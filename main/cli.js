import { app } from 'electron';
import fs from 'node:fs/promises';
import { sendCmd, setExportQuit } from './context.js';
import { startDock, setDockDebug } from './dock.js';

export function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function capture(win, shot) {
  win.webContents.invalidate();
  await wait(700);
  const img = await win.webContents.capturePage();
  await fs.writeFile(shot, img.toPNG());
}

async function runDock(win, dockHandle) {
  sendCmd({ type: 'nosession' });
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
      await capture(win, shot);
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

const INPUT_STEPS = {
  click: () => 't.click()',
  move: (x, y) => `t.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`,
  down: (x, y) => `t.dispatchEvent(new MouseEvent('mousedown', { clientX: ${x}, clientY: ${y}, button: 0, bubbles: true }))`,
  up: (x, y) => `window.dispatchEvent(new MouseEvent('mouseup', { clientX: ${x}, clientY: ${y}, button: 0, bubbles: true }))`,
  drag: (x, y) => `window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`,
  right: (x, y) => `t.dispatchEvent(new MouseEvent('mousedown', { clientX: ${x}, clientY: ${y}, button: 2, bubbles: true }))`,
  wheel: (x, y, arg) => `t.dispatchEvent(new WheelEvent('wheel', { clientX: ${x}, clientY: ${y}, deltaY: ${arg || -100}, bubbles: true, cancelable: true }))`
};

async function runInput(win, spec) {
  for (const step of spec.split(';').filter(Boolean)) {
    const [kind, at] = step.split('@');
    if (kind === 'wait') { await wait(parseInt(at, 10) || 0); continue; }
    const [x, y, arg] = String(at || '').split(',').map(n => parseInt(n, 10));
    if (!INPUT_STEPS[kind] || !Number.isFinite(x) || !Number.isFinite(y)) {
      console.error('[shot] bad input step ' + step);
      continue;
    }
    await win.webContents.executeJavaScript(
      `(() => { const t = document.elementFromPoint(${x}, ${y}); if (!t) return 'nothing at point';`
      + ` ${INPUT_STEPS[kind](x, y, arg)}; return t.tagName + '.' + (t.className || ''); })()`
    ).then(r => console.log('[shot] ' + kind + ' ' + r)).catch(err => console.error('[shot] failed', err));
    await wait(1500);
  }
}

async function runScreenshot(win, shot) {
  win.webContents.on('console-message', (e, level, msg) => console.log('[page] ' + (msg ?? e.message)));
  sendCmd({ type: 'nosession' });
  await wait(800);
  const openPop = argValue('--open');
  const waveArg = argValue('--wave');
  const viewArg = argValue('--view');
  const timeArg = argValue('--time');
  const held = parseInt(argValue('--wait') || '0', 10);
  if (openPop) {
    sendCmd({ type: 'open', path: openPop, wave: waveArg ? parseInt(waveArg, 10) : null, view: viewArg, time: timeArg ? parseFloat(timeArg) : null, mapselect: process.argv.includes('--mapselect'), mapmode: argValue('--mapmode') });
    await wait(held > 0 ? held : 2500);
  } else if (argValue('--model')) {
    sendCmd({ type: 'viewmodel', base: argValue('--model') });
    await wait(6000);
  } else if (viewArg) {
    sendCmd({ type: 'view', view: viewArg });
    await wait(6000);
  }
  const input = argValue('--input');
  if (input) await runInput(win, input);
  await capture(win, shot);
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
