import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import fs from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { decodeVTF } from './shared/vtf.js';
import { encodePNG } from './shared/png.js';
import { indexVPK, readVPKEntry } from './shared/vpk.js';
import { request as httpsRequest } from 'node:https';
import { readEntityLump, parseEntities, pathTracks, chainLength, readModels, pakEntries, readPakEntry } from './shared/bsp.js';
import { parseNav } from './shared/nav.js';
import { parseMDL, parseVVD, parseVTX, buildMeshes, sampleAnim } from './shared/mdl.js';
import { extractGeometry } from './shared/bspgeo.js';
import { bakeTopDown } from './shared/bsprender.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setPath('userData', path.join(app.getPath('appData'), 'popfile-visualizer'));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

let win = null;
let closeConfirmed = false;
let closeAckTimer = null;
let exportQuit = false;

ipcMain.handle('close:ack', () => {
  clearTimeout(closeAckTimer);
});

ipcMain.handle('close:proceed', () => {
  closeConfirmed = true;
  if (win && !win.isDestroyed()) win.close();
});

async function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#101318',
    show: false,
    autoHideMenuBar: true,
    title: 'pop visualizer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', e => {
    if (closeConfirmed) return;
    e.preventDefault();
    clearTimeout(closeAckTimer);
    closeAckTimer = setTimeout(() => {
      closeConfirmed = true;
      if (win && !win.isDestroyed()) win.close();
    }, 1200);
    win.webContents.send('cmd', { type: 'wantclose' });
  });

  const dockHandle = argValue('--dock');
  if (dockHandle) dockDebug = true;
  if (dockHandle) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 900));
      console.log('[dock] bounds before:', JSON.stringify(win.getBounds()), 'visible:', win.isVisible());
      const ok = startDock({ handle: Number(dockHandle), name: 'cli' }, { position: argValue('--dockpos') || 'bottom' });
      console.log('[dock] startDock returned', ok);
      const openPop = argValue('--open');
      if (openPop) {
        win.webContents.send('cmd', { type: 'open', path: openPop, wave: 0 });
        await new Promise(r => setTimeout(r, 2000));
      }
      win.webContents.send('cmd', { type: 'docked', handle: Number(dockHandle) });
      const shot = argValue('--screenshot');
      setTimeout(async () => {
        console.log('[dock] bounds after:', JSON.stringify(win.getBounds()));
        console.log('[dock] alwaysOnTop:', win.isAlwaysOnTop(), 'visible:', win.isVisible());
        if (shot) {
          try {
            const img = await win.webContents.capturePage();
            await fs.writeFile(shot, img.toPNG());
            console.log('[dock] screenshot written');
          } catch (err) { console.error('[dock] shot failed', err); }
        }
        app.quit();
      }, 2500);
    });
    return;
  }

  const exportOut = argValue('--export');
  if (exportOut) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('cmd', { type: 'nosession' });
    });
    const openPop = argValue('--open');
    const waveArg = argValue('--wave');
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 800));
      if (openPop) {
        win.webContents.send('cmd', { type: 'open', path: openPop, wave: waveArg ? parseInt(waveArg, 10) : null });
        await new Promise(r => setTimeout(r, 2500));
      }
      exportQuit = true;
      win.webContents.send('cmd', { type: 'exportpng', out: exportOut });
      setTimeout(() => app.quit(), 15000);
    });
    return;
  }

  const shot = argValue('--screenshot');
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('cmd', { type: 'nosession' });
    });
    const openPop = argValue('--open');
    const waveArg = argValue('--wave');
    const viewArg = argValue('--view');
    const timeArg = argValue('--time');
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 800));
      if (openPop) {
        win.webContents.send('cmd', { type: 'open', path: openPop, wave: waveArg ? parseInt(waveArg, 10) : null, view: viewArg, time: timeArg ? parseFloat(timeArg) : null });
        await new Promise(r => setTimeout(r, 2500));
      } else if (argValue('--model')) {
        win.webContents.send('cmd', { type: 'viewmodel', base: argValue('--model') });
        await new Promise(r => setTimeout(r, 6000));
      } else if (viewArg) {
        win.webContents.send('cmd', { type: 'view', view: viewArg });
        await new Promise(r => setTimeout(r, 6000));
      }
      const img = await win.webContents.capturePage();
      await fs.writeFile(shot, img.toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open popfile',
    filters: [{ name: 'Popfiles', extensions: ['pop'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections']
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:save', async (e, suggested) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save popfile as',
    defaultPath: suggested || 'mission.pop',
    filters: [{ name: 'Popfiles', extensions: ['pop'] }]
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('file:read', async (e, p) => {
  return fs.readFile(p, 'latin1');
});

ipcMain.handle('file:write', async (e, p, text) => {
  const key = watchKey(p);
  suppressWatch.set(key, Infinity);
  const tmp = p + '.popvis-tmp';
  try {
    await fs.writeFile(tmp, text, 'latin1');
    await fs.rename(tmp, p);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
    throw err;
  } finally {
    suppressWatch.set(key, Date.now() + 1200);
  }
  return true;
});

ipcMain.handle('file:exists', async (e, p) => {
  try { await fs.access(p); return true; } catch { return false; }
});

ipcMain.handle('dir:list', async (e, p) => {
  try {
    const entries = await fs.readdir(p);
    return entries.filter(n => n.toLowerCase().endsWith('.pop'));
  } catch { return []; }
});

ipcMain.handle('app:paths', () => ({
  base: path.join(__dirname, 'base'),
  vanilla: path.join(__dirname, 'vanilla'),
  sep: path.sep,
  platform: process.platform
}));

ipcMain.handle('dialog:dir', async (e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Pick a folder', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

let tfPathCache;

async function resolveCase(base, ...segments) {
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
    path.join(home, '.steam', 'root'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam')
  ];
}

async function detectTFPath() {
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

const vpkIndexCache = new Map();

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

const dirIndexCache = new Map();

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

const iconDataCache = new Map();

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

ipcMain.handle('icons:resolve', async (e, names, extraDirs, tfPathOverride) => {
  const bundled = path.join(__dirname, 'icons');
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

function sourceLabel(s) {
  if (s.type === 'vpk') return 'vanilla vpk';
  if (/[\\/]download[\\/]/i.test(s.path)) return 'download';
  const m = s.path.match(/[\\/]custom[\\/]([^\\/]+)/i);
  if (m) return 'custom: ' + m[1];
  return 'folder';
}

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
    for (const n of await fs.readdir(path.join(__dirname, 'icons'))) {
      const lower = n.toLowerCase();
      if (lower.startsWith('leaderboard_class_') && lower.endsWith('.png')) {
        const name = lower.slice(0, -4);
        if (!out.has(name)) out.set(name, 'bundled');
      }
    }
  } catch {}
  return [...out.entries()].map(([name, source]) => ({ name, source })).sort((a, b) => a.name.localeCompare(b.name));
});

const bspTrackCache = new Map();

async function listBSPs(tfPath) {
  const out = [];
  for (const d of [path.join(tfPath, 'maps'), path.join(tfPath, 'download', 'maps')]) {
    try {
      for (const n of await fs.readdir(d)) {
        if (n.toLowerCase().endsWith('.bsp')) out.push({ name: n.toLowerCase().replace(/\.bsp$/, ''), full: path.join(d, n) });
      }
    } catch {}
  }
  return out;
}

function bspTracksFor(bspPath) {
  if (bspTrackCache.has(bspPath)) return bspTrackCache.get(bspPath);
  let tracks = null;
  try {
    const text = readEntityLump(bspPath);
    if (text) tracks = pathTracks(parseEntities(text));
  } catch {}
  bspTrackCache.set(bspPath, tracks);
  return tracks;
}

async function findBSPFor(popName, tfPath) {
  const base = String(popName).toLowerCase().replace(/\.pop$/, '');
  const bsps = await listBSPs(tfPath);
  let best = null;
  for (const b of bsps) {
    if ((base === b.name || base.startsWith(b.name + '_')) && (!best || b.name.length > best.name.length)) best = b;
  }
  return best;
}

ipcMain.handle('tank:path', async (e, popName, tfPathOverride, starts) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return null;
  const best = await findBSPFor(popName, tfPath);
  if (!best) return null;
  const tracks = bspTracksFor(best.full);
  if (!tracks) return { map: best.name, results: {}, unreadable: true };
  const results = {};
  for (const rawStart of starts || []) {
    const start = String(rawStart).toLowerCase();
    let matched = start;
    let r = chainLength(tracks, start);
    if (!r) {
      const alt = start.replace(/_([a-z])(\d+)$/, '_$2');
      if (alt !== start) {
        r = chainLength(tracks, alt);
        if (r) matched = alt;
      }
    }
    if (r) results[rawStart] = { ...r, matched, approx: matched !== start };
  }
  return { map: best.name, results };
});

const mapDataCache = new Map();

async function looseNavs(tfPath) {
  const out = [];
  for (const d of [path.join(tfPath, 'maps'), path.join(tfPath, 'download', 'maps')]) {
    try {
      for (const n of await fs.readdir(d)) {
        if (n.toLowerCase().endsWith('.nav')) out.push({ name: n.toLowerCase().replace(/\.nav$/, ''), kind: 'file', where: path.join(d, n) });
      }
    } catch {}
  }
  return out;
}

function vpkNavs(tfPath) {
  const out = [];
  try {
    const vpk = path.join(tfPath, 'tf2_misc_dir.vpk');
    const entries = indexVPK(vpk, (ext, dir) => ext === 'nav' && dir.startsWith('maps'));
    for (const [key, entry] of entries) {
      out.push({ name: key.split('/').pop().replace(/\.nav$/, ''), kind: 'vpk', where: vpk, entry });
    }
  } catch {}
  return out;
}

function sharedPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

async function loadNavFor(bsp, tfPath) {
  const candidates = [...await looseNavs(tfPath), ...vpkNavs(tfPath)];
  try {
    for (const p of pakEntries(bsp.full)) {
      if (p.name.endsWith('.nav')) candidates.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', where: bsp.full, entry: p });
    }
  } catch {}
  let pick = candidates.find(c => c.name === bsp.name);
  let approx = false;
  if (!pick) {
    let bestLen = 0;
    for (const c of candidates) {
      const l = sharedPrefixLen(c.name, bsp.name);
      if (l >= 8 && l >= c.name.length - 6 && l > bestLen) { bestLen = l; pick = c; }
    }
    approx = !!pick;
  }
  if (!pick) return null;
  let buf = null;
  try {
    if (pick.kind === 'file') buf = await fs.readFile(pick.where);
    else if (pick.kind === 'vpk') buf = readVPKEntry(pick.where, pick.entry);
    else buf = readPakEntry(pick.where, pick.entry);
    if (!buf) return null;
    const nav = parseNav(buf);
    return { source: pick.kind, name: pick.name, approx, areas: nav.areas.map(a => {
      const out = { id: a.id, nw: a.nw, se: a.se, neZ: a.neZ, swZ: a.swZ, connect: a.connect };
      if (a.hide) out.hide = a.hide;
      return out;
    }) };
  } catch {
    return null;
  }
}

ipcMain.handle('map:data', async (e, popName, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return null;
  const best = await findBSPFor(popName, tfPath);
  if (!best) return null;
  if (mapDataCache.has(best.full)) return mapDataCache.get(best.full);
  let result = null;
  try {
    const text = readEntityLump(best.full);
    if (!text) return null;
    const ents = parseEntities(text);
    const models = readModels(best.full);
    const vec = s => {
      const v = String(s || '0 0 0').split(/\s+/).map(parseFloat);
      return v.length >= 3 && v.every(Number.isFinite) ? v.slice(0, 3) : null;
    };
    const spawns = [];
    for (const en of ents) {
      if (en.classname !== 'info_player_teamspawn' || !en.targetname) continue;
      const o = vec(en.origin);
      if (o) spawns.push({ name: en.targetname, origin: o, team: en.teamnum || null, disabled: String(en.startdisabled ?? en.start_disabled ?? '0') === '1' });
    }
    const flags = [];
    for (const en of ents) {
      if (en.classname !== 'item_teamflag') continue;
      const o = vec(en.origin);
      if (o) flags.push(o);
    }
    const capzones = [];
    for (const en of ents) {
      if (en.classname !== 'func_capturezone') continue;
      const idx = parseInt(String(en.model || '').slice(1), 10);
      const m = models[idx];
      if (!m) continue;
      const c = [(m.mins[0] + m.maxs[0]) / 2 + m.origin[0], (m.mins[1] + m.maxs[1]) / 2 + m.origin[1], (m.mins[2] + m.maxs[2]) / 2 + m.origin[2]];
      if (Math.abs(c[0]) + Math.abs(c[1]) > 1) capzones.push(c);
    }
    const tracks = [];
    for (const en of ents) {
      if (en.classname !== 'path_track' || !en.targetname) continue;
      const o = vec(en.origin);
      if (o) tracks.push({ name: en.targetname.toLowerCase(), origin: o, target: (en.target || '').toLowerCase() });
    }
    const redSpawns = [];
    for (const en of ents) {
      if (en.classname !== 'info_player_teamspawn' || en.teamnum !== '2') continue;
      const o = vec(en.origin);
      if (o) redSpawns.push(o);
    }
    const hints = [];
    for (const en of ents) {
      if (!/^(bot_hint_sniper_spot|bot_hint_engineer_nest|bot_hint_sentrygun|bot_hint_teleporter_exit|func_tfbot_hint)$/.test(en.classname)) continue;
      const o = vec(en.origin);
      if (o) hints.push({ kind: en.classname, origin: o, team: en.teamnum || null, hint: en.hint || null });
    }
    const navVolumes = [];
    for (const en of ents) {
      if (en.classname !== 'func_nav_avoid' && en.classname !== 'func_nav_prefer') continue;
      const idx = parseInt(String(en.model || '').slice(1), 10);
      const m = models[idx];
      if (!m) continue;
      navVolumes.push({
        kind: en.classname === 'func_nav_prefer' ? 'prefer' : 'avoid',
        name: (en.targetname || '').toLowerCase() || null,
        startDisabled: String(en.start_disabled ?? en.startdisabled ?? '0') === '1',
        tags: String(en.tags || '').toLowerCase().split(/\s+/).filter(Boolean),
        team: en.team || null,
        mins: [m.mins[0] + m.origin[0], m.mins[1] + m.origin[1], m.mins[2] + m.origin[2]],
        maxs: [m.maxs[0] + m.origin[0], m.maxs[1] + m.origin[1], m.maxs[2] + m.origin[2]]
      });
    }
    const pathProps = [];
    for (const en of ents) {
      if (en.classname !== 'prop_dynamic') continue;
      const name = (en.targetname || '').toLowerCase();
      if (!name || !/hologram|bombpath/.test(name)) continue;
      const o = vec(en.origin);
      if (!o) continue;
      pathProps.push({
        name,
        origin: o,
        angles: vec(en.angles) || [0, 0, 0],
        startDisabled: String(en.startdisabled ?? en.start_disabled ?? '0') === '1'
      });
    }
    const nav = await loadNavFor(best, tfPath);
    result = { map: best.name, spawns, flags, capzones, tracks, nav, redSpawns, hints, navVolumes, pathProps };
  } catch {
    result = null;
  }
  mapDataCache.set(best.full, result);
  return result;
});

const mapGeoCache = new Map();

ipcMain.handle('map:geo', async (e, popName, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return null;
  const best = await findBSPFor(popName, tfPath);
  if (!best) return null;
  if (mapGeoCache.has(best.full)) return mapGeoCache.get(best.full);
  let result = null;
  try {
    const g = extractGeometry(best.full);
    if (g) result = { polys: g.polys, bounds: g.bounds, zRange: g.zRange, lit: g.lit, data: Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength) };
  } catch {}
  mapGeoCache.set(best.full, result);
  return result;
});

async function readMaterialFile(rel, tfPath) {
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

function makeMaterialLoader(tfPath) {
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

const mapTexCache = new Map();

ipcMain.handle('map:texture', async (e, popName, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return null;
  const best = await findBSPFor(popName, tfPath);
  if (!best) return null;
  if (mapTexCache.has(best.full)) return mapTexCache.get(best.full);
  let result = null;
  try {
    const cachedData = mapDataCache.get(best.full);
    const nav = cachedData ? cachedData.nav : await loadNavFor(best, tfPath);
    const baked = await bakeTopDown(best.full, makeMaterialLoader(tfPath), {
      nav,
      spawns: cachedData ? cachedData.spawns : [],
      tracks: cachedData ? cachedData.tracks : []
    });
    if (baked) result = { width: baked.width, height: baked.height, bounds: baked.bounds, rgba: Buffer.from(baked.rgba.buffer, baked.rgba.byteOffset, baked.rgba.byteLength) };
  } catch (err) { console.error('[map:texture]', err); }
  mapTexCache.set(best.full, result);
  return result;
});

ipcMain.handle('fsx:list', async (e, dir) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = [];
    const files = [];
    for (const en of entries) {
      if (en.isDirectory()) dirs.push(en.name);
      else if (en.isFile()) {
        let size = 0;
        try { size = (await fs.stat(path.join(dir, en.name))).size; } catch {}
        files.push({ name: en.name, size });
      }
    }
    dirs.sort();
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { dirs, files };
  } catch {
    return null;
  }
});

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

async function readModelSet(src, tfPath) {
  const need = async rel => {
    if (src.kind === 'file') {
      try { return await fs.readFile(src.base + rel); } catch { return null; }
    }
    try { return await httpGet(potatoUrl(src.base + rel), 128 * 1024 * 1024); } catch { return null; }
  };
  const mdl = await need('.mdl');
  if (!mdl) return null;
  const vvd = await need('.vvd');
  const vtx = (await need('.dx90.vtx')) || (await need('.dx80.vtx'));
  if (!vvd || !vtx) return { mdl };
  return { mdl, vvd, vtx };
}

function animFramesFor(mdl, targetBones, boneMap) {
  const out = [];
  for (const a of mdl.anims) {
    if (a.animblock !== 0 || a.numframes < 1 || a.numframes > 1000) continue;
    const frames = new Float32Array(a.numframes * targetBones.length * 7);
    let ok = true;
    for (let f = 0; f < a.numframes; f++) {
      const s = sampleAnim(mdl, a, f);
      if (!s.ok) { ok = false; break; }
      for (let b = 0; b < targetBones.length; b++) {
        const srcIdx = boneMap ? boneMap[b] : b;
        const src = srcIdx >= 0 && srcIdx < s.bones.length ? s.bones[srcIdx] : null;
        const o = (f * targetBones.length + b) * 7;
        const bind = targetBones[b];
        const p = src ? src.pos : bind.pos;
        const q = src ? src.quat : bind.quat;
        frames[o] = p[0]; frames[o + 1] = p[1]; frames[o + 2] = p[2];
        frames[o + 3] = q[0]; frames[o + 4] = q[1]; frames[o + 5] = q[2]; frames[o + 6] = q[3];
      }
    }
    if (!ok) continue;
    out.push({ name: a.name, fps: a.fps || 30, numframes: a.numframes, frames: Buffer.from(frames.buffer) });
  }
  return out;
}

ipcMain.handle('model:load', async (e, src, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  try {
    const set = await readModelSet(src, tfPath);
    if (!set) return { error: 'model not found' };
    const mdl = parseMDL(set.mdl);
    const bones = mdl.bones.map(b => ({ name: b.name, parent: b.parent, pos: b.pos, quat: b.quat }));
    const result = {
      name: mdl.header.name,
      version: mdl.header.version,
      textures: mdl.textures,
      cdtextures: mdl.cdtextures,
      skins: mdl.skins,
      bones,
      anims: []
    };
    if (set.vvd && set.vtx) {
      const vvd = parseVVD(set.vvd);
      const vtx = parseVTX(set.vtx);
      const built = buildMeshes(mdl, vvd, vtx);
      const n = built.verts.length;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      const bw = new Float32Array(n * 3);
      const bi = new Uint8Array(n * 4);
      const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const v = built.verts[i];
        pos.set(v.pos, i * 3);
        nrm.set(v.normal, i * 3);
        uv.set(v.uv, i * 2);
        bw.set(v.weights, i * 3);
        bi[i * 4] = v.bones[0]; bi[i * 4 + 1] = v.bones[1]; bi[i * 4 + 2] = v.bones[2]; bi[i * 4 + 3] = Math.max(1, Math.min(3, v.numBones));
        for (let a = 0; a < 3; a++) {
          bbox[a] = Math.min(bbox[a], v.pos[a]);
          bbox[a + 3] = Math.max(bbox[a + 3], v.pos[a]);
        }
      }
      let total = 0;
      for (const m of built.meshes) total += m.indices.length;
      const indices = new Uint32Array(total);
      const meshes = [];
      let ofs = 0;
      for (const m of built.meshes) {
        indices.set(m.indices, ofs);
        meshes.push({ material: m.material, offset: ofs, count: m.indices.length });
        ofs += m.indices.length;
      }
      result.numVerts = n;
      result.positions = Buffer.from(pos.buffer);
      result.normals = Buffer.from(nrm.buffer);
      result.uvs = Buffer.from(uv.buffer);
      result.boneWeights = Buffer.from(bw.buffer);
      result.boneIds = Buffer.from(bi.buffer);
      result.indices = Buffer.from(indices.buffer);
      result.meshes = meshes;
      result.bbox = bbox;
    }
    result.anims = animFramesFor(mdl, mdl.bones, null);
    try {
      const compSet = await readModelSet({ kind: src.kind, base: src.base + '_animations' }, tfPath);
      if (compSet && compSet.mdl) {
        const comp = parseMDL(compSet.mdl);
        const nameToIdx = new Map(comp.bones.map((b, i) => [b.name.toLowerCase(), i]));
        const boneMap = mdl.bones.map(b => nameToIdx.get(b.name.toLowerCase()) ?? -1);
        result.anims.push(...animFramesFor(comp, mdl.bones, boneMap));
      }
    } catch {}
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('hlmv:find', async (e, tfPathOverride, override) => {
  if (override) {
    try { await fs.access(override); return override; } catch {}
  }
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return null;
  const game = path.dirname(tfPath);
  const win = process.platform === 'win32';
  const subs = win ? [['bin', 'x64'], ['bin', 'win64'], ['bin']] : [['bin', 'linux64'], ['bin']];
  const names = ['hlmvplusplus', 'hlmv++', 'hlmv_plus_plus', 'hlmv'].map(n => win ? n + '.exe' : n);
  for (const sub of subs) {
    for (const name of names) {
      const p = path.join(game, ...sub, name);
      try { await fs.access(p); return p; } catch {}
    }
  }
  return null;
});

ipcMain.handle('hlmv:open', async (e, exe, tfPathOverride, mdlPath) => {
  const tfPath = tfPathOverride || await detectTFPath();
  try {
    spawn(exe, ['-game', tfPath || '', mdlPath], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
});

const POTATO_BASE = 'https://testing.potato.tf/tf/';

function httpGet(url, maxBytes = 512 * 1024 * 1024, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).href, maxBytes, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n > maxBytes) { req.destroy(new Error('too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function httpExists(url, redirects = 3) {
  return new Promise(resolve => {
    const req = httpsRequest(url, { method: 'HEAD' }, res => {
      res.resume();
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        resolve(httpExists(new URL(res.headers.location, url).href, redirects - 1));
        return;
      }
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function potatoUrl(rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..')) return null;
  return POTATO_BASE + clean.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');
}

ipcMain.handle('potato:list', async (e, rel) => {
  const url = potatoUrl(rel.endsWith('/') || rel === '' ? rel : rel + '/');
  if (!url) return null;
  let body;
  try { body = await httpGet(url, 8 * 1024 * 1024); } catch { return null; }
  if (!body) return null;
  const html = body.toString('utf8');
  const dirs = [];
  const files = [];
  for (const m of html.matchAll(/<a\s+href="([^"]+)"/gi)) {
    let href = m[1];
    if (href.startsWith('?') || href.startsWith('/') || href.startsWith('..') || /^https?:/i.test(href)) continue;
    try { href = decodeURIComponent(href); } catch {}
    if (href.endsWith('/')) dirs.push(href.slice(0, -1));
    else files.push({ name: href, size: 0 });
  }
  return { dirs: [...new Set(dirs)].sort(), files };
});

function dlProgress(label) {
  if (win && !win.isDestroyed()) win.webContents.send('cmd', { type: 'dlprog', label });
}

async function saveUnder(tfPath, rel, buf) {
  const dest = path.join(tfPath, 'download', rel.replace(/\//g, path.sep));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return dest;
}

async function fetchToDownload(tfPath, rel, results, optional = false) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (clean.includes('..')) return null;
  for (const root of [path.join(tfPath, 'download'), tfPath]) {
    try {
      await fs.access(path.join(root, clean));
      results.push({ path: clean, status: 'exists' });
      return await fs.readFile(path.join(root, clean));
    } catch {}
  }
  dlProgress('Downloading ' + clean);
  let buf = null;
  try { buf = await httpGet(potatoUrl(clean)); } catch {}
  if (!buf) {
    if (!optional) results.push({ path: clean, status: 'missing' });
    return null;
  }
  await saveUnder(tfPath, clean, buf);
  results.push({ path: clean, status: 'downloaded', bytes: buf.length });
  return buf;
}

function vmtTextureRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(/\$(basetexture2?|bumpmap|normalmap|detail|envmapmask|phongexponenttexture|selfillummask|lightwarptexture)"?\s*"?([^"\r\n]+?)"?\s*$/gim)) {
    const v = m[2].trim().replace(/\\/g, '/');
    if (v && !v.startsWith('_rt_') && !v.startsWith('env_cubemap')) out.add(v.toLowerCase());
  }
  for (const m of text.matchAll(/include"?\s*"?([^"\r\n]+?)"?\s*$/gim)) {
    const v = m[1].trim().replace(/\\/g, '/').toLowerCase();
    if (v.endsWith('.vmt')) out.add('!' + v);
  }
  return out;
}

ipcMain.handle('potato:model', async (e, mdlRel, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return { error: 'TF folder not found' };
  const base = String(mdlRel).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.mdl$/i, '').toLowerCase();
  if (base.includes('..')) return { error: 'bad path' };
  const results = [];
  const mdlBuf = await fetchToDownload(tfPath, base + '.mdl', results);
  if (!mdlBuf) return { error: 'model not found on index', results };
  for (const ext of ['.vvd', '.dx90.vtx', '.dx80.vtx', '.sw.vtx', '.phy', '.ani']) {
    await fetchToDownload(tfPath, base + ext, results, ext === '.phy' || ext === '.ani' || ext === '.sw.vtx' || ext === '.dx80.vtx');
  }
  try {
    const mdl = parseMDL(mdlBuf);
    const vmtQueue = [];
    for (const tex of mdl.textures) {
      const t = tex.replace(/\\/g, '/').toLowerCase();
      if (t.includes('/')) vmtQueue.push('materials/' + t + '.vmt');
      else for (const cd of mdl.cdtextures) vmtQueue.push(('materials/' + cd + t + '.vmt').replace(/\/+/g, '/'));
    }
    const seenVmt = new Set();
    const vtfSet = new Set();
    while (vmtQueue.length) {
      const rel = vmtQueue.shift().replace(/\/+/g, '/');
      if (seenVmt.has(rel)) continue;
      seenVmt.add(rel);
      const vmtBuf = await fetchToDownload(tfPath, rel, results, true);
      if (!vmtBuf) continue;
      for (const ref of vmtTextureRefs(vmtBuf.toString('latin1'))) {
        if (ref.startsWith('!')) vmtQueue.push(ref.slice(1));
        else vtfSet.add('materials/' + ref.replace(/\.vtf$/, '') + '.vtf');
      }
    }
    for (const rel of vtfSet) await fetchToDownload(tfPath, rel, results, true);
  } catch {}
  dlProgress('');
  return { results };
});

ipcMain.handle('potato:map', async (e, mapName, tfPathOverride) => {
  const tfPath = tfPathOverride || await detectTFPath();
  if (!tfPath) return { error: 'TF folder not found' };
  const name = String(mapName).toLowerCase().replace(/\.bsp$/, '');
  if (!/^[a-z0-9_\-.]+$/.test(name)) return { error: 'bad map name' };
  const results = [];
  const bsp = await fetchToDownload(tfPath, 'maps/' + name + '.bsp', results);
  await fetchToDownload(tfPath, 'maps/' + name + '.nav', results, true);
  dlProgress('');
  if (!bsp) {
    const bz = await httpExists(potatoUrl('maps/' + name + '.bsp.bz2'));
    return { error: bz ? 'only a .bsp.bz2 exists on the index for this map' : 'map not found on the index', results };
  }
  return { results };
});

ipcMain.handle('map:flush', () => {
  mapDataCache.clear();
  mapGeoCache.clear();
  bspTrackCache.clear();
  tfPathCache = undefined;
});

ipcMain.handle('wins:list', async () => {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command',
      "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id,ProcessName,MainWindowTitle,Path,@{n='Handle';e={[Int64]$_.MainWindowHandle}} | ConvertTo-Json -Compress"
    ], { maxBuffer: 4 * 1024 * 1024 });
    let list = JSON.parse(stdout || '[]');
    if (!Array.isArray(list)) list = [list];
    return list
      .filter(w => w.Handle && w.Id !== process.pid && !/^electron$/i.test(w.ProcessName))
      .map(w => ({ pid: w.Id, name: w.ProcessName, title: w.MainWindowTitle, exe: w.Path || null, handle: w.Handle }));
  } catch {
    return [];
  }
});

let dockProc = null;
let dockPrev = null;
let dockOpts = { position: 'bottom' };
let dockLastBounds = null;
let dockDebug = false;

function stopDockProc() {
  if (dockProc) {
    try { dockProc.kill(); } catch {}
    dockProc = null;
  }
}

function applyDockBounds(l, t, r, b) {
  let full = screen.screenToDipRect(win, { x: l, y: t, width: r - l, height: b - t });
  const wa = screen.getDisplayMatching(full).workArea;
  const x1 = Math.max(full.x, wa.x);
  const y1 = Math.max(full.y, wa.y);
  const x2 = Math.min(full.x + full.width, wa.x + wa.width);
  const y2 = Math.min(full.y + full.height, wa.y + wa.height);
  if (x2 > x1 && y2 > y1) full = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  let target;
  if (dockOpts.position === 'right') {
    const w = Math.min(620, Math.max(380, Math.round(full.width * 0.4)));
    target = { x: full.x + full.width - w, y: full.y, width: w, height: full.height };
  } else {
    const h = Math.min(440, Math.max(240, Math.round(full.height * 0.42)));
    target = { x: full.x, y: full.y + full.height - h, width: full.width, height: h };
  }
  if (dockLastBounds && Math.abs(dockLastBounds.x - target.x) < 3 && Math.abs(dockLastBounds.y - target.y) < 3 &&
      Math.abs(dockLastBounds.width - target.width) < 3 && Math.abs(dockLastBounds.height - target.height) < 3) return;
  dockLastBounds = target;
  win.setBounds(target);
}

function startDock(target, opts) {
  stopDockProc();
  if (!dockPrev) dockPrev = win.getBounds();
  win.setMinimumSize(320, 180);
  dockOpts = { position: (opts && opts.position) || 'bottom' };
  dockLastBounds = null;
  const script = path.join(__dirname, 'tools', 'dockwatch.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  dockProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(target.handle)], { stdio: ['ignore', 'pipe', 'ignore'] });
  win.setAlwaysOnTop(true, 'floating');
  const rl = createInterface({ input: dockProc.stdout });
  let hidden = false;
  let sawUsable = false;
  rl.on('line', line => {
    if (line === 'GONE') {
      win.webContents.send('cmd', { type: 'docklost' });
      return;
    }
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 5 || parts.some(n => !Number.isFinite(n))) return;
    const [l, t, r, b, iconic] = parts;
    if (dockDebug) console.log('[dock] line', l, t, r, b, 'iconic=' + iconic);
    if (iconic || r - l < 50 || b - t < 50) {
      if (!sawUsable) {
        stopDockProc();
        win.setAlwaysOnTop(false);
        win.setMinimumSize(1100, 640);
        if (dockPrev) { win.setBounds(dockPrev); dockPrev = null; }
        win.webContents.send('cmd', { type: 'dockrefused', reason: 'minimized' });
        return;
      }
      if (!hidden) { hidden = true; win.hide(); }
      return;
    }
    sawUsable = true;
    if (hidden) { hidden = false; win.showInactive(); }
    try { applyDockBounds(l, t, r, b); } catch (err) { console.error('[dock] applyDockBounds failed:', err); }
  });
  return true;
}

ipcMain.handle('dock:start', (e, target, opts) => {
  if (process.platform !== 'win32') return false;
  try {
    return startDock(target, opts);
  } catch (err) {
    console.error('[dock] start failed:', err);
    return false;
  }
});

ipcMain.handle('dock:pos', (e, position) => {
  dockOpts.position = position === 'right' ? 'right' : 'bottom';
  dockLastBounds = null;
});

ipcMain.handle('dock:stop', () => {
  stopDockProc();
  win.setAlwaysOnTop(false);
  win.setMinimumSize(1100, 640);
  if (!win.isVisible()) win.show();
  if (dockPrev) { win.setBounds(dockPrev); dockPrev = null; }
  dockLastBounds = null;
});

ipcMain.handle('editor:goto', (e, editor, file, line) => {
  if (!editor || !editor.exe) return false;
  const n = (editor.name || '').toLowerCase();
  let args = null;
  if (n.includes('code') || n.includes('codium')) args = ['--goto', `${file}:${line}`];
  else if (n.includes('notepad++')) args = ['-n' + line, file];
  else if (n.includes('sublime')) args = [`${file}:${line}`];
  else if (n.includes('notepad')) args = [file];
  if (!args) return false;
  try {
    spawn(editor.exe, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
});

const watchKey = p => path.normalize(p).toLowerCase();
const suppressWatch = new Map();
const fileWatchers = new Map();

ipcMain.handle('watch:add', (e, p) => {
  const key = watchKey(p);
  if (fileWatchers.has(key)) return;
  try {
    const dir = path.dirname(p);
    const base = path.basename(p).toLowerCase();
    const entry = { w: null, timer: null };
    entry.w = fsWatch(dir, (ev, fn) => {
      if (fn && fn.toLowerCase() !== base) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if ((suppressWatch.get(key) || 0) > Date.now()) return;
        if (win && !win.isDestroyed()) win.webContents.send('cmd', { type: 'filechanged', path: p });
      }, 300);
    });
    fileWatchers.set(key, entry);
  } catch {}
});

ipcMain.handle('watch:remove', (e, p) => {
  const key = watchKey(p);
  const entry = fileWatchers.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    try { entry.w.close(); } catch {}
    fileWatchers.delete(key);
    suppressWatch.delete(key);
  }
});

ipcMain.handle('image:save', async (e, name, bytes, targetPath) => {
  let dest = targetPath || null;
  if (!dest) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export wave as PNG',
      defaultPath: name || 'wave.png',
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });
    if (r.canceled || !r.filePath) return null;
    dest = r.filePath;
  }
  await fs.writeFile(dest, Buffer.from(bytes));
  if (exportQuit) setTimeout(() => app.quit(), 80);
  return dest;
});
