import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { appRoot, setWindow, getWindow, windowAlive, sendCmd } from './main/context.js';
import { attach as attachCLI } from './main/cli.js';
import * as tfpath from './main/tfpath.js';
import * as files from './main/files.js';
import * as icons from './main/icons.js';
import * as materials from './main/materials.js';
import * as maps from './main/maps.js';
import * as models from './main/models.js';
import * as potato from './main/potato.js';
import * as dock from './main/dock.js';

app.setPath('userData', path.join(app.getPath('appData'), 'popfile-visualizer'));

for (const mod of [tfpath, files, icons, materials, maps, models, potato, dock]) mod.register();

let closeConfirmed = false;
let closeAckTimer = null;

ipcMain.handle('close:ack', () => {
  clearTimeout(closeAckTimer);
});

ipcMain.handle('close:proceed', () => {
  closeConfirmed = true;
  if (windowAlive()) getWindow().close();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#101318',
    show: false,
    autoHideMenuBar: true,
    title: 'pop visualizer',
    icon: path.join(appRoot, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(appRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  setWindow(win);
  win.loadFile(path.join(appRoot, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', e => {
    if (closeConfirmed) return;
    e.preventDefault();
    clearTimeout(closeAckTimer);
    closeAckTimer = setTimeout(() => {
      closeConfirmed = true;
      if (windowAlive()) win.close();
    }, 1200);
    sendCmd({ type: 'wantclose' });
  });

  attachCLI(win);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
