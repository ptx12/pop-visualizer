import { decodeVTF } from './vtf.js';
import { readGameFile, normalizeGamePath } from './gamefs.js';
import { stripVmtComments, vmtParam } from './vmt.js';

export function pakFor(bspPath) {
  return bspPath ? String(bspPath) : null;
}

export function normalizeMaterialPath(rel) {
  return normalizeGamePath(rel).replace(/\.vmt\.vmt$/, '.vmt').replace(/\.vtf\.vtf$/, '.vtf');
}

export async function readMaterialFile(rel, tfPath, pak) {
  return await readGameFile(normalizeMaterialPath(rel), tfPath, pak);
}

const INCLUDE_RE = /include"?\s*"?([^"\r\n]+?)"?\s*$/im;

export async function baseTextureOf(name, tfPath, pak, seen, depth = 0) {
  const buf = await readMaterialFile('materials/' + name + '.vmt', tfPath, pak);
  if (!buf) return null;
  const text = stripVmtComments(buf.toString('latin1'));
  const m = vmtParam(text, 'basetexture') || vmtParam(text, 'basetexture2');
  if (m) return m.replace(/\\/g, '/').toLowerCase();
  if (depth >= 4) return null;
  const inc = text.match(INCLUDE_RE);
  if (!inc) return null;
  const next = inc[1].trim().replace(/\\/g, '/').toLowerCase()
    .replace(/^materials\//, '').replace(/\.vmt$/, '');
  if (!next || seen.has(next)) return null;
  seen.add(next);
  return baseTextureOf(next, tfPath, pak, seen, depth + 1);
}

export function makeMaterialLoader(tfPath, bspPath) {
  const vmtCache = new Map();
  const decCache = new Map();
  const pak = pakFor(bspPath);
  return async name => {
    if (decCache.has(name)) return decCache.get(name);
    let base = vmtCache.get(name);
    if (base === undefined) {
      base = await baseTextureOf(name, tfPath, pak, new Set([name]));
      vmtCache.set(name, base);
    }
    let out = null;
    if (base) {
      const key = 'materials/' + base + '.vtf';
      if (decCache.has(key)) out = decCache.get(key);
      else {
        const vtfBuf = await readMaterialFile(key, tfPath, pak);
        if (vtfBuf) { try { const d = decodeVTF(vtfBuf); if (d) out = { rgba: d.rgba, width: d.width, height: d.height }; } catch {} }
        decCache.set(key, out);
      }
    }
    decCache.set(name, out);
    return out;
  };
}
