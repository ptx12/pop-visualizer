import { ipcMain } from 'electron';
import { parsePCF } from '../shared/pcf.js';
import { readGameFile, listGameDir } from '../shared/gamefs.js';
import { decodeVTF } from '../shared/vtf.js';
import { detectTFPath } from './tfpath.js';
import { readMaterialFile } from './materials.js';

let systemIndex = null;
const fileCache = new Map();

const HARDWARE_FALLBACK = /_dx80\.pcf$|_dx90_slow\.pcf$/i;

async function readManifest(tfPath) {
  const buf = await readGameFile('particles/particles_manifest.txt', tfPath);
  if (!buf) return [];
  const text = buf.toString('latin1');
  const out = [];
  const re = /"file"\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].replace(/^!/, '').replace(/\\/g, '/').toLowerCase();
    if (p.endsWith('.pcf')) out.push(p);
  }
  return out;
}

async function pcfSources(tfPath) {
  const out = [];
  const taken = new Set();
  const add = rel => {
    if (taken.has(rel) || HARDWARE_FALLBACK.test(rel)) return;
    taken.add(rel);
    out.push(rel);
  };
  for (const rel of await readManifest(tfPath)) add(rel);
  for (const rel of await listGameDir('particles', 'pcf', tfPath)) add(rel);
  return out;
}

async function readSource(rel, tfPath) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  let parsed = null;
  try {
    const buf = await readGameFile(rel, tfPath);
    if (buf) parsed = parsePCF(buf);
  } catch {}
  fileCache.set(rel, parsed);
  return parsed;
}

async function buildIndex(tfPath) {
  if (systemIndex) return systemIndex;
  const map = new Map();
  for (const rel of await pcfSources(tfPath)) {
    const parsed = await readSource(rel, tfPath);
    if (!parsed || !parsed.systems) continue;
    for (const s of parsed.systems) {
      const k = s.name.toLowerCase();
      if (!map.has(k)) map.set(k, { src: rel, name: s.name });
    }
  }
  systemIndex = map;
  return map;
}

export function flushParticles() { systemIndex = null; fileCache.clear(); }

async function sheetFor(sys, tfPath) {
  if (!sys || !sys.material) return null;
  try {
    const vmt = await readMaterialFile('materials/' + sys.material + '.vmt', tfPath, null);
    if (!vmt) return null;
    const text = vmt.toString('latin1');
    sys.additive = /\$additive"?\s*"?1/i.test(text);
    const bm = text.match(/\$basetexture"?\s*"?([^"\r\n]+?)"?\s*$/im);
    if (!bm) return null;
    const rel = 'materials/' + bm[1].trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase() + '.vtf';
    const vtf = await readMaterialFile(rel, tfPath, null);
    if (!vtf) return null;
    const d = decodeVTF(vtf);
    return d ? { width: d.width, height: d.height, rgba: Buffer.from(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength) } : null;
  } catch {
    return null;
  }
}

export function register() {
  ipcMain.handle('particles:system', async (e, sysName, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath || !sysName) return null;
    const idx = await buildIndex(tfPath);
    const hit = idx.get(String(sysName).toLowerCase());
    if (!hit) return null;
    const parsed = await readSource(hit.src, tfPath);
    if (!parsed) return null;
    const sys = parsed.systems.find(s => s.name === hit.name);
    if (!sys) return null;

    const sheet = await sheetFor(sys, tfPath);
    const children = [];
    const seen = new Set([sys.name]);
    const walk = async (node, depth) => {
      if (depth > 4) return;
      for (const cname of (node.children || [])) {
        if (!cname || seen.has(cname)) continue;
        seen.add(cname);
        const child = parsed.systems.find(s => s.name === cname);
        if (!child) continue;
        children.push({ system: child, sheet: await sheetFor(child, tfPath) });
        await walk(child, depth + 1);
      }
    };
    await walk(sys, 0);
    return { system: sys, sheet, children };
  });

  ipcMain.handle('particles:list', async (e, pattern, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return [];
    const idx = await buildIndex(tfPath);
    const re = pattern ? new RegExp(String(pattern), 'i') : null;
    const out = [];
    for (const [k, v] of idx) if (!re || re.test(k)) out.push(v.name);
    return out.slice(0, 400);
  });
}
