import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readEntityLump, parseEntities, pathTracks, chainLength, readModels, pakEntries, readPakEntry, readStaticProps, readDynamicProps, flushLumpCache } from '../shared/bsp.js';
import { parseNav } from '../shared/nav.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { extractGeometry } from '../shared/bspgeo.js';
import { bakeTopDown, extractWorldFaces } from '../shared/bsprender.js';
import { extractLighting } from '../shared/lighting.js';
import { lru } from './context.js';
import { detectTFPath, flushTFPath } from './tfpath.js';
import { makeMaterialLoader, flushMaterialCaches } from './materials.js';
import { extractMapEntities } from './mapentities.js';
import { rankNavCandidates, nearNavNames } from '../shared/navpick.js';
import { flushGameFS, setExtraAssetRoots, getExtraAssetRoots } from '../shared/gamefs.js';
import { readTonemapSettings, tonemapWithDefaults } from '../shared/tonemap.js';
import { loadEntitySim, entitySimMovers, entitySimPathChain, flushEntitySims } from '../shared/entssim.js';

const bspTrackCache = lru(24);
const mapDataCache = lru(12);
const mapGeoCache = lru(4);
const mapTexCache = lru(4);
const mapFaces3dCache = lru(3);
const mapLightCache = lru(3);

export function flushMapCaches() {
  mapDataCache.clear();
  mapTexCache.clear();
  mapFaces3dCache.clear();
  flushLumpCache();
  flushGameFS();
  flushMaterialCaches();
  flushEntitySims();
}

export async function mapDirs(tfPath, popDir) {
  const dirs = [];
  if (popDir) {
    dirs.push(popDir);
    dirs.push(path.join(popDir, 'maps'));
    dirs.push(path.join(path.dirname(popDir), 'maps'));
  }
  for (const r of getExtraAssetRoots()) {
    dirs.push(r);
    dirs.push(path.join(r, 'maps'));
    dirs.push(path.join(r, 'download', 'maps'));
  }
  dirs.push(path.join(tfPath, 'maps'), path.join(tfPath, 'download', 'maps'));
  try {
    const customs = await fs.readdir(path.join(tfPath, 'custom'), { withFileTypes: true });
    for (const c of customs) {
      if (!c.isDirectory() || c.name === 'workshop') continue;
      dirs.push(path.join(tfPath, 'custom', c.name, 'maps'));
      dirs.push(path.join(tfPath, 'custom', c.name, 'download', 'maps'));
    }
  } catch {}
  return dirs;
}

async function listBSPs(tfPath, popDir) {
  const out = [];
  for (const d of await mapDirs(tfPath, popDir)) {
    try {
      for (const n of await fs.readdir(d)) {
        if (n.toLowerCase().endsWith('.bsp')) out.push({ name: n.toLowerCase().replace(/\.bsp$/, ''), full: path.join(d, n) });
      }
    } catch {}
  }
  return out;
}

const ambientCache = new Map();

function skyAmbientOf(bspPath) {
  if (ambientCache.has(bspPath)) return ambientCache.get(bspPath);
  let out = null;
  try {
    const ents = parseEntities(readEntityLump(bspPath));
    const le = ents.find(e => e.classname === 'light_environment');
    if (le) {
      const pick = raw => {
        if (!raw) return null;
        const v = String(raw).trim().split(/\s+/).map(Number);
        if (v.length < 3 || v.some(n => !Number.isFinite(n)) || v[0] < 0) return null;
        return [v[0], v[1], v[2]];
      };
      const rgb = pick(le._ambienthdr) || pick(le._ambient);
      if (rgb) {
        const lum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        if (lum > 1) out = rgb.map(c => c / lum);
      }
    }
  } catch {}
  ambientCache.set(bspPath, out);
  return out;
}

function bspTracksFor(bspPath) {
  if (bspTrackCache.has(bspPath)) return bspTrackCache.get(bspPath);
  let tracks = null;
  try {
    const text = readEntityLump(bspPath);
    if (text) tracks = pathTracks(parseEntities(text));
  } catch {}
  return bspTrackCache.set(bspPath, tracks);
}

export async function findBSPFor(popName, tfPath, popDir) {
  const base = String(popName).toLowerCase().replace(/\.pop$/, '');
  const bsps = await listBSPs(tfPath, popDir);
  let best = null;
  for (const b of bsps) {
    if ((base === b.name || base.startsWith(b.name + '_')) && (!best || b.name.length > best.name.length)) best = b;
  }
  return best;
}

async function looseNavs(tfPath, popDir) {
  const out = [];
  for (const d of await mapDirs(tfPath, popDir)) {
    try {
      for (const n of await fs.readdir(d)) {
        if (n.toLowerCase().endsWith('.nav')) out.push({ name: n.toLowerCase().replace(/\.nav$/, ''), kind: 'file', where: path.join(d, n) });
      }
    } catch {}
  }
  return out;
}

function vpkNavs(tfPath) {
  const out = [];
  try {
    const vpk = path.join(tfPath, 'tf2_misc_dir.vpk');
    const entries = indexVPK(vpk, (ext, dir) => ext === 'nav' && dir.startsWith('maps'));
    for (const [key, entry] of entries) {
      out.push({ name: key.split('/').pop().replace(/\.nav$/, ''), kind: 'vpk', where: vpk, entry });
    }
  } catch {}
  return out;
}

export function sharedPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

async function readNavCandidate(c) {
  if (c.kind === 'file') return await fs.readFile(c.where);
  if (c.kind === 'vpk') return readVPKEntry(c.where, c.entry);
  return readPakEntry(c.where, c.entry);
}

async function loadNavFor(bsp, tfPath, popDir) {
  const searched = await mapDirs(tfPath, popDir);
  const candidates = [...await looseNavs(tfPath, popDir), ...vpkNavs(tfPath)];
  try {
    for (const p of pakEntries(bsp.full)) {
      if (p.name.endsWith('.nav')) candidates.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', where: bsp.full, entry: p, size: p.uncompSize });
    }
  } catch {}
  const ordered = rankNavCandidates(candidates, bsp.name);
  const near = nearNavNames(candidates, bsp.name);
  if (!ordered.length) return { nav: null, searched, near, reason: 'missing' };

  let lastReason = 'missing';
  for (const pick of ordered) {
    let nav = null;
    try {
      const buf = await readNavCandidate(pick);
      if (!buf) { lastReason = 'unreadable'; continue; }
      nav = parseNav(buf);
    } catch (err) {
      lastReason = 'error: ' + err.message;
      continue;
    }
    if (!nav.areas.length) { lastReason = 'empty:' + pick.name; continue; }
    return {
      searched, near,
      nav: {
        source: pick.kind,
        name: pick.kind === 'pak' ? bsp.name : pick.name,
        packedAs: pick.kind === 'pak' && pick.name !== bsp.name ? pick.name : null,
        approx: pick.rank === 1,
        where: pick.kind === 'file' ? pick.where : pick.kind,
        areas: nav.areas.map(a => {
          const out = { id: a.id, nw: a.nw, se: a.se, neZ: a.neZ, swZ: a.swZ, connect: a.connect };
          if (a.hide) out.hide = a.hide;
          if (a.tfAttributes) out.tf = a.tfAttributes;
          return out;
        })
      }
    };
  }
  return { nav: null, searched, near, reason: lastReason };
}

async function mapDataFor(best, tfPath, popDir) {
  if (mapDataCache.has(best.full)) return mapDataCache.get(best.full);
  let result = null;
  try {
    const text = readEntityLump(best.full);
    if (!text) return null;
    const ents = parseEntities(text);
    const models = readModels(best.full);
    await loadEntitySim(best.full, best.name);
    const ent = extractMapEntities(ents, models, entitySimMovers(best.full));
    const navLookup = await loadNavFor(best, tfPath, popDir);
    result = {
      map: best.name,
      ...ent,
      tonemap: readTonemapSettings(ents),
      nav: navLookup.nav,
      navSearch: { searched: navLookup.searched, near: navLookup.near, reason: navLookup.reason || null }
    };
  } catch {
    result = null;
  }
  return mapDataCache.set(best.full, result);
}

export function register() {
  ipcMain.handle('tank:path', async (e, popName, tfPathOverride, starts, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    const sim = await loadEntitySim(best.full, best.name);
    const tracks = sim ? null : bspTracksFor(best.full);
    if (!sim && !tracks) return { map: best.name, results: {}, unreadable: true };
    const chain = name => (sim ? entitySimPathChain(best.full, name) : chainLength(tracks, name));
    const results = {};
    for (const rawStart of starts || []) {
      const start = String(rawStart).toLowerCase();
      let matched = start;
      let r = chain(start);
      if (!r) {
        const alt = start.replace(/_([a-z])(\d+)$/, '_$2');
        if (alt !== start) {
          r = chain(alt);
          if (r) matched = alt;
        }
      }
      if (r) results[rawStart] = { ...r, matched, approx: matched !== start };
    }
    return { map: best.name, results };
  });

  ipcMain.handle('map:data', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    return mapDataFor(best, tfPath, popDir);
  });

  ipcMain.handle('map:geo', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    if (mapGeoCache.has(best.full)) return mapGeoCache.get(best.full);
    let result = null;
    try {
      const g = extractGeometry(best.full);
      if (g) result = { polys: g.polys, bounds: g.bounds, zRange: g.zRange, lit: g.lit, data: Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength) };
    } catch {}
    return mapGeoCache.set(best.full, result);
  });

  ipcMain.handle('map:texture', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    if (mapTexCache.has(best.full)) return mapTexCache.get(best.full);
    let result = null;
    try {
      const data = await mapDataFor(best, tfPath, popDir);
      const baked = await bakeTopDown(best.full, makeMaterialLoader(tfPath, best.full), {
        nav: data ? data.nav : (await loadNavFor(best, tfPath, popDir)).nav,
        spawns: data ? data.spawns : [],
        tracks: data ? data.tracks : [],
        moverTracks: entitySimMovers(best.full)
      });
      if (baked) {
        result = { width: baked.width, height: baked.height, bounds: baked.bounds, rgba: Buffer.from(baked.rgba.buffer, baked.rgba.byteOffset, baked.rgba.byteLength) };
        const hg = baked.heightGrid;
        if (hg) result.heightGrid = { grid: Buffer.from(hg.grid.buffer, hg.grid.byteOffset, hg.grid.byteLength), gw: hg.gw, gh: hg.gh, cellPx: hg.cellPx, zMin: hg.zMin, zMax: hg.zMax };
      }
    } catch (err) { console.error('[map:texture]', err); }
    return mapTexCache.set(best.full, result);
  });

  ipcMain.handle('map:faces3d', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    if (mapFaces3dCache.has(best.full)) return mapFaces3dCache.get(best.full);
    let result = null;
    try {
      const data = await mapDataFor(best, tfPath, popDir);
      const tonemap = data ? data.tonemap : null;
      const w = extractWorldFaces(best.full, {
        nav: data ? data.nav : (await loadNavFor(best, tfPath, popDir)).nav,
        spawns: data ? data.spawns : [],
        tracks: data ? data.tracks : [],
        tonemap,
        moverTracks: entitySimMovers(best.full)
      });
      if (w) {
        const buf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        result = {
          bsp: best.full,
          bounds: w.bounds,
          exposure: w.exposure,
          minLight: w.minLight,
          lmUpBright: w.lmUpBright,
          ambient: skyAmbientOf(best.full),
          tonemap: tonemapWithDefaults(tonemap),
          materials: w.materials.map(m => ({ name: m.name, mover: m.mover, count: m.count, positions: buf(m.positions), uvs: buf(m.uvs), normals: buf(m.normals), lm: buf(m.lm) })),
          movers: w.movers || [],
          lightmap: w.lightmap ? { width: w.lightmap.width, height: w.lightmap.height, range: w.lightmap.range, rgba: buf(w.lightmap.rgba) } : null
        };
      }
    } catch (err) { console.error('[map:faces3d]', err); }
    return mapFaces3dCache.set(best.full, result);
  });

  ipcMain.handle('map:props', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    try {
      const stat = readStaticProps(best.full);
      const dyn = readDynamicProps(best.full);
      const seen = new Set();
      const out = [];
      for (const p of stat.concat(dyn)) {
        const key = p.model + '@' + Math.round(p.origin[0]) + ',' + Math.round(p.origin[1]) + ',' + Math.round(p.origin[2]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
      return { props: out, bsp: best.full };
    } catch { return { props: [], bsp: best.full }; }
  });

  ipcMain.handle('nav:use', async (e, popName, sourceName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return { error: 'TF folder not found' };
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return { error: 'no matching BSP' };
    const src = String(sourceName).toLowerCase().replace(/\.nav$/, '');
    if (!/^[a-z0-9_\-.]+$/.test(src)) return { error: 'bad nav name' };
    const candidates = [...await looseNavs(tfPath, popDir), ...vpkNavs(tfPath)];
    try {
      for (const p of pakEntries(best.full)) {
        if (p.name.endsWith('.nav')) candidates.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', where: best.full, entry: p });
      }
    } catch {}
    const pick = candidates.find(c => c.name === src);
    if (!pick) return { error: src + '.nav not found' };
    let buf = null;
    try {
      if (pick.kind === 'file') buf = await fs.readFile(pick.where);
      else if (pick.kind === 'vpk') buf = readVPKEntry(pick.where, pick.entry);
      else buf = readPakEntry(pick.where, pick.entry);
    } catch (err) { return { error: err.message }; }
    if (!buf) return { error: src + '.nav could not be read' };
    const dest = path.join(tfPath, 'download', 'maps', best.name + '.nav');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    flushMapCaches();
    return { saved: dest, source: src, renamed: src !== best.name };
  });

  ipcMain.handle('map:lighting', async (e, popName, tfPathOverride, popDir) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const best = await findBSPFor(popName, tfPath, popDir);
    if (!best) return null;
    if (mapLightCache.has(best.full)) return mapLightCache.get(best.full);
    let result = null;
    try {
      const L = extractLighting(best.full);
      if (L) {
        const buf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        result = {
          planes: buf(L.planes), nodes: buf(L.nodes),
          leafMins: buf(L.leafMins), leafMaxs: buf(L.leafMaxs),
          ambCount: buf(L.ambCount), ambFirst: buf(L.ambFirst),
          cubes: buf(L.cubes), ambPos: buf(L.ambPos),
          lights: L.lights
        };
      }
    } catch (err) { console.error('[map:lighting]', err); }
    return mapLightCache.set(best.full, result);
  });

  ipcMain.handle('map:flush', () => {
    mapDataCache.clear();
    mapGeoCache.clear();
    mapTexCache.clear();
    bspTrackCache.clear();
    flushMaterialCaches();
    flushTFPath();
  });

  ipcMain.handle('assets:roots', async (e, roots) => {
    if (Array.isArray(roots)) {
      setExtraAssetRoots(roots);
      flushMapCaches();
      mapGeoCache.clear();
      mapLightCache.clear();
      bspTrackCache.clear();
    }
    const out = [];
    for (const r of getExtraAssetRoots()) {
      let ok = false;
      try { ok = (await fs.stat(r)).isDirectory(); } catch {}
      out.push({ path: r, exists: ok });
    }
    return out;
  });
}
