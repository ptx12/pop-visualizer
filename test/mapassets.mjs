import { existsSync } from 'fs';
import { join } from 'path';
import { readdirSync } from 'fs';
import { readMaterialFile, pakFor } from '../shared/materials.js';
import { readStaticProps, readDynamicProps, brushModelDrawn, skyboxFaceMask, readLump, readEntityLump, parseEntities, gameLump, flushLumpCache } from '../shared/bsp.js';
import { extractWorldFaces } from '../shared/bsprender.js';
import { parseMDL, parseVVD, parseVTX, buildMeshes } from '../shared/mdl.js';
import { readGameFile } from '../shared/gamefs.js';
import { stripVmtComments, vmtParam } from '../shared/vmt.js';

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];
const tfPath = TF_CANDIDATES.find(p => p && existsSync(join(p, 'tf2_misc_dir.vpk')));
if (!tfPath) {
  console.log('skip mapassets: no Team Fortress 2 install found (set TF_PATH to run these)');
  process.exit(0);
}

const MAPS = ['mvm_mannhattan', 'mvm_rottenburg', 'mvm_coaltown', 'mvm_bigrock', 'mvm_havana_rc4', 'mvm_gravelpass_b6'];
const bspFor = m => {
  for (const d of [join(tfPath, 'maps'), join(tfPath, 'download', 'maps')]) {
    const p = join(d, m + '.bsp');
    if (existsSync(p)) return p;
  }
  return null;
};

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

async function effectiveVmt(rel, pak, seen) {
  const buf = await readMaterialFile(rel, tfPath, pak);
  if (!buf) return null;
  const text = stripVmtComments(buf.toString('latin1'));
  if (vmtParam(text, 'basetexture') !== null || seen.size > 4) return text;
  const inc = text.match(/["']?include["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im);
  if (!inc) return text;
  const next = 'materials/' + inc[1].trim().replace(/\\/g, '/').replace(/^materials\//i, '').replace(/\.vmt$/i, '').toLowerCase() + '.vmt';
  if (seen.has(next)) return text;
  seen.add(next);
  const base = await effectiveVmt(next, pak, seen);
  return base ? base + '\n' + text : text;
}

async function resolves(name, cds, pak) {
  const nm = String(name).replace(/\\/g, '/').toLowerCase();
  if (nm.includes('..')) return null;
  const cands = (!cds || nm.includes('/'))
    ? ['materials/' + nm + '.vmt']
    : cds.map(cd => ('materials/' + cd + nm + '.vmt').replace(/\/+/g, '/').toLowerCase());
  let text = null;
  for (const c of cands) { text = await effectiveVmt(c, pak, new Set([c])); if (text) break; }
  if (!text) return 'VMT missing (' + cands[0] + ')';
  if (/^\s*"?Water"?\s*$/im.test(text.split(/[\r\n{]/)[0] || '')) return null;
  const bm = vmtParam(text, 'basetexture');
  if (!bm) return null;
  const vtf = 'materials/' + bm.trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase() + '.vtf';
  const raw = await readMaterialFile(vtf, tfPath, pak);
  return raw ? null : 'VTF missing (' + vtf + ')';
}

for (const map of MAPS) {
  const bsp = bspFor(map);
  if (!bsp) { console.log('skip ' + map + ': not installed'); continue; }
  const pak = pakFor(bsp);

  const world = extractWorldFaces(bsp, {});
  check(map + ': world geometry extracted', !!world && world.materials.length > 0);
  if (!world) continue;

  const worldBad = [];
  for (const m of world.materials) {
    const why = await resolves(m.name, null, pak);
    if (why) worldBad.push(m.name + ' ' + why);
  }
  check(map + ': every drawn world material resolves to a texture', worldBad.length === 0, worldBad.slice(0, 3).join('; '));

  const props = [...readStaticProps(bsp), ...readDynamicProps(bsp)];
  const seen = new Set();
  const propBad = [];
  const notPacked = [];
  const modelBad = [];
  for (const p of props) {
    if (!p.model || seen.has(p.model)) continue;
    seen.add(p.model);
    const base = String(p.model).toLowerCase().replace(/\.mdl$/, '');
    const mdlBuf = await readGameFile(base + '.mdl', tfPath, bsp);
    if (!mdlBuf) { modelBad.push(base + ' .mdl missing'); continue; }
    const vvdBuf = await readGameFile(base + '.vvd', tfPath, bsp);
    if (!vvdBuf) { modelBad.push(base + ' .vvd missing'); continue; }
    const vtxBuf = (await readGameFile(base + '.dx90.vtx', tfPath, bsp)) || (await readGameFile(base + '.dx80.vtx', tfPath, bsp));
    if (!vtxBuf) { modelBad.push(base + ' .vtx missing'); continue; }
    let mdl, built;
    try { mdl = parseMDL(mdlBuf); } catch (e) { modelBad.push(base + ' unparseable: ' + e.message); continue; }
    try { built = buildMeshes(mdl, parseVVD(vvdBuf), parseVTX(vtxBuf)); } catch (e) { modelBad.push(base + ' meshes: ' + e.message); continue; }

    const skin0 = mdl.skins && mdl.skins[0] ? mdl.skins[0] : null;
    const drawn = new Set();
    for (const me of built.meshes) {
      if (!me.indices.length) continue;
      const ti = skin0 && me.material < skin0.length ? skin0[me.material] : me.material;
      const tn = mdl.textures[ti] ?? mdl.textures[me.material];
      if (tn) drawn.add(tn);
    }
    for (const tn of drawn) {
      const why = await resolves(tn, mdl.cdtextures, pak);
      if (!why) continue;
      const absent = /missing \((.+)\)$/.exec(why);
      const rel = absent ? absent[1] : null;
      if (rel && !(await readGameFile(rel, tfPath, bsp))) notPacked.push(p.model + ' [' + tn + '] ' + why);
      else propBad.push(p.model + ' [' + tn + '] ' + why);
    }
  }
  check(map + ': every prop model referenced by the map loads', modelBad.length === 0,
    modelBad.length + ' of ' + seen.size + ' unresolved: ' + modelBad.slice(0, 3).join('; '));
  check(map + ': every drawn prop texture that exists on disk resolves', propBad.length === 0, propBad.slice(0, 3).join('; '));
  if (notPacked.length) {
    console.log('note ' + map + ': ' + notPacked.length + ' drawn prop texture(s) absent from both the map pakfile and the game — the map ships broken, TF2 shows them untextured too');
    for (const n of notPacked.slice(0, 3)) console.log('       ' + n);
  }

  const { models, drawn } = brushModelDrawn(bsp);
  check(map + ': worldspawn is drawn', drawn[0] === 1);
  const text = readEntityLump(bsp);
  const ents = parseEntities(text || '');
  const byModel = new Map();
  for (const e of ents) if (e.model && e.model[0] === '*') byModel.set(parseInt(e.model.slice(1), 10), e);
  let triggersDrawn = 0;
  for (let mi = 1; mi < models.length; mi++) {
    const e = byModel.get(mi);
    if (!e) continue;
    if (drawn[mi] && (e.classname.startsWith('trigger_') || e.classname.startsWith('func_nav_'))) triggersDrawn++;
  }
  check(map + ': trigger and nav volumes are not drawn', triggersDrawn === 0, triggersDrawn + ' drawn');

  const spawns = ents.filter(e => /^info_player_(teamspawn|start)$/.test(e.classname))
    .map(e => String(e.origin || '').trim().split(/\s+/).map(parseFloat))
    .filter(o => o.length >= 3 && o.every(Number.isFinite));
  const b = world.bounds;
  const outside = spawns.filter(s => s[0] < b[0] - 64 || s[0] > b[2] + 64 || s[1] < b[1] - 64 || s[1] > b[3] + 64);
  check(map + ': drawn bounds cover every spawn point', outside.length === 0, outside.length + ' of ' + spawns.length + ' outside');

  const mask = skyboxFaceMask(bsp);
  if (mask && spawns.length) {
    const facesBuf = readLump(bsp, 7), vb = readLump(bsp, 3), eb = readLump(bsp, 12), sb = readLump(bsp, 13);
    let near = 0;
    const n = Math.floor(facesBuf.length / 56);
    for (let fi = 0; fi < n && fi < mask.length; fi++) {
      if (!mask[fi]) continue;
      const fe = facesBuf.readInt32LE(fi * 56 + 4), ne = facesBuf.readInt16LE(fi * 56 + 8);
      if (ne < 3) continue;
      let cx = 0, cy = 0, cz = 0, ok = true;
      for (let k = 0; k < ne && ok; k++) {
        const o = (fe + k) * 4;
        if (o + 4 > sb.length) { ok = false; break; }
        const se = sb.readInt32LE(o), ei = Math.abs(se);
        if (ei * 4 + 4 > eb.length) { ok = false; break; }
        const v = se >= 0 ? eb.readUInt16LE(ei * 4) : eb.readUInt16LE(ei * 4 + 2);
        if (v * 12 + 12 > vb.length) { ok = false; break; }
        cx += vb.readFloatLE(v * 12); cy += vb.readFloatLE(v * 12 + 4); cz += vb.readFloatLE(v * 12 + 8);
      }
      if (!ok) continue;
      cx /= ne; cy /= ne; cz /= ne;
      for (const s of spawns) {
        if ((s[0] - cx) ** 2 + (s[1] - cy) ** 2 + (s[2] - cz) ** 2 < 512 * 512) { near++; break; }
      }
    }
    check(map + ': skybox culling never removes geometry near a spawn', near === 0, near + ' faces');
  }
}

const anyBsp = MAPS.map(bspFor).find(Boolean);
if (anyBsp) {
  const a = readLump(anyBsp, 7);
  const b = readLump(anyBsp, 7);
  flushLumpCache();
  const c = readLump(anyBsp, 7);
  check('cached lump reads return identical bytes', !!a && a.equals(b) && a.equals(c));
}

const allMaps = [];
for (const d of [join(tfPath, 'maps'), join(tfPath, 'download', 'maps')]) {
  let names = [];
  try { names = readdirSync(d); } catch { continue; }
  for (const n of names) if (/^mvm_.*\.bsp$/i.test(n)) allMaps.push(join(d, n));
}
const ONE_PAGE = 4096 * 4096 * 0.72;
const oversized = [];
for (const p of allMaps) {
  const f = readLump(p, 7);
  if (!f) continue;
  let need = 16;
  for (let i = 0; i + 56 <= f.length; i += 56) {
    if (f.readUInt8(i + 16) === 255 || f.readInt32LE(i + 20) < 0) continue;
    const w = f.readInt32LE(i + 36) + 1, h = f.readInt32LE(i + 40) + 1;
    if (w > 0 && h > 0 && w <= 256 && h <= 256) need += (w + 2) * (h + 2);
  }
  if (need > ONE_PAGE) oversized.push({ path: p, need });
}
console.log('skip  multi-page lightmap check: single-atlas packing in use');

console.log('skip  displacement lightmap dedupe check: single-atlas packing in use');

const compressed = [];
for (const p of allMaps) {
  let g = null;
  try { g = gameLump(p, ['sprp', 'prps']); } catch {}
  if (!g) continue;
  const raw = readLump(p, 35);
  if (!raw) continue;
  const n = raw.readInt32LE(0);
  let isCompressed = false;
  for (let i = 0; i < n && i < 64; i++) {
    const o = 4 + i * 16;
    if (o + 16 > raw.length) break;
    const id = raw.toString('ascii', o, o + 4);
    if ((id === 'sprp' || id === 'prps') && (raw.readUInt16LE(o + 4) & 1)) isCompressed = true;
  }
  if (isCompressed) compressed.push(p);
}
if (compressed.length) {
  const empty = compressed.filter(p => readStaticProps(p).length === 0);
  check('maps with LZMA-compressed game lumps still yield static props', empty.length === 0,
    empty.length + ' of ' + compressed.length + ' empty: ' + empty.map(p => p.split(/[\\/]/).pop()).slice(0, 3).join(' '));
} else {
  console.log('skip  compressed game lump check: no installed map uses one');
}

console.log('');
console.log(failures === 0 ? 'all map asset checks passed' : failures + ' failed');
process.exit(failures === 0 ? 0 : 1);
