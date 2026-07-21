import { el, clear, modal, closeModal, toast } from './ui.js';
import { native } from './native.js';
import { getTFPath } from './icons.js';
import { createModelScene, renderThumbnail } from './modelgl.js';

const bstate = {
  source: localStorage.getItem('popvis.mb.source') || 'local',
  localPath: localStorage.getItem('popvis.mb.local') || null,
  potatoPath: localStorage.getItem('popvis.mb.potato') || 'models',
  search: ''
};
const thumbCache = new Map();
let thumbQueue = [];
let thumbBusy = false;
let hlmvExe = undefined;
let hlmvKey = null;
let dlProgHandler = null;

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

async function findHLMV() {
  const key = localStorage.getItem('popvis.hlmv') || '';
  if (hlmvExe !== undefined && key === hlmvKey) return hlmvExe;
  hlmvKey = key;
  const tfPath = await getTFPath();
  hlmvExe = await window.popnative.hlmvFind(tfPath, key || null);
  return hlmvExe;
}

function pumpThumbs() {
  if (thumbBusy) return;
  const job = thumbQueue.shift();
  if (!job) return;
  thumbBusy = true;
  (async () => {
    try {
      if (!job.img.isConnected) return;
      const payload = await window.popnative.modelLoad(job.src);
      if (payload && !payload.error && payload.positions) {
        const url = await renderThumbnail(payload);
        if (url) {
          thumbCache.set(job.key, url);
          while (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
          if (job.img.isConnected) {
            job.img.src = url;
            job.img.classList.remove('mb-pending');
          }
        }
      } else if (job.img.isConnected) job.img.classList.add('mb-failed');
    } catch {}
    finally {
      thumbBusy = false;
      setTimeout(pumpThumbs, 0);
    }
  })();
}

function queueThumb(key, src, img) {
  if (thumbCache.has(key)) {
    img.src = thumbCache.get(key);
    img.classList.remove('mb-pending');
    return;
  }
  thumbQueue.push({ key, src, img });
  pumpThumbs();
}

async function openHLMVOrViewer(src, title) {
  if (src.kind === 'file') {
    const exe = await findHLMV();
    if (exe) {
      const tfPath = await getTFPath();
      const ok = await window.popnative.hlmvOpen(exe, tfPath, src.base + '.mdl');
      if (ok) { toast('Opened in ' + exe.split(/[\\/]/).pop()); return; }
    }
  }
  viewerModal(src, title);
}

export async function viewerModal(src, title) {
  const canvas = el('canvas', { class: 'mv-canvas', width: 760, height: 540 });
  const status = el('div', { class: 'mv-status', text: 'Loading...' });
  const controls = el('div', { class: 'mv-controls' });
  const body = el('div', { class: 'mv-body' }, canvas, controls, status);
  const buttons = [];
  if (src.kind === 'potato') {
    buttons.push({
      label: 'Download with dependencies', primary: true, action: () => {
        downloadModel(src.base);
        return false;
      }
    });
  }
  modal(title, body, buttons);

  const scene = createModelScene(canvas);
  if (!scene) { status.textContent = 'WebGL unavailable'; return; }
  const payload = await window.popnative.modelLoad(src);
  if (!canvas.isConnected) return;
  if (!payload || payload.error || !payload.positions) {
    status.textContent = 'Could not load model' + (payload && payload.error ? ': ' + payload.error : '');
    return;
  }
  await scene.setModel(payload, () => { if (!anim.playing) draw(); });

  const cam = { yaw: Math.PI * 0.75, pitch: 0.3, zoom: 2.2 };
  const anim = { idx: -1, frame: 0, playing: false, raf: 0 };

  const draw = () => {
    scene.applyAnim(anim.idx, anim.frame);
    scene.render(cam);
  };

  status.textContent = `${payload.name || title} — ${payload.numVerts} verts, ${payload.meshes.length} meshes, ${payload.bones.length} bones`;
  const animSel = el('select', { class: 'inp sm' },
    el('option', { value: -1, text: payload.anims.length ? 'Bind pose' : 'Bind pose (no inline anims)' }),
    ...payload.anims.map((a, i) => el('option', { value: i, text: a.name + ' (' + a.numframes + 'f)' })));
  const playBtn = el('button', { class: 'btn sm', text: 'Play' });
  controls.append(animSel, playBtn);

  function tick(prev) {
    anim.raf = 0;
    if (!canvas.isConnected || !anim.playing) return;
    const a = payload.anims[anim.idx];
    const now = performance.now();
    if (a) {
      anim.frame += ((now - prev) / 1000) * a.fps;
      if (anim.frame >= a.numframes) anim.frame = 0;
      draw();
    }
    anim.raf = requestAnimationFrame(() => tick(now));
  }
  animSel.addEventListener('change', () => {
    anim.idx = parseInt(animSel.value, 10);
    anim.frame = 0;
    if (anim.playing && !anim.raf) anim.raf = requestAnimationFrame(() => tick(performance.now()));
    draw();
  });
  playBtn.addEventListener('click', () => {
    if (!payload.anims.length) return;
    if (!anim.playing && anim.idx < 0) {
      animSel.value = 0;
      anim.idx = 0;
      anim.frame = 0;
    }
    anim.playing = !anim.playing;
    playBtn.textContent = anim.playing ? 'Pause' : 'Play';
    if (anim.playing && !anim.raf) anim.raf = requestAnimationFrame(() => tick(performance.now()));
  });

  let drag = null;
  canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('mousemove', e => {
    if (!drag || !canvas.isConnected) return;
    cam.yaw -= (e.clientX - drag.x) * 0.01;
    cam.pitch = Math.min(1.5, Math.max(-1.5, cam.pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
    if (!anim.playing) draw();
  });
  addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = Math.min(8, Math.max(0.6, cam.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    if (!anim.playing) draw();
  }, { passive: false });

  draw();
}

const activeModelDownloads = new Set();

async function downloadModel(rel) {
  if (activeModelDownloads.has(rel)) return;
  activeModelDownloads.add(rel);
  try {
    const tfPath = await getTFPath();
    toast('Downloading ' + rel + '...');
    const res = await window.popnative.potatoModel(rel, tfPath);
    if (!res || res.error) { toast('Download failed: ' + (res ? res.error : '?'), 'error'); return; }
    const dl = res.results.filter(r => r.status === 'downloaded').length;
    const ex = res.results.filter(r => r.status === 'exists').length;
    const miss = res.results.filter(r => r.status === 'missing').length;
    toast(`${rel.split('/').pop()}: ${dl} files downloaded, ${ex} already present${miss ? ', ' + miss + ' missing' : ''}`, miss ? 'error' : 'ok');
  } catch (e) {
    toast('Download failed: ' + e.message, 'error');
  } finally {
    activeModelDownloads.delete(rel);
    dispatchEvent(new CustomEvent('popvis-dlprog', { detail: '' }));
  }
}

async function defaultLocalPath() {
  const tfPath = await getTFPath();
  if (!tfPath) return null;
  for (const cand of [native.join(tfPath, 'download', 'models'), native.join(tfPath, 'download'), tfPath]) {
    if (await native.exists(cand)) return cand;
  }
  return tfPath;
}

export function renderModelBrowser(container) {
  clear(container);
  if (!native.isElectron) {
    container.append(el('div', { class: 'empty-note', text: 'The model browser needs the desktop app.' }));
    return;
  }
  const wrap = el('div', { class: 'mb-wrap' });
  container.append(wrap);
  drawBrowser(wrap);
}

async function drawBrowser(wrap) {
  clear(wrap);
  const isLocal = bstate.source === 'local';
  if (isLocal && !bstate.localPath) bstate.localPath = await defaultLocalPath();
  if (isLocal && !bstate.localPath) {
    wrap.append(el('div', { class: 'empty-note', text: 'TF folder not found. Set it in Settings.' }));
    return;
  }

  const srcSeg = el('span', { class: 'map-modes' },
    ...[['local', 'Local'], ['potato', 'potato.tf']].map(([s, label]) => el('button', {
      class: 'seg-btn' + (bstate.source === s ? ' on' : ''), text: label,
      onclick: () => {
        bstate.source = s;
        localStorage.setItem('popvis.mb.source', s);
        drawBrowser(wrap);
      }
    })));
  const upBtn = el('button', { class: 'btn sm', text: 'Up', onclick: () => {
    if (isLocal) {
      const parent = native.dirname(bstate.localPath);
      if (parent && parent !== bstate.localPath) bstate.localPath = parent;
    } else {
      const parts = bstate.potatoPath.split('/').filter(Boolean);
      parts.pop();
      bstate.potatoPath = parts.join('/');
    }
    persistPath();
    drawBrowser(wrap);
  } });
  const search = el('input', { class: 'inp tpl-search', type: 'search', placeholder: 'Filter...', value: bstate.search });
  search.addEventListener('input', () => {
    bstate.search = search.value;
    renderEntries();
  });
  const pathLbl = el('span', { class: 'mb-path', text: isLocal ? bstate.localPath : '/' + bstate.potatoPath });
  const browseBtn = isLocal ? el('button', { class: 'btn sm', text: 'Folder…', onclick: async () => {
    const dir = await native.dirDialog('Browse a models folder');
    if (dir) { bstate.localPath = dir; persistPath(); drawBrowser(wrap); }
  } }) : null;
  const dlStatus = el('span', { class: 'map-note mb-dl' });
  wrap.append(el('div', { class: 'map-toolbar' }, srcSeg, upBtn, browseBtn, search, pathLbl, dlStatus));
  const grid = el('div', { class: 'mb-grid' });
  wrap.append(grid);

  if (dlProgHandler) removeEventListener('popvis-dlprog', dlProgHandler);
  dlProgHandler = e => { dlStatus.textContent = e.detail || ''; };
  addEventListener('popvis-dlprog', dlProgHandler);

  let listing = null;
  if (isLocal) {
    listing = await window.popnative.fsxList(bstate.localPath);
  } else {
    listing = await window.popnative.potatoList(bstate.potatoPath ? bstate.potatoPath + '/' : '');
  }
  if (!grid.isConnected) return;
  if (!listing) {
    grid.append(el('div', { class: 'empty-note', text: isLocal ? 'Cannot read folder.' : 'Index unreachable.' }));
    return;
  }

  function persistPath() {
    localStorage.setItem('popvis.mb.local', bstate.localPath || '');
    localStorage.setItem('popvis.mb.potato', bstate.potatoPath || '');
  }

  function enterDir(name) {
    if (isLocal) bstate.localPath = native.join(bstate.localPath, name);
    else bstate.potatoPath = (bstate.potatoPath ? bstate.potatoPath + '/' : '') + name;
    persistPath();
    drawBrowser(wrap);
  }

  const modelSets = new Map();
  for (const f of listing.files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.mdl')) {
      modelSets.set(f.name.slice(0, -4), { size: f.size });
    }
  }

  function renderEntries() {
    clear(grid);
    const q = bstate.search.toLowerCase();
    for (const d of listing.dirs) {
      if (q && !d.toLowerCase().includes(q)) continue;
      grid.append(el('div', { class: 'mb-card mb-dir', role: 'button', tabindex: 0, 'data-kbd': true, title: 'Open folder', onclick: () => enterDir(d) },
        el('div', { class: 'mb-dir-glyph', text: '/' }),
        el('div', { class: 'mb-name', text: d })));
    }
    for (const [base, info] of modelSets) {
      if (q && !base.toLowerCase().includes(q)) continue;
      const src = isLocal
        ? { kind: 'file', base: native.join(bstate.localPath, base) }
        : { kind: 'potato', base: (bstate.potatoPath ? bstate.potatoPath + '/' : '') + base };
      const img = el('img', { class: 'mb-thumb mb-pending', draggable: 'false' });
      const card = el('div', { class: 'mb-card', title: base + '.mdl' + (info.size ? ' — ' + fmtSize(info.size) : '') },
        img,
        el('div', { class: 'mb-name', text: base }),
        el('div', { class: 'mb-actions' },
          el('button', { class: 'btn sm', text: 'View', title: 'Open in the built-in viewer', onclick: e => { e.stopPropagation(); viewerModal(src, base); } }),
          isLocal ? el('button', { class: 'btn sm', text: 'HLMV', title: 'Open in HLMV when installed next to TF2 (also double-click)', onclick: e => { e.stopPropagation(); openHLMVOrViewer(src, base); } }) : null,
          isLocal ? null : el('button', { class: 'btn sm', text: 'Get', title: 'Download the model and its textures into tf/download', onclick: e => { e.stopPropagation(); downloadModel(src.base + '.mdl'); } })));
      card.addEventListener('dblclick', () => openHLMVOrViewer(src, base));
      grid.append(card);
      if (isLocal) queueThumb(src.base, src, img);
    }
    if (!grid.children.length) grid.append(el('div', { class: 'empty-note', text: 'Nothing here' + (q ? ' matches' : '') + '.' }));
  }
  renderEntries();
}
