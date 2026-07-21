import { app, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

let tfPathCache;

export function flushTFPath() {
  tfPathCache = undefined;
}

export async function resolveCase(base, ...segments) {
  let cur = base;
  for (const seg of segments) {
    const direct = path.join(cur, seg);
    try {
      await fs.access(direct);
      cur = direct;
      continue;
    } catch {}
    let entries;
    try { entries = await fs.readdir(cur); } catch { return null; }
    const hit = entries.find(n => n.toLowerCase() === seg.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

async function steamRoots() {
  if (process.platform === 'win32') {
    const roots = [];
    try {
      const { stdout } = await execFileP('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
      const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) roots.push(m[1].trim());
    } catch {}
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    return roots;
  }
  const home = app.getPath('home');
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Steam')];
  return [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam')
  ];
}

export async function detectTFPath() {
  if (tfPathCache !== undefined) return tfPathCache;
  tfPathCache = null;
  const libs = [];
  for (const root of await steamRoots()) {
    libs.push(root);
    const vdf = await resolveCase(root, 'steamapps', 'libraryfolders.vdf');
    if (!vdf) continue;
    try {
      const text = await fs.readFile(vdf, 'latin1');
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  for (const lib of libs) {
    const tf = await resolveCase(lib, 'steamapps', 'common', 'Team Fortress 2', 'tf');
    if (tf) { tfPathCache = tf; break; }
  }
  return tfPathCache;
}

export function register() {
  ipcMain.handle('tf:detect', () => detectTFPath());

  ipcMain.handle('fonts:tf', async (e, tfPathOverride) => {
    const tf = tfPathOverride || await detectTFPath();
    if (!tf) return null;
    const dir = path.join(tf, 'resource');
    const out = {};
    for (const [key, file] of [['build', 'tf2build.ttf'], ['secondary', 'tf2secondary.ttf']]) {
      try { out[key] = await fs.readFile(path.join(dir, file)); } catch {}
    }
    return Object.keys(out).length ? out : null;
  });
}
