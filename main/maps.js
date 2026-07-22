import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readEntityLump, parseEntities, pathTracks, chainLength, readModels, pakEntries, readPakEntry } from '../shared/bsp.js';
import { parseNav } from '../shared/nav.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { extractGeometry } from '../shared/bspgeo.js';
import { bakeTopDown } from '../shared/bsprender.js';
import { lru } from './context.js';
import { detectTFPath, flushTFPath } from './tfpath.js';
import { makeMaterialLoader } from './materials.js';
import { extractMapEntities } from './mapentities.js';

const bspTrackCache = lru(24);
const mapDataCache = lru(12);
const mapGeoCache = lru(4);
const mapTexCache = lru(4);

export function flushMapCaches() {
  mapDataCache.clear();
  mapTexCache.clear();
}

export async function mapDirs(tfPath, popDir) {
  const dirs = [];
  if (popDir) {
    dirs.push(popDir);
    dirs.push(path.join(popDir, 'maps'));
    dirs.push(path.join(path.dirname(popDir), 'maps'));
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

function bspTracksFor(bspPath) {
  if (bspTrackCache.has(bspPath)) return bspTrackCache.get(bspPath);
  let tracks = null;
  try {
    const text = readEntityLump(bspPath);
    if (text) tracks = pathTracks(parseEntities(text));
  } catch {}
  return bspTrackCache.set(bspPath, tracks);
}

async function findBSPFor(popName, tfPath, popDir) {
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

async function loadNavFor(bsp, tfPath, popDir) {
  const searched = await mapDirs(tfPath, popDir);
  const candidates = [...await looseNavs(tfPath, popDir), ...vpkNavs(tfPath)];
  try {
    for (const p of pakEntries(bsp.full)) {
      if (p.name.endsWith('.nav')) candidates.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', where: bsp.full, entry: p });
    }
  } catch {}
  const near = [...new Set(candidates
    .filter(c => sharedPrefixLen(c.name, bsp.name) >= 5)
    .map(c => c.name))].slice(0, 8);
  let pick = candidates.find(c => c.name === bsp.name);
  let approx = false;
  if (!pick) {
    let bestLen = 0;
    for (const c of candidates) {
      const l = sharedPrefixLen(c.name, bsp.name);
      if (l >= 8 && l >= c.name.length - 6 && l > bestLen) { bestLen = l; pick = c; }
    }
    approx = !!pick;
  }
  if (!pick) return { nav: null, searched, near, reason: 'missing' };
  try {
    let buf = null;
    if (pick.kind === 'file') buf = await fs.readFile(pick.where);
    else if (pick.kind === 'vpk') buf = readVPKEntry(pick.where, pick.entry);
    else buf = readPakEntry(pick.where, pick.entry);
    if (!buf) return { nav: null, searched, near, reason: 'unreadable' };
    const nav = parseNav(buf);
    return {
      searched, near,
      nav: {
        source: pick.kind, name: pick.name, approx, where: pick.kind === 'file' ? pick.where : pick.kind,
        areas: nav.areas.map(a => {
          const out = { id: a.id, nw: a.nw, se: a.se, neZ: a.neZ, swZ: a.swZ, connect: a.connect };
          if (a.hide) out.hide = a.hide;
          if (a.tfAttributes) out.tf = a.tfAttributes;
          return out;
        })
      }
    };
  } catch (err) {
    return { nav: null, searched, near, reason: 'error: ' + err.message };
  }
}

async function mapDataFor(best, tfPath, popDir) {
  if (mapDataCache.has(best.full)) return mapDataCache.get(best.full);
  let result = null;
  try {
    const text = readEntityLump(best.full);
    if (!text) return null;
    const ents = parseEntities(text);
    const models = readModels(best.full);
    const ent = extractMapEntities(ents, models);
    const navLookup = await loadNavFor(best, tfPath, popDir);
    result = {
      map: best.name,
      ...ent,
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
    const tracks = bspTracksFor(best.full);
    if (!tracks) return { map: best.name, results: {}, unreadable: true };
    const results = {};
    for (const rawStart of starts || []) {
      const start = String(rawStart).toLowerCase();
      let matched = start;
      let r = chainLength(tracks, start);
      if (!r) {
        const alt = start.replace(/_([a-z])(\d+)$/, '_$2');
        if (alt !== start) {
          r = chainLength(tracks, alt);
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
        tracks: data ? data.tracks : []
      });
      if (baked) result = { width: baked.width, height: baked.height, bounds: baked.bounds, rgba: Buffer.from(baked.rgba.buffer, baked.rgba.byteOffset, baked.rgba.byteLength) };
    } catch (err) { console.error('[map:texture]', err); }
    return mapTexCache.set(best.full, result);
  });

  ipcMain.handle('map:flush', () => {
    mapDataCache.clear();
    mapGeoCache.clear();
    mapTexCache.clear();
    bspTrackCache.clear();
    flushTFPath();
  });
}
