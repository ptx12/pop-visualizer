import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeVTF } from '../shared/vtf.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { pakEntries, readPakEntry } from '../shared/bsp.js';
import { detectTFPath } from './tfpath.js';

const matVpkIndexes = new Map();

function pakIndexFor(bspPath) {
  const index = new Map();
  try {
    for (const e of pakEntries(bspPath)) {
      if (/^materials\/.*\.(vmt|vtf)$/.test(e.name)) index.set(e.name, e);
    }
  } catch {}
  return index;
}

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

export async function readMaterialFile(rel, tfPath, pak) {
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
  if (pak) {
    const entry = pak.index.get(rel);
    if (entry) { try { return readPakEntry(pak.path, entry); } catch {} }
  }
  for (const vpk of searchVPKs(tfPath, ext)) {
    const entry = matVpkIndex(vpk, ext).get(rel);
    if (entry) { try { return readVPKEntry(vpk, entry); } catch {} }
  }
  return null;
}

function searchVPKs(tfPath, ext) {
  const hl2 = path.join(path.dirname(tfPath), 'hl2');
  const tf = ext === 'vtf' ? ['tf2_textures_dir.vpk', 'tf2_misc_dir.vpk'] : ['tf2_misc_dir.vpk'];
  const base = ext === 'vtf' ? ['hl2_textures_dir.vpk', 'hl2_misc_dir.vpk'] : ['hl2_misc_dir.vpk', 'hl2_textures_dir.vpk'];
  return [...tf.map(n => path.join(tfPath, n)), ...base.map(n => path.join(hl2, n))];
}

const BASE_RE = /["']?\$basetexture["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im;
const BASE2_RE = /["']?\$basetexture2["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im;
const INCLUDE_RE = /include"?\s*"?([^"\r\n]+?)"?\s*$/im;

async function baseTextureOf(name, tfPath, pak, seen, depth = 0) {
  const buf = await readMaterialFile('materials/' + name + '.vmt', tfPath, pak);
  if (!buf) return null;
  const text = buf.toString('latin1');
  const m = text.match(BASE_RE) || text.match(BASE2_RE);
  if (m) return m[1].trim().replace(/\\/g, '/').toLowerCase();
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
  const pak = bspPath ? { path: bspPath, index: pakIndexFor(bspPath) } : null;
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
