import { el, clear, showTip, hideTip, fmtTime, fmtNum, loader, botVisual, tankVisual } from './ui.js';
import { state, simFor, emit, onChange, deathModel, navTogglesFor, bombPathRerollsFor, mapQueryName, probesFor, addProbe, clearProbes } from './state.js';
import { CLASS_INFO, botDisplayName } from './popmodel.js';
import { getTFPath, iconURL, iconNameFor, classIconName, tankIconName } from './icons.js';
import { native } from './native.js';
import { botMaxSpeed, buildTrackChains, dpsProfile, objectiveCandidates, bombPathGroups, isSentryBuster, STEP, RNG_SEED_BASE } from './navpaths.js';
import { createBotSim, actorPosAt, actorZAt, actorDistAt, actorYawAt } from './botplayback.js';
import { setStatus, clearStatus, clearStatusPrefix } from './statusbar.js';
import { startTask } from './tasks.js';
import { createMap3D, BLU_SKIN } from './map3d.js';
import { KILL_RADIUS, killRadiusOf, killPointAt, killPointsFor, saveKillPoints } from './killzones.js';
import { botModelBase, botWeaponModels, botCosmeticModels, resolveBotItems, resolveWeaponRoles, botWeaponClass, botActivity , animDurationSync, resolveAnimDuration, SENTRY_BUSTER_MODEL } from './botmodels.js';

import { initNavWasm } from './navwasm.js';
import { primaryColor } from './timeline.js';
import { simOptsPanel } from './inspector.js';
import { icon } from './svgicon.js';

const playStates = new Map();
const viewStates = new Map();
let active3D = null;
const cam3dCache = new Map();
const itemsRequested = new Set();
let itemsPending = false;
const rolesRequested = new Set();
let rolesPending = false;
const aiRuns = new WeakMap();
const lastAi = new Map();
const worldCache = new Map();
const imgCache = new Map();
const paintCache = new Map();
const paintVersions = new Map();
const mapDlActive = new Set();
const approxDismissed = new Set();
const WORLD_MAX = 4096;
const GIANT_BG = '#c01c00';
const NORMAL_BG = '#ebe2ca';
const CRIT_BG = ['#0099c5', '#00ceeb'];
const CRIT_FPS = 5;
const TANK_PATH = '#cfa35a';
const CLUSTER_GAP = 0.92;
const SPREAD_LIMIT = 0.9;
const SPREAD_PASSES = 3;
const CLUSTER_HYST = 1.3;
const DECLUTTER_EASE = 0.25;
const LIFT_SHADOW = 0.5;
const LIFT_SCALE = 0.14;
const PLATE_REF_SCALE = 20 / 48;
const PLATE_ZOOM_MIN = 0.6;
const PLATE_ZOOM_MAX = 1.7;

onChange(what => { if (what === 'icons') imgCache.clear(); });

let waPanel = null;
let mapRedraw = null;

function routeProgress(pts, bombPos) {
  if (!pts || !bombPos) return 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i][0] - bombPos[0]) ** 2 + (pts[i][1] - bombPos[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function drawRoute(ctx, pts, toScreen, phase, covered) {
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
  if (covered > 0) {
    ctx.strokeStyle = '#a7d0ff';
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(scr[0][0], scr[0][1]);
    for (let i = 1; i <= Math.min(covered, scr.length - 1); i++) ctx.lineTo(scr[i][0], scr[i][1]);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
  }
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
      if (b.tank) push(tankIconName(b.tank));
      else if (b.bot) push(iconNameFor(b.bot) || classIconName(b.bot.cls));
    }
    if (!names.length && ws.isTank) push(tankIconName((ws.bots.find(b => b.tank) || {}).tank));
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
        const gx = Math.round(cx) + .5;
        c.save();
        c.strokeStyle = color;
        c.globalAlpha = .55;
        c.lineWidth = 2;
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx, sy); c.stroke();
        c.setLineDash([]);
        c.beginPath(); c.moveTo(gx - 5, gy + 1); c.lineTo(gx + 5, gy + 1); c.stroke();
        c.restore();
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
    const y2 = yOf(Math.max(...rs.map(v => (v.barEnd != null ? v.barEnd : v.lastSpawn))));
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
      const ts = rs.flatMap(v => (v.tickTimes && v.tickTimes.length ? v.tickTimes : v.events.map(e => e.t)));
      const nth = Math.ceil(ts.length / 120);
      ts.forEach((tt, k) => {
        if (k % nth) return;
        c.fillRect(x + 1, Math.round(yOf(tt)), L.barW - 2, 1);
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

  let dragView = null;
  const timeAt = ev => {
    const p = waPanel;
    if (!p || !p.view) return 0;
    const v = dragView || p.view;
    const L = wtLayout(canvas, v.cols.length);
    const r = graph.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientY - r.top - WT_PAD - L.headH) / Math.max(1, L.gh)));
    return v.a + frac * Math.max(1, v.b - v.a);
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
    if (waPanel && waPanel.view) dragView = { a: waPanel.view.a, b: waPanel.view.b, cols: waPanel.view.cols };
    scrub(e);
    const move = e2 => scrub(e2);
    const up = () => { dragView = null; removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
}


function engineerProbeSpec(mapData, wave) {
  if (!(mapData.hints || []).some(h => h.kind === 'bot_hint_engineer_nest')) return null;
  const names = [];
  const push = n => {
    const s = String(n || '').trim();
    if (s && !names.some(v => v.toLowerCase() === s.toLowerCase())) names.push(s);
  };
  for (const ws of wave.wavespawns) for (const wn of ws.where || []) push(wn);
  for (const s of mapData.spawns) if (!s.disabled) push(s.name);
  if (!names.length) return null;
  return { where: names[0], teleportWhere: names };
}

const BOMB_BUFFS = ['Robots near the carrier get a defense buff', 'Robots near the carrier get crit boost', 'Robots near the carrier get rapid healing'];

function buildBombHUD(ai) {
  const b = ai && ai.bomb;
  if (!b || !b.log) return null;
  const maxLevel = Math.min(3, b.maxLevel || 3);
  const hud = el('div', { class: 'bomb-hud' });
  const bomb = el('img', { class: 'bomb-icon', alt: 'Bomb' });
  const chevrons = el('div', { class: 'bomb-upgrades' });
  const chevronEls = [];
  for (let i = 1; i <= maxLevel; i++) {
    const c = el('img', { class: 'bomb-upgrade', alt: 'Bomb upgrade ' + i, title: BOMB_BUFFS[i - 1] });
    chevronEls.push(c);
    chevrons.append(c);
  }
  const meterFill = el('div', { class: 'bomb-meter-fill' });
  const meter = el('div', { class: 'bomb-meter' },
    el('img', { class: 'bomb-meter-base', alt: '' }),
    el('div', { class: 'bomb-meter-clip' }, meterFill),
    el('img', { class: 'bomb-meter-frame', alt: '' }));
  hud.append(bomb, chevrons, meter);
  const setSrc = (img, name) => {
    const url = iconURL(name);
    img.hidden = !url;
    if (url) img.src = url;
  };
  const update = t => {
    let cur = null;
    for (const e of b.log) { if (e.t <= t) cur = e; else break; }
    const delivered = b.deliveredAt != null && t >= b.deliveredAt;
    const held = !!cur && cur.kind !== 'drop' && !delivered;
    const level = held ? cur.level : 0;
    const taunting = held && cur.tauntUntil > t;
    hud.classList.toggle('held', held);
    hud.classList.toggle('taunting', taunting);
    hud.classList.toggle('delivered', delivered);
    setSrc(bomb, held ? 'bomb_carried' : 'bomb_dropped');
    hud.title = delivered ? 'Bomb deployed at ' + fmtTime(b.deliveredAt)
      : held ? ((CLASS_INFO[cur.cls] || {}).label || 'Robot') + ' carrying — upgrade level ' + level
        + (taunting ? '\ntaunting' : '')
      : 'Bomb not picked up';
    chevronEls.forEach((c, i) => {
      setSrc(c, 'hud_mvm_bomb_upgrade_' + (i + 1) + (i < level ? '' : '_disabled'));
      c.classList.toggle('on', i < level);
    });
    const from = held && cur.kind === 'charge' ? cur.from : null;
    const at = held && cur.kind === 'charge' ? cur.at : null;
    const charging = Number.isFinite(from) && Number.isFinite(at) && at > from && level < maxLevel;
    meter.hidden = !charging;
    if (charging) {
      setSrc(meter.firstChild, 'bomb_carrier_upgrade_base');
      setSrc(meter.lastChild, 'bomb_carrier_upgrade_frame');
      const url = iconURL('bomb_carrier_upgrade_meter');
      if (url) meterFill.style.backgroundImage = 'url(' + url + ')';
      const p = Math.max(0, Math.min(1, (t - from) / (at - from)));
      meter.querySelector('.bomb-meter-clip').style.width = (p * 100).toFixed(1) + '%';
      meter.title = 'Next bomb upgrade in ' + fmtNum(Math.max(0, at - t)) + 's';
    }
  };
  update(0);
  hud.update = update;
  return hud;
}

function tankPathLength(a) {
  const cum = a.chain && a.chain.cum;
  return cum && cum.length ? cum[cum.length - 1] : 0;
}

function tankProgressAt(a, t) {
  if (a.tank && a.tank.immobile) return 0;
  const len = tankPathLength(a);
  if (!(len > 0)) return 0;
  return Math.max(0, Math.min(1, (a.speed || 0) * (t - a.spawnT) / len));
}

const TANK_BAR_WIDE = 153;

function buildTankHUD(ai) {
  const tanks = (ai.actors || []).filter(a => a.kind === 'tank');
  if (!tanks.length) return null;
  const hud = el('div', { class: 'tank-hud' });
  let skinned = false;
  const rows = tanks.map(a => {
    const icon = el('img', { class: 'tank-icon', alt: 'Tank' });
    const fill = el('div', { class: 'tank-bar-fill' });
    const row = el('div', { class: 'tank-panel' }, icon, el('div', { class: 'tank-bar' }, fill));
    hud.append(row);
    return { a, row, icon, fill };
  });
  const update = t => {
    if (!skinned) {
      const panel = iconURL('tournament_panel_brown');
      const track = iconURL('tournament_panel_tan');
      const bar = iconURL('tournament_panel_blu');
      if (panel && track && bar) {
        hud.style.setProperty('--tank-panel', 'url(' + panel + ')');
        hud.style.setProperty('--tank-track', 'url(' + track + ')');
        hud.style.setProperty('--tank-fill', 'url(' + bar + ')');
        skinned = true;
      }
    }
    let anyLive = false;
    for (const r of rows) {
      const live = t >= r.a.spawnT && t <= r.a.dieT;
      r.row.hidden = !live;
      if (!live) continue;
      anyLive = true;
      const url = iconURL(tankIconName(r.a.tank));
      r.icon.hidden = !url;
      if (url) r.icon.src = url;
      r.fill.style.width = TANK_BAR_WIDE + 'px';
      r.row.title = (r.a.tank.name || 'Tank') + ' — ' + r.a.tank.health + ' HP · '
        + Math.round(tankProgressAt(r.a, t) * 100) + '% of the way to the hatch';
    }
    hud.hidden = !anyLive;
  };
  update(0);
  hud.update = update;
  return hud;
}

const TELEPORTER_MODEL = 'models/buildables/teleporter';

let buildTimes = null;
let buildTimesReq = null;

function teleporterBuildTime() {
  if (!buildTimes) return null;
  const v = buildTimes.obj_teleporter;
  return Number.isFinite(v) ? v : 0;
}

function resolveBuildTimes() {
  if (buildTimesReq) return buildTimesReq;
  buildTimesReq = (async () => {
    if (!native.isElectron || !window.popnative.buildTimes) { buildTimes = {}; return false; }
    try { buildTimes = (await window.popnative.buildTimes(await getTFPath())) || {}; } catch { buildTimes = {}; }
    return Number.isFinite(buildTimes.obj_teleporter);
  })();
  return buildTimesReq;
}
const DEPLOY_ANIM_MODEL = 'models/bots/scout/bot_scout_animations';

function cleanTankModel(m) {
  return String(m || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.mdl$/i, '').toLowerCase().trim() || null;
}

function gateLetter(g, i) {
  const m = String(g.label || '').match(/\b([A-Z])\s*$/);
  return m ? m[1] : String.fromCharCode(65 + i);
}

function allGatesCapturedAt(gates) {
  if (!gates || !gates.length) return null;
  let last = 0;
  for (const g of gates) {
    if (g.capturedAt == null) return null;
    last = Math.max(last, g.capturedAt);
  }
  return last;
}

function gateUnlockAt(cell, cells) {
  if (!cell.g.startsLocked) return 0;
  if (cell.state && cell.state.openAt != null) return cell.state.openAt;
  const prev = cell.g.previous ? cells.find(x => x.g.point === cell.g.previous) : null;
  if (!prev || !prev.state || prev.state.capturedAt == null) return null;
  const on = prev.g.effects && (prev.g.effects.gatesOn || []).find(x => x.trigger === cell.g.trigger);
  return prev.state.capturedAt + (on ? on.delay : 0);
}

const gateIconCache = new Map();

function applyGateIcons(c, held, taken, overlay) {
  c.heldURL = held;
  c.takenURL = taken;
  if (!held && !taken) return;
  c.fallback.hidden = true;
  c.base.hidden = false;
  c.base.src = held || taken;
  if (overlay) { c.over.src = overlay; c.over.hidden = false; }
}

function loadGateIcons(bspPath, cells) {
  const pending = [];
  for (const c of cells) {
    const ic = c.g.icons || {};
    const names = [ic.held, ic.taken, ic.overlay];
    if (names.every(n => !n || gateIconCache.has(n))) {
      applyGateIcons(c, gateIconCache.get(ic.held) || null, gateIconCache.get(ic.taken) || null, gateIconCache.get(ic.overlay) || null);
      continue;
    }
    pending.push(c);
  }
  if (!pending.length) return;
  (async () => {
    const tfPath = await getTFPath();
    const inflight = new Map();
    const resolve = async mat => {
      if (!mat) return null;
      if (gateIconCache.has(mat)) return gateIconCache.get(mat);
      if (!inflight.has(mat)) inflight.set(mat, window.popnative.matIcon(mat, tfPath, null));
      const url = await inflight.get(mat);
      gateIconCache.set(mat, url || null);
      return url || null;
    };
    for (const c of pending) {
      const ic = c.g.icons || {};
      const [held, taken, overlay] = await Promise.all([resolve(ic.held), resolve(ic.taken), resolve(ic.overlay)]);
      if (!c.cell.isConnected) continue;
      applyGateIcons(c, held, taken, overlay);
    }
  })().catch(() => {});
}

function buildGateHUD(mapData, wave, ai, bspPath) {
  const gates = (mapData && mapData.gates) || [];
  if (!gates.length) return null;
  const gatebots = wave ? (wave.gatebotCount || 0) : 0;
  const live = (ai && ai.gates) || [];
  const stateOf = g => live.find(x => x.def && x.def.point === g.point) || null;
  const hud = el('div', { class: 'gate-hud' });
  const strip = el('div', { class: 'gate-strip' });
  const cells = [];
  gates.forEach((g, i) => {
    const cell = el('div', {
      class: 'gate-cell' + (g.startsLocked ? ' locked' : '') + (gatebots ? '' : ' idle'),
      title: `${g.label}\ncaptured in ${fmtNum(g.capTime)}s by ${g.capCount} gatebot${g.capCount > 1 ? 's' : ''}`
        + (g.startsLocked ? '\nlocked until the previous gate is captured' : '\nopen from the start of the wave')
        + (g.relay ? `\nfires ${g.relay} on capture` : '')
    });
    const fx = g.effects;
    if (fx) {
      const on = fx.spawnsOn.map(x => x.name).join(', ');
      const off = fx.spawnsOff.map(x => x.name).join(', ');
      cell.title += (fx.pauseFor ? `\n\non capture: bot spawning pauses ${fmtNum(fx.pauseFor)}s` : '\n\non capture:')
        + (on ? `\nspawns move to ${on}` : '')
        + (off ? `\nspawns stop at ${off}` : '');
    }
    const icon = el('div', { class: 'gate-icon' });
    const base = el('img', { class: 'gate-icon-base', alt: '' });
    const over = el('img', { class: 'gate-icon-overlay', alt: '' });
    base.hidden = true;
    over.hidden = true;
    const capFill = el('div', { class: 'gate-cap-fill' });
    const cap = el('div', { class: 'gate-cap' }, capFill);
    const count = el('div', { class: 'gate-count' });
    count.hidden = true;
    const fallback = el('div', { class: 'gate-icon-letter', text: gateLetter(g, i) });
    icon.append(fallback, base, over, cap, count);
    cell.append(icon);
    const meta = el('div', { class: 'gate-meta' },
      el('div', { class: 'gate-name', text: g.label }),
      el('div', { class: 'gate-time', text: g.startsLocked ? 'locked · ' + fmtNum(g.capTime) + 's' : fmtNum(g.capTime) + 's to cap' }));
    const timeEl = meta.lastChild;
    cell.append(meta);
    strip.append(cell);
    cells.push({ g, cell, timeEl, base, over, fallback, cap, capFill, count, state: stateOf(g) });
  });
  loadGateIcons(bspPath || null, cells);
  hud.append(strip);
  const note = el('div', { class: 'gate-note' + (gatebots ? '' : ' muted'), text: gatebots ? gatebots + ' gatebots this wave' : 'no gatebots this wave' });
  hud.append(note);

  const liveAt = (st, t) => {
    if (!st || !st.log || !st.log.length) return null;
    let cur = null;
    for (const e of st.log) { if (e.t <= t) cur = e; else break; }
    return cur;
  };

  const update = t => {
    let pausedUntil = 0;
    for (const c of cells) {
      const st = c.state;
      const live = liveAt(st, t);
      const capped0 = st && st.capturedAt !== null && t >= st.capturedAt;
      const frac = capped0 ? 1 : (live && c.g.capTime > 0 ? Math.max(0, Math.min(1, live.progress / c.g.capTime)) : 0);
      c.capFill.style.height = (frac * 100).toFixed(1) + '%';
      c.cap.hidden = !(frac > 0) || capped0;
      const holders = capped0 ? 0 : (live ? live.holders : 0);
      c.count.hidden = holders <= 0;
      if (holders > 0) c.count.textContent = holders;
      c.cell.classList.toggle('capping', holders > 0 && !capped0);
      const capped = st && st.capturedAt !== null && t >= st.capturedAt;
      c.cell.classList.toggle('captured', !!capped);
      const want = capped ? (c.takenURL || c.heldURL) : (c.heldURL || c.takenURL);
      if (want && c.base.src !== want) c.base.src = want;
      if (capped) {
        c.cell.classList.remove('locked');
        c.timeEl.textContent = 'captured ' + fmtTime(st.capturedAt);
        const fx = c.g.effects;
        if (fx && fx.pauseFor) pausedUntil = Math.max(pausedUntil, st.capturedAt + fx.pauseFor);
        continue;
      }
      const unlockedAt = gateUnlockAt(c, cells);
      const open = unlockedAt != null && t >= unlockedAt;
      c.cell.classList.toggle('locked', !open);
      c.timeEl.textContent = open ? fmtNum(c.g.capTime) + 's to cap'
        : unlockedAt != null ? 'unlocks ' + fmtTime(unlockedAt)
          : 'locked · ' + fmtNum(c.g.capTime) + 's';
    }
    const paused = pausedUntil > t;
    note.classList.toggle('paused', paused);
    note.textContent = paused
      ? 'spawning paused — ' + fmtNum(pausedUntil - t) + 's'
      : (gatebots ? gatebots + ' gatebots this wave' : 'no gatebots this wave');
  };
  update(0);
  hud.update = update;
  return hud;
}

function bombPathKey(mapName, waveIndex, perWave) {
  return perWave ? 'popvis.bombpath.' + mapName + '.' + waveIndex : 'popvis.bombpath.' + mapName;
}

function autoBombPath(mapName, waveIndex, groups) {
  if (!groups.length) return null;
  let h = 2166136261 ^ waveIndex;
  for (let i = 0; i < mapName.length; i++) {
    h ^= mapName.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return groups[(h >>> 0) % groups.length].key;
}

function bombPathFor(mapName, groups, waveIndex, perWave) {
  const v = localStorage.getItem(bombPathKey(mapName, waveIndex, perWave));
  if (v && groups.some(g => g.key === v)) return v;
  if (v === '__none') return null;
  if (!perWave) {
    const legacy = localStorage.getItem('popvis.bombpath.' + mapName);
    if (legacy && groups.some(g => g.key === legacy)) return legacy;
    return null;
  }
  return autoBombPath(mapName, waveIndex, groups);
}

function objectiveIdxFor(mapName) {
  return parseInt(localStorage.getItem('popvis.objidx.' + mapName) || '0', 10) || 0;
}

export function presetMapSelect(file, waveIndex) {
  playStateFor(file, waveIndex).selectFirst = true;
}

export function presetMapMode(file, waveIndex, mode) {
  playStateFor(file, waveIndex).mode = mode;
}

export function mapTransport(file, waveIndex, action) {
  const ps = playStateFor(file, waveIndex);
  const end = ps.waveEnd || Infinity;
  if (action === 'toggle') { ps.playing = !ps.playing; emit('map'); return; }
  if (action === 'restart') { ps.t = 0; ps.playing = false; emit('map'); return; }
  if (action === 'follow') { if (ps.selKey) { ps.follow = !ps.follow; emit('map'); } return; }
  if (action === 'deselect') {
    if (ps.selKey || ps.follow) { ps.selKey = null; ps.follow = false; emit('map'); return true; }
    return false;
  }
  if (action === 'step-back' || action === 'step-fwd') {
    ps.t = Math.max(0, Math.min(end, ps.t + (action === 'step-fwd' ? STEP : -STEP)));
    ps.playing = false;
    emit('map');
    return;
  }
  const ai = lastAi.get(file.id + ':' + waveIndex);
  if (!ai) return;
  const log = eventLogFor(ai);
  if (action === 'prev-event') {
    for (let i = log.length - 1; i >= 0; i--) if (log[i].t < ps.t - 0.001) { ps.t = Math.min(end, log[i].t); break; }
  } else if (action === 'next-event') {
    for (const ev of log) if (ev.t > ps.t + 0.001) { ps.t = Math.min(end, ev.t); break; }
  }
  ps.playing = false;
  emit('map');
}

export function presetMapTime(file, waveIndex, t) {
  playStateFor(file, waveIndex).t = Math.max(0, t);
}

function popDirOf(file) {
  return file && file.path ? native.dirname(file.path) : null;
}

function reloadMapData(file) {
  file.mapData = undefined;
  file.mapGeo = undefined;
  file.mapTexture = undefined;
  file.mapFaces3d = undefined;
  file.mapFaces3dReq = null;
  file.mapProps = undefined;
  file.mapPropsReq = null;
  file.mapBspPath = undefined;
  file.mapLighting = undefined;
  file.mapLightingReq = null;
  file.mapDataReq = null;
  file.tankPathsKey = null;
  emit('map');
}

function navReasonText(reason) {
  if (!reason || reason === 'missing') return null;
  if (reason === 'unreadable') return 'A matching nav file was found but could not be read.';
  if (reason.startsWith('empty:')) return reason.slice(6) + '.nav contains no areas (empty or truncated file) — pick another source below.';
  return 'A matching nav file was found but could not be parsed — ' + String(reason).replace(/^error: /, '') + '.';
}

function navScore(name, query) {
  if (!query) return 1;
  if (name === query) return 1000;
  const stem = s => s.replace(/^mvm_/, '');
  const n = stem(name), q = stem(query);
  if (n === q) return 900;
  if (n.startsWith(q)) return 800 - (n.length - q.length);
  const at = n.indexOf(q);
  if (at >= 0) return 600 - at - (n.length - q.length) * 0.1;
  let i = 0, runs = 0, last = -2;
  for (let k = 0; k < n.length && i < q.length; k++) {
    if (n[k] !== q[i]) continue;
    if (k !== last + 1) runs++;
    last = k;
    i++;
  }
  if (i < q.length) return 0;
  const pre = sharedPrefix(n, q);
  return 300 - runs * 8 - (n.length - q.length) * 0.1 + pre * 4;
}

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function pickRow(opts) {
  return el('button', {
    class: 'pick-row' + (opts.best ? ' best' : ''),
    'aria-label': opts.action + ' ' + opts.name + opts.ext,
    onclick: opts.onclick
  },
    el('span', { class: 'pick-name' },
      el('span', { text: opts.name }),
      el('span', { class: 'pick-ext', text: opts.ext })),
    opts.tag ? el('span', { class: 'pick-tag', text: opts.tag }) : null,
    el('span', { class: 'pick-go', text: opts.action }));
}

function navBrowser(file, mapName, status) {
  const wrap = el('div', { class: 'nav-browse' });
  const query = el('input', { class: 'inp', value: mapName, placeholder: 'Search the potato.tf nav index', spellcheck: 'false' });
  const meta = el('div', { class: 'nav-gate-sub muted' });
  const list = el('div', { class: 'pick-list scroll' });
  let names = null;
  let busy = false;

  const download = async name => {
    if (busy) return;
    busy = true;
    status.textContent = 'Downloading ' + name + '.nav…';
    try {
      const tfPath = await getTFPath();
      const dl = await window.popnative.potatoNav(mapName, name, tfPath);
      if (!dl || dl.error) { status.textContent = dl && dl.error ? dl.error : 'Download failed.'; return; }
      status.textContent = 'Saved as ' + mapName + '.nav' + (dl.renamed ? ' (from ' + dl.source + ')' : '');
      await window.popnative.mapFlush();
      reloadMapData(file);
    } finally {
      busy = false;
    }
  };

  const render = () => {
    clear(list);
    if (!names) return;
    const q = query.value.trim().toLowerCase();
    const hits = names
      .map(n => ({ name: n, score: navScore(n, q) }))
      .filter(h => h.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 40);
    meta.textContent = q
      ? hits.length + ' of ' + names.length + ' navs match "' + q + '"'
      : names.length + ' navs on the potato.tf index';
    if (!hits.length) { list.append(el('div', { class: 'pick-more', text: 'Nothing matches. Try a shorter query.' })); return; }
    for (const h of hits) {
      const exact = h.name === mapName;
      list.append(pickRow({
        name: h.name, ext: '.nav',
        tag: exact ? 'Exact match' : null, best: exact,
        action: 'Download', onclick: () => download(h.name)
      }));
    }
  };

  const load = async force => {
    if (!native.isElectron) { meta.textContent = 'Desktop app only.'; return; }
    meta.textContent = force ? 'Refreshing the index…' : 'Loading the index…';
    try {
      const res = await window.popnative.potatoNavIndex(!!force);
      if (!res || res.error) { meta.textContent = res && res.error ? res.error : 'Could not reach the index.'; return; }
      names = res.names || [];
      render();
      if (res.stale) meta.textContent += ' (offline — showing the last index)';
    } catch (err) {
      meta.textContent = 'Index lookup failed: ' + err.message;
    }
  };

  let timer = null;
  query.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 90);
  });
  query.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const first = list.querySelector('button');
    if (first) first.click();
  });

  wrap.append(
    el('div', { class: 'nav-browse-row' }, query,
      el('button', { class: 'btn sm', text: 'Refresh', title: 'Re-fetch the potato.tf index', onclick: () => load(true) })),
    meta, list);
  load(false);
  return wrap;
}

function navSearchNote(search) {
  const out = [];
  if (search.searched && search.searched.length) {
    out.push(el('div', { class: 'nav-gate-sub' },
      el('span', { text: 'Searched: ' }),
      el('span', { class: 'nav-gate-mono', text: search.searched.join('  ') }),
      el('span', { text: '  plus tf2_misc_dir.vpk and the map pakfile. Add your own folder under Settings & blocks.' })));
  }
  return out;
}

function nearNavButtons(file, mapData, status) {
  const search = mapData.navSearch || {};
  const bad = search.reason && search.reason.startsWith('empty:') ? search.reason.slice(6) : null;
  const names = (search.near || []).filter(n => n !== bad);
  if (!names.length) return null;
  const row = el('div', { class: 'pick-list' });
  for (const n of names) {
    row.append(pickRow({
      name: n, ext: '.nav', tag: 'On disk', action: 'Use',
      onclick: async () => {
        status.textContent = 'Using ' + n + '.nav…';
        const dl = await window.popnative.navUse(mapQueryName(file), n, await getTFPath(), popDirOf(file));
        if (!dl || dl.error) { status.textContent = dl && dl.error ? dl.error : 'Failed.'; return; }
        status.textContent = 'Saved as ' + mapData.map + '.nav' + (dl.renamed ? ' (from ' + dl.source + ')' : '');
        await window.popnative.mapFlush();
        reloadMapData(file);
      }
    }));
  }
  return row;
}

function renderNavGate(container, file, mapData) {
  clear(container);
  const search = mapData.navSearch || {};
  const panel = el('div', { class: 'nav-gate' });
  panel.append(el('div', { class: 'panel-title', text: 'NO NAV MESH' }));
  panel.append(el('div', { class: 'nav-gate-msg', text: 'The simulation needs ' + mapData.map + '.nav. Without it bots have no walkable graph, so it will not run.' }));
  const why = navReasonText(search.reason);
  if (why) panel.append(el('div', { class: 'nav-gate-msg warn', text: why }));
  for (const n of navSearchNote(search)) panel.append(n);

  const status = el('div', { class: 'nav-gate-status' });
  const nearRow = nearNavButtons(file, mapData, status);
  if (nearRow) {
    panel.append(el('div', { class: 'nav-gate-sub', text: 'Nearby nav files — pick one to use for this map:' }), nearRow);
  }

  panel.append(el('div', { class: 'nav-gate-sub', text: 'Browse the potato.tf nav index:' }));
  panel.append(navBrowser(file, mapData.map, status), status);
  container.append(panel);
}

const mapIndexCache = { names: null };
const mapPickFilter = new Map();

function missionStem(name) {
  const tokens = String(name).toLowerCase().replace(/\.pop$/, '').split(/[_\s]+/).filter(Boolean);
  return (tokens[0] === 'mvm' && tokens[1] ? tokens[1] : tokens[0]) || '';
}

async function potatoMapIndex() {
  if (mapIndexCache.names) return mapIndexCache.names;
  const res = await window.popnative.potatoList('maps');
  if (!res || !res.files) return null;
  mapIndexCache.names = [...new Set(res.files
    .map(f => String(f.name).toLowerCase())
    .filter(n => n.endsWith('.bsp'))
    .map(n => n.replace(/\.bsp$/, '')))].sort();
  return mapIndexCache.names;
}

function renderMapPicker(container, file) {
  const mission = file.name.toLowerCase().replace(/\.pop$/, '');
  const isPfx = n => mission === n || mission.startsWith(n + '_');
  const panel = el('div', { class: 'nav-gate' });
  panel.append(el('div', { class: 'panel-title', text: 'NO MATCHING MAP' }));
  panel.append(el('div', { class: 'nav-gate-msg', text: 'No installed map matches "' + file.name + '". Pick one from the potato.tf index to download it.' }));
  panel.append(el('div', { class: 'nav-gate-sub', text: 'Downloads go to tf/download/maps.' }));

  const filter = el('input', { class: 'inp', value: mapPickFilter.get(file.id) ?? missionStem(file.name), placeholder: 'Search the potato.tf map index', spellcheck: 'false' });
  const status = el('div', { class: 'nav-gate-status' });
  const list = el('div', { class: 'pick-list scroll' });

  const download = async name => {
    if (mapDlActive.has(file.id)) return;
    mapDlActive.add(file.id);
    status.textContent = 'Downloading ' + name + '.bsp…';
    try {
      const tfPath = await getTFPath();
      const res = await window.popnative.potatoMap(name, tfPath);
      if (!res || res.error) { status.textContent = res && res.error ? res.error : 'Download failed.'; return; }
      if (!isPfx(name)) localStorage.setItem('popvis.mapfor.' + file.name.toLowerCase(), name);
      status.textContent = 'Downloaded ' + name + '.bsp';
      await window.popnative.mapFlush();
      mapDlActive.delete(file.id);
      reloadMapData(file);
    } catch (err) {
      status.textContent = 'Download failed: ' + err.message;
    } finally {
      mapDlActive.delete(file.id);
    }
  };

  const refresh = names => {
    clear(list);
    const q = filter.value.trim().toLowerCase();
    const hits = names.filter(n => !q || n.includes(q));
    hits.sort((a, b) => (isPfx(b) - isPfx(a)) || (isPfx(a) && isPfx(b) ? b.length - a.length : 0) || a.localeCompare(b));
    if (!hits.length) status.textContent = 'Nothing on the index matches "' + q + '".';
    else status.textContent = q
      ? hits.length + ' of ' + names.length + ' maps match "' + q + '"'
      : names.length + ' maps on the potato.tf index';
    for (const n of hits.slice(0, 40)) {
      list.append(pickRow({
        name: n, ext: '.bsp',
        tag: isPfx(n) ? 'Mission match' : null, best: isPfx(n),
        action: 'Download', onclick: () => download(n)
      }));
    }
    if (hits.length > 40) list.append(el('div', { class: 'pick-more', text: (hits.length - 40) + ' more — narrow the search' }));
  };

  filter.addEventListener('input', () => {
    mapPickFilter.set(file.id, filter.value);
    if (mapIndexCache.names) refresh(mapIndexCache.names);
  });
  filter.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const first = list.querySelector('button');
    if (first) first.click();
  });

  panel.append(el('div', { class: 'nav-browse-row' }, filter), status, list);
  container.append(panel);

  if (mapDlActive.has(file.id)) {
    status.textContent = 'Downloading…';
    return;
  }
  status.textContent = 'Reading the index…';
  potatoMapIndex().then(names => {
    if (!list.isConnected) return;
    if (!names) { status.textContent = 'Could not reach the potato.tf index.'; return; }
    refresh(names);
  });
}

function buildApproxBanner(file, mapData) {
  const nav = mapData.nav;
  const bar = el('div', { class: 'nav-approx' });
  const status = el('div', { class: 'nav-gate-status' });
  const holder = el('div', {});
  const findBtn = el('button', { class: 'btn sm', text: 'Find the right one' });
  findBtn.addEventListener('click', () => {
    if (holder.firstChild) { clear(holder); return; }
    holder.append(navBrowser(file, mapData.map, status));
  });
  bar.append(
    el('span', { class: 'nav-approx-tag', text: 'APPROXIMATE NAV' }),
    el('span', {
      class: 'nav-approx-msg',
      text: 'Using ' + nav.name + '.nav for ' + mapData.map + '. Routes and reachability are only as accurate as that mesh.'
    }),
    findBtn,
    el('button', {
      class: 'btn sm', text: 'Dismiss',
      onclick: () => { approxDismissed.add(mapData.map); emit('map'); }
    }));
  return el('div', {}, bar, holder, status);
}

function playStateFor(file, waveIndex) {
  const key = file.id + ':' + waveIndex;
  if (!playStates.has(key)) playStates.set(key, { t: 0, playing: false, speed: 1, raf: 0, mode: localStorage.getItem('popvis.mapmode') || '3d', tool: null, brush: 1, killRadius: KILL_RADIUS, hover: null, optionsOpen: localStorage.getItem('popvis.simpanel') !== '0' });
  return playStates.get(key);
}

function getDPS() {
  return Math.max(0, state.simOpts.teamDPS || 0);
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
  const task = startTask('Baking map textures', { stage: 'reading VTF materials' });
  file.mapTexReq = (async () => {
    try {
      const t = await window.popnative.mapTexture(mapQueryName(file), await getTFPath(), popDirOf(file));
      if (file.name !== reqName) { task.succeed(); return; }
      if (t && t.rgba && t.width && t.height) {
        const u8 = t.rgba instanceof Uint8Array ? t.rgba : new Uint8Array(t.rgba);
        const cv = document.createElement('canvas');
        cv.width = t.width; cv.height = t.height;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(u8.buffer, u8.byteOffset, u8.byteLength), t.width, t.height), 0, 0);
        let hg = null;
        if (t.heightGrid && t.heightGrid.grid) {
          const gb = t.heightGrid.grid;
          const g8 = gb instanceof Uint8Array ? gb : new Uint8Array(gb);
          const gbuf = g8.byteOffset % 4 === 0 ? g8.buffer.slice(g8.byteOffset, g8.byteOffset + g8.byteLength) : g8.slice().buffer;
          hg = { grid: new Float32Array(gbuf), gw: t.heightGrid.gw, gh: t.heightGrid.gh, cellPx: t.heightGrid.cellPx, zMin: t.heightGrid.zMin, zMax: t.heightGrid.zMax };
        }
        file.mapTexture = { bounds: t.bounds, canvas: cv, width: t.width, height: t.height, heightGrid: hg };
        task.succeed('Map textures ready');
      } else { file.mapTexture = null; task.succeed(); }
    } catch { if (file.name === reqName) file.mapTexture = null; task.fail('texture bake failed'); }
    finally { file.mapTexReq = null; worldCache.clear(); emit('map'); }
  })();
}

function requestMapFaces3d(file) {
  if (!native.isElectron || !window.popnative.mapFaces3d) return;
  if (file.mapFaces3d !== undefined || file.mapFaces3dReq) return;
  const reqName = file.name;
  const task = startTask('Loading 3D geometry', { stage: 'reading map faces' });
  file.mapFaces3dReq = (async () => {
    try {
      const r = await window.popnative.mapFaces3d(mapQueryName(file), await getTFPath(), popDirOf(file));
      if (file.name !== reqName) { task.succeed(); return; }
      if (r && r.materials) {
        if (r.bsp) file.mapBspPath = r.bsp;
        const toF32 = b => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); const buf = u.byteOffset % 4 === 0 ? u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) : u.slice().buffer; return new Float32Array(buf); };
        const toU8 = b => b instanceof Uint8Array ? b : new Uint8Array(b);
        file.mapFaces3d = {
          bounds: r.bounds,
          exposure: r.exposure,
          minLight: r.minLight,
          lmUpBright: r.lmUpBright,
          ambient: r.ambient || null,
          materials: r.materials.map(m => ({ name: m.name, count: m.count, positions: toF32(m.positions), uvs: toF32(m.uvs), lm: toF32(m.lm) })),
          lightmap: r.lightmap ? { width: r.lightmap.width, height: r.lightmap.height, range: r.lightmap.range, rgba: toU8(r.lightmap.rgba) } : null
        };
        task.succeed('3D geometry ready');
      } else { file.mapFaces3d = null; task.succeed(); }
    } catch { if (file.name === reqName) file.mapFaces3d = null; task.fail('geometry load failed'); }
    finally { file.mapFaces3dReq = null; emit('map'); }
  })();
}

function requestMapLighting(file) {
  if (!native.isElectron || !window.popnative.mapLighting) return;
  if (file.mapLighting !== undefined || file.mapLightingReq) return;
  const reqName = file.name;
  file.mapLightingReq = (async () => {
    try {
      const r = await window.popnative.mapLighting(mapQueryName(file), await getTFPath(), popDirOf(file));
      if (file.name !== reqName) return;
      if (r && r.cubes) {
        const ta = (b, T) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); const ab = u.byteOffset % 8 === 0 ? u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) : u.slice().buffer; return new T(ab); };
        file.mapLighting = {
          planes: ta(r.planes, Float32Array), nodes: ta(r.nodes, Int32Array),
          leafMins: ta(r.leafMins, Int16Array), leafMaxs: ta(r.leafMaxs, Int16Array),
          ambCount: ta(r.ambCount, Uint16Array), ambFirst: ta(r.ambFirst, Uint16Array),
          cubes: ta(r.cubes, Float32Array), ambPos: ta(r.ambPos, Uint8Array),
          lights: r.lights || []
        };
      } else file.mapLighting = null;
    } catch { if (file.name === reqName) file.mapLighting = null; }
    finally { file.mapLightingReq = null; emit('map'); }
  })();
}

function requestMapProps(file) {
  if (!native.isElectron || !window.popnative.mapProps) return;
  if (file.mapProps !== undefined || file.mapPropsReq) return;
  const reqName = file.name;
  const task = startTask('Loading props', { stage: 'reading static props' });
  file.mapPropsReq = (async () => {
    try {
      const r = await window.popnative.mapProps(mapQueryName(file), await getTFPath(), popDirOf(file));
      if (file.name !== reqName) { task.succeed(); return; }
      const list = Array.isArray(r) ? r : (r && r.props);
      file.mapProps = Array.isArray(list) ? list : null;
      if (r && r.bsp) file.mapBspPath = r.bsp;
      task.succeed(file.mapProps ? file.mapProps.length + ' props' : 'no props');
    } catch { if (file.name === reqName) file.mapProps = null; task.fail('props load failed'); }
    finally { file.mapPropsReq = null; emit('map'); }
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
  run = { key, ai: null, staleAi, cancelled: false, progressEl: null, stepper: null };
  aiRuns.set(sim, run);
  const tick = () => {
    if (run.cancelled) return;
    const stepper = run.stepper;
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
  initNavWasm().then(() => {
    if (run.cancelled) return;
    run.stepper = createBotSim(wave, sim, mapData, opts);
    setTimeout(tick, 0);
  });
  return run;
}

const eventLogCache = new WeakMap();
function eventLogFor(ai) {
  let log = eventLogCache.get(ai);
  if (log) return log;
  log = [];
  for (const a of ai.actors) {
    if (!a.spawned) continue;
    const label = a.kind === 'tank' ? 'Tank' : a.kind === 'prop' ? ((a.prop && a.prop.name) || 'Prop') : botDisplayName(a.bot);
    const wsn = a.ws && a.ws.name ? ' — ' + a.ws.name : '';
    log.push({ t: a.spawnT, kind: 'spawn', text: label + ' spawned' + wsn });
    if (Number.isFinite(a.dieT) && a.dieT <= ai.end) {
      if (a.done && ai.bomb.deliveredAt != null && Math.abs(a.dieT - ai.bomb.deliveredAt) < 0.3) {
        log.push({ t: a.dieT, kind: 'deliver', text: label + ' deployed the bomb' + wsn });
      } else {
        log.push({ t: a.dieT, kind: 'death', text: label + (a.kind === 'tank' ? ' destroyed' : ' died') + wsn });
      }
    }
  }
  if (ai.truncation && ai.truncation.endedEarly) {
    log.push({ t: ai.truncation.endT, kind: 'warn', text: 'Simulation stopped at its step limit — late activity missing' });
  }
  log.sort((x, y) => x.t - y.t);
  eventLogCache.set(ai, log);
  return log;
}

export function renderMapView(container, file, waveIndex) {
  clear(container);
  clearStatusPrefix('map:');
  const wave = file.model.waves[waveIndex];
  if (!wave) { container.append(el('div', { class: 'empty-note', text: 'No such wave' })); return; }
  if (!native.isElectron) {
    container.append(el('div', { class: 'empty-note', text: 'Map view needs the desktop app.' }));
    return;
  }
  if (file.mapData === undefined || file.mapGeo === undefined) {
    if (!file.mapDataReq) {
      const reqName = file.name;
      const task = startTask('Loading map ' + mapQueryName(file).replace(/\.pop$/i, ''), { stage: 'reading geometry' });
      file.mapDataReq = (async () => {
        try {
          const tfPath = await getTFPath();
          const [md, mg] = await Promise.all([
            window.popnative.mapData(mapQueryName(file), tfPath, popDirOf(file)),
            window.popnative.mapGeo(mapQueryName(file), tfPath, popDirOf(file))
          ]);
          if (file.name !== reqName) { task.succeed(); return; }
          file.mapData = md;
          if (mg && mg.data) {
            const u8 = mg.data instanceof Uint8Array ? mg.data : new Uint8Array(mg.data);
            const buf = u8.byteOffset % 4 === 0 ? u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : u8.slice().buffer;
            file.mapGeo = { polys: mg.polys, bounds: mg.bounds, zRange: mg.zRange, lit: mg.lit, data: new Float32Array(buf) };
          } else file.mapGeo = null;
          task.succeed(md ? 'Loaded map ' + md.map : 'No map found');
        } catch (err) {
          if (file.name === reqName) { file.mapData = null; file.mapGeo = null; }
          task.fail('could not read the map');
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
    renderMapPicker(container, file);
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
  const engineerNests = (mapData.hints || []).filter(h => h.kind === 'bot_hint_engineer_nest');
  const engineerSpec = engineerProbeSpec(mapData, wave);
  const objIdx = objectiveIdxFor(mapData.map);
  const pathGroups = bombPathGroups(mapData);
  const perWavePath = bombPathRerollsFor(file, mapData);
  const bombPath = bombPathFor(mapData.map, pathGroups, waveIndex, perWavePath);
  const toggles = navTogglesFor(file, wave);
  const teleBuild = teleporterBuildTime();
  if (teleBuild === null) resolveBuildTimes().then(v => { if (v) emit('map'); });
  const deployAnim = animDurationSync(DEPLOY_ANIM_MODEL, 'deploybomb');
  if (deployAnim === null) resolveAnimDuration(DEPLOY_ANIM_MODEL, 'deploybomb').then(v => { if (v) emit('map'); });
  const aiKey = [waveIndex, model, dps, zMode, paintV, objIdx, bombPath, teleBuild || 0, deployAnim || 0, JSON.stringify(killPts),
    toggles.enabled.join(','), toggles.disabled.join(',')].join('|');
  const aiOpts = {
    teamDPS: dps, deathModel: model, zonesMode: zMode, killPoints: killPts, objectiveIdx: objIdx, bombPath,
    enabledNames: toggles.enabled, disabledNames: toggles.disabled,
    extraSpawnPoints: file.model.extraSpawnPoints || [],
    extraTankPaths: file.model.extraTankPaths || [],
    botPushaway: file.model.botPushaway,
    flagCarrierPenalty: file.model.flagCarrierPenalty,
    maxSpeedLimit: file.model.maxSpeedLimit,
    templateEntities: file.model.templateEntities,
    teleporterBuildTime: teleBuild || 0,
    deployBombTime: deployAnim || 0
  };
  if (zMode === 'custom') aiOpts.zoneWeights = paint;
  const run = aiRunFor(file, wave, sim, mapData, aiKey, aiOpts);

  setStatus('map:bsp', { view: 'map', text: 'map ' + mapData.map, title: 'Loaded map geometry (BSP)' });
  setStatus('map:nav', mapData.nav
    ? { view: 'map', text: 'nav ' + mapData.nav.name + (mapData.nav.approx ? ' (approximate)' : ''), kind: mapData.nav.approx ? 'warn' : null, title: 'Navigation mesh the simulation runs on' }
    : { view: 'map', text: 'no nav mesh', kind: 'warn', title: 'No navigation mesh — movement falls back to straight lines' });
  if (!run.ai) setStatus('map:run', { view: 'map', text: run.staleAi ? 'resimulating…' : 'simulating…', title: 'The movement simulation is computing in the background' });
  else clearStatus('map:run');
  if (file.mapTexReq) setStatus('map:bake', { view: 'map', text: 'baking textures…', title: 'Reading the map textures' });
  else clearStatus('map:bake');

  if (ps.raf) { cancelAnimationFrame(ps.raf); ps.raf = 0; }
  if (ps.pulse) { clearTimeout(ps.pulse); ps.pulse = 0; }

  if (!run.ai && !run.staleAi) {
    const prog = loader('Simulating');
    run.progressEl = prog.label;
    container.append(prog);
    return;
  }
  const resimulating = !run.ai;
  if (resimulating) {
    if (ps.playing) ps.resumeAfterSim = true;
    ps.playing = false;
  } else if (ps.resumeAfterSim) {
    ps.resumeAfterSim = false;
    ps.playing = true;
  }
  const ai = run.ai || run.staleAi;
  const waveEnd = ai.end;
  ps.t = Math.min(ps.t, waveEnd);
  ps.waveEnd = waveEnd;
  const actorKey = a => (a.ws && a.ws.node ? a.ws.node.id : '?') + '#' + a.spawnT.toFixed(2) + '#' + (a.squadId || 0) + '#' + (a.memberIdx || 0);
  const selectedActor = () => ps.selKey ? ai.actors.find(a => actorKey(a) === ps.selKey) || null : null;
  if (ps.selectFirst && !ps.selKey) {
    const first = ai.actors.find(a => a.kind === 'bot' && ps.t >= a.spawnT && ps.t <= a.dieT) || ai.actors.find(a => a.kind === 'bot');
    if (first) ps.selKey = actorKey(first);
    ps.selectFirst = false;
  }
  const chains = buildTrackChains(mapData, file.model.extraTankPaths);
  const areasById = new Map();
  if (mapData.nav) for (const a of mapData.nav.areas) areasById.set(a.id, a);
  let zLow = Infinity, zHigh = -Infinity;
  if (mapData.nav) {
    for (const a of mapData.nav.areas) {
      const z = (a.nw[2] + a.se[2]) / 2;
      if (z < zLow) zLow = z;
      if (z > zHigh) zHigh = z;
    }
  }
  if (!Number.isFinite(zLow)) { zLow = 0; zHigh = 0; }
  const zSpan = zHigh - zLow;

  const navNote = mapData.nav
    ? 'nav: ' + mapData.nav.name + (mapData.nav.approx ? ' (approximate)' : '')
    : 'no nav mesh';

  const playBtn = el('button', { class: 'btn sm ctl-play' });
  const setPlayLabel = playing => {
    if (playBtn.dataset.state === (playing ? 'pause' : 'play')) return;
    playBtn.dataset.state = playing ? 'pause' : 'play';
    clear(playBtn);
    playBtn.append(icon(playing ? 'pause' : 'play', 15), el('span', { text: playing ? 'Pause' : 'Play' }));
    playBtn.title = (playing ? 'Pause playback' : 'Play the wave') + ' (Space)';
    playBtn.setAttribute('aria-label', playing ? 'Pause playback' : 'Play the wave');
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  };
  setPlayLabel(ps.playing);
  const timeLbl = el('span', { class: 'map-time' });
  const mini = el('canvas', { class: 'map-mini', title: 'Wave activity — click or drag to scrub' });
  const nextLbl = el('span', { class: 'map-next' });
  const speedSel = el('select', {
    class: 'inp sm map-speed', title: 'Playback speed', 'aria-label': 'Playback speed'
  },
    ...[0.5, 1, 2, 4].map(s => el('option', { value: s, text: s + 'x', selected: ps.speed === s })));
  const fitBtn = el('button', { class: 'btn sm', title: 'Fit the whole map in view' },
    icon('maximize', 15), el('span', { text: 'Fit' }));

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
  const modeSeg = el('span', { class: 'map-modes', role: 'group', 'aria-label': 'View mode' },
    ...[['full', 'Full'], ['layout', 'Nav'], ['3d', '3D']].map(([m, label]) => el('button', {
      class: 'seg-btn' + (ps.mode === m ? ' on' : ''), text: label,
      'aria-pressed': ps.mode === m ? 'true' : 'false',
      title: m === '3d' ? 'Orbit a 3D height-mesh of the map (drag to rotate, wheel to zoom)' : null,
      onclick: () => {
        ps.mode = m;
        localStorage.setItem('popvis.mapmode', m);
        emit('map');
      }
    })));

  const objCands = objectiveCandidates(mapData, buildTrackChains(mapData, file.model.extraTankPaths));

  const displayBtn = el('button', {
    class: 'btn sm map-simbtn' + (ps.optionsOpen ? ' on' : ''),
    'aria-pressed': ps.optionsOpen ? 'true' : 'false',
    'aria-expanded': ps.optionsOpen ? 'true' : 'false',
    title: 'Death model, damage zones, kill points, objective',
    onclick: () => {
      ps.optionsOpen = !ps.optionsOpen;
      localStorage.setItem('popvis.simpanel', ps.optionsOpen ? '1' : '0');
      emit('map');
    }
  });
  displayBtn.append(icon('sliders', 15), el('span', { text: 'Simulation' }));

  const truncParts = [];
  if (ai.truncation) {
    if (ai.truncation.capHit && ai.truncation.skipped > 0) truncParts.push('~' + ai.truncation.skipped + ' late robots not simulated (' + ai.truncation.cap + '-actor cap)');
    if (ai.truncation.endedEarly) {
      const tails = [];
      if (ai.truncation.unspawned > 0) tails.push(ai.truncation.unspawned + ' never spawned');
      if (ai.truncation.unfinished > 0) tails.push(ai.truncation.unfinished + ' still active');
      truncParts.push('stopped at ' + fmtTime(ai.truncation.endT) + (tails.length ? ' — ' + tails.join(', ') : ''));
    }
  }
  setStatus('map:sim', {
    view: 'map',
    text: model + ' model · seed ' + ((RNG_SEED_BASE ^ wave.index) >>> 0).toString(16),
    title: 'Deterministic run — the death model and the RNG seed used for this wave'
  });
  if (truncParts.length) setStatus('map:trunc', { view: 'map', kind: 'warn', text: 'sim truncated', title: truncParts.join('; ') });
  else clearStatus('map:trunc');
  const tbtn = (iconName, label, action) => {
    const b = el('button', {
      class: 'icon-btn sm', title: label, 'aria-label': label,
      onclick: () => mapTransport(file, waveIndex, action)
    });
    b.append(icon(iconName, 15));
    return b;
  };
  const transport = el('span', { class: 'map-transport', role: 'group', 'aria-label': 'Playback' },
    tbtn('rotate-ccw', 'Restart (Home)', 'restart'),
    el('span', { class: 'ctl-div' }),
    tbtn('skip-back', 'Previous event ([)', 'prev-event'),
    tbtn('chevron-left', 'Step back one tick (←)', 'step-back'),
    playBtn,
    tbtn('chevron-right', 'Step forward one tick (→)', 'step-fwd'),
    tbtn('skip-forward', 'Next event (])', 'next-event'),
    el('span', { class: 'ctl-div' }),
    speedSel);
  const zoomLbl = el('button', { class: 'btn sm map-zoom', title: 'Zoom — click to fit the map', onclick: () => { fit(); drawFrame(); } });
  const bar = el('div', { class: 'map-toolbar' },
    el('div', { class: 'map-row map-row-play' },
      transport, mini, timeLbl, nextLbl),
    el('div', { class: 'map-row map-row-view' },
      el('span', { class: 'map-group', role: 'group', 'aria-label': 'Viewport' }, fitBtn, zoomLbl, modeSeg),
      el('span', { class: 'map-info' },
        el('span', { class: 'map-note', text: mapData.map + ' — ' + navNote }),
        truncParts.length ? el('span', {
          class: 'map-trunc',
          title: 'The movement simulation hit an internal limit, so late activity is missing from this playback. The timeline schedule is not affected.',
          text: 'truncated — ' + truncParts.join('; ')
        }) : null,
        file.mapTexReq ? el('span', { class: 'map-baking', title: 'Reading the map textures — surfaces stay flat until this finishes', text: 'baking textures…' }) : null),
      displayBtn));

  function buildOptionsPanel() {
    const panel = el('div', { class: 'map-opts map-tools' });
    const closeBtn = el('button', {
      class: 'icon-btn sm', title: 'Close', 'aria-label': 'Close the simulation panel',
      onclick: () => { ps.optionsOpen = false; localStorage.setItem('popvis.simpanel', '0'); emit('map'); }
    });
    closeBtn.append(icon('x', 15));
    panel.append(el('div', { class: 'pop-title' }, el('span', { text: 'SIMULATION' }), closeBtn));

    const tool = (id, iconName, label, hint) => {
      const b = el('button', {
        class: 'btn sm tool-btn' + (ps.tool === id ? ' on' : ''), title: hint,
        'aria-label': label, 'aria-pressed': ps.tool === id ? 'true' : 'false',
        onclick: () => { ps.tool = ps.tool === id ? null : id; emit('map'); }
      });
      b.append(icon(iconName, 15), el('span', { text: label }));
      return b;
    };

    panel.append(simOptsPanel(file));
    panel.append(el('div', {
      class: 'opt-note info',
      title: 'Every run of this wave uses the same random seed, so results are reproducible',
      text: 'Deterministic — seed ' + ((RNG_SEED_BASE ^ wave.index) >>> 0).toString(16)
    }));

    if (model === 'damage') {
      const zoneSeg = el('span', { class: 'map-modes', role: 'group', 'aria-label': 'Damage zones' },
        ...[['auto', 'Auto'], ['custom', 'Custom'], ['off', 'Off']].map(([m, label]) => el('button', {
          class: 'seg-btn' + (zMode === m ? ' on' : ''), text: label,
          'aria-pressed': zMode === m ? 'true' : 'false',
          onclick: () => { localStorage.setItem('popvis.zonesmode', m); emit('map'); }
        })));
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Damage zones' }), zoneSeg));
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

    const routeOn = ps.showRoute !== false;
    const routeBtn = el('button', {
      class: 'btn sm ctl-toggle' + (routeOn ? ' on' : ''), text: routeOn ? 'On' : 'Off',
      title: 'Draw the route the bots take to the hatch',
      'aria-label': 'Draw the bomb route', 'aria-pressed': routeOn ? 'true' : 'false',
      onclick: () => { ps.showRoute = ps.showRoute === false; emit('map'); }
    });
    if (pathGroups.length) {
      const fromMap = pathGroups.some(g => g.fromMap);
      const stored = localStorage.getItem(bombPathKey(mapData.map, waveIndex, perWavePath));
      const picked = stored && pathGroups.some(g => g.key === stored);
      const autoLabel = perWavePath
        ? 'this wave: ' + String(bombPath || '').replace(/_/g, ' ')
        : (fromMap ? 'random (map picks)' : 'default (map)');
      const pathSel = el('select', {
        class: 'inp sm', 'aria-label': 'Nav path',
        title: perWavePath
          ? 'The map re-rolls the bomb path after every wave, so each wave gets its own. This is one of the possibilities — pick a specific one to pin it.'
          : (fromMap
            ? 'The map picks one of these at random each round. Choosing one applies exactly what that relay enables.'
            : 'Which bomb path the map has enabled — switches func_nav_prefer / func_nav_avoid')
      },
        el('option', { value: '', text: autoLabel, selected: !picked }),
        ...pathGroups.map(g => el('option', {
          value: g.key, text: g.key.replace(/_/g, ' '), selected: picked && g.key === bombPath
        })),
        perWavePath ? el('option', { value: '__none', text: 'none enabled', selected: stored === '__none' }) : null);
      pathSel.addEventListener('change', () => {
        const key = bombPathKey(mapData.map, waveIndex, perWavePath);
        if (pathSel.value) localStorage.setItem(key, pathSel.value);
        else localStorage.removeItem(key);
        emit('map');
      });
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Nav path' }), pathSel, routeBtn));
      if (perWavePath) {
        panel.append(el('div', {
          class: 'opt-note info',
          text: 'Re-rolled by the map after each wave'
        }));
      }
    } else {
      panel.append(el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'Route' }), routeBtn));
    }
    if (toggles.deferred && toggles.deferred.length) {
      panel.append(el('div', {
        class: 'opt-note',
        title: toggles.deferred.map(d => d.input + ' ' + d.target + ' at +' + d.delay + 's').join('\n'),
        text: toggles.deferred.length + ' nav change' + (toggles.deferred.length > 1 ? 's fire' : ' fires') + ' later — not simulated'
      }));
    }

    panel.append(el('div', { class: 'tool-sep' }));

    const killRow = el('div', { class: 'opt-row' },
      tool('kill', 'crosshair', 'Kill points', 'Left-click places a despawn point, right-click removes one'));
    if (killPts.length) killRow.append(el('button', {
      class: 'btn sm', text: 'Clear', title: 'Remove every despawn point on this map',
      onclick: () => { saveKillPoints(mapData.map, []); emit('map'); }
    }));
    panel.append(killRow);

    panel.append(el('div', { class: 'tool-sep' }));
    const existing = probesFor(file, waveIndex);
    const engBtn = tool('engineer', 'plus', 'Place engineer',
      engineerSpec
        ? 'Click the map to drop an engineer there. It walks to the nearest highlighted nest hint and builds its teleporter. Not written to the popfile.'
        : 'This map has no bot_hint_engineer_nest');
    if (!engineerSpec) { engBtn.disabled = true; if (ps.tool === 'engineer') ps.tool = null; }
    const probeRow = el('div', { class: 'opt-row' }, engBtn);
    if (existing.length) probeRow.append(el('button', {
      class: 'btn sm', text: 'Clear ' + existing.length,
      title: 'Remove every spawned test engineer from this wave',
      onclick: () => { clearProbes(file, waveIndex); emit('map'); }
    }));
    panel.append(probeRow);


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

  let gateHud = null;
  let bombHud = null;
  let tankHud = null;
  const canvas = el('canvas', { class: 'map-canvas' + (ps.tool ? ' painting' : '') });
  canvas.addEventListener('contextmenu', e => { if (ps.tool) e.preventDefault(); });
  const canvasWrap = el('div', { class: 'map-canvaswrap' }, canvas);
  gateHud = buildGateHUD(mapData, wave, ai, file.mapBspPath || null);
  if (gateHud) canvasWrap.append(gateHud);
  bombHud = buildBombHUD(ai);
  tankHud = buildTankHUD(ai);
  if (bombHud || tankHud) canvasWrap.append(el('div', { class: 'map-status' }, bombHud, tankHud));
  if (resimulating) canvasWrap.append(el('div', { class: 'map-resim', text: 'Re-simulating…' }));
  const approx = mapData.nav.approx && !approxDismissed.has(mapData.map)
    ? buildApproxBanner(file, mapData)
    : null;

  const dpr = window.devicePixelRatio || 1;

  function repaintNow() {
    if (ps.mode !== '3d') { drawFrame(); return; }
    if (active3D) active3D.redraw();
    drawMini();
    updateWavePanel(ps.t, countActiveAt(ps.t), waveEnd);
  }

  function wirePlayback() {
    playBtn.addEventListener('click', () => {
      if (!ps.playing && ps.t >= waveEnd) ps.t = 0;
      ps.playing = !ps.playing;
      setPlayLabel(ps.playing);
      if (ps.mode === '3d') { if (active3D) active3D.redraw(); }
      else if (ps.playing && !ps.raf) ps.raf = requestAnimationFrame(() => loop(0));
    });
    speedSel.addEventListener('change', () => { ps.speed = parseFloat(speedSel.value); repaintNow(); });
    let dragging = false;
    const seek = ev => {
      const r = mini.getBoundingClientRect();
      ps.t = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) * waveEnd;
      repaintNow();
    };
    mini.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      seek(e);
      const mv = ev => { if (dragging) seek(ev); };
      const up2 = () => { dragging = false; removeEventListener('mousemove', mv); removeEventListener('mouseup', up2); };
      addEventListener('mousemove', mv);
      addEventListener('mouseup', up2);
    });
    mini.addEventListener('wheel', e => {
      e.preventDefault();
      const step = (e.shiftKey ? 5 : 1) * (e.deltaY > 0 ? 1 : -1);
      ps.playing = false;
      setPlayLabel(false);
      ps.t = Math.max(0, Math.min(waveEnd, ps.t + step));
      repaintNow();
    }, { passive: false });
  }

  if (ps.mode === '3d') {
    wirePlayback();
    mapRedraw = repaintNow;
    render3DMode();
    drawMini();
    return;
  }
  wirePlayback();

  function hexRGB(h) {
    const n = parseInt(String(h || '#9aa0a6').slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function actorColorSize(a) {
    if (a.kind === 'tank') return { c: [0.74, 0.28, 0.24], s: 0.92 };
    if (a.kind === 'prop') return { c: [0.5, 0.55, 0.62], s: 0.4 };
    let c = hexRGB((CLASS_INFO[a.bot.cls] || CLASS_INFO.unknown).color);
    let s = 0.36;
    if (a.bot.isBoss) { c = c.map(x => Math.min(1, x * 0.55 + 0.45)); s = 0.85; }
    else if (a.bot.isGiant) { c = c.map(x => Math.min(1, x * 0.7 + 0.25)); s = 0.6; }
    return { c, s };
  }
  function actorsAt3D(t) {
    const out = [];
    const gatesDoneAt = allGatesCapturedAt(ai.gates);
    let freshItems = false;
    for (const a of ai.actors) {
      if (a.kind === 'bot' && a.bot.items) for (const it of a.bot.items) if (!itemsRequested.has(it)) { itemsRequested.add(it); freshItems = true; }
    }
    if (freshItems && !itemsPending) {
      itemsPending = true;
      resolveBotItems([...itemsRequested]).then(c => { itemsPending = false; if (c) emit('map'); }).catch(() => { itemsPending = false; });
    }
    let freshRoles = false;
    for (const a of ai.actors) {
      if (a.kind !== 'bot') continue;
      const wc = botWeaponClass(a.bot);
      if (wc && !rolesRequested.has(wc)) { rolesRequested.add(wc); freshRoles = true; }
    }
    if (freshRoles && !rolesPending) {
      rolesPending = true;
      resolveWeaponRoles([...rolesRequested]).then(c => { rolesPending = false; if (c) emit('map'); }).catch(() => { rolesPending = false; });
    }
    for (const a of ai.actors) {
      if (t < a.spawnT || t > a.dieT) continue;
      const p = actorPosAt(a, t);
      if (!p) continue;
      const cs = actorColorSize(a);
      const H = 0.12;
      const before = actorPosAt(a, Math.max(a.spawnT, t - H));
      const after = actorPosAt(a, Math.min(a.dieT, t + H)) || p;
      const heading = actorYawAt(a, t);
      let moving = false, speed = 0;
      if (before) {
        const span = Math.min(a.dieT, t + H) - Math.max(a.spawnT, t - H);
        const d = Math.hypot(after[0] - before[0], after[1] - before[1]);
        speed = span > 0 ? d / span : 0;
        moving = speed > 0.5;
      }
      let scale = 1, modelBase = null, attachments = null, loadoutKey = null, activity = null;
      if (a.kind === 'bot') {
        scale = a.bot.scale != null ? a.bot.scale : (a.bot.isGiant ? 1.75 : 1);
        modelBase = isSentryBuster(a) ? SENTRY_BUSTER_MODEL : botModelBase(a.bot);
        const reverted = a.isGatebot && gatesDoneAt != null && t >= gatesDoneAt;
        const styles = reverted ? a.bot.revertItemStyles : a.bot.itemStyles;
        const weps = botWeaponModels(a.bot, styles);
        const cos = botCosmeticModels(a.bot, styles);
        activity = botActivity(a.bot);
        attachments = [...weps, ...cos];
        loadoutKey = modelBase + '|' + activity + '|' + attachments.join('|');
      } else if (a.kind === 'tank' && a.tank) {
        if (Number.isFinite(a.tank.scale) && a.tank.scale > 0) scale = a.tank.scale;
        modelBase = a.tank.model ? cleanTankModel(a.tank.model) : null;
      }
      const modelSkin = a.kind === 'tank' && a.tank ? (a.tank.skin || 0) : 0;
      out.push({
        x: p[0], y: p[1], z: actorZAt(a, t), size: cs.s, r: cs.c[0], g: cs.c[1], b: cs.c[2],
        kind: a.kind, cls: a.kind === 'bot' ? a.bot.cls : null,
        crit: a.kind === 'bot' && !!a.bot.alwaysCrit,
        ubered: !!(a.uberUntil > t),
        modelSkin,
        tankSmoke: !(a.kind === 'tank' && a.tank && a.tank.disableSmokestack),
        probe: !!(a.ws && a.ws.isProbe),
        viaTeleporter: !!a.viaTeleporter,
        modelBase, attachments, loadoutKey, activity, moving, carrying: false, speed, dist: actorDistAt(a, t),
        heading, scale, phase: (Math.floor(a.spawnT * 13) + (a.memberIdx || 0) * 5) % 128
      });
    }
    if (ps.tool === 'engineer' && ps.hover && engineerSpec) {
      const area = ai.nav && ai.nav.nearestArea([ps.hover[0], ps.hover[1]]);
      const gz = area ? (area.nw[2] + area.se[2]) / 2 : 0;
      const ghostBot = { cls: 'engineer', items: [], attrs: [], tags: [], loadout: {}, combat: {} };
      const base = botModelBase(ghostBot);
      const act = botActivity(ghostBot);
      out.push({
        x: ps.hover[0], y: ps.hover[1], z: gz, size: 0.55, r: 0.42, g: 0.66, b: 0.92,
        kind: 'bot', cls: 'engineer', probe: true,
        modelBase: base, attachments: [], activity: act,
        loadoutKey: base + '|' + act + '|', moving: false, carrying: false, speed: 0, dist: 0,
        heading: 0, scale: 1, phase: 0
      });
    }
    for (const tp of ai.teleporters || []) {
      if (t < tp.readyAt) continue;
      out.push({
        x: tp.pos[0], y: tp.pos[1], z: tp.pos[2], size: 0.6, r: 0.42, g: 0.66, b: 0.92,
        kind: 'building', modelBase: TELEPORTER_MODEL, modelSkin: BLU_SKIN, heading: 0, scale: 1
      });
    }
    if (ai.bomb && ai.bomb.samples && ai.bomb.samples.length) {
      const bi = Math.max(0, Math.min(ai.bomb.samples.length - 1, Math.round(t / STEP)));
      const bp = ai.bomb.samples[bi];
      if (bp) {
        let carrier = null, bd = 48 * 48;
        for (const o of out) {
          if (o.kind !== 'bot') continue;
          const d = (o.x - bp[0]) ** 2 + (o.y - bp[1]) ** 2;
          if (d < bd) { bd = d; carrier = o; }
        }
        if (carrier) carrier.carrying = true;
        else out.push({ x: bp[0], y: bp[1], z: bp[2], size: 0.55, r: 1, g: 0.85, b: 0.15, kind: 'bomb' });
      }
    }
    return out;
  }
  function placeEngineer(wx, wy) {
    if (!engineerSpec) return;
    const area = ai.nav && ai.nav.nearestArea([wx, wy]);
    const z = area ? (area.nw[2] + area.se[2]) / 2 : 0;
    addProbe(file, waveIndex, { ...engineerSpec, pos: [wx, wy, z] });
    emit('map');
  }

  function countActiveAt(t) {
    let n = 0;
    for (const a of ai.actors) if (t >= a.spawnT && t <= a.dieT) n++;
    return n;
  }

  function render3DMode() {
    const wrap3d = el('div', { class: 'map-canvaswrap' });
    container.append(el('div', { class: 'mapview' }, approx, bar, wrap3d));
    fitBtn.title = 'Reset the 3D camera';
    fitBtn.addEventListener('click', () => active3D && active3D.resetCamera());
    if (ps.optionsOpen) wrap3d.append(buildOptionsPanel());
    if (!tex || !tex.heightGrid) {
      wrap3d.append(el('div', { class: 'empty-note', text: tex ? 'This map has no baked geometry to build a 3D mesh — use Full or Nav.' : 'Baking the map… 3D appears once the textures finish.' }));
      return;
    }
    requestMapFaces3d(file);
    requestMapProps(file);
    requestMapLighting(file);
    let cam = cam3dCache.get(mapData.map);
    if (!cam) { cam = {}; cam3dCache.set(mapData.map, cam); }
    const scene = {
      mapName: mapData.map, bspPath: file.mapBspPath || null, tex: tex.canvas, heightGrid: tex.heightGrid, bounds: tex.bounds, faces3d: file.mapFaces3d || null, props: file.mapProps || null, lighting: file.mapLighting || null, ps, cam, waveEnd,
      actorsAt: actorsAt3D,
      tool: ps.tool, killPoints: killPts,
      route: ps.showRoute !== false ? ai.route : null,
      routeCoveredAt: tt => {
        if (!ai.route || !ai.bomb || !ai.bomb.samples.length) return 0;
        const bi = Math.max(0, Math.min(ai.bomb.samples.length - 1, Math.round(tt / STEP)));
        return routeProgress(ai.route, ai.bomb.samples[bi]);
      },
      killIndexAt: (wx, wy) => killPointAt(killPts, wx, wy),
      hintRings: engineerNests.map(h => [h.origin[0], h.origin[1]]),
      propEvents: ai.propEvents || null,
      doors: ai.doors || null,
      teleporters: ai.teleporters || null,
      mapParticles: new Map((mapData.particles || []).map(p => [p.name, p])),
      onHover: (wx, wy) => {
        ps.hover = wx == null ? null : [wx, wy];
        if (active3D) active3D.redraw();
      },
      onPlace: (wx, wy) => placeEngineer(wx, wy),
      onKill: (wx, wy, remove) => {
        const list = killPointsFor(mapData.map);
        const hit = killPointAt(list, wx, wy);
        if (remove) { if (hit < 0) return; list.splice(hit, 1); }
        else list.push([wx, wy, ps.killRadius]);
        saveKillPoints(mapData.map, list);
        emit('map');
      },
      onTime: tt => {
        if (gateHud) gateHud.update(tt);
        if (bombHud) bombHud.update(tt);
        if (tankHud) tankHud.update(tt);
        const alive = countActiveAt(tt);
        timeLbl.textContent = fmtTime(tt) + ' / ' + fmtTime(waveEnd) + ' — ' + alive + ' active';
        if (!ps.playing) setPlayLabel(false);
        drawMini();
        updateWavePanel(tt, alive, waveEnd);
      },
      onPlayEnd: () => emit('map')
    };
    if (active3D && active3D.mapName === mapData.map) {
      active3D.update(scene);
      wrap3d.append(active3D.canvas);
    } else {
      if (active3D) active3D.dispose();
      active3D = createMap3D(scene);
      if (!active3D) { wrap3d.append(el('div', { class: 'empty-note', text: 'WebGL is unavailable — 3D mode needs it. Use Full or Nav.' })); return; }
      wrap3d.append(active3D.canvas);
    }
    wrap3d.append(el('div', { class: 'map-3d-hint', text: 'left-drag orbit · right-drag pan · wheel zoom · Fit resets' }));
    gateHud = buildGateHUD(mapData, wave, ai, file.mapBspPath || null);
    if (gateHud) wrap3d.append(gateHud);
    bombHud = buildBombHUD(ai);
    tankHud = buildTankHUD(ai);
    if (bombHud || tankHud) wrap3d.append(el('div', { class: 'map-status' }, bombHud, tankHud));
    timeLbl.textContent = fmtTime(ps.t) + ' / ' + fmtTime(waveEnd) + ' — ' + countActiveAt(ps.t) + ' active';
  }

  function buildActorCard(sel) {
    const isBot = sel.kind === 'bot';
    const wrap = el('div', { class: 'map-actorcard map-tools' });
    const acClose = el('button', {
      class: 'icon-btn sm', title: 'Deselect (Esc)', 'aria-label': 'Deselect',
      onclick: () => { ps.selKey = null; ps.follow = false; emit('map'); }
    });
    acClose.append(icon('x', 15));
    wrap.append(el('div', { class: 'pop-title' }, el('span', { text: 'ACTOR' }), acClose));
    const head = el('div', { class: 'ac-head' });
    if (isBot) head.append(botVisual(sel.bot));
    else if (sel.kind === 'tank') head.append(tankVisual(sel.tank));
    head.append(el('div', { class: 'ac-name', text: isBot ? botDisplayName(sel.bot) : sel.kind === 'tank' ? 'Tank' : (sel.prop.label || 'Entity') }));
    wrap.append(head);
    const rows = el('div', { class: 'ac-rows' });
    const row = (k, v) => rows.append(el('div', { class: 'ac-row' }, el('span', { class: 'ac-k', text: k }), el('span', { class: 'ac-v', text: v })));
    if (isBot) {
      row('Class', (CLASS_INFO[sel.bot.cls] || {}).name || sel.bot.cls);
      row('Health', sel.bot.health + ' HP');
      row('Speed', Math.round(botMaxSpeed(sel.bot, false)) + ' HU/s');
      const tags = [];
      if (sel.bot.isBoss) tags.push('boss'); else if (sel.bot.isGiant) tags.push('giant');
      if (sel.bot.alwaysCrit) tags.push('always-crit');
      if (sel.squadId) tags.push('squad ' + sel.squadRole);
      if (tags.length) row('Type', tags.join(', '));
    } else if (sel.kind === 'tank') {
      row('Health', sel.tank.health + ' HP');
      row('Speed', sel.tank.speed + ' HU/s');
    }
    row('From', '"' + (sel.ws.name || 'unnamed') + '"');
    row('Spawns', fmtTime(sel.spawnT));
    if (Number.isFinite(sel.dieT) && sel.dieT <= waveEnd) {
      const cause = sel.done ? 'reaches the hatch' : sel.kind === 'tank' ? 'destroyed' : 'leaves the field';
      row('Ends', fmtTime(sel.dieT) + ' · ' + cause);
    } else row('Ends', 'survives the window');
    const now = ps.t < sel.spawnT ? 'not spawned yet' : ps.t > sel.dieT ? 'gone' : isBot ? sel.state : 'active';
    row('At ' + fmtTime(ps.t), now);
    wrap.append(rows);
    if (isBot || sel.kind === 'tank') {
      wrap.append(el('button', {
        class: 'btn sm ac-follow' + (ps.follow ? ' on' : ''),
        text: ps.follow ? 'Following' : 'Follow', title: 'Keep the camera on this actor (F)',
        onclick: () => { ps.follow = !ps.follow; emit('map'); }
      }));
    }
    return wrap;
  }

  container.append(el('div', { class: 'mapview' }, approx, bar, canvasWrap));
  if (ps.optionsOpen) canvasWrap.append(buildOptionsPanel());
  const selNow = selectedActor();
  if (selNow) canvasWrap.append(buildActorCard(selNow));

  const ctx = canvas.getContext('2d');
  const worldKey = file.id + ':' + ps.mode + ':' + (geo ? 'g' : 'n') + ':' + (tex ? 't' : '');
  const world = buildWorldCanvas(worldKey, ps.mode, mapData, geo, tex);
  if (!world) {
    container.append(el('div', { class: 'empty-note', text: 'No drawable geometry or nav mesh for this map.' }));
    return;
  }
  let vs = viewStates.get(file.id);

  function fitScaleFor() {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    const bw = world.bounds[2] - world.bounds[0], bh = world.bounds[3] - world.bounds[1];
    return Math.min(w / (bw + 150), h / (bh + 150));
  }
  function fit() {
    const scale = fitScaleFor();
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

    const eraseTarget = ps.tool === 'kill' && ps.hover ? killPointAt(killPts, ps.hover[0], ps.hover[1]) : -1;
    killPts.forEach((k, ki) => {
      const [kx, ky] = toScreen(k[0], k[1]);
      const kr = killRadiusOf(k) * vs.scale;
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

    if (ps.tool === 'engineer') {
      for (const h of engineerNests) {
        const [nx, ny] = toScreen(h.origin[0], h.origin[1]);
        const nr = Math.max(5, 90 * vs.scale);
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(242,184,72,.16)';
        ctx.fill();
        ctx.strokeStyle = '#f2b848';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      if (ps.hover) {
        const [hx, hy] = toScreen(ps.hover[0], ps.hover[1]);
        const img = iconImage(classIconName('engineer'), scheduleDraw);
        const plate = 26;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = NORMAL_BG;
        ctx.beginPath();
        ctx.roundRect(hx - plate / 2, hy - plate / 2, plate, plate, 5);
        ctx.fill();
        ctx.strokeStyle = '#7fb8f0';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, hx - plate * 0.44, hy - plate * 0.44, plate * 0.875, plate * 0.875);
        ctx.globalAlpha = 1;
      }
    }

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

  function plateSize(a) {
    const base = a.kind === 'tank' ? 34 : a.kind === 'prop' ? 24 : a.bot.isBoss ? 34 : a.bot.isGiant ? 28 : 20;
    const zoom = Math.min(PLATE_ZOOM_MAX, Math.max(PLATE_ZOOM_MIN, (vs ? vs.scale : PLATE_REF_SCALE) / PLATE_REF_SCALE));
    return base * zoom;
  }

  function heightFrac(a, t) {
    if (!zSpan) return 0;
    return Math.max(0, Math.min(1, (actorZAt(a, t) - zLow) / zSpan));
  }

  function drawLift(sx, sy, plate, zf) {
    if (zf < 0.02) return;
    const off = zf * plate * LIFT_SHADOW;
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,11,' + (0.2 + zf * 0.4).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + off * 0.55, sy + off, plate * 0.5, plate * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStack(sx, sy, plate, r, n, fill) {
    const layers = Math.min(2, n - 1);
    for (let i = layers; i >= 1; i--) {
      const off = i * plate * 0.16;
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.45 - (i - 1) * 0.14;
      ctx.beginPath();
      ctx.roundRect(sx - plate / 2 - off, sy - plate / 2 - off, plate, plate, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.stroke();
    }
  }

  function stackScale(n) {
    return n > 1 ? 1 + Math.min(0.5, Math.log2(n) * 0.12) : 1;
  }

  function drawActor(a, t, sx, sy, zf, n) {
    const lift = (1 + (zf || 0) * LIFT_SCALE) * stackScale(n);
    if (a.kind === 'prop') {
      const s = plateSize(a) * lift;
      const red = a.prop.team === 2;
      drawLift(sx, sy, s, zf || 0);
      ctx.fillStyle = red ? '#7a3a34' : '#3a4a5a';
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sx - s / 2, sy - s / 2, s, s, 3);
      ctx.fill();
      ctx.stroke();
      const img = a.prop.icon ? iconImage(a.prop.icon, scheduleDraw) : null;
      if (img && img.complete && img.naturalWidth) {
        const is = s * 0.82;
        ctx.drawImage(img, sx - is / 2, sy - is / 2, is, is);
      } else {
        ctx.fillStyle = '#d9dbde';
        ctx.font = 'bold ' + (s * 0.5).toFixed(0) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((a.prop.label || 'E')[0].toUpperCase(), sx, sy + 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      return;
    }
    if (a.kind === 'tank') {
      const img = iconImage(tankIconName(a.tank), scheduleDraw) || iconImage('leaderboard_class_tank', scheduleDraw);
      const s = plateSize(a) * lift;
      const ang = actorHeading(a, t);
      drawLift(sx, sy, s, zf || 0);
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
    const plate = plateSize(a) * lift;
    const r = plate * 0.25;
    drawLift(sx, sy, plate, zf || 0);
    if (n > 1) drawStack(sx, sy, plate, r, n, bot.isGiant || bot.isBoss ? GIANT_BG : NORMAL_BG);
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

  let labelRects = [];

  function placeLabel(sx, sy, plate, w, h) {
    const r = plate * 0.3;
    const spots = [
      [sx + r, sy + r * 1.1],
      [sx - r - w, sy + r * 1.1],
      [sx + r, sy - r * 1.1 - h],
      [sx - r - w, sy - r * 1.1 - h],
      [sx - w / 2, sy + plate * 0.55]
    ];
    for (const [x, y] of spots) {
      let clash = false;
      for (const q of labelRects) {
        if (x < q[0] + q[2] && x + w > q[0] && y < q[1] + q[3] && y + h > q[1]) { clash = true; break; }
      }
      if (clash) continue;
      labelRects.push([x, y, w, h]);
      return [x, y];
    }
    return null;
  }

  function drawCount(sx, sy, plate, n) {
    const label = '×' + n;
    const fs = Math.max(8, Math.min(11, plate * 0.42));
    ctx.save();
    ctx.font = 'bold ' + fs.toFixed(1) + 'px sans-serif';
    const w = ctx.measureText(label).width + 5;
    const h = fs + 3;
    const spot = placeLabel(sx, sy, plate, w, h);
    if (!spot) { ctx.restore(); return; }
    const bx = spot[0], by = spot[1];
    ctx.fillStyle = 'rgba(12,15,19,.88)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e6e9ec';
    ctx.fillText(label, bx + 2.5, by + h - 3);
    ctx.restore();
  }

  function declutter(shown) {
    const n = shown.length;
    const mem = ps.declutter || (ps.declutter = new Map());
    for (const q of shown) {
      q.key = actorKey(q.a);
      const prev = mem.get(q.key);
      q.dx = prev ? prev.dx : 0;
      q.dy = prev ? prev.dy : 0;
      q.n = 1;
    }
    if (n < 2) { persistDeclutter(shown, mem); return shown; }
    const order = shown.map((q, i) => i).sort((i, j) =>
      shown[j].plate - shown[i].plate || shown[i].a.spawnT - shown[j].a.spawnT || i - j);
    const taken = new Array(n).fill(false);
    const groups = [];
    for (const i of order) {
      if (taken[i]) continue;
      taken[i] = true;
      const members = [shown[i]];
      const reach = shown[i].plate * CLUSTER_GAP;
      const leadKey = shown[i].key;
      for (const j of order) {
        if (taken[j]) continue;
        const dx = shown[i].sx - shown[j].sx, dy = shown[i].sy - shown[j].sy;
        const prev = mem.get(shown[j].key);
        const r = prev && prev.lead === leadKey ? reach * CLUSTER_HYST : reach;
        if (dx * dx + dy * dy >= r * r) continue;
        taken[j] = true;
        shown[j].lead = leadKey;
        members.push(shown[j]);
      }
      shown[i].lead = leadKey;
      groups.push(members);
    }
    const out = [];
    for (const members of groups) {
      if (members.length === 1) { out.push(members[0]); continue; }
      const plate = members.reduce((m, q) => Math.max(m, q.plate), 0);
      const capacity = Math.max(2, Math.floor(Math.PI * 2 * SPREAD_LIMIT));
      const wasStacked = mem.has(members[0].key) && mem.get(members[0].key).stacked;
      if (members.length > (wasStacked ? capacity - 1 : capacity)) {
        let cx = 0, cy = 0;
        for (const q of members) { cx += q.sx; cy += q.sy; }
        const lead = members[0];
        lead.sx = cx / members.length;
        lead.sy = cy / members.length;
        lead.n = members.length;
        lead.plate = plate;
        out.push(lead);
        continue;
      }
      for (const q of members) out.push(q);
    }
    spread(out);
    persistDeclutter(out, mem);
    out.sort((p, q) => p.zf - q.zf);
    return out;
  }

  function persistDeclutter(list, mem) {
    const seen = new Set();
    for (const q of list) {
      const prev = mem.get(q.key);
      if (prev) {
        q.dx = prev.dx + (q.dx - prev.dx) * DECLUTTER_EASE;
        q.dy = prev.dy + (q.dy - prev.dy) * DECLUTTER_EASE;
      }
      mem.set(q.key, { dx: q.dx, dy: q.dy, lead: q.lead || q.key, stacked: q.n > 1 });
      seen.add(q.key);
    }
    if (mem.size > seen.size) for (const k of [...mem.keys()]) if (!seen.has(k)) mem.delete(k);
  }

  function spread(list) {
    const size = q => q.plate * stackScale(q.n);
    for (let pass = 0; pass < SPREAD_PASSES; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i], q = list[j];
          const need = (size(p) + size(q)) / 2 * CLUSTER_GAP;
          let dx = p.sx + p.dx - (q.sx + q.dx), dy = p.sy + p.dy - (q.sy + q.dy);
          let d = Math.hypot(dx, dy);
          if (d >= need) continue;
          if (d < 0.01) {
            const ang = i * 2.399963 + j * 0.7;
            dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
          }
          const push = (need - d) / 2;
          p.dx += dx / d * push; p.dy += dy / d * push;
          q.dx -= dx / d * push; q.dy -= dy / d * push;
        }
      }
    }
    for (const q of list) {
      const d = Math.hypot(q.dx, q.dy);
      const cap = size(q) * SPREAD_LIMIT;
      if (d > cap) { q.dx *= cap / d; q.dy *= cap / d; }
      q.sx += q.dx;
      q.sy += q.dy;
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
    const sel = selectedActor();
    if (ps.follow && sel && t >= sel.spawnT && t <= sel.dieT) {
      const sp = actorPosAt(sel, t);
      if (sp) { vs.cx = sp[0]; vs.cy = sp[1]; }
    }
    if (ps.showRoute !== false && ai.route) {
      const bi = Math.max(0, Math.min(ai.bomb.samples.length - 1, Math.round(t / STEP)));
      drawRoute(ctx, ai.route, toScreen, t, routeProgress(ai.route, ai.bomb.samples[bi]));
    }
    let alive = 0;
    lastPositions = [];
    const visible = [];
    const pad = 40;
    for (const a of ai.actors) {
      if (t < a.spawnT || t > a.dieT) continue;
      const p = actorPosAt(a, t);
      if (!p) continue;
      alive++;
      const [sx, sy] = toScreen(p[0], p[1]);
      if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
      visible.push({ a, sx, sy, plate: plateSize(a), zf: heightFrac(a, t) });
    }
    visible.sort((p, q) => p.zf - q.zf);
    const shown = declutter(visible);
    lastPositions = shown;
    drawSquadLinks(shown);
    for (const q of shown) drawActor(q.a, t, q.sx, q.sy, q.zf, q.n);
    if (sel && t >= sel.spawnT && t <= sel.dieT) {
      const sp = actorPosAt(sel, t);
      if (sp) { const [rx, ry] = toScreen(sp[0], sp[1]); drawSelRing(rx, ry, plateSize(sel) * (1 + heightFrac(sel, t) * LIFT_SCALE)); }
    }
    labelRects = [];
    for (const q of shown) {
      if (q.n > 1) drawCount(q.sx, q.sy, q.plate * (1 + q.zf * LIFT_SCALE) * stackScale(q.n), q.n);
    }
    drawTeleporters(t);
    drawBomb(t);
    if (gateHud) gateHud.update(t);
    if (bombHud) bombHud.update(t);
    if (tankHud) tankHud.update(t);
    timeLbl.textContent = fmtTime(t) + ' / ' + fmtTime(waveEnd) + ' — ' + alive + ' active';
    const fs = fitScaleFor();
    if (fs) zoomLbl.textContent = Math.round(vs.scale / fs * 100) + '%';
    drawMini();
    updateWavePanel(t, alive, waveEnd);
  }

  function drawTeleporters(t) {
    for (const tp of ai.teleporters || []) {
      if (t < tp.readyAt) continue;
      const [sx, sy] = toScreen(tp.pos[0], tp.pos[1]);
      const r = Math.max(5, 42 * vs.scale);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(107,169,235,.22)';
      ctx.fill();
      ctx.strokeStyle = '#6ba9eb';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, r * 0.34), 0, Math.PI * 2);
      ctx.fillStyle = '#6ba9eb';
      ctx.fill();
    }
  }

  function drawSelRing(sx, sy, plate) {
    const r = plate * 0.72 + 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(124,196,255,.35)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#7cc4ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
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
    const peakA = Math.max(1, sim.peak.bots);
    const path = new Path2D();
    path.moveTo(0, mh);
    for (const p of sim.curve) {
      if (p.t > waveEnd) break;
      path.lineTo(p.t / waveEnd * mw, mh - 2 - (p.bots / peakA) * (mh - 6));
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

  function loop(prev) {
    ps.raf = 0;
    if (!canvas.isConnected || !ps.playing) { schedulePulse(); return; }
    const now = performance.now();
    const dt = prev ? (now - prev) / 1000 : 0;
    ps.t += dt * ps.speed;
    if (ps.t >= waveEnd) { ps.t = waveEnd; ps.playing = false; setPlayLabel(false); }
    drawFrame();
    if (ps.playing) ps.raf = requestAnimationFrame(() => loop(now));
    else schedulePulse();
  }

  function critOnScreen() {
    const t = ps.t;
    for (const a of ai.actors) {
      if (a.kind !== 'bot' || !a.bot.alwaysCrit) continue;
      if (t >= a.spawnT && t <= a.dieT) return true;
    }
    return false;
  }

  function schedulePulse() {
    clearTimeout(ps.pulse);
    ps.pulse = 0;
    if (ps.playing || !canvas.isConnected || !critOnScreen()) return;
    ps.pulse = setTimeout(() => {
      if (!canvas.isConnected || ps.playing) return;
      drawFrame();
      schedulePulse();
    }, 1000 / CRIT_FPS);
  }

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
    if (ps.tool === 'engineer' && e.button === 0) {
      e.preventDefault();
      const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      placeEngineer(wx, wy);
      return;
    }
    if (ps.tool === 'kill' && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const list = killPointsFor(mapData.map);
      const hit = killPointAt(list, wx, wy);
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
    dragging = { x: e.clientX, y: e.clientY, cx: vs.cx, cy: vs.cy, lx: e.clientX - rect.left, ly: e.clientY - rect.top, moved: false, followOff: false };
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
      if (!dragging.moved && Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y) > 4) {
        dragging.moved = true;
        if (ps.follow) { ps.follow = false; dragging.followOff = true; }
      }
      if (dragging.moved) {
        vs.cx = dragging.cx - (e.clientX - dragging.x) / vs.scale;
        vs.cy = dragging.cy + (e.clientY - dragging.y) / vs.scale;
        drawFrame();
      }
      return;
    }
    if (ps.tool === 'kill' || ps.tool === 'engineer') {
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
    let hit = null, bestD = 240;
    for (const lp of lastPositions) {
      const d = (lp.sx - mx) ** 2 + (lp.sy - my) ** 2;
      if (d < bestD) { bestD = d; hit = lp; }
    }
    if (hit) {
      const best = hit.a;
      const died = Number.isFinite(best.dieT) ? ' · dies ' + fmtTime(best.dieT) : '';
      const stacked = hit.n > 1 ? `\nstacked with ${hit.n - 1} more here` : '';
      const label = best.kind === 'tank'
        ? `Tank — ${best.tank.health} HP · ${best.tank.speed} HU/s${died}\nfrom "${best.ws.name || 'unnamed'}"${stacked}`
        : best.kind === 'prop'
        ? `${best.prop.label}${best.prop.health ? ' — ' + best.prop.health + ' HP' : ''} · ${best.prop.team === 2 ? 'red, stationary' : 'placed entity'}\nfrom "${best.ws.name || 'unnamed'}" · spawned ${fmtTime(best.spawnT)}${died}\n(movement not simulated)`
        : `${botDisplayName(best.bot)} — ${best.bot.health} HP · ${Math.round(botMaxSpeed(best.bot, false))} HU/s\n${best.state}${best.squadId ? ' · squad ' + best.squadRole : ''}\nfrom "${best.ws.name || 'unnamed'}" · spawned ${fmtTime(best.spawnT)}${died}${stacked}`;
      showTip(label, e.clientX, e.clientY);
    } else hideTip();
  }
  function onUp() {
    const d = dragging;
    dragging = null;
    if (paintingDown) {
      paintingDown = false;
      if (paintDirty) {
        paintDirty = false;
        savePaint(mapData.map);
        emit('map');
      }
      return;
    }
    if (!d) return;
    if (!d.moved) {
      let hit = null, bestD = 260;
      for (const lp of lastPositions) {
        const dd = (lp.sx - d.lx) ** 2 + (lp.sy - d.ly) ** 2;
        if (dd < bestD) { bestD = dd; hit = lp; }
      }
      const key = hit ? actorKey(hit.a) : null;
      if (key !== ps.selKey || (!key && ps.follow)) {
        ps.selKey = key;
        if (!key) ps.follow = false;
        emit('map');
      }
    } else if (d.followOff) {
      emit('map');
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
  else schedulePulse();
}
