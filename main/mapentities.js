import { doorRecord } from '../shared/bsp.js';

const OUTPUT_ESC = String.fromCharCode(27);

function splitOutput(value) {
  return value.includes(OUTPUT_ESC) ? value.split(OUTPUT_ESC) : value.split(',');
}

export function entityOutputs(ents) {
  const graph = new Map();
  for (const en of ents) {
    const name = (en.targetname || '').toLowerCase();
    if (!name || !en.outputs) continue;
    if (!graph.has(name)) graph.set(name, []);
    const list = graph.get(name);
    for (const o of en.outputs) {
      const parts = splitOutput(o.value);
      const delay = parseFloat(parts[3]);
      list.push({ on: o.key, target: (parts[0] || '').toLowerCase(), input: (parts[1] || '').toLowerCase(), param: parts[2] || '', delay: Number.isFinite(delay) ? delay : 0 });
    }
  }
  return graph;
}

const PROP_CLASSES = new Set(['prop_dynamic', 'prop_dynamic_override', 'prop_physics', 'prop_physics_override', 'prop_physics_multiplayer', 'func_brush', 'func_breakable']);
const PROP_EFFECT = {
  kill: 'kill', break: 'kill', shatter: 'kill', breakprop: 'kill',
  disable: 'kill', hide: 'kill',
  enable: 'show', show: 'show',
  setanimation: 'anim', skin: 'skin'
};
const CHAIN_INPUTS = new Set(['trigger', 'fireuser1', 'fireuser2', 'fireuser3', 'fireuser4', 'enable', 'toggle', 'start']);
const BREAK_MAX_DEPTH = 6;
const PARTICLE_CLASS = 'info_particle_system';
const PARTICLE_EFFECT = { start: 'burst', stop: 'burstoff' };

export function buildBreakables(ents) {
  const graph = entityOutputs(ents);
  const classOf = new Map();
  for (const en of ents) {
    const n = (en.targetname || '').toLowerCase();
    if (n && !classOf.has(n)) classOf.set(n, en.classname);
  }
  const out = [];
  for (const en of ents) {
    if (en.classname !== 'path_track') continue;
    const node = (en.targetname || '').toLowerCase();
    if (!node) continue;
    const queue = [];
    for (const o of graph.get(node) || []) {
      if (String(o.on).toLowerCase() !== 'onpass') continue;
      queue.push({ o, delay: o.delay, depth: 0 });
    }
    const seen = new Set();
    while (queue.length) {
      const { o, delay, depth } = queue.shift();
      const key = o.target + '|' + o.input + '|' + o.param + '|' + delay.toFixed(3);
      if (seen.has(key) || depth > BREAK_MAX_DEPTH) continue;
      seen.add(key);
      const cls = classOf.get(o.target);
      const effect = PROP_EFFECT[o.input];
      if (effect && PROP_CLASSES.has(cls)) {
        out.push({ node, target: o.target, effect, param: o.param || '', delay });
        continue;
      }
      const burst = PARTICLE_EFFECT[o.input];
      if (burst && cls === PARTICLE_CLASS) {
        out.push({ node, target: o.target, effect: burst, param: o.param || '', delay });
        continue;
      }
      if (!CHAIN_INPUTS.has(o.input)) continue;
      for (const next of graph.get(o.target) || []) {
        queue.push({ o: next, delay: delay + next.delay, depth: depth + 1 });
      }
    }
  }
  return out;
}

export function resolveToggles(graph, seed, volumeNames) {
  const enable = new Set();
  const disable = new Set();
  const queue = [{ name: seed, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (cur.depth > 8 || seen.has(cur.name)) continue;
    seen.add(cur.name);
    for (const o of graph.get(cur.name) || []) {
      if (!o.target) continue;
      if (volumeNames.has(o.target)) {
        if (o.input === 'enable') enable.add(o.target);
        else if (o.input === 'disable') disable.add(o.target);
        continue;
      }
      if (o.input === 'trigger') queue.push({ name: o.target, depth: cur.depth + 1 });
    }
  }
  return { enable: [...enable], disable: [...disable] };
}

export function resolveTogglesTimed(graph, seed, names) {
  const out = [];
  const best = new Map();
  const queue = [{ name: seed, delay: 0, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const key = cur.name + '@' + cur.delay.toFixed(3);
    if (cur.depth > 8 || seen.has(key)) continue;
    seen.add(key);
    for (const o of graph.get(cur.name) || []) {
      if (!o.target) continue;
      const at = cur.delay + o.delay;
      if (names.has(o.target)) {
        if (o.input !== 'enable' && o.input !== 'disable') continue;
        const k = o.target + '|' + o.input + '|' + at.toFixed(3);
        if (best.has(k)) continue;
        best.set(k, true);
        out.push({ name: o.target, on: o.input === 'enable', at });
        continue;
      }
      if (o.input === 'trigger') queue.push({ name: o.target, delay: at, depth: cur.depth + 1 });
    }
  }
  out.sort((a, b) => a.at - b.at || (a.on === b.on ? 0 : a.on ? -1 : 1));
  return out;
}

export function rerollSources(graph, chooser) {
  if (!chooser) return [];
  const picks = new Set();
  for (const [name, outs] of graph) {
    for (const o of outs) {
      if (o.target === chooser && /^pick/.test(o.input)) picks.add(name);
    }
  }
  const out = new Set();
  const seen = new Set();
  const walk = (name, depth) => {
    if (depth > 8 || seen.has(name)) return;
    seen.add(name);
    for (const [src, outs] of graph) {
      for (const o of outs) {
        if (o.target !== name || o.input !== 'trigger') continue;
        out.add(src);
        walk(src, depth + 1);
      }
    }
  };
  for (const p of picks) { out.add(p); walk(p, 0); }
  return [...out];
}

export function buildBombPaths(ents, navVolumes, hintNames, doorNames, blockerNames, triggerNames) {
  const volumeNames = new Set(navVolumes.map(v => v.name).filter(Boolean));
  if (!volumeNames.size) return [];
  const graph = entityOutputs(ents);
  const paths = [];
  for (const en of ents) {
    if (en.classname !== 'logic_case' || !en.outputs) continue;
    for (const o of en.outputs) {
      if (!/^oncase/i.test(o.key)) continue;
      const relay = (splitOutput(o.value)[0] || '').toLowerCase();
      if (!relay || relay === 'null') continue;
      const t = resolveToggles(graph, relay, volumeNames);
      if (!t.enable.length && !t.disable.length) continue;
      const key = relay.replace(/^bombpath_/, '').replace(/_relay$/, '') || relay;
      if (paths.some(p => p.key === key)) continue;
      const h = hintNames && hintNames.size ? resolveToggles(graph, relay, hintNames) : { enable: [], disable: [] };
      paths.push({
        key, relay, chooser: (en.targetname || '').toLowerCase(),
        enable: t.enable, disable: t.disable, hintsOn: h.enable, hintsOff: h.disable
      });
    }
  }
  if (!paths.length) for (const p of complementaryRoutes(ents, graph, volumeNames)) paths.push(p);
  for (const p of paths) {
    p.rerollBy = rerollSources(graph, p.chooser);
    p.doorEvents = doorNames && doorNames.size ? doorEvents(graph, p.relay, doorNames) : [];
    p.blockerEvents = blockerNames && blockerNames.size ? blockerEvents(graph, p.relay, blockerNames) : [];
    p.triggerEvents = triggerNames && triggerNames.size ? enableEvents(graph, p.relay, triggerNames) : [];
  }
  return paths;
}

function complementaryRoutes(ents, graph, volumeNames) {
  const seen = new Set();
  const cand = [];
  for (const en of ents) {
    const name = (en.targetname || '').toLowerCase();
    if (!name || !en.outputs || seen.has(name)) continue;
    if (en.classname !== 'logic_relay' && en.classname !== 'logic_case') continue;
    seen.add(name);
    const t = resolveToggles(graph, name, volumeNames);
    if (!t.enable.length || !t.disable.length) continue;
    cand.push({ name, ...t });
  }
  const routes = [];
  for (const c of cand) {
    if (!cand.some(o => o !== c && o.enable.some(n => c.disable.includes(n)))) continue;
    const key = c.name.replace(/^bombpath_/, '').replace(/_relay$/, '') || c.name;
    if (routes.some(p => p.key === key)) continue;
    routes.push({ key, relay: c.name, chooser: '', enable: c.enable, disable: c.disable });
  }
  return routes.length > 1 ? routes : [];
}

function prevPoint(cp) {
  const p = (cp.team_previouspoint_3_0 || '').toLowerCase();
  const self = (cp.targetname || '').toLowerCase();
  return p && p !== self ? p : null;
}

function gateEffects(graph, relay, spawnNames, triggerNames, hintNames, prereqNames, classOf, doorNames, blockerNames, doorTriggerNames) {
  const hints = hintNames && hintNames.size ? resolveToggles(graph, relay, hintNames) : { enable: [], disable: [] };
  const pre = prereqNames && prereqNames.size ? resolveToggles(graph, relay, prereqNames) : { enable: [], disable: [] };
  const preEvents = prereqNames && prereqNames.size ? resolveTogglesTimed(graph, relay, prereqNames) : [];
  const hintEvents = hintNames && hintNames.size ? resolveTogglesTimed(graph, relay, hintNames) : [];
  const outs = graph.get(relay) || [];
  let pauseAt = null, resumeAt = null;
  const spawnsOn = [], spawnsOff = [], gatesOn = [];
  for (const o of outs) {
    if (o.input === 'pausebotspawning') pauseAt = pauseAt === null ? o.delay : Math.min(pauseAt, o.delay);
    if (o.input === 'unpausebotspawning') resumeAt = resumeAt === null ? o.delay : Math.max(resumeAt, o.delay);
    if (triggerNames && triggerNames.has(o.target) && o.input === 'enable'
      && !gatesOn.some(x => x.trigger === o.target)) gatesOn.push({ trigger: o.target, delay: o.delay });
    if (!spawnNames.has(o.target)) continue;
    if (o.input === 'enable' && !spawnsOn.some(x => x.name === o.target)) spawnsOn.push({ name: o.target, delay: o.delay });
    if (o.input === 'disable' && !spawnsOff.some(x => x.name === o.target)) spawnsOff.push({ name: o.target, delay: o.delay });
  }
  return {
    pauseFor: pauseAt !== null && resumeAt !== null ? Math.max(0, resumeAt - pauseAt) : 0,
    spawnsOn, spawnsOff, gatesOn,
    hintsOn: hints.enable, hintsOff: hints.disable,
    prereqsOn: pre.enable, prereqsOff: pre.disable,
    prereqEvents: preEvents, hintEvents,
    propEvents: classOf ? propToggleEvents(graph, relay, classOf) : [],
    doorEvents: doorNames && doorNames.size ? doorEvents(graph, relay, doorNames) : [],
    blockerEvents: blockerNames && blockerNames.size ? blockerEvents(graph, relay, blockerNames) : [],
    triggerEvents: doorTriggerNames && doorTriggerNames.size ? enableEvents(graph, relay, doorTriggerNames) : []
  };
}

const matName = v => String(v || '').replace(/\\/g, '/').replace(/^materials\//i, '').replace(/\.vmt$/i, '').toLowerCase().trim() || null;

const WAVE_START_RELAY = 'wave_start_relay';

const NAV_TASK = { 2: 'moveto', 3: 'wait' };

function truthyFlag(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

export function buildFilters(ents) {
  const out = {};
  for (const en of ents) {
    const cls = String(en.classname || '').toLowerCase();
    const name = (en.targetname || '').toLowerCase();
    if (!name || !cls.startsWith('filter_')) continue;
    const negated = truthyFlag(en.negated);
    if (cls === 'filter_tf_bot_has_tag') {
      out[name] = {
        kind: 'tag', negated,
        tags: String(en.tags || '').toLowerCase().split(/\s+/).filter(Boolean),
        requireAll: truthyFlag(en.require_all_tags)
      };
    } else if (cls === 'filter_activator_tfteam') {
      out[name] = { kind: 'team', negated, team: String(en.teamnum || '').trim() };
    } else if (cls === 'filter_multi') {
      const subs = [];
      for (const [k, v] of Object.entries(en)) {
        if (/^filter\d+$/i.test(k) && v) subs.push(String(v).toLowerCase());
      }
      out[name] = { kind: 'multi', negated, any: String(en.filtertype || '0').trim() === '1', filters: subs };
    }
  }
  return out;
}

export function buildPrerequisites(ents, brushBox) {
  const out = [];
  for (const en of ents) {
    if (String(en.classname || '').toLowerCase() !== 'func_nav_prerequisite') continue;
    const task = NAV_TASK[String(en.task || '').trim()];
    if (!task) continue;
    const bounds = brushBox ? brushBox(en) : null;
    if (!bounds) continue;
    const value = parseFloat(en.value);
    out.push({
      name: (en.targetname || '').toLowerCase() || null,
      task,
      entity: String(en.entity || '').trim().toLowerCase() || null,
      filter: String(en.filtername || '').trim().toLowerCase() || null,
      startDisabled: truthy(en.startdisabled, en.start_disabled),
      value: Number.isFinite(value) ? value : 0,
      bounds
    });
  }
  return out;
}

export function propToggleEvents(graph, relay, classOf, onFilter = null) {
  const out = [];
  const seen = new Set();
  const queue = [{ name: relay, delay: 0, depth: 0 }];
  const walked = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const key = cur.name + '@' + cur.delay.toFixed(3);
    if (cur.depth > BREAK_MAX_DEPTH || walked.has(key)) continue;
    walked.add(key);
    for (const o of graph.get(cur.name) || []) {
      if (!o.target) continue;
      if (!cur.depth && onFilter && !onFilter.test(String(o.on).toLowerCase())) continue;
      const at = cur.delay + o.delay;
      const effect = PROP_EFFECT[o.input];
      if (effect && PROP_CLASSES.has(classOf.get(o.target))) {
        const k = o.target + '|' + effect + '|' + (o.param || '') + '|' + at.toFixed(3);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ target: o.target, effect, param: o.param || '', delay: at });
        continue;
      }
      if (CHAIN_INPUTS.has(o.input)) queue.push({ name: o.target, delay: at, depth: cur.depth + 1 });
    }
  }
  out.sort((a, b) => a.delay - b.delay);
  return out;
}

function buildHintToggles(ents, hintNames) {
  const out = {};
  if (!hintNames.size) return out;
  const graph = entityOutputs(ents);
  for (const name of graph.keys()) {
    const t = resolveToggles(graph, name, hintNames);
    if (t.enable.length || t.disable.length) out[name] = { enable: t.enable, disable: t.disable };
  }
  return out;
}

const DOOR_INPUTS = { open: 'open', close: 'close', toggle: 'toggle' };
const BLOCKER_INPUTS = { enable: 'on', disable: 'off', kill: 'off' };
const FIRE_INPUTS = new Set(['trigger', 'fireuser1', 'fireuser2', 'fireuser3', 'fireuser4']);
const TOUCH_START = /^onstarttouch(all)?$/;
const TOUCH_END = /^(onendtouchall|onnottouching)$/;
const ON_PASS = /^onpass$/;
const BLOCKER_CLASSES = new Set(['func_brush', 'func_nav_blocker']);
const SOLIDITY_NEVER = '1';
const SOLIDITY_ALWAYS = '2';

export function buildDoors(ents, models, movers = null) {
  const out = [];
  for (const en of ents) {
    const raw = String(en.model || '');
    if (raw[0] !== '*') continue;
    const mi = parseInt(raw.slice(1), 10);
    const model = models[mi];
    if (!model) continue;
    const door = movers ? movers.get(mi) || null : doorRecord(en, model, mi);
    if (!door) continue;
    const eo = vec(en.origin) || [0, 0, 0];
    out.push({
      ...door,
      bounds: {
        mins: [model.mins[0] + model.origin[0] + eo[0], model.mins[1] + model.origin[1] + eo[1], model.mins[2] + model.origin[2] + eo[2]],
        maxs: [model.maxs[0] + model.origin[0] + eo[0], model.maxs[1] + model.origin[1] + eo[1], model.maxs[2] + model.origin[2] + eo[2]]
      }
    });
  }
  return out;
}

export function buildBlockers(ents, brushBox) {
  const out = [];
  for (const en of ents) {
    const cls = String(en.classname || '').toLowerCase();
    if (!BLOCKER_CLASSES.has(cls)) continue;
    const solidity = String(en.solidity ?? en.Solidity ?? '').trim();
    if (cls === 'func_brush' && solidity === SOLIDITY_NEVER) continue;
    const bounds = brushBox(en);
    if (!bounds) continue;
    out.push({
      name: (en.targetname || '').toLowerCase() || null,
      cls,
      team: String(en.teamnum ?? en.team ?? '').trim() || null,
      alwaysSolid: solidity === SOLIDITY_ALWAYS,
      startDisabled: truthy(en.startdisabled, en.start_disabled),
      bounds
    });
  }
  return out;
}

function targetEvents(graph, seed, names, inputs, onFilter) {
  const out = [];
  const seen = new Set();
  const walked = new Set();
  const queue = [{ name: seed, delay: 0, depth: 0 }];
  while (queue.length) {
    const cur = queue.shift();
    const key = cur.name + '@' + cur.delay.toFixed(3);
    if (cur.depth > BREAK_MAX_DEPTH || walked.has(key)) continue;
    walked.add(key);
    for (const o of graph.get(cur.name) || []) {
      if (!o.target) continue;
      if (!cur.depth && onFilter && !onFilter.test(String(o.on).toLowerCase())) continue;
      const at = cur.delay + o.delay;
      const action = inputs[o.input];
      if (action && names.has(o.target)) {
        const k = o.target + '|' + action + '|' + at.toFixed(3);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ target: o.target, action, at });
        continue;
      }
      if (FIRE_INPUTS.has(o.input)) queue.push({ name: o.target, delay: at, depth: cur.depth + 1 });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function doorEvents(graph, seed, doorNames, onFilter = null) {
  return targetEvents(graph, seed, doorNames, DOOR_INPUTS, onFilter)
    .map(e => ({ door: e.target, input: e.action, at: e.at }));
}

export function blockerEvents(graph, seed, blockerNames, onFilter = null) {
  return targetEvents(graph, seed, blockerNames, BLOCKER_INPUTS, onFilter)
    .map(e => ({ blocker: e.target, on: e.action === 'on', at: e.at }));
}

export function enableEvents(graph, seed, names, onFilter = null) {
  return targetEvents(graph, seed, names, BLOCKER_INPUTS, onFilter)
    .map(e => ({ name: e.target, on: e.action === 'on', at: e.at }));
}

export function buildDoorTriggers(ents, brushBox, doorNames) {
  if (!doorNames.size) return [];
  const out = [];
  for (const en of ents) {
    const cls = String(en.classname || '').toLowerCase();
    if (!cls.startsWith('trigger_') || !en.outputs) continue;
    const bounds = brushBox(en);
    if (!bounds) continue;
    const onEnter = [], onLeave = [];
    for (const o of en.outputs) {
      const parts = splitOutput(o.value);
      const target = (parts[0] || '').toLowerCase();
      const input = DOOR_INPUTS[(parts[1] || '').toLowerCase()];
      if (!doorNames.has(target) || !input) continue;
      const delay = parseFloat(parts[3]);
      const ev = { door: target, input, delay: Number.isFinite(delay) ? delay : 0 };
      const on = String(o.key).toLowerCase();
      if (TOUCH_START.test(on)) onEnter.push(ev);
      else if (TOUCH_END.test(on)) onLeave.push(ev);
    }
    const doorName = String(en.door_name || '').toLowerCase();
    if (!onEnter.length && !onLeave.length && doorNames.has(doorName)) {
      onEnter.push({ door: doorName, input: 'open', delay: 0 });
      onLeave.push({ door: doorName, input: 'close', delay: 0 });
    }
    if (!onEnter.length && !onLeave.length) continue;
    out.push({
      name: (en.targetname || '').toLowerCase() || null,
      cls,
      filter: String(en.filtername || '').trim().toLowerCase() || null,
      startDisabled: truthy(en.startdisabled, en.start_disabled),
      bounds, onEnter, onLeave
    });
  }
  return out;
}

export function buildPathGates(ents, graph, doorNames, blockerNames) {
  const out = [];
  if (!doorNames.size && !blockerNames.size) return out;
  for (const en of ents) {
    if (en.classname !== 'path_track') continue;
    const node = (en.targetname || '').toLowerCase();
    if (!node) continue;
    for (const ev of doorEvents(graph, node, doorNames, ON_PASS)) out.push({ node, door: ev.door, input: ev.input, delay: ev.at });
    for (const ev of blockerEvents(graph, node, blockerNames, ON_PASS)) out.push({ node, blocker: ev.blocker, on: ev.on, delay: ev.at });
  }
  return out;
}

const DOOR_OUTPUTS = {
  onOpen: /^onopen$/,
  onClose: /^onclose$/,
  onFullyOpen: /^onfullyopen$/,
  onFullyClosed: /^onfullyclosed$/
};

export function buildDoorOutputs(graph, doorNames, blockerNames, classOf) {
  const out = {};
  for (const name of doorNames) {
    const outs = graph.get(name);
    if (!outs || !outs.length) continue;
    const rec = {};
    let any = false;
    for (const [key, onFilter] of Object.entries(DOOR_OUTPUTS)) {
      if (!outs.some(o => onFilter.test(String(o.on).toLowerCase()))) continue;
      const props = classOf ? propToggleEvents(graph, name, classOf, onFilter) : [];
      const doors = doorEvents(graph, name, doorNames, onFilter);
      const blockers = blockerEvents(graph, name, blockerNames, onFilter);
      if (!props.length && !doors.length && !blockers.length) continue;
      rec[key] = { props, doors, blockers };
      any = true;
    }
    if (any) out[name] = rec;
  }
  return out;
}

function mapSpawnGates(ents, graph, doorNames, blockerNames) {
  const doors = [], blockers = [];
  for (const en of ents) {
    if (en.classname !== 'logic_auto' || !en.outputs) continue;
    for (const o of en.outputs) {
      const target = (splitOutput(o.value)[0] || '').toLowerCase();
      if (!target) continue;
      for (const ev of doorEvents(graph, target, doorNames)) doors.push(ev);
      for (const ev of blockerEvents(graph, target, blockerNames)) blockers.push(ev);
    }
  }
  doors.sort((a, b) => a.at - b.at);
  blockers.sort((a, b) => a.at - b.at);
  return { doors, blockers };
}

function mapSpawnHints(ents, hintNames) {
  const graph = entityOutputs(ents);
  const enable = new Set();
  const disable = new Set();
  for (const en of ents) {
    if (en.classname !== 'logic_auto' || !en.outputs) continue;
    for (const o of en.outputs) {
      const parts = splitOutput(o.value);
      const target = (parts[0] || '').toLowerCase();
      if (!target) continue;
      const t = resolveToggles(graph, target, hintNames);
      for (const n of t.enable) enable.add(n);
      for (const n of t.disable) disable.add(n);
    }
  }
  return { enable: [...enable], disable: [...disable] };
}

export function buildGates(ents, spawns, brushBox, hintNames, prereqNames, doorNames, blockerNames, doorTriggerNames) {
  const graph = entityOutputs(ents);
  const spawnNames = new Set((spawns || []).map(s => String(s.name || '').toLowerCase()).filter(Boolean));
  const points = new Map();
  const relays = new Set();
  for (const e of ents) {
    const n = (e.targetname || '').toLowerCase();
    if (!n) continue;
    if (e.classname === 'team_control_point') points.set(n, e);
    if (e.classname === 'logic_relay') relays.add(n);
  }
  const triggerNames = new Set(ents
    .filter(e => e.classname === 'trigger_timer_door' && e.targetname)
    .map(e => String(e.targetname).toLowerCase()));
  const classOf = new Map();
  for (const e of ents) {
    const n = (e.targetname || '').toLowerCase();
    if (n && !classOf.has(n)) classOf.set(n, e.classname);
  }
  const out = [];
  for (const e of ents) {
    if (e.classname !== 'trigger_timer_door') continue;
    const cp = points.get(String(e.area_cap_point || '').toLowerCase());
    if (!cp) continue;
    let relay = null;
    for (const o of e.outputs || []) {
      if (!/^oncapteam/i.test(o.key)) continue;
      const target = (splitOutput(o.value)[0] || '').toLowerCase();
      if (relays.has(target)) { relay = target; break; }
    }
    const capTime = parseFloat(e.area_time_to_cap);
    const capCount = parseInt(e.team_numcap_3, 10);
    out.push({
      trigger: (e.targetname || '').toLowerCase(),
      point: (cp.targetname || '').toLowerCase(),
      label: cp.point_printname || cp.targetname || '',
      index: parseInt(cp.point_index, 10) || 0,
      origin: vec(cp.origin),
      capTime: Number.isFinite(capTime) ? capTime : 0,
      capCount: Number.isFinite(capCount) && capCount > 0 ? capCount : 1,
      startsLocked: String(e.startdisabled) === '1',
      previous: prevPoint(cp),
      bounds: brushBox ? brushBox(e) : null,
      icons: {
        held: matName(cp.team_icon_2) || matName(cp.team_icon_0),
        taken: matName(cp.team_icon_3) || matName(cp.team_icon_0),
        overlay: matName(cp.team_overlay_3) || matName(cp.team_overlay_0)
      },
      relay,
      effects: relay ? gateEffects(graph, relay, spawnNames, triggerNames, hintNames, prereqNames, classOf, doorNames, blockerNames, doorTriggerNames) : null
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

const HINT_CLASSES = /^(bot_hint_sniper_spot|bot_hint_engineer_nest|bot_hint_sentrygun|bot_hint_teleporter_exit|func_tfbot_hint)$/;

function vec(s) {
  const v = String(s || '0 0 0').split(/\s+/).map(parseFloat);
  return v.length >= 3 && v.every(Number.isFinite) ? v.slice(0, 3) : null;
}

function truthy(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return String(v) === '1';
  }
  return false;
}

export function extractMapEntities(ents, models, movers = null) {
  const brushBox = en => {
    const m = models[parseInt(String(en.model || '').slice(1), 10)];
    if (!m) return null;
    const eo = vec(en.origin) || [0, 0, 0];
    return {
      mins: [m.mins[0] + m.origin[0] + eo[0], m.mins[1] + m.origin[1] + eo[1], m.mins[2] + m.origin[2] + eo[2]],
      maxs: [m.maxs[0] + m.origin[0] + eo[0], m.maxs[1] + m.origin[1] + eo[1], m.maxs[2] + m.origin[2] + eo[2]]
    };
  };
  const spawns = [];
  const flags = [];
  const capzones = [];
  const tracks = [];
  const redSpawns = [];
  const hints = [];
  const navVolumes = [];
  const spawnRooms = [];
  const pathProps = [];
  const particles = [];

  for (const en of ents) {
    switch (en.classname) {
      case 'info_player_teamspawn': {
        const o = vec(en.origin);
        if (!o) break;
        if (en.targetname) spawns.push({ name: en.targetname, origin: o, team: en.teamnum || null, disabled: truthy(en.startdisabled, en.start_disabled) });
        if (en.teamnum === '2') redSpawns.push(o);
        break;
      }
      case 'item_teamflag': {
        const o = vec(en.origin);
        if (o) flags.push(o);
        break;
      }
      case 'func_capturezone': {
        if (String(en.teamnum) === '2') break;
        const b = brushBox(en);
        if (!b) break;
        const c = [(b.mins[0] + b.maxs[0]) / 2, (b.mins[1] + b.maxs[1]) / 2, (b.mins[2] + b.maxs[2]) / 2];
        if (Math.abs(c[0]) + Math.abs(c[1]) > 1) capzones.push(c);
        break;
      }
      case 'path_track': {
        const o = vec(en.origin);
        if (o && en.targetname) tracks.push({ name: en.targetname.toLowerCase(), origin: o, target: (en.target || '').toLowerCase() });
        break;
      }
      case 'func_nav_avoid':
      case 'func_nav_prefer': {
        const b = brushBox(en);
        if (!b) break;
        navVolumes.push({
          kind: en.classname === 'func_nav_prefer' ? 'prefer' : 'avoid',
          name: (en.targetname || '').toLowerCase() || null,
          startDisabled: truthy(en.start_disabled, en.startdisabled),
          tags: String(en.tags || '').toLowerCase().split(/\s+/).filter(Boolean),
          team: en.team || null,
          mins: b.mins,
          maxs: b.maxs
        });
        break;
      }
      case 'func_respawnroom': {
        if (String(en.teamnum ?? en.TeamNum ?? '') !== '3') break;
        const b = brushBox(en);
        if (b) spawnRooms.push(b);
        break;
      }
      case 'prop_dynamic': {
        const name = (en.targetname || '').toLowerCase();
        if (!name || !/hologram|bombpath/.test(name)) break;
        const o = vec(en.origin);
        if (!o) break;
        pathProps.push({
          name,
          origin: o,
          angles: vec(en.angles) || [0, 0, 0],
          startDisabled: truthy(en.startdisabled, en.start_disabled)
        });
        break;
      }
      case 'info_particle_system': {
        const name = (en.targetname || '').toLowerCase();
        const o = vec(en.origin);
        const fx = String(en.effect_name || '').trim().toLowerCase();
        if (!name || !o || !fx) break;
        particles.push({ name, origin: o, effect: fx });
        break;
      }
      default:
        if (HINT_CLASSES.test(en.classname)) {
          const o = vec(en.origin);
          if (o) hints.push({
            kind: en.classname, origin: o, team: en.teamnum || null,
            hint: en.hint || null, name: (en.targetname || '').toLowerCase() || null,
            startDisabled: truthy(en.startdisabled, en.start_disabled)
          });
        }
    }
  }

  const hintNames = new Set(hints.map(h => h.name).filter(Boolean));
  const hintToggles = buildHintToggles(ents, hintNames);
  const prerequisites = buildPrerequisites(ents, brushBox);
  const prereqNames = new Set(prerequisites.map(p => p.name).filter(Boolean));
  const graph = entityOutputs(ents);
  const doors = buildDoors(ents, models, movers);
  const doorNames = new Set(doors.map(d => d.name).filter(Boolean));
  const blockers = buildBlockers(ents, brushBox);
  const blockerNames = new Set(blockers.map(b => b.name).filter(Boolean));
  const classOf = new Map();
  for (const en of ents) {
    const n = (en.targetname || '').toLowerCase();
    if (n && !classOf.has(n)) classOf.set(n, en.classname);
  }
  const atSpawn = mapSpawnGates(ents, graph, doorNames, blockerNames);
  const doorTriggers = buildDoorTriggers(ents, brushBox, doorNames);
  const triggerNames = new Set(doorTriggers.map(t => t.name).filter(Boolean));
  return {
    spawns, flags, capzones, tracks, redSpawns, hints, navVolumes, spawnRooms, pathProps, particles,
    hintsAtWaveStart: resolveToggles(graph, WAVE_START_RELAY, hintNames),
    hintsAtMapSpawn: mapSpawnHints(ents, hintNames),
    hintToggles,
    filters: buildFilters(ents),
    prerequisites,
    doors,
    doorTriggers,
    triggersAtWaveStart: enableEvents(graph, WAVE_START_RELAY, triggerNames),
    blockers,
    doorsAtMapSpawn: atSpawn.doors,
    blockersAtMapSpawn: atSpawn.blockers,
    doorOutputs: buildDoorOutputs(graph, doorNames, blockerNames, classOf),
    doorsAtWaveStart: doorEvents(graph, WAVE_START_RELAY, doorNames),
    blockersAtWaveStart: blockerEvents(graph, WAVE_START_RELAY, blockerNames),
    pathGates: buildPathGates(ents, graph, doorNames, blockerNames),
    breakables: buildBreakables(ents),
    bombPaths: buildBombPaths(ents, navVolumes, hintNames, doorNames, blockerNames, triggerNames),
    gates: buildGates(ents, spawns, brushBox, hintNames, prereqNames, doorNames, blockerNames, triggerNames)
  };
}
