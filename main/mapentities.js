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

export function buildBombPaths(ents, navVolumes) {
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
      paths.push({ key, relay, chooser: (en.targetname || '').toLowerCase(), enable: t.enable, disable: t.disable });
    }
  }
  if (!paths.length) for (const p of complementaryRoutes(ents, graph, volumeNames)) paths.push(p);
  for (const p of paths) p.rerollBy = rerollSources(graph, p.chooser);
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

function gateEffects(graph, relay, spawnNames) {
  const outs = graph.get(relay) || [];
  let pauseAt = null, resumeAt = null;
  const spawnsOn = [], spawnsOff = [];
  for (const o of outs) {
    if (o.input === 'pausebotspawning') pauseAt = pauseAt === null ? o.delay : Math.min(pauseAt, o.delay);
    if (o.input === 'unpausebotspawning') resumeAt = resumeAt === null ? o.delay : Math.max(resumeAt, o.delay);
    if (!spawnNames.has(o.target)) continue;
    if (o.input === 'enable' && !spawnsOn.some(x => x.name === o.target)) spawnsOn.push({ name: o.target, delay: o.delay });
    if (o.input === 'disable' && !spawnsOff.some(x => x.name === o.target)) spawnsOff.push({ name: o.target, delay: o.delay });
  }
  return {
    pauseFor: pauseAt !== null && resumeAt !== null ? Math.max(0, resumeAt - pauseAt) : 0,
    spawnsOn, spawnsOff
  };
}

export function buildGates(ents, spawns, brushBox) {
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
      relay,
      effects: relay ? gateEffects(graph, relay, spawnNames) : null
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

export function extractMapEntities(ents, models) {
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
      default:
        if (HINT_CLASSES.test(en.classname)) {
          const o = vec(en.origin);
          if (o) hints.push({ kind: en.classname, origin: o, team: en.teamnum || null, hint: en.hint || null });
        }
    }
  }

  return { spawns, flags, capzones, tracks, redSpawns, hints, navVolumes, spawnRooms, pathProps, bombPaths: buildBombPaths(ents, navVolumes), gates: buildGates(ents, spawns, brushBox) };
}
