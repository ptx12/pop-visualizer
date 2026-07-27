import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePCF } from '../shared/pcf.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { decodeVTF } from '../shared/vtf.js';
import { detectTFPath } from './tfpath.js';
import { readMaterialFile } from './materials.js';

let systemIndex = null;
const fileCache = new Map();

async function pcfSources(tfPath) {
  const out = [];
  for (const dir of [path.join(tfPath, 'particles'), path.join(tfPath, 'download', 'particles')]) {
    try {
      for (const n of await fs.readdir(dir)) {
        if (n.toLowerCase().endsWith('.pcf')) out.push({ kind: 'file', where: path.join(dir, n) });
      }
    } catch {}
  }
  try {
    const vpk = path.join(tfPath, 'tf2_misc_dir.vpk');
    const idx = indexVPK(vpk, ext => ext === 'pcf');
    for (const [name, entry] of idx) out.push({ kind: 'vpk', where: vpk, entry, name });
  } catch {}
  return out;
}

async function readSource(src) {
  const key = src.kind + ':' + (src.name || src.where);
  if (fileCache.has(key)) return fileCache.get(key);
  let parsed = null;
  try {
    const buf = src.kind === 'file' ? await fs.readFile(src.where) : readVPKEntry(src.where, src.entry);
    parsed = parsePCF(buf);
  } catch {}
  fileCache.set(key, parsed);
  return parsed;
}

// name -> source, built once so a lookup doesn't reparse 134 files.
async function buildIndex(tfPath) {
  if (systemIndex) return systemIndex;
  const map = new Map();
  for (const src of await pcfSources(tfPath)) {
    const parsed = await readSource(src);
    if (!parsed || !parsed.systems) continue;
    for (const s of parsed.systems) {
      const k = s.name.toLowerCase();
      if (!map.has(k)) map.set(k, { src, name: s.name });
    }
  }
  systemIndex = map;
  return map;
}

export function flushParticles() { systemIndex = null; fileCache.clear(); }

export function register() {
  ipcMain.handle('particles:system', async (e, sysName, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath || !sysName) return null;
    const idx = await buildIndex(tfPath);
    const hit = idx.get(String(sysName).toLowerCase());
    if (!hit) return null;
    const parsed = await readSource(hit.src);
    if (!parsed) return null;
    const sys = parsed.systems.find(s => s.name === hit.name);
    if (!sys) return null;

    let sheet = null;
    if (sys.material) {
      try {
        const vmt = await readMaterialFile('materials/' + sys.material + '.vmt', tfPath, null);
        if (vmt) {
          const text = vmt.toString('latin1');
          const bm = text.match(/\$basetexture"?\s*"?([^"\r\n]+?)"?\s*$/im);
          if (bm) {
            const rel = 'materials/' + bm[1].trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase() + '.vtf';
            const vtf = await readMaterialFile(rel, tfPath, null);
            if (vtf) {
              const d = decodeVTF(vtf);
              if (d) sheet = { width: d.width, height: d.height, rgba: Buffer.from(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength) };
            }
          }
          // Additive/translucent blending is what nearly every particle material asks for.
          sys.additive = /\$additive"?\s*"?1/i.test(text);
        }
      } catch {}
    }
    return { system: sys, sheet };
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
