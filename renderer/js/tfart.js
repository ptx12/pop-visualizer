import { native } from './native.js';
import { getTFPath } from './icons.js';

const CASH_VTF = 'materials/models/items/cash_bundle.vtf';
const LOGO_VTF = 'materials/vgui/gfx/vgui/tf_logo.vtf';

const cache = new Map();

async function loadTexture(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const p = (async () => {
    if (!native.isElectron || !window.popnative.matTexture) return null;
    try {
      const t = await window.popnative.matTexture(rel, await getTFPath());
      if (!t || !t.rgba || !t.width || !t.height) return null;
      const u8 = t.rgba instanceof Uint8Array ? t.rgba : new Uint8Array(t.rgba);
      const canvas = document.createElement('canvas');
      canvas.width = t.width;
      canvas.height = t.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(u8), t.width, t.height), 0, 0);
      return canvas;
    } catch {
      return null;
    }
  })();
  cache.set(rel, p);
  return p;
}

function crop(src, sx, sy, sw, sh, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export async function cashSwatch(size = 48) {
  const src = await loadTexture(CASH_VTF);
  if (!src) return null;
  const s = Math.min(src.width, src.height);
  return crop(src, 0, 0, s, s, size / s).toDataURL('image/png');
}

export async function tfLogo(size = 20, style = 'silver') {
  const src = await loadTexture(LOGO_VTF);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, size, size);
  g.globalCompositeOperation = 'source-in';
  if (style === 'blue') {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#9dc6ee');
    grad.addColorStop(1, '#4d6f93');
    g.fillStyle = grad;
  } else {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#f2f5f8');
    grad.addColorStop(0.45, '#c3cad2');
    grad.addColorStop(0.55, '#8b939c');
    grad.addColorStop(1, '#d8dee5');
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, size, size);
  return c.toDataURL('image/png');
}
