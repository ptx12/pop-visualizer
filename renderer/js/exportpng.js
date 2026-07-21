import { el } from './ui.js';
import { native } from './native.js';

const STRIP = '.bar-linkdot, .bar-resize, .row-collapse, .ws-drag, .tl-cursor, .tl-cursorlabel, .tl-snapguide, .tl-guide';

function collectCss() {
  const parts = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) parts.push(r.cssText);
  }
  return parts.join('\n').replaceAll(':root', ':root, svg');
}

export async function renderWavePng(container) {
  const header = container.querySelector('.tl-header');
  const inner = container.querySelector('.tl-inner');
  if (!inner) throw new Error('no timeline to export');
  const w = Math.ceil(inner.getBoundingClientRect().width);
  const rootCs = getComputedStyle(document.documentElement);
  const bg = rootCs.getPropertyValue('--bg0').trim() || '#1a1c1f';

  const wrap = el('div', { style: `width:${w}px;background:${bg};color:${rootCs.color};font:13px/1.45 "Segoe UI", system-ui, sans-serif;` });
  if (header) {
    const hc = header.cloneNode(true);
    const act = hc.querySelector('.tl-actions');
    if (act) act.remove();
    wrap.append(hc);
  }
  const ic = inner.cloneNode(true);
  ic.style.height = 'auto';
  ic.style.minHeight = '0';
  for (const n of ic.querySelectorAll(STRIP)) n.remove();
  wrap.append(ic);

  wrap.style.position = 'absolute';
  wrap.style.left = '-100000px';
  wrap.style.top = '0';
  wrap.style.visibility = 'hidden';
  document.body.append(wrap);
  let arrowBottom = 0;
  const wrapTop = wrap.getBoundingClientRect().top;
  const layer = ic.querySelector('.tl-arrowlayer');
  if (layer) {
    const lr = layer.getBoundingClientRect();
    if (lr.height) arrowBottom = lr.bottom - wrapTop;
  }
  const h = Math.ceil(Math.max(wrap.getBoundingClientRect().height, arrowBottom)) + 4;
  wrap.remove();
  wrap.style.position = '';
  wrap.style.left = '';
  wrap.style.top = '';
  wrap.style.visibility = '';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  const style = document.createElementNS(svgNS, 'style');
  style.textContent = collectCss();
  const fo = document.createElementNS(svgNS, 'foreignObject');
  fo.setAttribute('width', '100%');
  fo.setAttribute('height', '100%');
  fo.append(wrap);
  svg.append(style, fo);
  const text = new XMLSerializer().serializeToString(svg);

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  await img.decode();

  let scale = Math.min(2, 16000 / w, 16000 / h, Math.sqrt(72e6 / (w * h)));
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function exportWavePng(container, file, waveIndex, outPath = null) {
  const canvas = await renderWavePng(container);
  const name = `${(file.name || 'wave').replace(/\.pop$/i, '')}_wave${waveIndex + 1}.png`;
  if (native.isElectron && window.popnative.imageSave) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG encode failed');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return await window.popnative.imageSave(name, bytes, outPath);
  }
  const a = el('a', { href: canvas.toDataURL('image/png'), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  return name;
}
