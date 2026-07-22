import { findAll, getValue } from './kv.js';

const ESC = String.fromCharCode(27);
const PAUSE_INPUTS = new Set(['$pausewavespawn']);
const RESUME_INPUTS = new Set(['$resumewavespawn']);
const STOP_INPUTS = new Set(['$killwavespawn', '$finishwavespawn']);
const WAVE_START_KEYS = ['initwaveoutput', 'startwaveoutput'];
const WS_OUTPUT_KEYS = ['firstspawnoutput', 'lastspawnoutput', 'doneoutput', 'startwaveoutput'];
const BOOT_KEYS = new Set(['onmapspawn', 'onspawnoutput', 'onspawn']);
const EVENT_OUTPUT_KEYS = new Map([
  ['onkilledoutput', 'a bot dying'],
  ['onparentkilledoutput', 'its parent dying'],
  ['onbombdroppedoutput', 'the bomb being dropped'],
  ['missionunloadoutput', 'the mission unloading']
]);

export function eventOutputLabel(key) {
  return EVENT_OUTPUT_KEYS.get(String(key).toLowerCase()) || null;
}
const FIRES_RE = /^(trigger|enable|start|fire|forcespawn|triggerforalltargets|open)$/i;
const ENTFIRE_RE = /EntFire(?:ByHandle)?\s*\(\s*[`"']([^`"']+)[`"']\s*(?:,\s*[`"']([^`"']*)[`"'])?\s*(?:,\s*[`"']?([^`"',)]*)[`"']?)?\s*(?:,\s*([0-9.]+))?/gi;

export function wildcardMatch(pattern, name) {
  if (!pattern || !name) return false;
  const p = String(pattern).toLowerCase().trim();
  const n = String(name).toLowerCase().trim();
  if (p === n) return true;
  if (p.endsWith('*')) return n.startsWith(p.slice(0, -1));
  return false;
}

function parseOutputString(s) {
  if (typeof s !== 'string') return null;
  const parts = s.indexOf(ESC) >= 0 ? s.split(ESC) : s.split(',');
  if (parts.length < 2) return null;
  const delay = parseFloat(parts[3]);
  return {
    target: (parts[0] || '').trim(),
    input: (parts[1] || '').trim(),
    param: (parts[2] || '').trim(),
    delay: Number.isFinite(delay) ? delay : 0
  };
}

function entFiresFrom(text) {
  const out = [];
  if (typeof text !== 'string' || !/EntFire/i.test(text)) return out;
  ENTFIRE_RE.lastIndex = 0;
  let m;
  while ((m = ENTFIRE_RE.exec(text)) !== null) {
    const delay = parseFloat(m[4]);
    out.push({
      target: (m[1] || '').trim(),
      input: (m[2] || 'Trigger').trim(),
      param: (m[3] || '').trim(),
      delay: Number.isFinite(delay) ? delay : 0
    });
  }
  return out;
}

function expand(o) {
  const out = [o];
  if (/runscriptcode/i.test(o.input)) {
    for (const e of entFiresFrom(o.param)) out.push({ ...e, on: o.on, delay: o.delay + e.delay });
  }
  return out;
}

function outputsOfEntityBlock(block) {
  const out = [];
  for (const c of block.children || []) {
    if (c.type !== 'kv' || !/^on[a-z0-9_]*$/i.test(c.key)) continue;
    const parsed = parseOutputString(c.value);
    if (parsed) out.push(...expand({ ...parsed, on: c.key.toLowerCase() }));
  }
  return out;
}

function outputsOfPopBlock(block, on) {
  return expand({
    target: (getValue(block, 'Target', '') || '').trim(),
    input: (getValue(block, 'Action', 'Trigger') || '').trim(),
    param: (getValue(block, 'Param', '') || '').trim(),
    delay: parseFloat(getValue(block, 'Delay', '0')) || 0,
    on
  });
}

export function buildTriggerGraph(doc) {
  const graph = new Map();
  const boot = [];
  const events = [];
  const add = (name, outs) => {
    const k = String(name).toLowerCase();
    if (!graph.has(k)) graph.set(k, []);
    graph.get(k).push(...outs);
  };
  const walk = node => {
    for (const c of node.children || []) {
      if (c.type !== 'block') continue;
      const tn = getValue(c, 'targetname', null);
      if (tn) {
        const outs = outputsOfEntityBlock(c);
        if (outs.length) {
          add(tn, outs);
          for (const o of outs) if (BOOT_KEYS.has(o.on)) boot.push(o);
        }
      }
      if (/^onspawnoutput$/i.test(c.key)) boot.push(...outputsOfPopBlock(c, 'onspawnoutput'));
      const ck = c.key.toLowerCase();
      if (EVENT_OUTPUT_KEYS.has(ck)) {
        for (const o of outputsOfPopBlock(c, ck)) events.push({ ...o, event: ck });
      }
      walk(c);
    }
  };
  walk(doc);
  return { graph, boot, events };
}

function resolve(seeds, graph, sink) {
  const queue = seeds.map(s => ({ ...s, depth: 0 }));
  const seen = new Set();
  let guard = 0;
  while (queue.length && guard++ < 6000) {
    const cur = queue.shift();
    if (cur.depth > 12) continue;
    const key = `${cur.target}|${cur.input}|${cur.param}|${cur.depth}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sink(cur);
    if (!FIRES_RE.test(cur.input)) continue;
    const next = graph.get(String(cur.target).toLowerCase());
    if (!next) continue;
    for (const o of next) queue.push({ ...o, delay: cur.delay + o.delay, depth: cur.depth + 1, via: cur.target, event: cur.event });
  }
}

function seedsForWave(wave) {
  const seeds = [];
  for (const key of WAVE_START_KEYS) {
    for (const b of findAll(wave.node, key)) {
      if (b.type === 'block') seeds.push(...outputsOfPopBlock(b, key));
    }
  }
  return seeds;
}

export function analyzeWave(wave, tg) {
  const { graph, boot } = tg;
  const result = new Map();
  for (const ws of wave.wavespawns) {
    result.set(ws, {
      paused: false, pausedBy: null, resumedBy: [], stoppedBy: null,
      whereDisabled: null, enabledBy: [], eventEnabled: null, eventResumed: null
    });
  }

  const atStart = [];
  resolve([...boot, ...seedsForWave(wave)], graph, e => atStart.push(e));

  const disabledPoints = new Set();
  const enabledPoints = new Set();
  for (const e of atStart) {
    if (/^disable$/i.test(e.input) && e.target) disabledPoints.add(e.target);
    if (/^enable$/i.test(e.input) && e.target) enabledPoints.add(e.target);
    if (!/^pop_interface$/i.test(e.target)) continue;
    const input = (e.input || '').toLowerCase();
    if (!PAUSE_INPUTS.has(input) || !e.param) continue;
    for (const ws of wave.wavespawns) {
      if (ws.name && wildcardMatch(e.param, ws.name)) {
        const g = result.get(ws);
        g.paused = true;
        g.pausedBy = e.via || 'wave start';
      }
    }
  }

  for (const [entity, outs] of graph) {
    for (const o of outs) {
      const input = (o.input || '').toLowerCase();
      if (/^pop_interface$/i.test(o.target) && o.param) {
        for (const ws of wave.wavespawns) {
          if (!ws.name || !wildcardMatch(o.param, ws.name)) continue;
          const g = result.get(ws);
          if (RESUME_INPUTS.has(input) && !g.resumedBy.includes(entity)) g.resumedBy.push(entity);
          else if (STOP_INPUTS.has(input)) g.stoppedBy = entity;
        }
      }
      if (/^enable$/i.test(o.input) && o.target) {
        for (const ws of wave.wavespawns) {
          const g = result.get(ws);
          for (const w of ws.where || []) {
            if (wildcardMatch(o.target, w) && !g.enabledBy.includes(entity)) g.enabledBy.push(entity);
          }
        }
      }
    }
  }

  const atEvent = [];
  resolve(tg.events || [], graph, e => atEvent.push(e));
  for (const e of atEvent) {
    const input = (e.input || '').toLowerCase();
    const label = eventOutputLabel(e.event);
    if (!label) continue;
    if (/^enable$/i.test(input) && e.target) {
      for (const ws of wave.wavespawns) {
        const g = result.get(ws);
        if (g.eventEnabled) continue;
        for (const w of ws.where || []) {
          if (wildcardMatch(e.target, w)) { g.eventEnabled = { why: label, by: e.via || e.target }; break; }
        }
      }
    }
    if (/^pop_interface$/i.test(e.target) && e.param && RESUME_INPUTS.has(input)) {
      for (const ws of wave.wavespawns) {
        if (!ws.name || !wildcardMatch(e.param, ws.name)) continue;
        const g = result.get(ws);
        if (!g.eventResumed) g.eventResumed = { why: label, by: e.via || e.target };
      }
    }
  }

  for (const ws of wave.wavespawns) {
    const g = result.get(ws);
    for (const w of ws.where || []) {
      for (const pat of disabledPoints) {
        if (wildcardMatch(pat, w)) { g.whereDisabled = w; break; }
      }
      for (const pat of enabledPoints) {
        if (wildcardMatch(pat, w)) { g.enabledAtStart = true; break; }
      }
      if (g.whereDisabled) break;
    }
  }
  return result;
}

export function eventGate(g) {
  if (!g) return null;
  if (g.paused && g.eventResumed && !g.resumedBy.length) return g.eventResumed;
  if (g.whereDisabled && g.eventEnabled && !g.enabledAtStart) return g.eventEnabled;
  return null;
}

const NAV_TOGGLE_MAX_DELAY = 1;

export function navToggles(wave, tg) {
  const enabled = [];
  const disabled = [];
  const deferred = [];
  if (!tg) return { enabled, disabled, deferred };
  resolve([...tg.boot, ...seedsForWave(wave)], tg.graph, e => {
    if (!e.target) return;
    const on = /^enable$/i.test(e.input);
    if (!on && !/^disable$/i.test(e.input)) return;
    if (e.delay > NAV_TOGGLE_MAX_DELAY) {
      deferred.push({ target: e.target, input: on ? 'enable' : 'disable', delay: e.delay });
      return;
    }
    (on ? enabled : disabled).push(e.target);
  });
  return { enabled, disabled, deferred };
}

const OUTPUT_BLOCK_KEYS = new Set([...WS_OUTPUT_KEYS, 'initwaveoutput', 'onspawnoutput']);

export function popOutputTargets(doc) {
  const out = new Set();
  const walk = node => {
    for (const c of node.children || []) {
      if (c.type !== 'block') continue;
      if (OUTPUT_BLOCK_KEYS.has(c.key.toLowerCase())) {
        const t = (getValue(c, 'Target', '') || '').trim().toLowerCase();
        if (t) out.add(t);
      }
      walk(c);
    }
  };
  walk(doc);
  return out;
}

export function firesAny(tg, doc, names) {
  if (!names || !names.size) return false;
  for (const t of popOutputTargets(doc)) if (names.has(t)) return true;
  if (!tg) return false;
  for (const [, outs] of tg.graph) {
    for (const o of outs) if (names.has(String(o.target).toLowerCase())) return true;
  }
  for (const o of tg.boot) if (names.has(String(o.target).toLowerCase())) return true;
  return false;
}

export function isGated(g) {
  return !!(g && (g.paused || g.whereDisabled));
}
