import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeVTF } from '../shared/vtf.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { detectTFPath } from './tfpath.js';

const matVpkIndexes = new Map();

function matVpkIndex(vpkPath, ext) {
  const key = vpkPath + ':' + ext;
  if (matVpkIndexes.has(key)) return matVpkIndexes.get(key);
  let map = new Map();
  try {
    map = indexVPK(vpkPath, (x, dir) => x === ext && dir.startsWith('materials'));
  } catch {}
  matVpkIndexes.set(key, map);
  return map;
}

export async function readMaterialFile(rel, tfPath) {
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const ext = rel.split('.').pop();
  for (const root of [path.join(tfPath, 'download'), tfPath]) {
    try { return await fs.readFile(path.join(root, rel)); } catch {}
  }
  try {
    const customs = await fs.readdir(path.join(tfPath, 'custom'), { withFileTypes: true });
    for (const c of customs) {
      if (!c.isDirectory() || /workshop/i.test(c.name)) continue;
      try { return await fs.readFile(path.join(tfPath, 'custom', c.name, rel)); } catch {}
    }
  } catch {}
  for (const vpkName of ext === 'vtf' ? ['tf2_textures_dir.vpk', 'tf2_misc_dir.vpk'] : ['tf2_misc_dir.vpk']) {
    const vpk = path.join(tfPath, vpkName);
    const entry = matVpkIndex(vpk, ext).get(rel);
    if (entry) { try { return readVPKEntry(vpk, entry); } catch {} }
  }
  return null;
}

export function makeMaterialLoader(tfPath) {
  const vmtCache = new Map();
  const decCache = new Map();
  return async name => {
    if (decCache.has(name)) return decCache.get(name);
    let base = vmtCache.get(name);
    if (base === undefined) {
      const vmtBuf = await readMaterialFile('materials/' + name + '.vmt', tfPath);
      const text = vmtBuf ? vmtBuf.toString('latin1') : '';
      let m = text.match(/["']?\$basetexture["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im);
      if (!m) m = text.match(/["']?\$basetexture2["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im);
      base = m ? m[1].trim().replace(/\\/g, '/').toLowerCase() : null;
      vmtCache.set(name, base);
    }
    let out = null;
    if (base) {
      const key = 'materials/' + base + '.vtf';
      if (decCache.has(key)) out = decCache.get(key);
      else {
        const vtfBuf = await readMaterialFile(key, tfPath);
        if (vtfBuf) { try { const d = decodeVTF(vtfBuf); if (d) out = { rgba: d.rgba, width: d.width, height: d.height }; } catch {} }
        decCache.set(key, out);
      }
    }
    decCache.set(name, out);
    return out;
  };
}

export function register() {
  ipcMain.handle('mat:read', async (e, relPath, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    const rel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (rel.includes('..')) return null;
    const ext = rel.split('.').pop();
    if (tfPath) {
      for (const root of [path.join(tfPath, 'download'), tfPath]) {
        try { return await fs.readFile(path.join(root, rel)); } catch {}
      }
      try {
        const customs = await fs.readdir(path.join(tfPath, 'custom'), { withFileTypes: true });
        for (const c of customs) {
          if (!c.isDirectory()) continue;
          try { return await fs.readFile(path.join(tfPath, 'custom', c.name, rel)); } catch {}
        }
      } catch {}
      for (const vpkName of ext === 'vtf' ? ['tf2_textures_dir.vpk', 'tf2_misc_dir.vpk'] : ['tf2_misc_dir.vpk']) {
        const vpk = path.join(tfPath, vpkName);
        const entry = matVpkIndex(vpk, ext).get(rel);
        if (entry) {
          try { return readVPKEntry(vpk, entry); } catch {}
        }
      }
    }
    return null;
  });

  ipcMain.handle('mat:texture', async (e, relPath, tfPathOverride) => {
    const rel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const tfPath = tfPathOverride || await detectTFPath();
    let buf = null;
    if (tfPath) {
      for (const root of [path.join(tfPath, 'download'), tfPath]) {
        try { buf = await fs.readFile(path.join(root, rel)); break; } catch {}
      }
      if (!buf) {
        for (const vpkName of ['tf2_textures_dir.vpk', 'tf2_misc_dir.vpk']) {
          const vpk = path.join(tfPath, vpkName);
          const entry = matVpkIndex(vpk, 'vtf').get(rel);
          if (entry) {
            try { buf = readVPKEntry(vpk, entry); break; } catch {}
          }
        }
      }
    }
    if (!buf) return null;
    try {
      const { width, height, rgba } = decodeVTF(buf);
      return { width, height, rgba: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
    } catch {
      return null;
    }
  });
}
