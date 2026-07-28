import { ipcMain } from 'electron';
import { decodeVTF } from '../shared/vtf.js';
import { readMaterialFile, makeMaterialLoader, pakFor } from '../shared/materials.js';
import { detectTFPath } from './tfpath.js';

export { readMaterialFile, makeMaterialLoader };

function byteCache(maxBytes) {
  const map = new Map();
  let bytes = 0;
  return {
    has: k => map.has(k),
    get(k) {
      if (!map.has(k)) return undefined;
      const e = map.get(k);
      map.delete(k);
      map.set(k, e);
      return e.value;
    },
    set(k, value, size) {
      if (map.has(k)) { bytes -= map.get(k).size; map.delete(k); }
      map.set(k, { value, size });
      bytes += size;
      while (bytes > maxBytes && map.size > 1) {
        const oldest = map.keys().next().value;
        bytes -= map.get(oldest).size;
        map.delete(oldest);
      }
      return value;
    },
    clear() { map.clear(); bytes = 0; }
  };
}

const vmtCache = byteCache(16 * 1024 * 1024);
const texCache = byteCache(192 * 1024 * 1024);

export function flushMaterialCaches() {
  vmtCache.clear();
  texCache.clear();
}

function cleanRel(relPath) {
  const rel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return rel.includes('..') ? null : rel;
}

export function register() {
  ipcMain.handle('mat:read', async (e, relPath, tfPathOverride, bspPath) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const rel = cleanRel(relPath);
    if (!rel) return null;
    const key = tfPath + '|' + (bspPath || '') + '|' + rel;
    if (vmtCache.has(key)) return vmtCache.get(key);
    const buf = await readMaterialFile(rel, tfPath, pakFor(bspPath));
    return vmtCache.set(key, buf, buf ? buf.length : 0);
  });

  ipcMain.handle('mat:texture', async (e, relPath, tfPathOverride, bspPath) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const rel = cleanRel(relPath);
    if (!rel) return null;
    const key = tfPath + '|' + (bspPath || '') + '|' + rel;
    if (texCache.has(key)) return texCache.get(key);
    const buf = await readMaterialFile(rel, tfPath, pakFor(bspPath));
    if (!buf) return texCache.set(key, null, 0);
    let out = null;
    try {
      const { width, height, rgba } = decodeVTF(buf);
      out = { width, height, rgba: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
    } catch {
      out = null;
    }
    return texCache.set(key, out, out ? out.rgba.length : 0);
  });
}
