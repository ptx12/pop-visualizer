import { app } from 'electron';
import fs from 'node:fs/promises';
import { sendCmd, setExportQuit } from './context.js';
import { startDock, setDockDebug } from './dock.js';

export function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function runDock(win, dockHandle) {
  await wait(900);
  console.log('[dock] bounds before:', JSON.stringify(win.getBounds()), 'visible:', win.isVisible());
  const ok = startDock({ handle: Number(dockHandle), name: 'cli' }, { position: argValue('--dockpos') || 'bottom' });
  console.log('[dock] startDock returned', ok);
  const openPop = argValue('--open');
  if (openPop) {
    sendCmd({ type: 'open', path: openPop, wave: 0 });
    await wait(2000);
  }
  sendCmd({ type: 'docked', handle: Number(dockHandle) });
  const shot = argValue('--screenshot');
  await wait(2500);
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
}

async function runExport(exportOut) {
  sendCmd({ type: 'nosession' });
  await wait(800);
  const openPop = argValue('--open');
  const waveArg = argValue('--wave');
  if (openPop) {
    sendCmd({ type: 'open', path: openPop, wave: waveArg ? parseInt(waveArg, 10) : null });
    await wait(2500);
  }
  setExportQuit(true);
  sendCmd({ type: 'exportpng', out: exportOut });
  setTimeout(() => app.quit(), 15000);
}

async function runScreenshot(win, shot) {
  sendCmd({ type: 'nosession' });
  await wait(800);
  const openPop = argValue('--open');
  const waveArg = argValue('--wave');
  const viewArg = argValue('--view');
  const timeArg = argValue('--time');
  if (openPop) {
    sendCmd({ type: 'open', path: openPop, wave: waveArg ? parseInt(waveArg, 10) : null, view: viewArg, time: timeArg ? parseFloat(timeArg) : null });
    await wait(2500);
  } else if (argValue('--model')) {
    sendCmd({ type: 'viewmodel', base: argValue('--model') });
    await wait(6000);
  } else if (viewArg) {
    sendCmd({ type: 'view', view: viewArg });
    await wait(6000);
  }
  const img = await win.webContents.capturePage();
  await fs.writeFile(shot, img.toPNG());
  app.quit();
}

export function attach(win) {
  const dockHandle = argValue('--dock');
  const exportOut = argValue('--export');
  const shot = argValue('--screenshot');

  if (dockHandle) {
    setDockDebug(true);
    win.webContents.once('did-finish-load', () => runDock(win, dockHandle));
    return true;
  }
  if (exportOut) {
    win.webContents.once('did-finish-load', () => runExport(exportOut));
    return true;
  }
  if (shot) {
    win.webContents.once('did-finish-load', () => runScreenshot(win, shot));
    return true;
  }
  return false;
}
