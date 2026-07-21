import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let win = null;

export function setWindow(w) {
  win = w;
}

export function getWindow() {
  return win;
}

export function windowAlive() {
  return !!win && !win.isDestroyed();
}

export function sendCmd(payload) {
  if (windowAlive()) win.webContents.send('cmd', payload);
}

let exportQuit = false;

export function setExportQuit(v) {
  exportQuit = v;
}

export function isExportQuit() {
  return exportQuit;
}

export function lru(max) {
  const map = new Map();
  return {
    has: k => map.has(k),
    get(k) {
      if (!map.has(k)) return undefined;
      const v = map.get(k);
      map.delete(k);
      map.set(k, v);
      return v;
    },
    set(k, v) {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      while (map.size > max) map.delete(map.keys().next().value);
      return v;
    },
    clear: () => map.clear()
  };
}
