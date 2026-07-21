import { app, ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { appRoot, getWindow, sendCmd, isExportQuit } from './context.js';

const watchKey = p => path.normalize(p).toLowerCase();
const suppressWatch = new Map();
const fileWatchers = new Map();

export function register() {
  ipcMain.handle('dialog:open', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Open popfile',
      filters: [{ name: 'Popfiles', extensions: ['pop'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:save', async (e, suggested) => {
    const r = await dialog.showSaveDialog(getWindow(), {
      title: 'Save popfile as',
      defaultPath: suggested || 'mission.pop',
      filters: [{ name: 'Popfiles', extensions: ['pop'] }]
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('dialog:dir', async (e, title) => {
    const r = await dialog.showOpenDialog(getWindow(), { title: title || 'Pick a folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
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

  ipcMain.handle('wasm:navkernel', async () => {
    try {
      return await fs.readFile(path.join(appRoot, 'shared', 'navkernel.wasm'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:paths', () => ({
    base: path.join(appRoot, 'base'),
    vanilla: path.join(appRoot, 'vanilla'),
    sep: path.sep,
    platform: process.platform
  }));

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
          sendCmd({ type: 'filechanged', path: p });
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
      const r = await dialog.showSaveDialog(getWindow(), {
        title: 'Export wave as PNG',
        defaultPath: name || 'wave.png',
        filters: [{ name: 'PNG', extensions: ['png'] }]
      });
      if (r.canceled || !r.filePath) return null;
      dest = r.filePath;
    }
    await fs.writeFile(dest, Buffer.from(bytes));
    if (isExportQuit()) setTimeout(() => app.quit(), 80);
    return dest;
  });
}
