import { el, clear, fmtNum, fmtTime, fmtCompact, compositionChips, botVisual, tankVisual, contextMenu, toast, showTip, hideTip, popover, closePopover } from './ui.js';
import { parse } from './kv.js';
import { state, activeFile, simFor, beginEdit, commitEdit, cancelEdit, emit, matchesSearch, gatingFor, wsTriggerTime, setWsTriggerTime } from './state.js';
import { setValue, getValue, findAll, cloneNode, removeNode, makeBlock, makeKV } from './kv.js';
import { CLASS_INFO, botDisplayName } from './popmodel.js';
import { native } from './native.js';
import { isGated } from './gating.js';
import { exportWavePng } from './exportpng.js';

const zoomMap = new Map();
const lastPps = new Map();
const scrollMap = new Map();
const GUTTER_MAX = 292;
const GUTTER_MIN = 200;
let GUTTER = GUTTER_MAX;

function computeGutter(container) {
  const avail = container.clientWidth || 1200;
  return Math.round(Math.max(GUTTER_MIN, Math.min(GUTTER_MAX, avail - 360)));
}

let dragGuideTime = null;
let suppressTips = false;

function rowHeight() {
  return isCompact() ? 44 : 60;
}

function isCompact() {
  return localStorage.getItem('popvis.compact') === '1';
}

const COLLAPSED_H = 24;

function rowKeysFor(wavespawns) {
  const seen = new Map();
  return wavespawns.map((ws, gi) => {
    if (ws.isLogic || !ws.name) return 'i:' + gi;
    const k = ws.name.toLowerCase();
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return n === 0 ? 'n:' + k : 'n:' + k + '#' + n;
  });
}

function collapsedSetFor(file, waveIndex) {
  try {
    const all = JSON.parse(localStorage.getItem('popvis.collapsed.' + file.name.toLowerCase()) || '{}');
    return new Set(all[waveIndex] || []);
  } catch { return new Set(); }
}

function saveCollapsedSet(file, waveIndex, set) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem('popvis.collapsed.' + file.name.toLowerCase()) || '{}') || {}; } catch {}
  if (set.size) all[waveIndex] = [...set];
  else delete all[waveIndex];
  localStorage.setItem('popvis.collapsed.' + file.name.toLowerCase(), JSON.stringify(all));
}

function toggleCollapse(file, waveIndex, key) {
  const set = collapsedSetFor(file, waveIndex);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  saveCollapsedSet(file, waveIndex, set);
  emit('timeline');
}

export function fitWave(file, waveIndex) {
  zoomMap.delete(file.id + ':' + waveIndex);
  emit('timeline');
}

function gateBadge(file, wave, ws) {
  const g = gatingFor(file, wave).get(ws);
  if (!isGated(g)) return null;
  const at = wsTriggerTime(file, wave, ws);
  const why = g.paused
    ? `Paused at wave start by "${g.pausedBy}" ($PauseWaveSpawn)`
    : `Spawn point "${g.whereDisabled}" is disabled at start`;
  const by = (g.paused ? g.resumedBy : g.enabledBy).filter(Boolean);
  const resume = by.length ? `\nRe-enabled by: ${by.join(', ')}` : '\nNo re-enable found in the popfile';
  const badge = el('span', {
    class: 'badge gated' + (at !== null ? ' forced' : ''),
    role: 'button', tabindex: 0, 'data-kbd': true,
    'data-popanchor': '1',
    title: why + resume + '\n\nThe real time depends on the players, so set it manually.\nClick to set the trigger time.',
    text: at !== null ? 'TRIGGER ' + fmtTime(at) : 'GATED',
    onclick: e => {
      e.stopPropagation();
      openTriggerPopover(badge, file, wave, ws, at);
    }
  });
  return badge;
}

function openTriggerPopover(anchor, file, wave, ws, current) {
  const input = el('input', {
    class: 'inp sm', type: 'number', min: 0, step: 1,
    value: current !== null ? Math.round(current) : '',
    placeholder: 'seconds'
  });
  const apply = () => {
    const v = parseFloat(input.value);
    setWsTriggerTime(file, wave, ws, Number.isFinite(v) ? v : null);
    closePopover();
    emit('timeline');
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    e.stopPropagation();
  });
  const body = el('div', { class: 'map-opts' },
    el('div', { class: 'pop-title', text: 'MANUAL TRIGGER' }),
    el('div', { class: 'wa-none', text: 'When do players open this gate?' }),
    el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: 'At' }), input,
      el('button', { class: 'btn sm', text: 'Set', onclick: apply })),
    el('div', { class: 'opt-row' },
      el('button', {
        class: 'btn sm', text: 'Never spawns',
        title: 'Leave it gated — it will not appear in the timeline or counts',
        onclick: () => { setWsTriggerTime(file, wave, ws, null); closePopover(); emit('timeline'); }
      })));
  popover(anchor, body);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

export function primaryColor(ws) {
  if (ws.isTank) return CLASS_INFO.tank.color;
  const first = ws.bots.find(b => b.bot);
  if (first) return (CLASS_INFO[first.bot.cls] || CLASS_INFO.unknown).color;
  return '#5b6470';
}

const spanOf = sim => Math.max(sim.waveEnd * 1.06 + 6, 30);

function memberColors(ws) {
  const colors = [];
  for (const b of ws.bots) {
    let c = null;
    if (b.bot) c = (CLASS_INFO[b.bot.cls] || CLASS_INFO.unknown).color;
    else if (b.tank) c = CLASS_INFO.tank.color;
    if (c && !colors.includes(c)) colors.push(c);
    if (colors.length >= 5) break;
  }
  return colors;
}

export function renderTimeline(container, file, waveIndex) {
  clear(container);
  GUTTER = computeGutter(container);
  container.style.setProperty('--gutter', GUTTER + 'px');
  container.style.setProperty('--rowh', rowHeight() + 'px');
  const wave = file.model.waves[waveIndex];
  if (!wave) {
    container.append(el('div', { class: 'empty-note', text: 'No such wave' }));
    return;
  }
  const sim = simFor(file, wave);
  const span = spanOf(sim);

  const zKey = file.id + ':' + waveIndex;
  let pps = zoomMap.get(zKey);
  const fitPps = Math.max(0.5, (container.clientWidth - GUTTER - 40) / span);
  if (!pps) pps = fitPps;
  lastPps.set(zKey, pps);

  container.append(buildHeader(container, file, wave, sim, waveIndex, () => {
    zoomMap.delete(zKey);
    renderTimeline(container, file, waveIndex);
  }));

  const scroll = el('div', { class: 'tl-scroll' });
  const innerW = GUTTER + span * pps + 60;
  const inner = el('div', { class: 'tl-inner', style: `width:${innerW}px` });
  scroll.append(inner);

  const ruler = buildRuler(span, pps, sim);
  inner.append(ruler);
  inner.append(buildActivity(span, pps, sim, wave));

  const collapsedSet = collapsedSetFor(file, waveIndex);
  const rowKeys = rowKeysFor(wave.wavespawns);
  const rowHeights = wave.wavespawns.map((ws, gi) => collapsedSet.has(rowKeys[gi]) ? COLLAPSED_H : rowHeight());
  const yCenters = [];
  let rowsTotalH = 0;
  for (const h of rowHeights) { yCenters.push(rowsTotalH + h / 2); rowsTotalH += h; }

  const rowsWrap = el('div', { class: 'tl-rows' });
  const yOfWs = new Map();
  wave.wavespawns.forEach((ws, gi) => {
    const row = buildRow(container, file, wave, waveIndex, ws, sim, pps, gi, collapsedSet.has(rowKeys[gi]), rowHeights[gi], rowKeys[gi]);
    yOfWs.set(ws, yCenters[gi]);
    rowsWrap.append(row);
  });
  inner.append(rowsWrap);

  if (!wave.wavespawns.length) {
    rowsWrap.append(el('div', { class: 'empty-note' },
      'This wave has no wavespawns yet. ',
      el('button', { class: 'btn primary', text: '+ Add WaveSpawn', onclick: () => addWaveSpawn(file, wave) })));
  }

  inner.append(buildArrows(file, wave, sim, pps, yOfWs, rowsTotalH));

  const sel = file.selection;
  if (sel && sel.type === 'wavespawn') {
    const selWs = wave.wavespawns.find(w => w.node.id === sel.nodeId);
    if (selWs) {
      const r = sim.results.get(selWs);
      if (r && r.events.length) {
        inner.append(el('div', { class: 'tl-guide', style: `left:${GUTTER + r.firstSpawn * pps}px` }));
        inner.append(el('div', { class: 'tl-guide', style: `left:${GUTTER + (r.barEnd != null ? r.barEnd : r.lastSpawn) * pps}px` }));
      }
    }
  }

  if (dragGuideTime !== null) {
    inner.append(el('div', { class: 'tl-snapguide', style: `left:${GUTTER + dragGuideTime * pps}px` }));
  }

  const cursor = el('div', { class: 'tl-cursor', style: 'display:none' });
  const cursorLabel = el('div', { class: 'tl-cursorlabel', style: 'display:none' });
  inner.append(cursor);
  ruler.append(cursorLabel);
  scroll.addEventListener('mousemove', e => {
    const rect = scroll.getBoundingClientRect();
    const x = e.clientX - rect.left + scroll.scrollLeft;
    const t = (x - GUTTER) / pps;
    if (t < 0 || t > span) { cursor.style.display = 'none'; cursorLabel.style.display = 'none'; return; }
    cursor.style.display = 'block';
    cursor.style.left = x + 'px';
    cursorLabel.style.display = 'block';
    cursorLabel.style.left = x + 'px';
    cursorLabel.textContent = fmtTime(t);
  });
  scroll.addEventListener('mouseleave', () => { cursor.style.display = 'none'; cursorLabel.style.display = 'none'; });

  const saved = scrollMap.get(zKey);
  scroll.addEventListener('scroll', () => scrollMap.set(zKey, { x: scroll.scrollLeft, y: scroll.scrollTop }));

  scroll.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = scroll.getBoundingClientRect();
    const mx = e.clientX - rect.left + scroll.scrollLeft - GUTTER;
    const tAtMouse = mx / pps;
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const next = Math.min(300, Math.max(fitPps * 0.4, pps * factor));
    zoomMap.set(zKey, next);
    renderTimeline(container, file, waveIndex);
    const newScroll = container.querySelector('.tl-scroll');
    if (newScroll) newScroll.scrollLeft = tAtMouse * next + GUTTER - (e.clientX - rect.left);
  }, { passive: false });

  container.append(scroll);
  if (saved) { scroll.scrollLeft = saved.x; scroll.scrollTop = saved.y; }
  container.append(buildInsights(file, wave, sim));
}

function buildHeader(container, file, wave, sim, waveIndex, refit) {
  const collapsedSet = collapsedSetFor(file, waveIndex);
  const headerKeys = rowKeysFor(wave.wavespawns);
  const anyExpanded = headerKeys.some(k => !collapsedSet.has(k));
  const viewGroup = el('div', { class: 'tb-group' });
  if (headerKeys.length > 1) {
    viewGroup.append(el('button', {
      class: 'btn', text: anyExpanded ? 'Collapse all' : 'Expand all',
      title: 'Collapse rows to thin strips (each row also has its own - / + button)',
      onclick: () => {
        const set = new Set();
        if (anyExpanded) headerKeys.forEach(k => set.add(k));
        saveCollapsedSet(file, waveIndex, set);
        emit('timeline');
      }
    }));
  }
  viewGroup.append(el('button', {
    class: 'btn' + (isCompact() ? ' on' : ''), text: 'Compact', title: 'Toggle compact rows',
    onclick: () => { localStorage.setItem('popvis.compact', isCompact() ? '0' : '1'); emit('timeline'); }
  }));

  const actions = el('div', { class: 'tl-actions' },
    el('button', { class: 'btn primary', text: '+ WaveSpawn', title: 'Add a wavespawn to this wave', onclick: () => addWaveSpawn(file, wave) }),
    viewGroup,
    el('button', {
      class: 'btn', text: 'Export', title: 'Export the entire wave graph as PNG',
      onclick: async ev => {
        const btn = ev.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          const dest = await exportWavePng(container, file, waveIndex);
          if (dest) toast('Wave exported', 'ok');
        } catch (err) {
          toast('Export failed: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      }
    }),
    el('div', { class: 'tb-group tl-zoom' },
      el('button', { class: 'icon-btn', text: '−', title: 'Zoom out (Ctrl+wheel)', onclick: () => zoomBy(file, waveIndex, 0.8) }),
      el('button', { class: 'icon-btn', text: 'Fit', title: 'Fit wave to view', onclick: refit }),
      el('button', { class: 'icon-btn', text: '+', title: 'Zoom in (Ctrl+wheel)', onclick: () => zoomBy(file, waveIndex, 1.25) })
    )
  );
  return el('div', { class: 'tl-header' },
    el('div', { class: 'tl-title' },
      el('span', { class: 'wave-num', text: 'Wave ' + (waveIndex + 1) }),
      el('span', { class: 'muted', text: `${wave.totalBots} bots` + (wave.supportBots ? ` +${wave.supportBots} support` : '') + (wave.tankCount ? ` · ${wave.tankCount} tank${wave.tankCount > 1 ? 's' : ''}` : '') }),
      el('span', { class: 'cash', text: '$' + wave.totalCurrency }),
      wave.totalHP > 0 ? el('span', { class: 'muted', title: 'Combined robot health (support excluded, RandomChoice averaged)', text: '≈' + fmtCompact(wave.totalHP) + ' HP' }) : null,
      el('span', { class: 'muted', text: '~' + fmtTime(sim.waveEnd) }),
      sim.peak.active > 0 ? el('span', { class: 'muted', title: 'Peak simultaneous robots (simulated) / mission RobotLimit', text: `peak ${sim.peak.active} @ ${fmtTime(sim.peak.t)} / ${sim.robotLimit}` }) : null
    ),
    actions);
}

export function scrollToTime(file, waveIndex, t) {
  const scroll = document.querySelector('.tl-scroll');
  if (!scroll) return;
  const zKey = file.id + ':' + waveIndex;
  const pps = zoomMap.get(zKey) || lastPps.get(zKey);
  if (!pps) return;
  scroll.scrollLeft = Math.max(0, GUTTER + t * pps - scroll.clientWidth / 2);
}

export function zoomBy(file, waveIndex, factor) {
  const zKey = file.id + ':' + waveIndex;
  const cur = zoomMap.get(zKey) || lastPps.get(zKey) || 4;
  zoomMap.set(zKey, Math.min(300, Math.max(0.2, cur * factor)));
  emit('timeline');
}

function buildRuler(span, pps, sim) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => s * pps >= 64) || 600;
  const ruler = el('div', { class: 'tl-ruler' });
  for (let t = 0; t <= span; t += step) {
    ruler.append(el('div', { class: 'tl-tick', style: `left:${GUTTER + t * pps}px` }, el('span', { text: fmtTime(t) })));
    const minor = step / 5;
    if (minor * pps > 9) {
      for (let m = t + minor; m < Math.min(t + step, span); m += minor) {
        ruler.append(el('div', { class: 'tl-tick minor', style: `left:${GUTTER + m * pps}px` }));
      }
    }
  }
  ruler.append(el('div', { class: 'tl-waveend', style: `left:${GUTTER + sim.waveEnd * pps}px`, title: 'Estimated wave end' }));
  return ruler;
}

function buildActivity(span, pps, sim, wave) {
  const H = 46;
  const wrap = el('div', { class: 'tl-activity', style: `padding-left:${GUTTER}px;height:${H + 14}px` });
  const w = Math.max(10, span * pps);
  const maxY = Math.max(sim.peak.active, 1);
  const pts = [];
  for (const p of sim.curve) {
    if (p.t > span) break;
    pts.push(`${(p.t * pps).toFixed(1)},${(H - p.active / maxY * (H - 4)).toFixed(1)}`);
  }
  const line = pts.join(' ');
  const lastT = sim.curve.length ? Math.min(span, sim.curve[sim.curve.length - 1].t) : 0;
  const area = `0,${H} ` + line + ` ${(lastT * pps).toFixed(1)},${H}`;

  let cashPts = '';
  const drops = [];
  let totalCash = 0;
  for (const ws of wave.wavespawns) {
    const r = sim.results.get(ws);
    if (!r || ws.totalCurrency <= 0 || ws.totalCount <= 0) continue;
    const perBot = ws.totalCurrency / ws.totalCount;
    for (const ev of r.events) drops.push([ev.t, perBot * ev.count]);
    totalCash += ws.totalCurrency;
  }
  if (drops.length) {
    drops.sort((a, b) => a[0] - b[0]);
    let cum = 0;
    const cpts = ['0,' + H];
    for (const [t, amt] of drops) {
      if (t > span) break;
      cpts.push(`${(t * pps).toFixed(1)},${(H - cum / totalCash * (H - 4)).toFixed(1)}`);
      cum += amt;
      cpts.push(`${(t * pps).toFixed(1)},${(H - cum / totalCash * (H - 4)).toFixed(1)}`);
    }
    const endX = (Math.min(span, drops[drops.length - 1][0]) * pps).toFixed(1);
    cpts.push(`${endX},${(H - cum / totalCash * (H - 4)).toFixed(1)}`);
    cashPts = cpts.join(' ');
  }

  const svg = svgEl('svg', { width: w, height: H, class: 'act-svg' },
    svgEl('polygon', { points: area, class: 'act-area' }),
    svgEl('polyline', { points: line, class: 'act-line' }),
    cashPts ? svgEl('polyline', { points: cashPts, class: 'cash-line' }) : null);
  wrap.append(el('div', { class: 'act-holder' }, svg));
  wrap.append(el('div', { class: 'act-legend' },
    el('span', { class: 'lg-item lg-bots' }, el('i'), el('span', { text: 'robots' })),
    cashPts ? el('span', {
      class: 'lg-item lg-cash',
      title: 'Currency released, by spawn time — when it drops depends on kill speed'
    }, el('i'), el('span', { text: 'money' })) : null));
  return wrap;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k === 'class' ? 'class' : k, v);
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

function barTooltip(file, ws, r, sim) {
  const wrap = el('div', { class: 'tip-body' });
  const head = el('div', { class: 'tip-head' });
  const first = ws.bots.find(b => b.bot);
  if (first) head.append(botVisual(first.bot, { size: 'lg' }));
  else if (ws.isTank) {
    const t = ws.bots.find(b => b.tank);
    if (t) head.append(tankVisual(t.tank, { size: 'lg' }));
  }
  head.append(el('div', {},
    el('div', { class: 'tip-title', text: ws.name || '(unnamed wavespawn)' }),
    el('div', { class: 'tip-sub', text: ws.bots.filter(b => b.bot).map(b => botDisplayName(b.bot)).slice(0, 3).join(', ') })));
  wrap.append(head);

  const rows = [
    ['Starts', fmtTime(r.start) + (r.gate > 0.01 ? ` (gate ${fmtTime(r.gate)} + ${fmtNum(ws.waitBeforeStarting)}s)` : '')],
    ['First → last spawn', `${fmtTime(r.firstSpawn)} → ${fmtTime(r.barEnd != null ? r.barEnd : r.lastSpawn)} (${fmtNum((r.barEnd != null ? r.barEnd : r.lastSpawn) - r.firstSpawn)}s)`],
    ['Pacing', `${r.batch || ws.spawnCount} per ${ws.waitBetweenSpawnsAfterDeath > 0 ? fmtNum(ws.waitBetweenSpawnsAfterDeath) + 's after death' : fmtNum(ws.waitBetweenSpawns) + 's'}, max ${ws.maxActive} active (sim only)`]
  ];
  if (ws.totalCurrency > 0) rows.push(['Currency', `$${ws.totalCurrency}` + (ws.totalCount > 0 ? ` (≈$${fmtNum(ws.totalCurrency / ws.totalCount, 2)}/bot)` : '')]);
  if (ws.waitForAllSpawned) rows.push(['After spawned', ws.waitForAllSpawned]);
  if (ws.waitForAllDead) rows.push(['After dead', ws.waitForAllDead]);
  if (r.blocked && !ws.support) rows.push(['Throttled', 'pacing limited by MaxActive']);
  const grid = el('div', { class: 'tip-grid' });
  for (const [k, v] of rows) {
    grid.append(el('span', { class: 'tip-k', text: k }), el('span', { class: 'tip-v', text: v }));
  }
  wrap.append(grid);
  wrap.append(el('div', { class: 'tip-hint', text: 'drag = retime · right edge = spacing · dot at the end = link dependency' }));
  return wrap;
}

function logicGlyph(ws) {
  if (ws.outputs.length && ws.sounds.length) return 'relay+snd';
  if (ws.outputs.length) return 'relay';
  if (ws.sounds.length) return 'sound';
  return 'timer';
}

function logicTooltip(ws, r) {
  const wrap = el('div', { class: 'tip-body' });
  wrap.append(el('div', { class: 'tip-head' },
    el('div', {},
      el('div', { class: 'tip-title', text: ws.name || '(unnamed logic wavespawn)' }),
      el('div', { class: 'tip-sub', text: logicGlyph(ws) + ' — no robots, used for timing / outputs' }))));
  const grid = el('div', { class: 'tip-grid' });
  grid.append(el('span', { class: 'tip-k', text: 'Fires at' }), el('span', { class: 'tip-v', text: fmtTime(r.start) + (r.gate > 0.01 ? ` (gate ${fmtTime(r.gate)} + ${fmtNum(ws.waitBeforeStarting)}s)` : '') }));
  for (const o of ws.outputs) grid.append(el('span', { class: 'tip-k', text: o.when }), el('span', { class: 'tip-v', text: `${o.target} → ${o.action}${o.param ? ' (' + o.param + ')' : ''}` }));
  for (const s of ws.sounds) grid.append(el('span', { class: 'tip-k', text: s.when }), el('span', { class: 'tip-v', text: s.value }));
  if (ws.waitForAllSpawned) grid.append(el('span', { class: 'tip-k', text: 'After spawned' }), el('span', { class: 'tip-v', text: ws.waitForAllSpawned }));
  if (ws.waitForAllDead) grid.append(el('span', { class: 'tip-k', text: 'After dead' }), el('span', { class: 'tip-v', text: ws.waitForAllDead }));
  wrap.append(grid);
  return wrap;
}

function buildRow(container, file, wave, waveIndex, ws, sim, pps, index, isCollapsed = false, rowH = null, rowKey = '') {
  const r = sim.results.get(ws);
  const color = ws.isLogic ? '#e0b45f' : primaryColor(ws);
  const selId = file.selection && file.selection.type === 'wavespawn' ? file.selection.nodeId : null;
  const selected = selId !== null && ws.node.id === selId;
  const dimmed = state.search && !matchesSearch(ws, state.search);

  const inMulti = file.multi && file.multi.has(ws.node.id);
  const gateInfo = gatingFor(file, wave).get(ws);
  const gatedOff = isGated(gateInfo) && wsTriggerTime(file, wave, ws) === null;
  const row = el('div', { class: 'tl-row' + (selected ? ' selected' : '') + (dimmed ? ' dimmed' : '') + (ws.isLogic ? ' row-logic' : '') + (inMulti ? ' multisel' : '') + (isCollapsed ? ' collapsed' : '') + (gatedOff ? ' gated-off' : ''), style: `--rowcolor:${color}` });
  if (rowH !== null) {
    row.style.height = rowH + 'px';
    row.style.setProperty('--rowh', rowH + 'px');
  }
  row.dataset.wsIndex = index;
  row.dataset.wsId = ws.node.id;
  row.dataset.wsIds = String(ws.node.id);

  const metaBits = [];
  if (ws.isLogic) {
    for (const o of ws.outputs.slice(0, 2)) metaBits.push('→ ' + o.target);
    if (ws.outputs.length > 2) metaBits.push('+' + (ws.outputs.length - 2));
    if (ws.sounds.length) metaBits.push(ws.sounds.length + ' sound' + (ws.sounds.length > 1 ? 's' : ''));
    if (!ws.outputs.length && !ws.sounds.length) metaBits.push('timer / chain anchor');
  } else {
    if (ws.support) metaBits.push(ws.support === 'unlimited' ? 'support ∞' : 'support (limited)');
    metaBits.push(`${ws.totalCount || 0}×`);
  }

  const nameSpan = el('span', { class: 'ws-name', text: ws.name || '(unnamed)', title: 'Double-click to rename' });
  nameSpan.addEventListener('dblclick', e => {
    e.stopPropagation();
    startRename(file, ws, nameSpan);
  });

  const collapseBtn = el('button', {
    class: 'row-collapse', text: isCollapsed ? '+' : '-',
    title: isCollapsed ? 'Expand row' : 'Collapse row',
    onclick: e => { e.stopPropagation(); toggleCollapse(file, waveIndex, rowKey); }
  });
  collapseBtn.addEventListener('mousedown', e => e.stopPropagation());

  const gutter = el('div', { class: 'tl-gutter' },
    el('div', { class: 'ws-drag', title: 'Drag to reorder', text: '⋮⋮' }),
    el('div', { class: 'ws-info' },
      el('div', { class: 'ws-line1' }, nameSpan,
        isCollapsed && ws.isLogic ? el('span', { class: 'badge logic', text: 'LOGIC' }) : null,
        !isCollapsed && ws.isLogic ? el('span', { class: 'badge logic', title: 'No robots — fires outputs / plays sounds / anchors WaitForAll chains', text: 'LOGIC' }) : null,
        !isCollapsed && ws.hasBoss ? el('span', { class: 'badge boss', text: 'BOSS' }) : null,
        !isCollapsed && ws.isTank ? el('span', { class: 'badge tank', text: 'TANK' }) : null,
        gateBadge(file, wave, ws)),
      isCollapsed ? null : el('div', { class: 'ws-line2' }, ws.isLogic ? el('span', { class: 'logic-glyph', text: logicGlyph(ws) }) : compositionChips(ws, 6, { size: isCompact() ? 'sm' : undefined })),
      isCollapsed || isCompact() ? null : el('div', { class: 'ws-line3', text: metaBits.join(' · ') })
    ),
    collapseBtn
  );

  const track = el('div', { class: 'tl-track' });
  const gateWait = () => {
    const g = gatewaitGeom(r, pps);
    if (!g) return null;
    return el('div', { class: 'bar-gatewait', style: `left:${GUTTER + g.a * pps}px;width:${(g.b - g.a) * pps}px` });
  };
  if (r && ws.isLogic) {
    const gw = gateWait();
    if (gw) track.append(gw);
    const marker = el('div', { class: 'logic-marker', style: `left:${GUTTER + r.start * pps - 7}px` });
    marker.addEventListener('mouseenter', e => { if (!suppressTips) showTip(logicTooltip(ws, r), e.clientX, e.clientY); });
    marker.addEventListener('mousemove', e => { if (!suppressTips) showTip(logicTooltip(ws, r), e.clientX, e.clientY); });
    marker.addEventListener('mouseleave', hideTip);
    track.append(marker);
    const labelBits = ws.outputs.slice(0, 1).map(o => '→ ' + o.target);
    if (!labelBits.length && ws.sounds.length) labelBits.push('sound');
    if (labelBits.length) track.append(el('div', { class: 'logic-label', style: `left:${GUTTER + r.start * pps + 12}px`, text: labelBits[0] }));
    attachBarDrag(container, marker, file, wave, waveIndex, ws, sim, pps);
    const linkDot = el('div', { class: 'bar-linkdot', title: 'Drag onto another row: it will wait for this one\n(hold Alt for WaitForAllDead)', style: `left:${GUTTER + r.start * pps + (labelBits.length ? 90 : 12)}px` });
    attachLinkDrag(container, linkDot, file, wave, waveIndex, ws, sim, pps);
    track.append(linkDot);
  } else if (r) {
    const gw = gateWait();
    if (gw) track.append(gw);

    const barStart = r.firstSpawn;
    const isInf = ws.support === 'unlimited';
    const anchorEnd = r.barEnd != null ? r.barEnd : r.lastSpawn;
    const cad = ws.waitBetweenSpawnsAfterDeath > 0 ? Math.max(0.05, ws.waitBetweenSpawnsAfterDeath) : Math.max(0.05, ws.waitBetweenSpawns);
    let ticks, visualEnd;
    if (isInf) {
      visualEnd = spanOf(sim);
      ticks = [];
      for (let t = barStart; t <= visualEnd + 0.01 && ticks.length < 4000; t += cad) ticks.push(t);
    } else {
      visualEnd = anchorEnd;
      ticks = r.tickTimes || r.events.map(e => e.t);
    }
    const spawnW = Math.max(4, (visualEnd - barStart) * pps);
    const groups = ticks.length;
    const bar = el('div', {
      class: 'bar' + (isInf ? ' bar-support' : '') + (ws.support === 'limited' ? ' bar-limited' : '')
        + (ws.spawner && ws.spawner.kind === 'random' ? ' bar-random' : '')
        + (ws.waitBetweenSpawnsAfterDeath > 0 ? ' bar-ad' : ''),
      style: `left:${GUTTER + barStart * pps}px;width:${spawnW}px`
    });
    const colors = memberColors(ws);
    if (colors.length > 1) {
      const stops = colors.map((c, i) => `color-mix(in srgb, ${c} 72%, #1c1c28) ${(i / colors.length * 100).toFixed(1)}% ${((i + 1) / colors.length * 100).toFixed(1)}%`);
      bar.style.background = `linear-gradient(180deg, ${stops.join(', ')})`;
    }
    if (groups > 1) {
      const nth = Math.ceil(groups / 160);
      ticks.forEach((t, i) => {
        if (i % nth) return;
        bar.append(el('div', { class: 'bar-tick', style: `left:${(t - barStart) * pps}px` }));
      });
    }
    if (groups > 1 && !isInf && ws.waitBetweenSpawnsAfterDeath <= 0) {
      bar.append(el('div', { class: 'bar-resize', title: 'Drag to change WaitBetweenSpawns' }));
    }
    const tipFor = () => barTooltip(file, ws, r, sim);
    bar.addEventListener('mouseenter', e => { if (!suppressTips) showTip(tipFor(), e.clientX, e.clientY); });
    bar.addEventListener('mousemove', e => { if (!suppressTips) showTip(tipFor(), e.clientX, e.clientY); });
    bar.addEventListener('mouseleave', hideTip);
    track.append(bar);

    const labelAt = isInf ? barStart : Math.max(anchorEnd, barStart);
    const totalCurrency = ws.totalCurrency > 0 ? ws.totalCurrency : 0;
    if (totalCurrency > 0) {
      track.append(el('div', { class: 'bar-cash', style: `left:${GUTTER + labelAt * pps + 8}px`, text: '$' + totalCurrency }));
    }

    const linkDot = el('div', { class: 'bar-linkdot', title: 'Drag onto another row: it will wait for this one\n(hold Alt for WaitForAllDead)', style: `left:${GUTTER + labelAt * pps + (totalCurrency > 0 ? 52 : 6)}px` });
    attachLinkDrag(container, linkDot, file, wave, waveIndex, ws, sim, pps);
    track.append(linkDot);

    attachBarDrag(container, bar, file, wave, waveIndex, ws, sim, pps);
  }

  row.append(gutter, track);
  const mainEl = track.querySelector('.bar, .logic-marker');
  if (mainEl) attachHoverDim(mainEl, row, ws, wave, sim);
  attachArrowHover(row, container, ws.node.id);
  row.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (!file.multi) file.multi = new Set();
    if (e.ctrlKey) {
      if (!file.multi.size && file.selection && file.selection.type === 'wavespawn' && file.selection.nodeId !== ws.node.id) {
        if (wave.wavespawns.some(w => w.node.id === file.selection.nodeId)) file.multi.add(file.selection.nodeId);
      }
      if (file.multi.has(ws.node.id)) file.multi.delete(ws.node.id);
      else file.multi.add(ws.node.id);
      file.selection = { type: 'wavespawn', nodeId: ws.node.id };
      emit('selection');
      return;
    }
    const hadForeignMulti = file.multi.size > 0 && !file.multi.has(ws.node.id);
    if (hadForeignMulti) file.multi.clear();
    const already = file.selection && file.selection.type === 'wavespawn' && file.selection.nodeId === ws.node.id;
    file.selection = { type: 'wavespawn', nodeId: ws.node.id };
    if (!already || hadForeignMulti) emit('selection');
    if (state.dock && state.dock.editor && native.isElectron && ws.node.line) {
      window.popnative.editorGoto(state.dock.editor, file.path, ws.node.line);
    }
  });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    selectWS(file, ws);
    wsContextMenu(e.clientX, e.clientY, file, wave, waveIndex, ws);
  });
  attachReorderDrag(gutter.querySelector('.ws-drag'), row, file, wave, ws);
  return row;
}

let dimTimer = null;

function attachHoverDim(barEl, row, ws, wave, sim) {
  barEl.addEventListener('mouseenter', () => {
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
      const r = sim.results.get(ws);
      const rowsWrap = row.parentElement;
      if (!r || !rowsWrap) return;
      const aStart = r.firstSpawn;
      const aEnd = Math.max(r.deathEnd, r.firstSpawn);
      const rows = [...rowsWrap.querySelectorAll('.tl-row')];
      wave.wavespawns.forEach((other, i) => {
        if (other === ws || !rows[i]) return;
        const or = sim.results.get(other);
        if (!or) return;
        const bStart = or.firstSpawn;
        const bEnd = Math.max(or.deathEnd, or.firstSpawn);
        const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
        rows[i].classList.toggle('faded', overlap < -0.5);
      });
    }, 350);
  });
  barEl.addEventListener('mouseleave', () => {
    clearTimeout(dimTimer);
    const rowsWrap = row.parentElement;
    if (rowsWrap) rowsWrap.querySelectorAll('.tl-row.faded').forEach(x => x.classList.remove('faded'));
  });
}

function attachArrowHover(row, container, wsId) {
  row.addEventListener('mouseenter', () => {
    container.querySelectorAll('.dep-arrow, .dep-dot').forEach(p => {
      if (p.dataset.src === String(wsId) || p.dataset.dst === String(wsId)) p.classList.add('hov');
    });
  });
  row.addEventListener('mouseleave', () => {
    container.querySelectorAll('.dep-arrow.hov, .dep-dot.hov').forEach(p => p.classList.remove('hov'));
  });
}

function selectWS(file, ws) {
  const already = file.selection && file.selection.type === 'wavespawn' && file.selection.nodeId === ws.node.id;
  if (already) return;
  file.selection = { type: 'wavespawn', nodeId: ws.node.id };
  emit('selection');
}

function startRename(file, ws, span) {
  const input = el('input', { class: 'inp inline-rename', value: ws.name || '' });
  span.replaceWith(input);
  input.focus();
  input.select();
  const done = (apply) => {
    if (apply) {
      beginEdit(file);
      setValue(ws.node, 'Name', input.value.trim() || null);
      commitEdit(file);
    } else emit();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => done(true));
}

function snapCandidates(wave, sim, exclude) {
  const c = [0];
  for (const other of wave.wavespawns) {
    if (other === exclude) continue;
    const or = sim.results.get(other);
    if (!or || !or.events.length) continue;
    c.push(or.firstSpawn, or.barEnd != null ? or.barEnd : or.lastSpawn, or.deathEnd);
  }
  return c;
}

function trackDrag({ onMove, onEnd }) {
  const move = ev => onMove(ev);
  const finish = cancelled => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    removeEventListener('blur', blur);
    removeEventListener('keydown', key, true);
    onEnd(cancelled);
  };
  const up = () => finish(false);
  const blur = () => finish(false);
  const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(true); } };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
  addEventListener('blur', blur);
  addEventListener('keydown', key, true);
}

function attachBarDrag(container, bar, file, wave, waveIndex, ws, sim, pps) {
  bar.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('bar-resize')) { attachResize(container, e, file, wave, waveIndex, ws, sim, pps); return; }
    if (e.target.classList.contains('bar-linkdot')) return;
    e.stopPropagation();
    selectWS(file, ws);
    let host = container.isConnected ? container : (document.querySelector('.tl-container') || container);
    hideTip();
    const startX = e.clientX;
    const orig = ws.waitBeforeStarting;
    const r = sim.results.get(ws);
    const gate = r ? r.gate : 0;
    const candidates = snapCandidates(wave, sim, ws);
    const group = file.multi && file.multi.size > 1 && file.multi.has(ws.node.id)
      ? wave.wavespawns.filter(w => file.multi.has(w.node.id))
      : [ws];
    const groupOrigs = group.map(w => w.waitBeforeStarting);
    let began = false;
    let lastVal = orig;
    const onMove = ev => {
      const deltaT = (ev.clientX - startX) / pps;
      if (!began && Math.abs(ev.clientX - startX) < 3) return;
      if (!began) { beginEdit(file); began = true; suppressTips = true; hideTip(); }
      const snap = ev.altKey ? 0.1 : 0.5;
      let val = Math.max(0, orig + deltaT);
      val = Math.round(val / snap) * snap;
      dragGuideTime = null;
      if (!ev.shiftKey && group.length === 1) {
        const proposed = gate + val;
        let best = null, bestDist = 8 / pps;
        for (const c of candidates) {
          const d = Math.abs(proposed - c);
          if (d < bestDist && c - gate >= 0) { best = c; bestDist = d; }
        }
        if (best !== null) { val = best - gate; dragGuideTime = best; }
      }
      val = Math.round(val * 100) / 100;
      if (val === lastVal) return;
      lastVal = val;
      const delta = val - orig;
      group.forEach((w, i) => {
        const nv = Math.round(Math.max(0, groupOrigs[i] + delta) * 100) / 100;
        setValue(w.node, 'WaitBeforeStarting', nv);
        w.waitBeforeStarting = nv;
      });
      file.simCache.delete(wave);
      if (!host.isConnected) host = document.querySelector('.tl-container') || host;
      renderTimeline(host, file, waveIndex);
    };
    const onEnd = cancelled => {
      dragGuideTime = null;
      suppressTips = false;
      if (cancelled) { if (began) cancelEdit(file); return; }
      if (began) {
        commitEdit(file);
        toast(group.length > 1 ? `Moved ${group.length} wavespawns together` : `WaitBeforeStarting → ${fmtNum(lastVal)}s`);
      }
    };
    trackDrag({ onMove, onEnd });
  });
}

function attachResize(container, e, file, wave, waveIndex, ws, sim, pps) {
  e.stopPropagation();
  e.preventDefault();
  hideTip();
  const r = sim.results.get(ws);
  if (!r || r.events.length < 2) return;
  const groups = r.events.length;
  const orig = ws.waitBetweenSpawns;
  let began = false;
  let lastVal = orig;
  const onMove = ev => {
    const scroll = container.querySelector('.tl-scroll');
    const rect = scroll.getBoundingClientRect();
    const t = (ev.clientX - rect.left + scroll.scrollLeft - GUTTER) / pps;
    const snap = ev.altKey ? 0.1 : 0.5;
    let wbs = (t - r.firstSpawn) / (groups - 1);
    wbs = Math.max(0.1, Math.round(wbs / snap) * snap);
    wbs = Math.round(wbs * 100) / 100;
    if (wbs === lastVal) return;
    if (!began) { beginEdit(file); began = true; suppressTips = true; }
    lastVal = wbs;
    setValue(ws.node, 'WaitBetweenSpawns', wbs);
    ws.waitBetweenSpawns = wbs;
    file.simCache.delete(wave);
    renderTimeline(container, file, waveIndex);
    showTip(`WaitBetweenSpawns: ${fmtNum(wbs)}s`, ev.clientX, ev.clientY - 40);
  };
  const onEnd = cancelled => {
    hideTip();
    suppressTips = false;
    if (cancelled) { if (began) cancelEdit(file); return; }
    if (began) {
      commitEdit(file);
      toast(`WaitBetweenSpawns → ${fmtNum(lastVal)}s`);
    }
  };
  trackDrag({ onMove, onEnd });
}

function attachLinkDrag(container, dot, file, wave, waveIndex, ws, sim, pps) {
  dot.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    hideTip();
    suppressTips = true;
    const scroll = container.querySelector('.tl-scroll');
    const inner = scroll.querySelector('.tl-inner');
    const svgNS = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(svgNS, 'svg');
    overlay.setAttribute('class', 'tl-linkoverlay');
    const path = document.createElementNS(svgNS, 'path');
    overlay.append(path);
    inner.append(overlay);
    const rowsWrap = inner.querySelector('.tl-rows');
    const rows = [...rowsWrap.querySelectorAll('.tl-row')];
    const startRect = dot.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const x1 = startRect.left - scrollRect.left + scroll.scrollLeft + 5;
    const y1 = startRect.top - scrollRect.top + scroll.scrollTop;
    let targetIdx = -1;
    let isDead = false;
    const move = ev => {
      isDead = ev.altKey;
      const x2 = ev.clientX - scrollRect.left + scroll.scrollLeft;
      const y2 = ev.clientY - scrollRect.top + scroll.scrollTop;
      path.setAttribute('d', `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', isDead ? 'linkline dead' : 'linkline spawned');
      const idx = rows.findIndex(rw => {
        const rr = rw.getBoundingClientRect();
        return ev.clientY >= rr.top && ev.clientY < rr.bottom;
      });
      if (idx !== targetIdx) {
        rows.forEach(rw => rw.classList.remove('link-target'));
        targetIdx = idx;
        if (idx >= 0 && idx < rows.length && wave.wavespawns[idx] !== ws) rows[idx].classList.add('link-target');
      }
      showTip(isDead ? 'release: WaitForAllDead (Alt held)' : 'release: WaitForAllSpawned (Alt = dead)', ev.clientX, ev.clientY - 44);
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      overlay.remove();
      hideTip();
      suppressTips = false;
      rows.forEach(rw => rw.classList.remove('link-target'));
      if (targetIdx >= 0 && targetIdx < wave.wavespawns.length) {
        const target = wave.wavespawns[targetIdx];
        if (target !== ws) {
          beginEdit(file);
          let name = ws.name;
          if (!name) {
            const used = new Set(wave.wavespawns.map(w => (w.name || '').toLowerCase()));
            let n = 1;
            do { name = `w${waveIndex + 1}_${String.fromCharCode(96 + n)}`; n++; } while (used.has(name.toLowerCase()));
            setValue(ws.node, 'Name', name);
          }
          setValue(target.node, isDead ? 'WaitForAllDead' : 'WaitForAllSpawned', name);
          commitEdit(file);
          toast(`"${target.name || 'wavespawn'}" now waits for ${isDead ? 'death of' : 'spawn of'} "${name}"`);
        }
      }
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
}

function attachReorderDrag(handle, row, file, wave, ws) {
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rowsWrap = row.parentElement;
    const rows = [...rowsWrap.querySelectorAll('.tl-row')];
    const startIdx = rows.indexOf(row);
    let curIdx = startIdx;
    row.classList.add('reordering');
    const move = ev => {
      const y = ev.clientY;
      let target = curIdx;
      rows.forEach((rw, i) => {
        const rect = rw.getBoundingClientRect();
        if (y > rect.top + rect.height / 2) target = i;
        if (i === 0 && y < rect.top + rect.height / 2) target = 0;
      });
      if (target !== curIdx) {
        curIdx = target;
        rows.forEach(rw => rw.classList.remove('drop-above'));
        if (rows[curIdx]) rows[curIdx].classList.add('drop-above');
      }
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      row.classList.remove('reordering');
      rows.forEach(rw => rw.classList.remove('drop-above'));
      if (curIdx !== startIdx) {
        beginEdit(file);
        const parent = wave.node;
        const wsNodes = findAll(parent, 'WaveSpawn');
        const nodeToMove = wsNodes[startIdx];
        const targetNode = wsNodes[curIdx];
        removeNode(parent, nodeToMove);
        const newIdx = parent.children.indexOf(targetNode);
        parent.children.splice(curIdx > startIdx ? newIdx + 1 : newIdx, 0, nodeToMove);
        commitEdit(file);
      }
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
}

function gatewaitGeom(r, pps) {
  if (!r || r.gate <= 0.01) return null;
  const end = Math.max(r.start, r.firstSpawn);
  if ((end - r.gate) * pps < 1) return null;
  return { a: r.gate, b: end };
}

function buildArrows(file, wave, sim, pps, yOfWs, rowsTotalH) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const yOf = w => yOfWs.get(w) || 0;
  const selId = file.selection && file.selection.type === 'wavespawn' ? file.selection.nodeId : null;
  let count = 0;
  for (const ws of wave.wavespawns) {
    const r = sim.results.get(ws);
    if (!r) continue;
    for (const kind of ['spawned', 'dead']) {
      for (const src of r.deps[kind]) {
        const sr = sim.results.get(src);
        if (!sr) continue;
        count++;
        const hot = selId !== null && (ws.node.id === selId || src.node.id === selId);
        const srcT = src.support === 'unlimited' ? sr.firstSpawn : Math.max(sr.barEnd != null ? sr.barEnd : sr.lastSpawn, sr.firstSpawn);
        const x1 = GUTTER + srcT * pps;
        const y1 = yOf(src);
        const g = gatewaitGeom(r, pps);
        const blockX = ws.isLogic ? r.start * pps - 7 : r.firstSpawn * pps;
        const x2 = GUTTER + (g ? g.a * pps : blockX);
        const y2 = yOf(ws);
        const path = document.createElementNS(svgNS, 'path');
        const midX = (x1 + x2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', 'dep-arrow ' + kind + (hot ? ' hot' : ''));
        path.dataset.src = src.node.id;
        path.dataset.dst = ws.node.id;
        path.addEventListener('click', e => {
          e.stopPropagation();
          depMenu(e.clientX, e.clientY, file, ws, src, kind);
        });
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = (kind === 'spawned' ? `waits until "${src.name}" finishes spawning` : `waits until "${src.name}" is dead`) + ' — click to edit';
        path.append(title);
        svg.append(path);
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', x2);
        dot.setAttribute('cy', y2);
        dot.setAttribute('r', 3.4);
        dot.setAttribute('class', 'dep-dot ' + kind + (hot ? ' hot' : ''));
        dot.dataset.src = src.node.id;
        dot.dataset.dst = ws.node.id;
        svg.append(dot);
      }
    }
  }
  svg.setAttribute('class', 'tl-arrowlayer' + (count > 8 ? ' calm' : ''));
  svg.setAttribute('style', `top:${86}px;height:${Math.ceil(rowsTotalH)}px`);
  return svg;
}

function depMenu(x, y, file, ws, src, kind) {
  contextMenu(x, y, [
    {
      label: kind === 'spawned' ? 'Switch to WaitForAllDead' : 'Switch to WaitForAllSpawned',
      action: () => {
        beginEdit(file);
        setValue(ws.node, kind === 'spawned' ? 'WaitForAllSpawned' : 'WaitForAllDead', null);
        setValue(ws.node, kind === 'spawned' ? 'WaitForAllDead' : 'WaitForAllSpawned', src.name);
        commitEdit(file);
      }
    },
    {
      label: 'Remove dependency', danger: true,
      action: () => {
        beginEdit(file);
        setValue(ws.node, kind === 'spawned' ? 'WaitForAllSpawned' : 'WaitForAllDead', null);
        commitEdit(file);
      }
    }
  ]);
}

function buildInsights(file, wave, sim) {
  const facts = [];
  const fact = (label, value, title) => facts.push(el('span', { class: 'insight-fact', title: title || '' },
    el('span', { class: 'insight-k', text: label }),
    el('span', { class: 'insight-v', text: value })));
  const peak = sim.peak;
  if (peak.active > 0) {
    const contributors = [];
    for (const ws of wave.wavespawns) {
      const r = sim.results.get(ws);
      if (!r) continue;
      const active = r.events.some(ev => ev.t <= peak.t && peak.t <= ev.t + r.life);
      if (active) contributors.push(ws.name || (ws.bots[0] && ws.bots[0].bot ? ws.bots[0].bot.cls : 'ws'));
    }
    fact('Peak robots', `${peak.active} @ ${fmtTime(peak.t)}`, contributors.join(', '));
  }
  const supports = wave.wavespawns.filter(w => w.support === 'unlimited');
  if (supports.length) fact('Endless support', String(supports.length), supports.map(w => w.name || 'unnamed').join(', '));
  const logic = wave.wavespawns.filter(w => w.isLogic);
  if (logic.length) fact('Logic entries', String(logic.length), 'Outputs, sounds and timing anchors without robots');
  if (!facts.length) return el('div', { class: 'tl-insights empty' });
  return el('div', { class: 'tl-insights' }, facts);
}

export function applySelectionClasses(scope, file) {
  if (!scope) return;
  const selId = file && file.selection && file.selection.type === 'wavespawn' ? String(file.selection.nodeId) : null;
  scope.querySelectorAll('.tl-row').forEach(row => {
    const ids = (row.dataset.wsIds || row.dataset.wsId || '').split(',');
    row.classList.toggle('selected', selId !== null && ids.includes(selId));
    row.classList.toggle('multisel', !!(file && file.multi && ids.some(id => file.multi.has(parseInt(id, 10)))));
  });
}

export async function pasteWS(file, wave) {
  let text;
  try { text = await navigator.clipboard.readText(); } catch { toast('Clipboard unavailable', 'error'); return; }
  let doc;
  try { doc = parse(text); } catch (e) { toast('Clipboard is not valid popfile KV: ' + e.message, 'error'); return; }
  const blocks = doc.children.filter(n => n.type === 'block' && n.key.toLowerCase() === 'wavespawn');
  if (!blocks.length) { toast('No WaveSpawn block in clipboard', 'error'); return; }
  beginEdit(file);
  for (const b of blocks) wave.node.children.push(b);
  file.selection = { type: 'wavespawn', nodeId: blocks[blocks.length - 1].id };
  commitEdit(file);
  toast(`Pasted ${blocks.length} wavespawn${blocks.length > 1 ? 's' : ''}`);
}

function allWSNames(model) {
  const names = new Set();
  for (const w of model.waves) {
    for (const s of w.wavespawns) {
      if (s.name) names.add(s.name.toLowerCase());
    }
  }
  return names;
}

function nextNewName(model) {
  let max = 0;
  for (const n of allWSNames(model)) {
    const m = n.match(/^new_(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'new_' + (max + 1);
}

function uniqueCopyName(model, base) {
  const names = allWSNames(model);
  let cand = base + '_copy';
  let i = 2;
  while (names.has(cand.toLowerCase())) cand = base + '_copy' + i++;
  return cand;
}

export function addWaveSpawn(file, wave, preset = null) {
  beginEdit(file);
  const ws = makeBlock('WaveSpawn');
  const wherePool = [...file.model.spawnPoints];
  ws.children.push(
    makeKV('Name', nextNewName(file.model)),
    makeKV('Where', wherePool[0] || 'spawnbot'),
    makeKV('TotalCount', 10),
    makeKV('MaxActive', 5),
    makeKV('SpawnCount', 2),
    makeKV('WaitBeforeStarting', 0),
    makeKV('WaitBetweenSpawns', 6),
    makeKV('TotalCurrency', 100)
  );
  const bot = makeBlock('TFBot');
  if (preset && preset.template) bot.children.push(makeKV('Template', preset.template));
  else {
    bot.children.push(makeKV('Class', preset && preset.cls ? preset.cls : 'Scout'));
    bot.children.push(makeKV('Skill', 'Normal'));
  }
  ws.children.push(bot);
  wave.node.children.push(ws);
  file.selection = { type: 'wavespawn', nodeId: ws.id };
  commitEdit(file);
}

function wsContextMenu(x, y, file, wave, waveIndex, ws) {
  const model = file.model;
  contextMenu(x, y, [
    { label: 'Duplicate', action: () => duplicateWS(file, wave, ws) },
    { label: ws.support ? 'Remove Support flag' : 'Make Support (endless)', action: () => toggleSupport(file, ws) },
    '-',
    ...model.waves.filter(w => w !== wave).map(w => ({
      label: `Move to Wave ${w.index + 1}`,
      action: () => moveWS(file, wave, w, ws)
    })),
    '-',
    { label: 'Copy block to clipboard', action: () => copyWS(ws) },
    { label: 'Paste wavespawn(s) from clipboard', action: () => pasteWS(file, wave) },
    { label: 'Delete', danger: true, action: () => deleteWS(file, wave, ws) }
  ]);
}

export function duplicateWS(file, wave, ws) {
  beginEdit(file);
  const copy = cloneNode(ws.node);
  const idx = wave.node.children.indexOf(ws.node);
  wave.node.children.splice(idx + 1, 0, copy);
  const nameKV = copy.children.find(c => c.type === 'kv' && c.key.toLowerCase() === 'name');
  if (nameKV) nameKV.value = uniqueCopyName(file.model, nameKV.value);
  file.selection = { type: 'wavespawn', nodeId: copy.id };
  commitEdit(file);
}

export function deleteWS(file, wave, ws) {
  beginEdit(file);
  removeNode(wave.node, ws.node);
  file.selection = null;
  commitEdit(file);
}

function toggleSupport(file, ws) {
  beginEdit(file);
  setValue(ws.node, 'Support', ws.support ? null : '1');
  commitEdit(file);
}

function moveWS(file, fromWave, toWave, ws) {
  beginEdit(file);
  removeNode(fromWave.node, ws.node);
  toWave.node.children.push(ws.node);
  file.selection = { type: 'wavespawn', nodeId: ws.node.id };
  if (state.view.mode === 'wave' || state.view.mode === 'map') state.view = { mode: state.view.mode, wave: toWave.index };
  commitEdit(file);
}

async function copyWS(ws) {
  const { serialize } = await import('./kv.js');
  const text = serialize({ bases: [], children: [ws.node], tail: [] });
  try {
    await navigator.clipboard.writeText(text);
    toast('WaveSpawn copied to clipboard');
  } catch {
    toast('Clipboard unavailable', 'error');
  }
}
