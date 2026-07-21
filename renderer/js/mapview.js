import { el, clear, showTip, hideTip, fmtTime, loader } from './ui.js';
import { simFor, emit, onChange, deathModel, navTogglesFor } from './state.js';
import { CLASS_INFO, botDisplayName } from './popmodel.js';
import { getTFPath, iconURL, iconNameFor, classIconName } from './icons.js';
import { native } from './native.js';
import { createBotSim, actorPosAt, botMaxSpeed, buildTrackChains, dpsProfile, objectiveCandidates, bombPathGroups, STEP } from './botai.js';
import { primaryColor } from './timeline.js';
import { simOptsPanel } from './inspector.js';
import { icon } from './svgicon.js';

const playStates = new Map();
const viewStates = new Map();
const aiRuns = new WeakMap();
const lastAi = new Map();
const worldCache = new Map();
const imgCache = new Map();
const paintCache = new Map();
const paintVersions = new Map();
const mapDlActive = new Set();
const WORLD_MAX = 4096;
const KILL_RADIUS = 200;
const GIANT_BG = '#c01c00';
const NORMAL_BG = '#ebe2ca';
const CRIT_BG = ['#0099c5', '#00ceeb'];
const CRIT_FPS = 5;
const TANK_PATH = '#cfa35a';

onChange(what => { if (what === 'icons') imgCache.clear(); });

let waPanel = null;
let mapRedraw = null;

function drawRoute(ctx, pts, toScreen, phase) {
  if (!pts || pts.length < 2) return;
  const scr = pts.map(p => toScreen(p[0], p[1]));
  ctx.save();
  ctx.strokeStyle = '#7fb8f0';
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  ctx.lineJoin = 'round';
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -phase * 16;
  ctx.beginPath();
  ctx.moveTo(scr[0][0], scr[0][1]);
  for (let i = 1; i < scr.length; i++) ctx.lineTo(scr[i][0], scr[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  const SP = 72;
  let acc = 0;
  ctx.fillStyle = '#a7d0ff';
  for (let i = 1; i < scr.length; i++) {
    const [x0, y0] = scr[i - 1], [x1, y1] = scr[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg < 0.01) continue;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    let d = SP - acc;
    while (d < seg) {
      const t = d / seg;
      ctx.save();
      ctx.translate(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-5, -4.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      d += SP;
    }
    acc = (acc + seg) % SP;
  }
  ctx.restore();
}

const WT_PAD = 5;
const WT_MAX_COLS = 5;
const WT_WINDOW = 75;

function wtLayout(canvas, colCount) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const n = Math.max(1, colCount);
  const colW = w / n;
  const iconSize = colW >= 22 ? Math.min(24, colW - 6) : 0;
  const headH = iconSize ? iconSize + 8 : 0;
  return { w, h, n, colW, barW: Math.max(3, Math.min(30, colW - 8)), iconSize, headH, gh: h - WT_PAD * 2 - headH };
}

function wsSpan(ws, r, waveEnd) {
  if (!r) return null;
  const a = ws.isLogic ? r.start : r.firstSpawn;
  const b = ws.isLogic ? r.start : Math.max(r.deathEnd, r.supportUntil || 0, r.lastSpawn);
  return [a, Math.min(b, waveEnd)];
}

function wtGroups(wave) {
  const groups = [];
  const byName = new Map();
  for (const ws of wave.wavespawns) {
    const key = !ws.isLogic && ws.name ? ws.name.toLowerCase() : null;
    if (key !== null && byName.has(key)) { byName.get(key).push(ws); continue; }
    const g = [ws];
    groups.push(g);
    if (key !== null) byName.set(key, g);
  }
  return groups;
}

export function wtView(wave, sim, waveEnd, t) {
  const half = WT_WINDOW * 0.35;
  let a = Math.max(0, t - half);
  let b = a + WT_WINDOW;
  if (b > waveEnd) { b = waveEnd; a = Math.max(0, b - WT_WINDOW); }

  const groups = wtGroups(wave);
  const scored = [];
  for (const members of groups) {
    let s = Infinity, e = -Infinity;
    for (const ws of members) {
      const span = wsSpan(ws, sim.results.get(ws), waveEnd);
      if (!span) continue;
      s = Math.min(s, span[0]);
      e = Math.max(e, span[1]);
    }
    if (!Number.isFinite(s)) continue;
    const activeNow = t >= s - 0.5 && t <= e + 0.5;
    const overlaps = e >= a && s <= b;
    if (!activeNow && !overlaps) continue;
    scored.push({ members, s, e, rank: activeNow ? 0 : (s >= t ? 1 : 2), dist: Math.abs(s - t) });
  }
  scored.sort((x, y) => x.rank - y.rank || x.dist - y.dist);
  const picked = scored.slice(0, WT_MAX_COLS).sort((x, y) => x.s - y.s || x.e - y.e);
  return { cols: picked.map(p => p.members), a, b, total: groups.length };
}

function wsIconNames(members) {
  const names = [];
  const push = n => { if (n && !names.includes(n)) names.push(n); };
  for (const ws of members) {
    for (const b of ws.bots) {
      if (names.length >= 3) break;
      if (b.tank) push('leaderboard_class_tank');
      else if (b.bot) push(iconNameFor(b.bot) || classIconName(b.bot.cls));
    }
    if (!names.length && ws.isTank) push('leaderboard_class_tank');
  }
  return names;
}

function drawFlippedTimeline(canvas, view, sim) {
  const L = wtLayout(canvas, view.cols.length);
  if (!L.w || !L.h) return false;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(L.w * dpr) || canvas.height !== Math.round(L.h * dpr)) {
    canvas.width = Math.round(L.w * dpr);
    canvas.height = Math.round(L.h * dpr);
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, L.w, L.h);
  const top = WT_PAD + L.headH;
  const span = Math.max(1, view.b - view.a);
  const yOf = t => top + Math.max(0, Math.min(1, (t - view.a) / span)) * L.gh;

  if (!view.cols.length) {
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.font = '11px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('nothing active here', L.w / 2, L.h / 2);
    c.textAlign = 'left';
    return true;
  }

  if (L.iconSize) {
    const redraw = () => {
      if (waPanel && waPanel.canvas.isConnected && waPanel.view) drawFlippedTimeline(waPanel.canvas, waPanel.view, waPanel.sim);
    };
    view.cols.forEach((members, i) => {
      const ws = members[0];
      const names = wsIconNames(members);
      const cx = i * L.colW + L.colW / 2;
      if (!names.length) return;
      const size = Math.max(10, Math.min(L.iconSize, (L.colW - 6) / names.length));
      const totalW = size * names.length;
      names.forEach((name, k) => {
        const img = iconImage(name, redraw);
        const ix = cx - totalW / 2 + k * size;
        const iy = WT_PAD + (L.iconSize - size) / 2;
        if (img && img.complete && img.naturalWidth) {
          c.drawImage(img, ix, iy, size, size);
        } else {
          c.fillStyle = ws.isLogic ? '#e0b45f' : primaryColor(ws);
          c.globalAlpha = .5;
          c.beginPath();
          c.arc(ix + size / 2, iy + size / 2, size / 3, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = 1;
        }
      });
    });
  }

  c.strokeStyle = 'rgba(255,255,255,.06)';
  c.lineWidth = 1;
  const step = span > 300 ? 60 : span > 120 ? 30 : span > 60 ? 15 : 10;
  c.font = '9px var(--mono, monospace)';
  for (let tt = Math.ceil(view.a / step) * step; tt <= view.b; tt += step) {
    const y = Math.round(yOf(tt)) + .5;
    c.beginPath(); c.moveTo(0, y); c.lineTo(L.w, y); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.22)';
    c.fillText(fmtTime(tt), 2, y - 2);
  }

  view.cols.forEach((members, i) => {
    const ws = members[0];
    const rs = members.map(m => sim.results.get(m)).filter(Boolean);
    if (!rs.length) return;
    const r = rs[0];
    const cx = i * L.colW + L.colW / 2;
    const x = cx - L.barW / 2;
    const color = ws.isLogic ? '#e0b45f' : primaryColor(ws);

    const gate = Math.min(...rs.map(v => v.gate));
    if (gate > 0.01) {
      const gy = yOf(gate), sy = yOf(Math.min(...rs.map(v => Math.max(v.start, v.firstSpawn))));
      if (sy - gy > 1) {
        c.strokeStyle = 'rgba(255,255,255,.18)';
        c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(Math.round(cx) + .5, gy); c.lineTo(Math.round(cx) + .5, sy); c.stroke();
        c.setLineDash([]);
      }
    }

    if (ws.isLogic) {
      const y = yOf(r.start);
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(cx, y - 4); c.lineTo(cx + 4, y); c.lineTo(cx, y + 4); c.lineTo(cx - 4, y);
      c.closePath(); c.fill();
      return;
    }

    const y1 = yOf(Math.min(...rs.map(v => v.firstSpawn)));
    const y2 = yOf(Math.max(...rs.map(v => v.lastSpawn)));
    const y3 = yOf(Math.max(...rs.map(v => Math.max(v.deathEnd, v.supportUntil || 0))));

    if (y3 > y2 + 1) {
      c.globalAlpha = .18;
      c.fillStyle = color;
      c.fillRect(x, y2, L.barW, y3 - y2);
      c.globalAlpha = 1;
    }

    c.globalAlpha = .5;
    c.fillStyle = color;
    c.fillRect(x, y1, L.barW, Math.max(2, y2 - y1));
    c.globalAlpha = 1;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.strokeRect(Math.round(x) + .5, Math.round(y1) + .5, Math.round(L.barW) - 1, Math.max(2, Math.round(y2 - y1)) - 1);

    if (L.barW >= 5) {
      c.fillStyle = 'rgba(0,0,0,.45)';
      const evs = rs.flatMap(v => v.events);
      const nth = Math.ceil(evs.length / 120);
      evs.forEach((ev, k) => {
        if (k % nth) return;
        c.fillRect(x + 1, Math.round(yOf(ev.t)), L.barW - 2, 1);
      });
    }
  });

  if (L.colW >= 13) {
    c.save();
    c.beginPath();
    c.rect(0, 0, L.w, L.h);
    c.clip();
    c.font = '600 10px "Segoe UI", system-ui, sans-serif';
    c.textBaseline = 'middle';
    view.cols.forEach((members, i) => {
      const name = members[0].name || '(unnamed)';
      c.save();
      c.translate(i * L.colW + L.colW / 2, WT_PAD + L.headH + 3);
      c.rotate(Math.PI / 2);
      const tw = Math.min(c.measureText(name).width, L.gh - 8);
      c.fillStyle = 'rgba(16,18,20,.82)';
      c.fillRect(-2, -6, tw + 5, 13);
      c.fillStyle = 'rgba(228,230,233,.95)';
      c.fillText(name, 0, 0, tw);
      c.restore();
    });
    c.restore();
  }
  return true;
}

function updateWavePanel(t, alive, waveEnd) {
  const p = waPanel;
  if (!p || !p.canvas.isConnected) return;
  if (waveEnd && Math.abs(waveEnd - p.waveEnd) > 0.5) {
    p.waveEnd = waveEnd;
    p.view = null;
  }
  const next = wtView(p.wave, p.sim, p.waveEnd, t);
  const changed = !p.view
    || Math.abs(next.a - p.view.a) > 0.4
    || next.cols.length !== p.view.cols.length
    || next.cols.some((m, i) => m[0] !== p.view.cols[i][0] || m.length !== p.view.cols[i].length)
    || p.canvas.clientHeight !== p.lastH
    || p.canvas.clientWidth !== p.lastW;
  if (changed) {
    p.view = next;
    if (drawFlippedTimeline(p.canvas, next, p.sim)) {
      p.lastH = p.canvas.clientHeight;
      p.lastW = p.canvas.clientWidth;
    }
  }
  const L = wtLayout(p.canvas, p.view.cols.length);
  const span = Math.max(1, p.view.b - p.view.a);
  const frac = Math.max(0, Math.min(1, (t - p.view.a) / span));
  const y = WT_PAD + L.headH + frac * L.gh;
  p.head.style.top = y + 'px';
  p.headLabel.style.top = y + 'px';
  p.headLabel.textContent = fmtTime(t);
  p.timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(p.waveEnd);
  if (alive !== undefined) p.activeEl.textContent = String(alive);
}

export function renderMapInspector(container, file, waveIndex) {
  clear(container);
  waPanel = null;
  const wave = file.model.waves[waveIndex];
  if (!wave) return;
  const sim = simFor(file, wave);
  const ps = playStates.get(file.id + ':' + waveIndex);
  const waveEnd = Math.max(1, (ps && ps.waveEnd) || sim.waveEnd);

  const timeEl = el('span', { class: 'wa-v', text: '0:00 / ' + fmtTime(waveEnd) });
  const activeEl = el('span', { class: 'wa-v', text: '0' });
  const canvas = el('canvas', { class: 'wa-canvas' });
  const head = el('div', { class: 'wa-head' });
  const headLabel = el('div', { class: 'wa-headlabel', text: '0:00' });
  const graph = el('div', { class: 'wa-graph' }, canvas, head, headLabel);

  container.append(el('div', { class: 'wa-panel' },
    el('div', { class: 'panel-title', text: 'WAVE TIMELINE' }),
    el('div', { class: 'wa-stats' },
      el('div', { class: 'wa-row' }, el('span', { class: 'wa-k', text: 'Time' }), timeEl),
      el('div', { class: 'wa-row' }, el('span', { class: 'wa-k', text: 'Active' }), activeEl)),
    graph));

  waPanel = { canvas, head, headLabel, graph, timeEl, activeEl, wave, sim, waveEnd, view: null, lastH: -1, lastW: -1 };
  updateWavePanel(ps ? ps.t : 0, undefined);

  const timeAt = ev => {
    const p = waPanel;
    if (!p || !p.view) return 0;
    const L = wtLayout(canvas, p.view.cols.length);
    const r = graph.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientY - r.top - WT_PAD - L.headH) / Math.max(1, L.gh)));
    return p.view.a + frac * Math.max(1, p.view.b - p.view.a);
  };

  graph.addEventListener('mousemove', ev => {
    const p = waPanel;
    if (!p || !p.view || !p.view.cols.length) { hideTip(); return; }
    const L = wtLayout(canvas, p.view.cols.length);
    const r = graph.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left) / Math.max(1, L.colW));
    const members = p.view.cols[i];
    if (!members) { hideTip(); return; }
    const ws = members[0];
    const rs = members.map(m => sim.results.get(m)).filter(Boolean);
    const res = rs[0];
    const bits = [(ws.name || '(unnamed)') + (members.length > 1 ? ` · ${members.length} wavespawns` : '')];
    if (res) bits.push(ws.isLogic ? 'logic @ ' + fmtTime(res.start)
      : `${fmtTime(Math.min(...rs.map(v => v.firstSpawn)))} – ${fmtTime(Math.max(...rs.map(v => v.lastSpawn)))}`);
    bits.push('cursor ' + fmtTime(Math.max(0, timeAt(ev))));
    showTip(bits.join('\n'), ev.clientX, ev.clientY);
  });
  graph.addEventListener('mouseleave', hideTip);

  const scrub = ev => {
    const st = playStates.get(file.id + ':' + waveIndex);
    if (!st) return;
    st.t = Math.max(0, Math.min(waPanel ? waPanel.waveEnd : waveEnd, timeAt(ev)));
    if (mapRedraw) mapRedraw();
    else updateWavePanel(st.t, undefined);
  };
  graph.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrub(e);
    const move = e2 => scrub(e2);
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
}

function killPointsFor(mapName) {
  try { return JSON.parse(localStorage.getItem('popvis.killpts.' + mapName) || '[]') || []; } catch { return []; }
}

function saveKillPoints(mapName, list) {
  if (list.length) localStorage.setItem('popvis.killpts.' + mapName, JSON.stringify(list));
  else localStorage.removeItem('popvis.killpts.' + mapName);
}

function bombPathFor(mapName, groups) {
  const v = localStorage.getItem('popvis.bombpath.' + mapName);
  if (v && groups.some(g => g.key === v)) return v;
  return null;
}

function objectiveIdxFor(mapName) {
  return parseInt(localStorage.getItem('popvis.objidx.' + mapName) || '0', 10) || 0;
}

export function presetMapTime(file, waveIndex, t) {
  playStateFor(file, waveIndex).t = Math.max(0, t);
}

function reloadMapData(file) {
  file.mapData = undefined;
  file.mapGeo = undefined;
  file.mapTexture = undefined;
  file.mapDataReq = null;
  file.tankPathsKey = null;
  emit('map');
}

function renderNavGate(container, file, mapData) {
  clear(container);
  const search = mapData.navSearch || {};
  const panel = el('div', { class: 'nav-gate' });
  panel.append(el('div', { class: 'panel-title', text: 'NO NAV MESH' }));
  panel.append(el('div', { class: 'nav-gate-msg', text: 'The simulation needs ' + mapData.map + '.nav. Without it bots have no walkable graph, so it will not run.' }));
  if (search.near && search.near.length) {
    panel.append(el('div', { class: 'nav-gate-sub' },
      el('span', { text: 'Nearby nav files found: ' }),
      el('span', { class: 'nav-gate-mono', text: search.near.join(', ') })));
  }
  if (search.searched && search.searched.length) {
    panel.append(el('div', { class: 'nav-gate-sub' },
      el('span', { text: 'Searched: ' }),
      el('span', { class: 'nav-gate-mono', text: search.searched.join('  ') }),
      el('span', { text: '  plus tf2_misc_dir.vpk and the map pakfile.' })));
  }

  const status = el('div', { class: 'nav-gate-status' });
  const list = el('div', { class: 'nav-gate-list' });

  const refreshBtn = el('button', {
    class: 'btn', text: 'Check again',
    title: 'Re-scan the map folders for a nav mesh',
    onclick: async () => {
      status.textContent = 'Rescanning…';
      if (native.isElectron) await window.popnative.mapFlush();
      reloadMapData(file);
    }
  });

  const findBtn = el('button', {
    class: 'btn primary', text: 'Find on potato.tf',
    onclick: async () => {
      if (!native.isElectron) { status.textContent = 'Desktop app only.'; return; }
      findBtn.disabled = true;
      status.textContent = 'Searching the index…';
      clear(list);
      try {
        const res = await window.popnative.potatoNavs(mapData.map);
        if (!res || res.error) { status.textContent = res && res.error ? res.error : 'Search failed.'; return; }
        if (!res.candidates.length) { status.textContent = 'No nav for this map on the index.'; return; }
        const exact = res.candidates.filter(c => c.exact);
        status.textContent = exact.length
          ? 'Found ' + exact[0].name + '.nav.'
          : 'No exact match — pick the closest ' + res.candidates.length + ':';
        for (const c of res.candidates) {
          list.append(el('button', {
            class: 'btn nav-cand' + (c.exact ? ' primary' : ''),
            text: c.name + '.nav' + (c.exact ? '  (exact)' : ''),
            onclick: async () => {
              status.textContent = 'Downloading ' + c.name + '.nav…';
              const tfPath = await getTFPath();
              const dl = await window.popnative.potatoNav(mapData.map, c.name, tfPath);
              if (!dl || dl.error) { status.textContent = dl && dl.error ? dl.error : 'Download failed.'; return; }
              status.textContent = 'Saved as ' + mapData.map + '.nav' + (dl.renamed ? ' (from ' + dl.source + ')' : '');
              await window.popnative.mapFlush();
              reloadMapData(file);
            }
          }));
        }
      } catch (err) {
        status.textContent = 'Search failed: ' + err.message;
      } finally {
        findBtn.disabled = false;
      }
    }
  });

  panel.append(el('div', { class: 'btn-row' }, refreshBtn, findBtn), status, list);
  container.append(panel);
}

function playStateFor(file, waveIndex) {
  const key = file.id + ':' + waveIndex;
  if (!playStates.has(key)) playStates.set(key, { t: 0, playing: false, speed: 1, raf: 0, mode: localStorage.getItem('popvis.mapmode') || 'full', tool: null, brush: 1, killRadius: KILL_RADIUS, hover: null, optionsOpen: localStorage.getItem('popvis.simpanel') !== '0' });
  return playStates.get(key);
}

function getDPS() {
  return Math.max(0, parseInt(localStorage.getItem('popvis.teamdps') || '1000', 10) || 0);
}

function zonesMode() {
  const v = localStorage.getItem('popvis.zonesmode');
  return v === 'custom' || v === 'off' ? v : 'auto';
}

function paintFor(mapName) {
  if (!paintCache.has(mapName)) {
    let m = new Map();
    try {
      const raw = localStorage.getItem('popvis.zonepaint.' + mapName);
      if (raw) m = new Map(JSON.parse(raw));
    } catch {}
    paintCache.set(mapName, m);
    if (!paintVersions.has(mapName)) paintVersions.set(mapName, 0);
  }
  return paintCache.get(mapName);
}

function savePaint(mapName) {
  const m = paintCache.get(mapName);
  try { localStorage.setItem('popvis.zonepaint.' + mapName, JSON.stringify([...m])); } catch {}
  paintVersions.set(mapName, (paintVersions.get(mapName) || 0) + 1);
}

function iconImage(name, onload) {
  if (!name) return null;
  if (imgCache.has(name)) return imgCache.get(name);
  const url = iconURL(name);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  if (onload) img.onload = onload;
  imgCache.set(name, img);
  return img;
}

function heightShade(z, zMin, zMax, lit) {
  const f = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0.5;
  return lit ? 0.90 + f * 0.18 : 0.62 + f * 0.55;
}

function playableBounds(mapData) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  };
  if (mapData.nav) for (const a of mapData.nav.areas) { add(a.nw[0], a.nw[1]); add(a.se[0], a.se[1]); }
  for (const s of mapData.spawns) add(s.origin[0], s.origin[1]);
  for (const t of mapData.tracks) add(t.origin[0], t.origin[1]);
  if (!Number.isFinite(b[0])) return null;
  return [b[0] - 600, b[1] - 600, b[2] + 600, b[3] + 600];
}

function requestMapTexture(file) {
  if (!native.isElectron || !window.popnative.mapTexture) return;
  if (file.mapTexture !== undefined || file.mapTexReq) return;
  const reqName = file.name;
  file.mapTexReq = (async () => {
    try {
      const t = await window.popnative.mapTexture(file.name, await getTFPath());
      if (file.name !== reqName) return;
      if (t && t.rgba && t.width && t.height) {
        const u8 = t.rgba instanceof Uint8Array ? t.rgba : new Uint8Array(t.rgba);
        const cv = document.createElement('canvas');
        cv.width = t.width; cv.height = t.height;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(u8.buffer, u8.byteOffset, u8.byteLength), t.width, t.height), 0, 0);
        file.mapTexture = { bounds: t.bounds, canvas: cv, width: t.width, height: t.height };
      } else file.mapTexture = null;
    } catch { if (file.name === reqName) file.mapTexture = null; }
    finally { file.mapTexReq = null; worldCache.clear(); emit('map'); }
  })();
}

function buildWorldCanvas(key, mode, mapData, geo, tex) {
  if (worldCache.has(key)) return worldCache.get(key);
  const clip = playableBounds(mapData);
  let bounds;
  if (mode === 'full' && (geo || tex)) {
    const gb = tex ? tex.bounds : geo.bounds;
    bounds = clip
      ? [Math.max(gb[0], clip[0]), Math.max(gb[1], clip[1]), Math.min(gb[2], clip[2]), Math.min(gb[3], clip[3])]
      : gb;
  }
  else if (mapData.nav) {
    bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const a of mapData.nav.areas) {
      bounds[0] = Math.min(bounds[0], a.nw[0]);
      bounds[1] = Math.min(bounds[1], a.nw[1]);
      bounds[2] = Math.max(bounds[2], a.se[0]);
      bounds[3] = Math.max(bounds[3], a.se[1]);
    }
  } else if (geo) bounds = geo.bounds;
  else return null;

  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  if (w <= 0 || h <= 0) return null;
  const scale = Math.min(WORLD_MAX / w, WORLD_MAX / h, 1.2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(w * scale));
  canvas.height = Math.max(64, Math.round(h * scale));
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b0e12';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const tx = x => (x - bounds[0]) * scale;
  const ty = y => (bounds[3] - y) * scale;

  if (mode === 'full' && tex) {
    const tb = tex.bounds;
    const sx = (bounds[0] - tb[0]) / (tb[2] - tb[0]) * tex.width;
    const sw = (bounds[2] - bounds[0]) / (tb[2] - tb[0]) * tex.width;
    const sy = (tb[3] - bounds[3]) / (tb[3] - tb[1]) * tex.height;
    const sh = (bounds[3] - bounds[1]) / (tb[3] - tb[1]) * tex.height;
    g.imageSmoothingEnabled = true;
    g.drawImage(tex.canvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const world = { canvas, bounds, scale };
    worldCache.set(key, world);
    while (worldCache.size > 4) worldCache.delete(worldCache.keys().next().value);
    return world;
  }

  if (mode === 'full' && geo) {
    const data = geo.data;
    const [zMin, zMax] = geo.zRange;
    let i = 0;
    while (i < data.length) {
      const n = data[i++];
      const r = data[i++], gg = data[i++], b = data[i++], z = data[i++];
      let inside = false;
      for (let v = 0; v < n && !inside; v++) {
        const x = data[i + v * 2], y = data[i + v * 2 + 1];
        if (x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]) inside = true;
      }
      if (!inside) { i += n * 2; continue; }
      const sh = heightShade(z, zMin, zMax, geo && geo.lit);
      g.fillStyle = `rgb(${Math.min(255, r * sh) | 0},${Math.min(255, gg * sh) | 0},${Math.min(255, b * sh) | 0})`;
      g.beginPath();
      g.moveTo(tx(data[i]), ty(data[i + 1]));
      for (let v = 1; v < n; v++) g.lineTo(tx(data[i + v * 2]), ty(data[i + v * 2 + 1]));
      g.closePath();
      g.fill();
      i += n * 2;
    }
  } else if (mapData.nav) {
    let zMin = Infinity, zMax = -Infinity;
    for (const a of mapData.nav.areas) { zMin = Math.min(zMin, a.nw[2]); zMax = Math.max(zMax, a.nw[2]); }
    for (const a of mapData.nav.areas) {
      const f = zMax > zMin ? (a.nw[2] - zMin) / (zMax - zMin) : 0.5;
      g.fillStyle = `hsl(215, 15%, ${15 + f * 18}%)`;
      const x = tx(a.nw[0]), y = ty(a.se[1]);
      g.fillRect(x, y, Math.max(1, tx(a.se[0]) - x - 0.5), Math.max(1, ty(a.nw[1]) - y - 0.5));
    }
  }
  const world = { canvas, bounds, scale };
  worldCache.set(key, world);
  while (worldCache.size > 4) worldCache.delete(worldCache.keys().next().value);
  return world;
}

function aiRunFor(file, wave, sim, mapData, key, opts) {
  const stableKey = file.id + ':' + wave.index;
  let run = aiRuns.get(sim);
  if (run && run.key === key) return run;
  const staleAi = (run ? (run.ai || run.staleAi) : null) || lastAi.get(stableKey);
  if (run) run.cancelled = true;
  const stepper = createBotSim(wave, sim, mapData, opts);
  run = { key, ai: null, staleAi, cancelled: false, progressEl: null, stepper };
  aiRuns.set(sim, run);
  const tick = () => {
    if (run.cancelled) return;
    const start = performance.now();
    let done = false;
    while (!done && performance.now() - start < 24) done = stepper.stepMany(16);
    if (run.progressEl && run.progressEl.isConnected) {
      run.progressEl.textContent = 'Simulating ' + Math.round(stepper.progress() * 100) + '%';
    }
    if (done) {
      run.ai = stepper.result();
      lastAi.delete(stableKey);
      lastAi.set(stableKey, run.ai);
      while (lastAi.size > 6) lastAi.delete(lastAi.keys().next().value);
      emit('map');
    } else setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return run;
}

export function renderMapView(container, file, waveIndex) {
  clear(container);
  const wave = file.model.waves[waveIndex];
  if (!wave) { container.append(el('div', { class: 'empty-note', text: 'No such wave' })); return; }
  if (!native.isElectron) {
    container.append(el('div', { class: 'empty-note', text: 'Map view needs the desktop app.' }));
    return;
  }
  if (file.mapData === undefined || file.mapGeo === undefined) {
    if (!file.mapDataReq) {
      const reqName = file.name;
      file.mapDataReq = (async () => {
        try {
          const tfPath = await getTFPath();
          const [md, mg] = await Promise.all([
            window.popnative.mapData(file.name, tfPath),
            window.popnative.mapGeo(file.name, tfPath)
          ]);
          if (file.name !== reqName) return;
          file.mapData = md;
          if (mg && mg.data) {
            const u8 = mg.data instanceof Uint8Array ? mg.data : new Uint8Array(mg.data);
            const buf = u8.byteOffset % 4 === 0 ? u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : u8.slice().buffer;
            file.mapGeo = { polys: mg.polys, bounds: mg.bounds, zRange: mg.zRange, lit: mg.lit, data: new Float32Array(buf) };
          } else file.mapGeo = null;
        } catch {
          if (file.name === reqName) { file.mapData = null; file.mapGeo = null; }
        } finally {
          file.mapDataReq = null;
        }
        emit('map');
      })();
    }
    container.append(loader('Reading map data'));
    return;
  }
  if (!file.mapData) {
    const busy = mapDlActive.has(file.id);
    const note = el('div', { class: 'empty-note', text: busy ? 'Downloading map...' : 'No matching BSP found for "' + file.name + '".' });
    const dlBtn = el('button', { class: 'btn primary', text: 'Download map from potato.tf', disabled: busy, onclick: async () => {
      if (mapDlActive.has(file.id)) return;
      mapDlActive.add(file.id);
      dlBtn.disabled = true;
      try {
        const tfPath = await getTFPath();
        const parts = file.name.toLowerCase().replace(/\.pop$/, '').split('_');
        let got = null;
        for (let n = parts.length; n >= 2 && !got; n--) {
          const cand = parts.slice(0, n).join('_');
          note.textContent = 'Trying ' + cand + '.bsp ...';
          const res = await window.popnative.potatoMap(cand, tfPath);
          if (res && !res.error) got = { cand, res };
        }
        if (!got) {
          note.textContent = 'Not found on the index (also checked shorter names).';
          return;
        }
        note.textContent = 'Downloaded ' + got.cand + '.bsp';
        await window.popnative.mapFlush();
        file.mapData = undefined;
        file.mapGeo = undefined;
        file.mapTexture = undefined;
        file.mapDataReq = null;
        file.tankPathsKey = null;
        mapDlActive.delete(file.id);
        emit('map');
      } catch (e) {
        note.textContent = 'Download failed: ' + e.message;
      } finally {
        mapDlActive.delete(file.id);
        dlBtn.disabled = false;
      }
    } });
    container.append(note, el('div', { class: 'btn-row mb-dlrow' }, dlBtn));
    return;
  }

  const mapData = file.mapData;
  if (!mapData.nav) { renderNavGate(container, file, mapData); return; }
  const geo = file.mapGeo;
  requestMapTexture(file);
  const tex = file.mapTexture && file.mapTexture.canvas ? file.mapTexture : null;
  const sim = simFor(file, wave);
  const model = deathModel();
  const dps = getDPS();
  const zMode = zonesMode();
  const paint = paintFor(mapData.map);
  const paintV = paintVersions.get(mapData.map) || 0;
  const ps = playStateFor(file, waveIndex);

  const killPts = killPointsFor(mapData.map);
  const objIdx = objectiveIdxFor(mapData.map);
  const pathGroups = bombPathGroups(mapData);
  const bombPath = bombPathFor(mapData.map, pathGroups);
  const toggles = navTogglesFor(file, wave);
  const aiKey = [waveIndex, model, dps, zMode, paintV, objIdx, bombPath, JSON.stringify(killPts),
    toggles.enabled.join(','), toggles.disabled.join(',')].join('|');
  const aiOpts = {
    teamDPS: dps, deathModel: model, zonesMode: zMode, killPoints: killPts, objectiveIdx: objIdx, bombPath,
    enabledNames: toggles.enabled, disabledNames: toggles.disabled
  };
  if (zMode === 'custom') aiOpts.zoneWeights = paint;
  const run = aiRunFor(file, wave, sim, mapData, aiKey, aiOpts);

  if (ps.raf) { cancelAnimationFrame(ps.raf); ps.raf = 0; }

  if (!run.ai && !run.staleAi) {
    const prog = loader('Simulating');
    run.progressEl = prog.label;
    container.append(prog);
    return;
  }
  const resimulating = !run.ai;
  const ai = run.ai || run.staleAi;
  const waveEnd = ai.end;
  ps.t = Math.min(ps.t, waveEnd);
  ps.waveEnd = waveEnd;
  const chains = buildTrackChains(mapData);
  const areasById = new Map();
  if (mapData.nav) for (const a of mapData.nav.areas) areasById.set(a.id, a);

  const navNote = mapData.nav
    ? 'nav: ' + mapData.nav.name + (mapData.nav.approx ? ' (approximate)' : '')
    : 'no nav mesh';

  const playBtn = el('button', { class: 'btn sm', text: ps.playing ? 'Pause' : 'Play' });
  const timeLbl = el('span', { class: 'map-time' });
  const mini = el('canvas', { class: 'map-mini', title: 'Wave activity — click or drag to scrub' });
  const nextLbl = el('span', { class: 'map-next' });
  const speedSel = el('select', { class: 'inp sm' },
    ...[0.5, 1, 2, 4].map(s => el('option', { value: s, text: s + 'x', selected: ps.speed === s })));
  const fitBtn = el('button', { class: 'btn sm', text: 'Fit' });

  const upcoming = [];
  for (const ws of wave.wavespawns) {
    if (ws.isLogic || !ws.bots.length) continue;
    const r = sim.results.get(ws);
    if (!r) continue;
    for (const ev of r.events) upcoming.push({ t: ev.t, name: ws.name || (ws.isTank ? 'tank' : 'wavespawn'), count: ev.count });
  }
  upcoming.sort((a, b) => a.t - b.t);
  const nextUp = t => {
    for (const u of upcoming) if (u.t > t + 0.001) return u;
    return null;
  };
  const modeSeg = el('span', { class: 'map-modes' },
    ...[['full', 'Full'], ['layout', 'Nav']].map(([m, label]) => el('button', {
      class: 'seg-btn' + (ps.mode === m ? ' on' : ''), text: label,
      onclick: () => {
        ps.mode = m;
        localStorage.setItem('popvis.mapmode', m);
        emit('map');
      }
    })));

  const objCands = objectiveCandidates(mapData, buildTrackChains(mapData));

  const displayBtn = el('button', {
    class: 'btn sm' + (ps.optionsOpen ? ' on' : ''),
    text: 'Simulation',
    title: 'Death model, damage zones, kill points, objective',
    onclick: () => {
      ps.optionsOpen = !ps.optionsOpen;
      localStorage.setItem('popvis.simpanel', ps.optionsOpen ? '1' : '0');
      emit('map');
    }
  });

  const bar = el('div', { class: 'map-toolbar' },
    el('span', { class: 'map-group' }, playBtn, speedSel),
    mini, timeLbl, nextLbl,
    el('span', { class: 'map-group' }, fitBtn, modeSeg),
    displayBtn,
    el('span', { class: 'map-note', text: mapData.map + ' — ' + navNote }));

  function buildOptionsPanel() {
    const panel = el('div', { class: 'map-opts map-tools' });
    panel.append(el('div', { class: 'pop-title' },
      el('span', { text: 'SIMULATION' }),
      el('button', {
        class: 'icon-btn sm', text: '×', title: 'Close',
        onclick: () => { ps.optionsOpen = false; localStorage.setItem('popvis.simpanel', '0'); emit('map'); }
      })));

    const tool = (id, iconName, label, hint) => {
      const b = el('button', {
        class: 'btn sm tool-btn' + (ps.tool === id ? ' on' : ''), title: hint,
        'aria-label': label,
        onclick: () => { ps.tool = ps.tool === id ? null : id; emit('map'); }
      });
      b.append(icon(iconName, 15), el('span', { text: label }));
      return b;
    };

    panel.append(simOptsPanel(file));

    if (model === 'damage') {
      const zoneSeg = el('span', { class: 'map-modes' },
        ...[['auto', 'Auto'], ['custom', 'Custom'], ['off', 'Off']].map(([m, label]) => el('button', {
          class: 'seg-btn' + (zMode === m ? ' on' : ''), text: label,
          onclick: () => { localStorage.setItem('popvis.zonesmode', m); emit('map'); }
        })));
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Damage zones' }), zoneSeg));
      if (zMode !== 'off') {
        const dpsInput = el('input', { class: 'inp sm map-dps', type: 'number', min: 0, step: 250, value: dps, title: 'Combined defender damage per second' });
        dpsInput.addEventListener('change', () => { localStorage.setItem('popvis.teamdps', String(Math.max(0, parseInt(dpsInput.value, 10) || 0))); emit('map'); });
        panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Team DPS' }), dpsInput));
      }
      if (zMode === 'custom') {
        const brushVal = el('span', { class: 'map-time', text: Math.round(ps.brush * 100) + '%' });
        const brush = el('input', { type: 'range', class: 'map-brush', min: 0, max: 150, step: 10, value: Math.round(ps.brush * 100) });
        brush.addEventListener('input', () => { ps.brush = parseInt(brush.value, 10) / 100; brushVal.textContent = brush.value + '%'; });
        panel.append(el('div', { class: 'opt-row' },
          tool('paint', 'brush', 'Paint', 'Left-drag paints damage weight, right-drag erases'),
          brush, brushVal,
          el('button', { class: 'btn sm', text: 'Clear', onclick: () => { paint.clear(); savePaint(mapData.map); emit('map'); } })));
      }
    }

    const routeBtn = el('button', {
      class: 'btn sm' + (ps.showRoute === false ? '' : ' on'), text: ps.showRoute === false ? 'Off' : 'On',
      title: 'Draw the route the bots take to the hatch',
      onclick: () => { ps.showRoute = ps.showRoute === false; emit('map'); }
    });
    if (pathGroups.length) {
      const fromMap = pathGroups.some(g => g.fromMap);
      const pathSel = el('select', {
        class: 'inp sm',
        title: fromMap
          ? 'The map picks one of these at random each round. Choosing one applies exactly what that relay enables.'
          : 'Which bomb path the map has enabled — switches func_nav_prefer / func_nav_avoid'
      },
        el('option', { value: '', text: fromMap ? 'random (map picks)' : 'default (map)', selected: !bombPath }),
        ...pathGroups.map(g => el('option', {
          value: g.key, text: g.key.replace(/_/g, ' '), selected: g.key === bombPath
        })));
      pathSel.addEventListener('change', () => {
        if (pathSel.value) localStorage.setItem('popvis.bombpath.' + mapData.map, pathSel.value);
        else localStorage.removeItem('popvis.bombpath.' + mapData.map);
        emit('map');
      });
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Nav path' }), pathSel, routeBtn));
    } else {
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Route' }), routeBtn));
    }

    panel.append(el('div', { class: 'tool-sep' }));

    const killRow = el('div', { class: 'opt-row' },
      tool('kill', 'crosshair', 'Kill points', 'Left-click places a despawn point, right-click removes one'));
    if (killPts.length) killRow.append(el('button', {
      class: 'btn sm', text: 'Clear', title: 'Remove every despawn point on this map',
      onclick: () => { saveKillPoints(mapData.map, []); emit('map'); }
    }));
    panel.append(killRow);

    if (ps.tool === 'kill') {
      const radVal = el('span', { class: 'map-time', text: Math.round(ps.killRadius) + ' HU' });
      const rad = el('input', {
        type: 'range', class: 'map-brush', min: 50, max: 800, step: 25, value: Math.round(ps.killRadius),
        title: 'Radius of new despawn points'
      });
      rad.addEventListener('input', () => {
        ps.killRadius = parseInt(rad.value, 10);
        radVal.textContent = rad.value + ' HU';
        scheduleDraw();
      });
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Radius' }), rad, radVal));
    }
    return panel;
  }

  const canvas = el('canvas', { class: 'map-canvas' + (ps.tool ? ' painting' : '') });
  canvas.addEventListener('contextmenu', e => { if (ps.tool) e.preventDefault(); });
  const canvasWrap = el('div', { class: 'map-canvaswrap' }, canvas);
  if (resimulating) canvasWrap.append(el('div', { class: 'map-resim', text: 'Re-simulating…' }));
  container.append(el('div', { class: 'mapview' }, bar, canvasWrap));
  if (ps.optionsOpen) canvasWrap.append(buildOptionsPanel());

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const worldKey = file.id + ':' + ps.mode + ':' + (geo ? 'g' : 'n') + ':' + (tex ? 't' : '');
  const world = buildWorldCanvas(worldKey, ps.mode, mapData, geo, tex);
  if (!world) {
    container.append(el('div', { class: 'empty-note', text: 'No drawable geometry or nav mesh for this map.' }));
    return;
  }
  let vs = viewStates.get(file.id);

  function fit() {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    const bw = world.bounds[2] - world.bounds[0], bh = world.bounds[3] - world.bounds[1];
    const scale = Math.min(w / (bw + 150), h / (bh + 150));
    vs = { cx: (world.bounds[0] + world.bounds[2]) / 2, cy: (world.bounds[1] + world.bounds[3]) / 2, scale };
    viewStates.set(file.id, vs);
  }

  const toScreen = (x, y) => [
    (x - vs.cx) * vs.scale + canvas.clientWidth / 2,
    (vs.cy - y) * vs.scale + canvas.clientHeight / 2
  ];
  const toWorld = (sx, sy) => [
    (sx - canvas.clientWidth / 2) / vs.scale + vs.cx,
    vs.cy - (sy - canvas.clientHeight / 2) / vs.scale
  ];

  const usedWhere = new Set();
  for (const ws of wave.wavespawns) for (const wn of ws.where || []) usedWhere.add(String(wn).toLowerCase());
  const scheduleDraw = () => { if (!ps.playing) drawFrame(); };

  function areaRect(a) {
    const [x1, y1] = toScreen(a.nw[0], a.se[1]);
    const [x2, y2] = toScreen(a.se[0], a.nw[1]);
    return [x1, y1, x2 - x1, y2 - y1];
  }

  function drawZones() {
    if (zMode === 'custom') {
      for (const [id, w] of paint) {
        if (w <= 0) continue;
        const a = areasById.get(id);
        if (!a) continue;
        const [x, y, rw, rh] = areaRect(a);
        if (x + rw < 0 || y + rh < 0 || x > canvas.clientWidth || y > canvas.clientHeight) continue;
        ctx.fillStyle = `rgba(216,72,60,${Math.min(0.5, w * 0.3).toFixed(3)})`;
        ctx.fillRect(x, y, rw, rh);
      }
      return;
    }
    if (!ai.hatchDist) return;
    for (const a of mapData.nav.areas) {
      const d = ai.hatchDist.get(a.id);
      if (d === undefined) continue;
      const u = Math.min(1, d / ai.hatchMaxDist);
      const w = dpsProfile(u);
      if (w < 0.3) continue;
      const [x, y, rw, rh] = areaRect(a);
      if (x + rw < 0 || y + rh < 0 || x > canvas.clientWidth || y > canvas.clientHeight) continue;
      const inten = Math.min(1, (w - 0.18) / 1.1);
      ctx.fillStyle = `rgba(216,72,60,${(inten * 0.34).toFixed(3)})`;
      ctx.fillRect(x, y, rw, rh);
    }
  }

  function drawOverlayStatic() {
    const seen = new Set();
    for (const t of mapData.tracks) {
      if (mapData.tracks.some(x => x.target === t.name)) continue;
      const chain = chains.chainFor(t.name);
      if (!chain || seen.has(chain)) continue;
      seen.add(chain);
      const pts = chain.poly.map(p => toScreen(p[0], p[1]));
      const trace = () => {
        ctx.beginPath();
        pts.forEach(([sx, sy], i) => { if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      trace();
      ctx.strokeStyle = 'rgba(0,0,0,.62)';
      ctx.lineWidth = 6;
      ctx.stroke();
      trace();
      ctx.strokeStyle = TANK_PATH;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([9, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 26) continue;
        const ang = Math.atan2(dy, dx);
        ctx.save();
        ctx.translate(x0 + dx / 2, y0 + dy / 2);
        ctx.rotate(ang);
        ctx.fillStyle = TANK_PATH;
        ctx.beginPath();
        ctx.moveTo(5, 0); ctx.lineTo(-4, 3.6); ctx.lineTo(-4, -3.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const [ex, ey] = pts[0];
      ctx.fillStyle = TANK_PATH;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('TANK PATH', ex + 8, ey - 6);
    }
    const byName = new Map();
    for (const s of mapData.spawns) {
      const k = s.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(s);
    }
    for (const [name, list] of byName) {
      const used = usedWhere.has(name);
      for (const s of list) {
        const active = used && !s.disabled;
        const [sx, sy] = toScreen(s.origin[0], s.origin[1]);
        ctx.fillStyle = active ? '#6a97c4' : 'rgba(140,150,165,0.5)';
        ctx.beginPath();
        ctx.arc(sx, sy, active ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const activeSpawn = used ? list.find(s => !s.disabled) : null;
      if (activeSpawn) {
        const [sx, sy] = toScreen(activeSpawn.origin[0], activeSpawn.origin[1]);
        ctx.fillStyle = '#a8ccf0';
        ctx.font = '10px sans-serif';
        ctx.fillText(name, sx + 8, sy + 3);
      }
    }
    const [ox, oy] = toScreen(ai.objective[0], ai.objective[1]);
    ctx.strokeStyle = '#d4504a';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 8, oy - 8, 16, 16);
    ctx.fillStyle = '#d4504a';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('HATCH', ox + 11, oy + 4);

    const eraseTarget = ps.tool === 'killerase' && ps.hover
      ? killPts.findIndex(k => (k[0] - ps.hover[0]) ** 2 + (k[1] - ps.hover[1]) ** 2 < (k[2] || KILL_RADIUS) ** 2)
      : -1;
    killPts.forEach((k, ki) => {
      const [kx, ky] = toScreen(k[0], k[1]);
      const kr = (k[2] || KILL_RADIUS) * vs.scale;
      const doomed = ki === eraseTarget;
      ctx.beginPath();
      ctx.arc(kx, ky, Math.max(4, kr), 0, Math.PI * 2);
      ctx.fillStyle = doomed ? '#d4504a55' : '#d4504a1e';
      ctx.fill();
      ctx.strokeStyle = doomed ? '#ff8f84' : '#d4736b';
      ctx.lineWidth = doomed ? 2.2 : 1.4;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = doomed ? '#ff8f84' : '#d4736b';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(doomed ? 'REMOVE' : 'DESPAWN', kx + Math.max(4, kr) + 4, ky + 3);
    });

    if (ps.tool === 'kill' && ps.hover) {
      const [hx, hy] = toScreen(ps.hover[0], ps.hover[1]);
      const hr = Math.max(4, ps.killRadius * vs.scale);
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = '#7fb8f01f';
      ctx.fill();
      ctx.strokeStyle = '#7fb8f0';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy); ctx.lineTo(hx + 6, hy);
      ctx.moveTo(hx, hy - 6); ctx.lineTo(hx, hy + 6);
      ctx.stroke();
      ctx.fillStyle = '#7fb8f0';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(Math.round(ps.killRadius) + ' HU', hx + hr + 4, hy + 3);
    }
  }

  function actorHeading(a, t) {
    const prev = actorPosAt(a, Math.max(a.spawnT, t - 0.6));
    const p = actorPosAt(a, t);
    if (!prev || !p) return null;
    const dx = p[0] - prev[0], dy = p[1] - prev[1];
    if (dx * dx + dy * dy < 4) return a.lastAngle ?? null;
    a.lastAngle = Math.atan2(-dy, dx);
    return a.lastAngle;
  }

  function drawActor(a, t, sx, sy) {
    if (a.kind === 'tank') {
      const img = iconImage('leaderboard_class_tank', scheduleDraw);
      const s = 34;
      const ang = actorHeading(a, t);
      ctx.save();
      ctx.translate(sx, sy);
      if (ang !== null) ctx.rotate(-ang);
      ctx.fillStyle = 'rgba(10,12,16,.55)';
      ctx.beginPath();
      ctx.arc(0, 0, s / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
      if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -s / 2, -s / 2, s, s);
      else { ctx.fillStyle = '#8b95a0'; ctx.fillRect(-9, -9, 18, 18); }
      ctx.restore();
      return;
    }
    const bot = a.bot;
    const plate = bot.isBoss ? 34 : bot.isGiant ? 28 : 20;
    const r = plate * 0.25;
    if (bot.alwaysCrit) {
      const halo = plate * 1.125;
      ctx.fillStyle = CRIT_BG[Math.floor(performance.now() / 1000 * CRIT_FPS) % CRIT_BG.length];
      ctx.beginPath();
      ctx.roundRect(sx - halo / 2, sy - halo / 2, halo, halo, r * 1.125);
      ctx.fill();
    }
    ctx.fillStyle = bot.isGiant || bot.isBoss ? GIANT_BG : NORMAL_BG;
    ctx.beginPath();
    ctx.roundRect(sx - plate / 2, sy - plate / 2, plate, plate, r);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.stroke();
    const s = plate * 0.875;
    const img = iconImage(iconNameFor(bot), scheduleDraw) || iconImage(classIconName(bot.cls), scheduleDraw);
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, sx - s / 2, sy - s / 2, s, s);
    } else {
      ctx.fillStyle = (CLASS_INFO[bot.cls] || CLASS_INFO.unknown).color;
      ctx.beginPath();
      ctx.arc(sx, sy, s / 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSquadLinks(positions) {
    const leaders = new Map();
    for (const q of positions) if (q.a.squadRole === 'leader' && q.a.squadId) leaders.set(q.a.squadId, q);
    const pairs = [];
    for (const q of positions) {
      if (q.a.squadRole !== 'member' || !q.a.squadId) continue;
      const lead = leaders.get(q.a.squadId);
      if (lead) pairs.push([lead, q]);
    }
    if (!pairs.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(150,190,235,.16)';
    ctx.lineWidth = 26;
    for (const [a, b] of pairs) {
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(190,220,255,.55)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    for (const [a, b] of pairs) {
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBomb(t) {
    const idx = Math.max(0, Math.min(ai.bomb.samples.length - 1, Math.round(t / STEP)));
    const b = ai.bomb.samples[idx];
    if (!b) return;
    const [sx, sy] = toScreen(b[0], b[1]);
    ctx.fillStyle = '#e3c74e';
    ctx.strokeStyle = '#161a20';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy - 9, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#161a20';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('B', sx - 3, sy - 6);
  }

  let lastPositions = [];

  function drawFrame() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    if (!vs) fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0e12';
    ctx.fillRect(0, 0, w, h);
    const [tlx, tly] = toScreen(world.bounds[0], world.bounds[3]);
    const dw = (world.bounds[2] - world.bounds[0]) * vs.scale;
    const dh = (world.bounds[3] - world.bounds[1]) * vs.scale;
    ctx.imageSmoothingEnabled = vs.scale < world.scale;
    ctx.drawImage(world.canvas, tlx, tly, dw, dh);
    if (model === 'damage' && zMode !== 'off' && mapData.nav) drawZones();
    drawOverlayStatic();
    const t = ps.t;
    if (ps.showRoute !== false && ai.route) drawRoute(ctx, ai.route, toScreen, t);
    let alive = 0;
    lastPositions = [];
    const shown = [];
    const pad = 40;
    for (const a of ai.actors) {
      if (t < a.spawnT || t > a.dieT) continue;
      const p = actorPosAt(a, t);
      if (!p) continue;
      alive++;
      const [sx, sy] = toScreen(p[0], p[1]);
      if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
      shown.push({ a, sx, sy });
    }
    lastPositions = shown;
    drawSquadLinks(shown);
    for (const q of shown) drawActor(q.a, t, q.sx, q.sy);
    drawBomb(t);
    timeLbl.textContent = fmtTime(t) + ' / ' + fmtTime(waveEnd) + ' — ' + alive + ' active';
    drawMini();
    updateWavePanel(t, alive, waveEnd);
  }

  function drawMini() {
    const mw = mini.clientWidth || 280, mh = mini.clientHeight || 32;
    if (mini.width !== mw * dpr || mini.height !== mh * dpr) {
      mini.width = mw * dpr;
      mini.height = mh * dpr;
    }
    const c2 = mini.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, mw, mh);
    const peakA = Math.max(1, sim.peak.active);
    const path = new Path2D();
    path.moveTo(0, mh);
    for (const p of sim.curve) {
      if (p.t > waveEnd) break;
      path.lineTo(p.t / waveEnd * mw, mh - 2 - (p.active / peakA) * (mh - 6));
    }
    path.lineTo(mw, mh);
    path.closePath();
    c2.fillStyle = '#6a97c42a';
    c2.fill(path);
    const cx = Math.min(1, ps.t / waveEnd) * mw;
    c2.save();
    c2.beginPath();
    c2.rect(0, 0, cx, mh);
    c2.clip();
    c2.fillStyle = '#6a97c455';
    c2.fill(path);
    c2.restore();
    c2.strokeStyle = '#93b3d1';
    c2.lineWidth = 1;
    c2.stroke(path);
    c2.fillStyle = '#d9dbde';
    c2.fillRect(cx - 0.5, 0, 1.5, mh);
    const u = nextUp(ps.t);
    nextLbl.textContent = u ? 'NEXT: ' + u.name : '';
  }

  let scrubbing = false;
  const scrubTo = ev => {
    const r = mini.getBoundingClientRect();
    ps.t = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) * waveEnd;
    drawFrame();
  };
  mini.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrubbing = true;
    scrubTo(e);
    const mv = ev => { if (scrubbing) scrubTo(ev); };
    const up2 = () => {
      scrubbing = false;
      removeEventListener('mousemove', mv);
      removeEventListener('mouseup', up2);
    };
    addEventListener('mousemove', mv);
    addEventListener('mouseup', up2);
  });

  function loop(prev) {
    ps.raf = 0;
    if (!canvas.isConnected || !ps.playing) return;
    const now = performance.now();
    const dt = prev ? (now - prev) / 1000 : 0;
    ps.t += dt * ps.speed;
    if (ps.t >= waveEnd) { ps.t = waveEnd; ps.playing = false; playBtn.textContent = 'Play'; }
    drawFrame();
    if (ps.playing) ps.raf = requestAnimationFrame(() => loop(now));
  }

  playBtn.addEventListener('click', () => {
    if (!ps.playing && ps.t >= waveEnd) ps.t = 0;
    ps.playing = !ps.playing;
    playBtn.textContent = ps.playing ? 'Pause' : 'Play';
    if (ps.playing && !ps.raf) ps.raf = requestAnimationFrame(() => loop(0));
  });
  speedSel.addEventListener('change', () => { ps.speed = parseFloat(speedSel.value); });
  fitBtn.addEventListener('click', () => { fit(); drawFrame(); });

  const painting = () => ps.tool === 'paint' && zMode === 'custom' && model === 'damage';
  let paintDirty = false;

  function paintAt(sx, sy, erase) {
    const [wx, wy] = toWorld(sx, sy);
    const r = 46 / vs.scale;
    for (const a of areasById.values()) {
      const cx = (a.nw[0] + a.se[0]) / 2, cy = (a.nw[1] + a.se[1]) / 2;
      if ((cx - wx) ** 2 + (cy - wy) ** 2 > r * r) continue;
      if (erase || ps.brush <= 0) paint.delete(a.id);
      else paint.set(a.id, ps.brush);
      paintDirty = true;
    }
    drawFrame();
  }

  let dragging = null;
  let paintingDown = false;
  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    if (ps.tool === 'kill' && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const list = killPointsFor(mapData.map);
      const hit = list.findIndex(k => (k[0] - wx) ** 2 + (k[1] - wy) ** 2 < (k[2] || KILL_RADIUS) ** 2);
      if (e.button === 2 || e.shiftKey) {
        if (hit < 0) return;
        list.splice(hit, 1);
      } else {
        list.push([wx, wy, ps.killRadius]);
      }
      saveKillPoints(mapData.map, list);
      emit('map');
      return;
    }
    if (painting() && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      paintingDown = e.button === 2 ? 'erase' : 'paint';
      paintAt(e.clientX - rect.left, e.clientY - rect.top, e.button === 2);
      return;
    }
    dragging = { x: e.clientX, y: e.clientY, cx: vs.cx, cy: vs.cy };
  });
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);
  function onMove(e) {
    if (!canvas.isConnected) { removeEventListener('mousemove', onMove); removeEventListener('mouseup', onUp); return; }
    const rect = canvas.getBoundingClientRect();
    if (paintingDown) {
      paintAt(e.clientX - rect.left, e.clientY - rect.top, paintingDown === 'erase');
      return;
    }
    if (dragging) {
      vs.cx = dragging.cx - (e.clientX - dragging.x) / vs.scale;
      vs.cy = dragging.cy + (e.clientY - dragging.y) / vs.scale;
      drawFrame();
      return;
    }
    if (ps.tool === 'kill' || ps.tool === 'killerase') {
      if (e.target === canvas) {
        ps.hover = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      } else if (ps.hover) {
        ps.hover = null;
      } else return;
      hideTip();
      scheduleDraw();
      return;
    }
    if (ps.hover) { ps.hover = null; scheduleDraw(); }
    if (e.target !== canvas) { hideTip(); return; }
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bestD = 240;
    for (const lp of lastPositions) {
      const d = (lp.sx - mx) ** 2 + (lp.sy - my) ** 2;
      if (d < bestD) { bestD = d; best = lp.a; }
    }
    if (best) {
      const died = Number.isFinite(best.dieT) ? ' · dies ' + fmtTime(best.dieT) : '';
      const label = best.kind === 'tank'
        ? `Tank — ${best.tank.health} HP · ${best.tank.speed} HU/s${died}\nfrom "${best.ws.name || 'unnamed'}"`
        : `${botDisplayName(best.bot)} — ${best.bot.health} HP · ${Math.round(botMaxSpeed(best.bot, false))} HU/s\n${best.state}${best.squadId ? ' · squad ' + best.squadRole : ''}\nfrom "${best.ws.name || 'unnamed'}" · spawned ${fmtTime(best.spawnT)}${died}`;
      showTip(label, e.clientX, e.clientY);
    } else hideTip();
  }
  function onUp() {
    dragging = null;
    if (paintingDown) {
      paintingDown = false;
      if (paintDirty) {
        paintDirty = false;
        savePaint(mapData.map);
        emit('map');
      }
    }
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    vs.scale *= f;
    vs.cx = wx - (wx - vs.cx) / f;
    vs.cy = wy - (wy - vs.cy) / f;
    drawFrame();
  }, { passive: false });

  mapRedraw = drawFrame;
  drawFrame();
  if (ps.playing) ps.raf = requestAnimationFrame(() => loop(0));
}
