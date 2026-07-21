import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeVTF } from '../shared/vtf.js';
import { encodePNG } from '../shared/png.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { appRoot } from './context.js';
import { detectTFPath } from './tfpath.js';

const vpkIndexCache = new Map();
const dirIndexCache = new Map();
const iconDataCache = new Map();

function vpkIcons(vpkPath) {
  if (vpkIndexCache.has(vpkPath)) return vpkIndexCache.get(vpkPath);
  let map = new Map();
  try {
    const entries = indexVPK(vpkPath, (ext, dir, name) => ext === 'vtf' && dir.startsWith('materials/hud') && name.startsWith('leaderboard_class_'));
    for (const [key, entry] of entries) {
      const name = key.split('/').pop().replace(/\.vtf$/, '');
      map.set(name, entry);
    }
  } catch {}
  vpkIndexCache.set(vpkPath, map);
  return map;
}

async function loadVPKIcon(vpkPath, name) {
  const cacheKey = 'vpk:' + vpkPath + ':' + name;
  if (iconDataCache.has(cacheKey)) return iconDataCache.get(cacheKey);
  let url = null;
  try {
    const entry = vpkIcons(vpkPath).get(name);
    if (entry) {
      const buf = readVPKEntry(vpkPath, entry);
      const { width, height, rgba } = decodeVTF(buf);
      url = 'data:image/png;base64,' + encodePNG(rgba, width, height).toString('base64');
    }
  } catch {}
  iconDataCache.set(cacheKey, url);
  return url;
}

async function tfIconSources(tfPath) {
  if (!tfPath) return [];
  const sources = [{ type: 'dir', path: path.join(tfPath, 'download', 'materials', 'hud') }];
  try {
    const customs = await fs.readdir(path.join(tfPath, 'custom'), { withFileTypes: true });
    for (const c of customs) {
      if (c.isDirectory() && c.name !== 'workshop') sources.push({ type: 'dir', path: path.join(tfPath, 'custom', c.name, 'materials', 'hud') });
    }
  } catch {}
  sources.push({ type: 'vpk', path: path.join(tfPath, 'tf2_textures_dir.vpk') });
  return sources;
}

async function indexIconDir(dir) {
  if (dirIndexCache.has(dir)) return dirIndexCache.get(dir);
  const map = new Map();
  async function walk(d, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        await walk(full, depth + 1);
        continue;
      }
      const lower = e.name.toLowerCase();
      if (!lower.startsWith('leaderboard_class_')) continue;
      if (lower.endsWith('.png') || lower.endsWith('.vtf')) {
        const name = lower.replace(/\.(png|vtf)$/, '');
        const existing = map.get(name);
        if (!existing || (existing.endsWith('.vtf') && lower.endsWith('.png'))) map.set(name, full);
      }
    }
  }
  await walk(dir, 0);
  dirIndexCache.set(dir, map);
  return map;
}

async function loadIconFile(file) {
  if (iconDataCache.has(file)) return iconDataCache.get(file);
  let url = null;
  try {
    const buf = await fs.readFile(file);
    let png;
    if (file.toLowerCase().endsWith('.vtf')) {
      const { width, height, rgba } = decodeVTF(buf);
      png = encodePNG(rgba, width, height);
    } else {
      png = buf;
    }
    url = 'data:image/png;base64,' + png.toString('base64');
  } catch {}
  iconDataCache.set(file, url);
  return url;
}

function sourceLabel(s) {
  if (s.type === 'vpk') return 'vanilla vpk';
  if (/[\\/]download[\\/]/i.test(s.path)) return 'download';
  const m = s.path.match(/[\\/]custom[\\/]([^\\/]+)/i);
  if (m) return 'custom: ' + m[1];
  return 'folder';
}

export function register() {
  ipcMain.handle('icons:resolve', async (e, names, extraDirs, tfPathOverride) => {
    const bundled = path.join(appRoot, 'icons');
    const out = {};
    const tfPath = tfPathOverride || await detectTFPath();
    const sources = [];
    for (const d of extraDirs || []) sources.push({ type: 'dir', path: d });
    sources.push(...await tfIconSources(tfPath));
    const dirMaps = new Map();
    for (const s of sources) {
      if (s.type === 'dir') dirMaps.set(s.path, await indexIconDir(s.path));
    }
    for (const rawName of names) {
      const name = String(rawName).toLowerCase();
      let url = null;
      for (const s of sources) {
        if (s.type === 'dir') {
          const m = dirMaps.get(s.path);
          if (m.has(name)) url = await loadIconFile(m.get(name));
        } else {
          url = await loadVPKIcon(s.path, name);
        }
        if (url) break;
      }
      if (!url) {
        const bundledFile = path.join(bundled, name + '.png');
        try { await fs.access(bundledFile); url = await loadIconFile(bundledFile); } catch {}
      }
      out[rawName] = url;
    }
    return out;
  });

  ipcMain.handle('icons:refresh', () => {
    dirIndexCache.clear();
    iconDataCache.clear();
    vpkIndexCache.clear();
  });

  ipcMain.handle('icons:list', async (e, extraDirs, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    const sources = [];
    for (const d of extraDirs || []) sources.push({ type: 'dir', path: d });
    sources.push(...await tfIconSources(tfPath));
    const out = new Map();
    for (const s of sources) {
      const label = sourceLabel(s);
      if (s.type === 'vpk') {
        for (const name of vpkIcons(s.path).keys()) if (!out.has(name)) out.set(name, label);
      } else {
        for (const name of (await indexIconDir(s.path)).keys()) if (!out.has(name)) out.set(name, label);
      }
    }
    try {
      for (const n of await fs.readdir(path.join(appRoot, 'icons'))) {
        const lower = n.toLowerCase();
        if (lower.startsWith('leaderboard_class_') && lower.endsWith('.png')) {
          const name = lower.slice(0, -4);
          if (!out.has(name)) out.set(name, 'bundled');
        }
      }
    } catch {}
    return [...out.entries()].map(([name, source]) => ({ name, source })).sort((a, b) => a.name.localeCompare(b.name));
  });
}
