import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { indexVPK, readVPKEntry } from './vpk.js';
import { pakEntries, readPakEntry } from './bsp.js';

const TF_VPKS = ['tf2_textures_dir.vpk', 'tf2_sound_vo_english_dir.vpk', 'tf2_sound_misc_dir.vpk', 'tf2_misc_dir.vpk'];
const HL2_VPKS = ['hl2_textures_dir.vpk', 'hl2_sound_vo_english_dir.vpk', 'hl2_sound_misc_dir.vpk', 'hl2_misc_dir.vpk'];

const vpkIndexes = new Map();
const customMountCache = new Map();
const pakIndexes = new Map();
const searchPathCache = new Map();
let extraRoots = [];

export function flushGameFS() {
  vpkIndexes.clear();
  customMountCache.clear();
  pakIndexes.clear();
  searchPathCache.clear();
}

export function getExtraAssetRoots() {
  return extraRoots.slice();
}

export function setExtraAssetRoots(roots) {
  const next = (Array.isArray(roots) ? roots : [])
    .map(r => String(r || '').trim())
    .filter(Boolean)
    .map(r => path.resolve(r));
  const seen = new Set();
  extraRoots = next.filter(r => {
    const k = r.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  flushGameFS();
  return extraRoots.slice();
}

export function flushGamePak(bspPath) {
  if (bspPath) pakIndexes.delete(String(bspPath));
  else pakIndexes.clear();
}

export function normalizeGamePath(rel) {
  return String(rel).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '').toLowerCase();
}

function customMounts(tfPath) {
  const hit = customMountCache.get(tfPath);
  if (hit) return hit;
  const dir = path.join(tfPath, 'custom');
  let names = [];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.name[0] !== '.' && (e.isDirectory() || /\.vpk$/i.test(e.name)))
      .map(e => ({ name: e.name, dirEntry: e.isDirectory() }));
  } catch {}
  names.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
  const haveDir = new Set(names.filter(n => /_dir\.vpk$/i.test(n.name)).map(n => n.name.slice(0, -8).toLowerCase()));
  const out = [];
  for (const n of names) {
    const numbered = n.name.match(/^(.*)_\d{3}\.vpk$/i);
    if (numbered && haveDir.has(numbered[1].toLowerCase())) continue;
    out.push(n.dirEntry
      ? { kind: 'dir', path: path.join(dir, n.name) }
      : { kind: 'vpk', path: path.join(dir, n.name) });
  }
  customMountCache.set(tfPath, out);
  return out;
}

export function gameSearchPath(tfPath, pakPath = null) {
  let base = searchPathCache.get(tfPath);
  if (!base) {
    const hl2 = path.join(path.dirname(tfPath), 'hl2');
    base = [
      ...extraRoots.map(r => ({ kind: 'dir', path: r })),
      ...customMounts(tfPath),
      ...TF_VPKS.map(v => ({ kind: 'vpk', path: path.join(tfPath, v) })),
      ...HL2_VPKS.map(v => ({ kind: 'vpk', path: path.join(hl2, v) })),
      { kind: 'dir', path: tfPath },
      { kind: 'dir', path: hl2 },
      { kind: 'dir', path: path.join(tfPath, 'download') }
    ];
    searchPathCache.set(tfPath, base);
  }
  return pakPath ? [{ kind: 'pak', path: String(pakPath) }, ...base] : base;
}

function vpkIndexFor(vpkPath, ext) {
  const key = vpkPath + '|' + ext;
  let m = vpkIndexes.get(key);
  if (m) return m;
  try { m = indexVPK(vpkPath, x => x === ext); } catch { m = new Map(); }
  vpkIndexes.set(key, m);
  return m;
}

function pakIndexFor(bspPath) {
  let m = pakIndexes.get(bspPath);
  if (m) return m;
  m = new Map();
  try { for (const e of pakEntries(bspPath)) m.set(e.name, e); } catch {}
  pakIndexes.set(bspPath, m);
  return m;
}

export function readGameFileFrom(source, rel) {
  if (source.kind === 'pak') {
    const e = pakIndexFor(source.path).get(rel);
    if (!e) return null;
    try { return readPakEntry(source.path, e); } catch { return null; }
  }
  if (source.kind === 'vpk') {
    const dot = rel.lastIndexOf('.');
    if (dot < 0) return null;
    const e = vpkIndexFor(source.path, rel.slice(dot + 1)).get(rel);
    if (!e) return null;
    try { return readVPKEntry(source.path, e); } catch { return null; }
  }
  return null;
}

export async function readGameFile(rel, tfPath, pakPath = null) {
  if (!tfPath) return null;
  rel = normalizeGamePath(rel);
  if (!rel || rel.includes('..')) return null;
  const native = rel.replace(/\//g, path.sep);
  for (const source of gameSearchPath(tfPath, pakPath)) {
    if (source.kind === 'dir') {
      try { return await fs.readFile(path.join(source.path, native)); } catch { continue; }
    }
    const buf = readGameFileFrom(source, rel);
    if (buf) return buf;
  }
  return null;
}

export async function gameFileExists(rel, tfPath, pakPath = null) {
  return (await readGameFile(rel, tfPath, pakPath)) !== null;
}

export async function listGameDir(dirRel, ext, tfPath, pakPath = null) {
  if (!tfPath) return [];
  const dir = normalizeGamePath(dirRel).replace(/\/+$/, '');
  if (dir.includes('..')) return [];
  const prefix = dir + '/';
  const suffix = '.' + String(ext).toLowerCase();
  const out = [];
  const seen = new Set();
  const take = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    out.push(rel);
  };
  for (const source of gameSearchPath(tfPath, pakPath)) {
    if (source.kind === 'dir') {
      let names = [];
      try { names = await fs.readdir(path.join(source.path, dir.replace(/\//g, path.sep))); } catch { continue; }
      for (const n of names.sort()) {
        const low = n.toLowerCase();
        if (low.endsWith(suffix)) take(prefix + low);
      }
      continue;
    }
    const keys = source.kind === 'pak' ? pakIndexFor(source.path).keys() : vpkIndexFor(source.path, String(ext).toLowerCase()).keys();
    const batch = [];
    for (const k of keys) if (k.startsWith(prefix) && k.endsWith(suffix) && k.indexOf('/', prefix.length) < 0) batch.push(k);
    for (const k of batch.sort()) take(k);
  }
  return out;
}
