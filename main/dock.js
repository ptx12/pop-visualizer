import { ipcMain, screen } from 'electron';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { appRoot, getWindow, sendCmd } from './context.js';

const execFileP = promisify(execFile);

let dockProc = null;
let dockPrev = null;
let dockOpts = { position: 'bottom' };
let dockLastBounds = null;
let dockDebug = false;

export function setDockDebug(v) {
  dockDebug = v;
}

function stopDockProc() {
  if (dockProc) {
    try { dockProc.kill(); } catch {}
    dockProc = null;
  }
}

function applyDockBounds(win, l, t, r, b) {
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

export function startDock(target, opts) {
  const win = getWindow();
  stopDockProc();
  if (!dockPrev) dockPrev = win.getBounds();
  win.setMinimumSize(320, 180);
  dockOpts = { position: (opts && opts.position) || 'bottom' };
  dockLastBounds = null;
  const script = path.join(appRoot, 'tools', 'dockwatch.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  dockProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(target.handle)], { stdio: ['ignore', 'pipe', 'ignore'] });
  win.setAlwaysOnTop(true, 'floating');
  const rl = createInterface({ input: dockProc.stdout });
  let hidden = false;
  let sawUsable = false;
  rl.on('line', line => {
    if (line === 'GONE') {
      sendCmd({ type: 'docklost' });
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
        sendCmd({ type: 'dockrefused', reason: 'minimized' });
        return;
      }
      if (!hidden) { hidden = true; win.hide(); }
      return;
    }
    sawUsable = true;
    if (hidden) { hidden = false; win.showInactive(); }
    try { applyDockBounds(win, l, t, r, b); } catch (err) { console.error('[dock] applyDockBounds failed:', err); }
  });
  return true;
}

export function register() {
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
    const win = getWindow();
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
}
