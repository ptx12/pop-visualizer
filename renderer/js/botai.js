import { buildNavGraphWasm, navWasmReady } from './navwasm.js';
import { buildPipeline } from './sim/systems.js';
import { behaviours, selectBehaviour } from './sim/behaviours.js';
import { instantiateSpawner } from './sim/spawners.js';
import { createEventBus, seedWaveEvents } from './sim/events.js';
import { waveStartOutputs, wavespawnOutputs } from './gating.js';
import { RANGES, healTarget } from './sim/systems/healing.js';
import {
  CLASS_BASE_SPEED, TF_MAX_SPEED, STEP, CARRIER_PENALTY,
  botScale, hasDemoShield, botMaxSpeed, mulberry32, dpsProfile
} from './sim/bots.js';

export { CLASS_BASE_SPEED, TF_MAX_SPEED, STEP, botScale, hasDemoShield, botMaxSpeed, mulberry32, dpsProfile };

const MAX_STEPS = 6000;
const BOMB_UPGRADE_1 = 5;
const BOMB_UPGRADE_2 = 15;
const BOMB_UPGRADE_3 = 15;
const BOMB_TAUNT_MIN = 3;
const BOMB_TAUNT_MAX = 5;
const CHARGE_SPEED = 750;
const CHARGE_TIME = 1.5;
const CHARGE_REGEN = 8.3;
const TF_NAV_SPAWN_ROOM_BLUE = 0x4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const AVOID_COST = 25;
const PREFER_COST = 0.04;
const TF_TEAM_BLUE = 3;

const CLASS_COST_NAME = {
  scout: 'scout', soldier: 'soldier', pyro: 'pyro', demoman: 'demoman',
  heavyweapons: 'heavyweapons', engineer: 'engineer', medic: 'medic',
  sniper: 'sniper', spy: 'spy'
};

export function costApplies(vol, bot, carrying) {
  const team = parseInt(vol.team, 10);
  if (Number.isFinite(team) && team > 0 && team !== TF_TEAM_BLUE) return false;
  const tags = vol.tags || [];
  if (!tags.length) return false;
  const botTags = (bot && bot.tags) || [];
  if (carrying) {
    if (tags.includes('bomb_carrier')) return true;
    for (const t of tags) if (t.includes('bomb_carrier') && botTags.includes(t)) return true;
    return false;
  }
  if (tags.includes('common')) return true;
  const cname = bot ? CLASS_COST_NAME[bot.cls] : null;
  if (cname && tags.includes(cname)) return true;
  for (const t of tags) if (botTags.includes(t)) return true;
  return false;
}

export function costProfile(volumes, bot, carrying) {
  const picked = [];
  let key = carrying ? 'c' : 'n';
  for (let i = 0; i < volumes.length; i++) {
    if (!costApplies(volumes[i], bot, carrying)) continue;
    picked.push(volumes[i]);
    key += ':' + i;
  }
  return { key, volumes: picked };
}

export function pathKeyOf(name) {
  if (!name) return null;
  const k = String(name).toLowerCase()
    .replace(/^bombpath_/, '')
    .replace(/holograms?/g, '')
    .replace(/arrows?/g, '')
    .replace(/nav_?avoid/g, '')
    .replace(/prefer_?flankers?/g, '')
    .replace(/prefer/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return k || null;
}

export function bombPathGroups(mapData) {
  const mapped = mapData.bombPaths || [];
  if (mapped.length) {
    return mapped.map(p => ({ key: p.key, volumes: p.enable.length, props: 0, fromMap: true }));
  }
  const keys = new Map();
  const add = (name, what) => {
    const k = pathKeyOf(name);
    if (!k) return;
    if (!keys.has(k)) keys.set(k, { key: k, volumes: 0, props: 0 });
    keys.get(k)[what]++;
  };
  for (const v of mapData.navVolumes || []) if (v.name && v.startDisabled) add(v.name, 'volumes');
  for (const p of mapData.pathProps || []) add(p.name, 'props');
  return [...keys.values()].filter(g => g.volumes || g.props).sort((a, b) => a.key.localeCompare(b.key));
}

function namePatternMatch(pat, name) {
  if (pat === name) return true;
  return pat.endsWith('*') && name.startsWith(pat.slice(0, -1));
}

function inList(list, name) {
  for (const p of list) if (namePatternMatch(p, name)) return true;
  return false;
}

function volumeActive(v, activeNames, bombPath, mapPaths) {
  if (v.name) {
    const n = v.name.toLowerCase();
    if (inList(activeNames.disabled, n)) return false;
    if (inList(activeNames.enabled, n)) return true;
    if (mapPaths && mapPaths.pool.has(n)) return mapPaths.on.has(n);
    if (v.startDisabled) return bombPath ? pathKeyOf(v.name) === bombPath : false;
    return true;
  }
  return !v.startDisabled;
}

function mapPathSets(mapData, bombPath) {
  const paths = mapData.bombPaths || [];
  if (!paths.length) return null;
  const pool = new Set();
  for (const p of paths) for (const n of p.enable) pool.add(n);
  const chosen = bombPath ? paths.find(p => p.key === bombPath) : null;
  return { pool, on: new Set(chosen ? chosen.enable : []) };
}

export function activeNavVolumes(mapData, opts = {}) {
  const activeNames = {
    enabled: (opts.enabledNames || []).map(s => String(s).toLowerCase()),
    disabled: (opts.disabledNames || []).map(s => String(s).toLowerCase())
  };
  const mapPaths = mapPathSets(mapData, opts.bombPath || null);
  return (mapData.navVolumes || []).filter(v => volumeActive(v, activeNames, opts.bombPath || null, mapPaths));
}

function areaWeights(mapData, volumes) {
  const w = new Map();
  if (!mapData.nav || !volumes.length) return w;
  for (const a of mapData.nav.areas) {
    const cx = (a.nw[0] + a.se[0]) / 2;
    const cy = (a.nw[1] + a.se[1]) / 2;
    const cz = (a.nw[2] + a.se[2]) / 2;
    let mult = 1;
    for (const v of volumes) {
      if (cx < v.mins[0] || cx > v.maxs[0] || cy < v.mins[1] || cy > v.maxs[1]) continue;
      if (cz < v.mins[2] - 80 || cz > v.maxs[2] + 80) continue;
      mult *= v.kind === 'avoid' ? AVOID_COST : PREFER_COST;
    }
    if (mult !== 1) w.set(a.id, mult);
  }
  return w;
}

export function buildNavGraph(mapData, volumes, allowWasm = true) {
  const weights = areaWeights(mapData, volumes || []);
  if (allowWasm && navWasmReady()) {
    const accel = buildNavGraphWasm(mapData, weights);
    if (accel) return accel;
  }
  const byId = new Map();
  if (mapData.nav) for (const a of mapData.nav.areas) byId.set(a.id, a);
  const centers = new Map();
  for (const a of byId.values()) centers.set(a.id, [(a.nw[0] + a.se[0]) / 2, (a.nw[1] + a.se[1]) / 2, (a.nw[2] + a.se[2]) / 2]);
  const rev = new Map();
  for (const a of byId.values()) {
    for (const n of a.connect) {
      if (!rev.has(n)) rev.set(n, []);
      rev.get(n).push(a.id);
    }
  }
  const fields = new Map();
  const center = id => centers.get(id);

  function nearestArea(p) {
    let best = null, bestD = Infinity;
    for (const a of byId.values()) {
      const cx = Math.min(Math.max(p[0], a.nw[0]), a.se[0]);
      const cy = Math.min(Math.max(p[1], a.nw[1]), a.se[1]);
      const dz = ((a.nw[2] + a.se[2]) / 2 - (p[2] ?? (a.nw[2] + a.se[2]) / 2));
      const d = (cx - p[0]) ** 2 + (cy - p[1]) ** 2 + dz * dz * 0.4;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function areaAt(p, hintId) {
    if (hintId != null) {
      const h = byId.get(hintId);
      if (h && p[0] >= h.nw[0] && p[0] <= h.se[0] && p[1] >= h.nw[1] && p[1] <= h.se[1]) return h;
      if (h) {
        for (const n of h.connect) {
          const a = byId.get(n);
          if (a && p[0] >= a.nw[0] && p[0] <= a.se[0] && p[1] >= a.nw[1] && p[1] <= a.se[1]) return a;
        }
      }
    }
    return nearestArea(p);
  }

  function flowField(targetId) {
    if (fields.has(targetId)) return fields.get(targetId);
    const dist = new Map([[targetId, 0]]);
    const heap = [[0, targetId]];
    while (heap.length) {
      let bi = 0;
      for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [d, cur] = heap.splice(bi, 1)[0];
      if (d > (dist.get(cur) ?? Infinity)) continue;
      const cc = center(cur);
      for (const p of rev.get(cur) || []) {
        const pc = center(p);
        const step = Math.hypot(pc[0] - cc[0], pc[1] - cc[1]) + Math.abs(pc[2] - cc[2]) * 0.5;
        const nd = d + step * (weights.get(p) || 1);
        if (nd < (dist.get(p) ?? Infinity)) {
          dist.set(p, nd);
          heap.push([nd, p]);
        }
      }
    }
    const field = { dist, next: new Map() };
    fields.set(targetId, field);
    return field;
  }

  function nextToward(field, areaId) {
    if (field.next.has(areaId)) return field.next.get(areaId);
    const a = byId.get(areaId);
    const here = field.dist.get(areaId);
    let best = null;
    let bestD = here === undefined ? Infinity : here;
    if (a) {
      for (const n of a.connect) {
        const d = field.dist.get(n);
        if (d === undefined || d >= bestD) continue;
        bestD = d;
        best = n;
      }
    }
    field.next.set(areaId, best);
    return best;
  }

  function portal(aId, bId) {
    const a = byId.get(aId), b = byId.get(bId);
    if (!a || !b) return null;
    const x1 = Math.max(a.nw[0], b.nw[0]), x2 = Math.min(a.se[0], b.se[0]);
    const y1 = Math.max(a.nw[1], b.nw[1]), y2 = Math.min(a.se[1], b.se[1]);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  const holds = (a, x, y) => a && x >= a.nw[0] && x <= a.se[0] && y >= a.nw[1] && y <= a.se[1];

  function areaContaining(x, y, hintId) {
    const h = byId.get(hintId);
    if (holds(h, x, y)) return h;
    if (h) for (const n of h.connect) {
      const a = byId.get(n);
      if (holds(a, x, y)) return a;
    }
    for (const a of byId.values()) if (holds(a, x, y)) return a;
    return null;
  }

  function settle(px, py, nx, ny, curId, crossing) {
    const hit = areaContaining(nx, ny, curId);
    if (hit) return { pos: [nx, ny], area: hit };
    if (crossing != null) {
      const c = byId.get(crossing);
      const a = byId.get(curId);
      if (c && a) {
        const inSpan = nx >= Math.min(a.nw[0], c.nw[0]) && nx <= Math.max(a.se[0], c.se[0]) &&
          ny >= Math.min(a.nw[1], c.nw[1]) && ny <= Math.max(a.se[1], c.se[1]);
        if (inSpan) return { pos: [nx, ny], area: a };
      }
    }
    const here = areaContaining(px, py, curId) || byId.get(curId);
    if (!here) return { pos: [nx, ny], area: null };
    const cx = Math.min(Math.max(nx, here.nw[0]), here.se[0]);
    const cy = Math.min(Math.max(ny, here.nw[1]), here.se[1]);
    return { pos: [cx, cy], area: here };
  }

  return { byId, centers, nearestArea, areaAt, flowField, nextToward, portal, center, settle };
}

export function buildTrackChains(mapData) {
  const trackMap = new Map();
  for (const t of mapData.tracks) if (!trackMap.has(t.name)) trackMap.set(t.name, t);
  const chains = new Map();
  const chainFor = start => {
    let key = String(start || '').toLowerCase();
    if (!trackMap.has(key)) {
      const alt = key.replace(/_([a-z])(\d+)$/, '_$2');
      if (trackMap.has(alt)) key = alt;
    }
    if (chains.has(key)) return chains.get(key);
    let cur = trackMap.get(key);
    const pts = [];
    const seen = new Set();
    while (cur && !seen.has(cur.name)) {
      seen.add(cur.name);
      pts.push(cur.origin);
      cur = trackMap.get(cur.target);
    }
    let chain = null;
    if (pts.length > 1) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      chain = { poly: pts, cum };
    }
    chains.set(key, chain);
    return chain;
  };
  return { trackMap, chainFor };
}

export function chainPointAt(chain, dist) {
  const { poly, cum } = chain;
  if (dist <= 0) return poly[0];
  if (dist >= cum[cum.length - 1]) return poly[poly.length - 1];
  let lo = 0;
  while (lo < cum.length - 1 && cum[lo + 1] < dist) lo++;
  const seg = cum[lo + 1] - cum[lo] || 1;
  const f = (dist - cum[lo]) / seg;
  return [poly[lo][0] + (poly[lo + 1][0] - poly[lo][0]) * f, poly[lo][1] + (poly[lo + 1][1] - poly[lo][1]) * f];
}

export function objectiveCandidates(mapData, chains) {
  const out = [];
  const placed = p => p && (Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1);
  const caps = mapData.capzones.filter(placed);
  caps.forEach((c, i) => out.push({ label: caps.length > 1 ? 'hatch ' + (i + 1) : 'hatch', pos: c }));
  const flags = mapData.flags.filter(placed);
  flags.forEach((f, i) => out.push({ label: flags.length > 1 ? 'bomb ' + (i + 1) : 'bomb', pos: f }));
  if (!out.length) {
    const ends = [];
    for (const t of mapData.tracks) {
      if (!mapData.tracks.some(x => x.target === t.name)) {
        const c = chains.chainFor(t.name);
        if (c) ends.push({ label: 'end of ' + t.name, pos: c.poly[c.poly.length - 1], len: c.cum[c.cum.length - 1] });
      }
    }
    ends.sort((a, b) => b.len - a.len);
    for (const e of ends) out.push({ label: e.label, pos: e.pos });
  }
  if (!out.length) out.push({ label: 'map origin', pos: [0, 0, 0] });
  return out;
}

function findObjective(mapData, chains, idx) {
  const cands = objectiveCandidates(mapData, chains);
  return (cands[idx] || cands[0]).pos;
}

export function createBotSim(wave, sim, mapData, opts = {}) {
  const teamDPS = Number.isFinite(opts.teamDPS) ? opts.teamDPS : 1000;
  const deathModel = opts.deathModel === 'lifetime' || opts.deathModel === 'damage' ? opts.deathModel : 'hatch';
  const zoneWeights = opts.zoneWeights || null;
  const damageOn = deathModel === 'damage' && opts.zonesMode !== 'off' && teamDPS > 0;
  const HATCH_DESPAWN = 180;
  const killPoints = Array.isArray(opts.killPoints) ? opts.killPoints : [];
  const rng = mulberry32(0x7f4a7c15 ^ wave.index);
  const navVolumes = activeNavVolumes(mapData, opts);
  const commonProfile = costProfile(navVolumes, null, false);
  const carrierProfile = costProfile(navVolumes, null, true);
  const graphCache = new Map();
  const nav = buildNavGraph(mapData, commonProfile.volumes);
  graphCache.set(commonProfile.key, nav);
  const graphFor = profile => {
    if (!graphCache.has(profile.key)) graphCache.set(profile.key, buildNavGraph(mapData, profile.volumes, false));
    return graphCache.get(profile.key);
  };
  const profileOf = (bot, carrying) => carrying && !bot ? carrierProfile : costProfile(navVolumes, bot, carrying);
  const navOf = a => a.nav || nav;
  const chains = buildTrackChains(mapData);
  const hasNav = nav.byId.size > 0;
  const objective = findObjective(mapData, chains, opts.objectiveIdx || 0);
  const flagHome = mapData.flags[0] || null;
  const objArea = hasNav ? nav.nearestArea(objective) : null;
  const hatchField = objArea ? nav.flowField(objArea.id) : null;
  const hatchFieldOf = a => (objArea ? navOf(a).flowField(objArea.id) : null);
  let hatchMaxDist = 1;
  if (hatchField) {
    for (const s of mapData.spawns) {
      const a = nav.nearestArea(s.origin);
      const d = a ? hatchField.dist.get(a.id) : undefined;
      if (d !== undefined) hatchMaxDist = Math.max(hatchMaxDist, d);
    }
    if (hatchMaxDist <= 1) for (const d of hatchField.dist.values()) hatchMaxDist = Math.max(hatchMaxDist, d);
  }
  const zoneU = a => {
    if (!hatchField || a.areaId == null) return 0.5;
    const d = hatchField.dist.get(a.areaId);
    return d === undefined ? 0.5 : Math.min(1, d / hatchMaxDist);
  };
  const zoneW = a => zoneWeights ? (zoneWeights.get(a.areaId) || 0) : dpsProfile(zoneU(a));

  const spawnsByName = new Map();
  for (const s of mapData.spawns) {
    const k = s.name.toLowerCase();
    if (!spawnsByName.has(k)) spawnsByName.set(k, []);
    spawnsByName.get(k).push(s);
  }
  const enabledOf = list => list.filter(s => !s.disabled);
  const pickSpawn = whereNames => {
    const names = (whereNames && whereNames.length ? whereNames : ['spawnbot']).map(w => String(w).toLowerCase());
    let pool = [];
    for (const n of names) pool.push(...(spawnsByName.get(n) || []));
    let usable = enabledOf(pool);
    if (!usable.length) for (const [k, list] of spawnsByName) if (k.startsWith('spawnbot')) usable.push(...enabledOf(list));
    if (!usable.length) usable = pool;
    if (!usable.length) usable = enabledOf(mapData.spawns);
    if (!usable.length) usable = mapData.spawns;
    if (!usable.length) return { origin: objective, name: '?' };
    return usable[Math.floor(rng() * usable.length)];
  };

  const nests = mapData.hints.filter(h => h.kind === 'bot_hint_engineer_nest');
  const redSpawns = mapData.redSpawns.length ? mapData.redSpawns : [objective];

  const actors = [];
  let squadSeq = 0;
  let jitterSeq = 0;
  for (const ws of wave.wavespawns) {
    if (ws.isLogic) continue;
    const r = sim.results.get(ws);
    if (!r || !r.events.length) continue;
    if (ws.isTank) {
      const tankEntry = ws.bots.find(b => b.tank);
      const chain = chains.chainFor(tankEntry.tank.startNode);
      for (const ev of r.events) {
        for (let c = 0; c < ev.count; c++) {
          actors.push({ kind: 'tank', ws, tank: tankEntry.tank, spawnT: ev.t, simDieT: ev.t + r.life, chain, speed: tankEntry.tank.speed || 75 });
        }
      }
      continue;
    }
    const collect = sp => {
      const entries = [];
      const walk = s => {
        if (!s) return;
        if (s.kind === 'bot') entries.push({ bot: s.bot });
        else if (s.children) for (const c of s.children) walk(c);
      };
      walk(sp);
      return entries;
    };
    const instantiate = sp => instantiateSpawner(sp, { rng, collect, instantiate });

    let pending = [];
    let pendingSquadId = null;
    let pendingIdx = 0;
    let pendingSpawn = null;
    for (const ev of r.events) {
      for (let c = 0; c < ev.count; c++) {
        if (!pending.length) {
          const inst = instantiate(ws.spawner);
          if (!inst.entries.length) break;
          pending = inst.entries;
          pendingSquadId = inst.squad && pending.length > 1 ? ++squadSeq : null;
          pendingIdx = 0;
          pendingSpawn = null;
        }
        const entry = pending.shift();
        if (!pendingSpawn || !pendingSquadId) pendingSpawn = pickSpawn(ws.where);
        const spawn = pendingSpawn;
        actors.push({
          kind: 'bot', ws, bot: entry.bot, spawnT: ev.t, simDieT: ev.t + r.life,
          spawnPos: spawn.origin.slice(0, 3),
          squadId: pendingSquadId, squadRole: pendingSquadId ? (pendingIdx === 0 ? 'leader' : 'member') : null,
          memberIdx: pendingIdx
        });
        pendingIdx++;
        if (actors.length >= 2500) break;
      }
      if (actors.length >= 2500) break;
    }
  }

  const bomb = { pos: flagHome ? flagHome.slice(0, 2) : objective.slice(0, 2), home: flagHome ? flagHome.slice(0, 2) : null, carrier: null, deliveredAt: null, areaId: null };
  if (hasNav) {
    const a = nav.nearestArea(flagHome || objective);
    bomb.areaId = a ? a.id : null;
  }
  const bombFieldOf = a => (bomb.areaId != null ? navOf(a).flowField(bomb.areaId) : null);

  for (const a of actors) {
    a.samples = [];
    a.sampleStart = a.spawnT;
    a.alive = false;
    a.done = false;
    a.dieT = deathModel === 'lifetime' ? a.simDieT : Infinity;
    if (a.kind === 'tank' && deathModel === 'hatch') {
      a.dieT = a.chain && a.chain.cum.length ? a.spawnT + a.chain.cum[a.chain.cum.length - 1] / (a.speed || 75) : a.simDieT;
    }
  }
  const bombSamples = [];

  const clsOf = a => a.bot ? a.bot.cls : null;
  const eligible = a => a.kind === 'bot' && !a.bot.ignoreFlag && a.squadRole !== 'member' &&
    clsOf(a) !== 'spy' && clsOf(a) !== 'medic' && clsOf(a) !== 'engineer';

  const squadLeaders = new Map();

  const namedPoints = new Map();
  for (const s of mapData.spawns || []) if (s.name) namedPoints.set(s.name.toLowerCase(), s.origin);
  for (const tr of mapData.tracks || []) if (tr.name) namedPoints.set(tr.name.toLowerCase(), tr.origin);
  for (const p of mapData.pathProps || []) if (p.name) namedPoints.set(p.name.toLowerCase(), p.origin);
  for (const h of mapData.hints || []) if (h.hint) namedPoints.set(String(h.hint).toLowerCase(), h.origin);

  function resolvePoint(spec) {
    if (!spec) return null;
    if (spec.point) return spec.point;
    const name = (spec.entity || spec.target || '').toString().trim().toLowerCase();
    if (!name) return null;
    return namedPoints.get(name) || null;
  }

  function placeActor(a, p) {
    a.pos = [p[0], p[1]];
    if (p.length > 2) a.z = p[2];
    if (hasNav) {
      const area = navOf(a).nearestArea(p);
      if (area) {
        a.pos[0] = Math.min(Math.max(a.pos[0], area.nw[0]), area.se[0]);
        a.pos[1] = Math.min(Math.max(a.pos[1], area.nw[1]), area.se[1]);
        a.areaId = area.id;
      }
    }
  }

  function stepInterrupt(a, t, dt, speed) {
    const s = a.ia;
    if (!s) return false;
    const spec = s.spec;
    if (!s.active) {
      if (t < s.next) return false;
      if (spec.repeats > 0 && s.count >= spec.repeats) return false;
      s.active = true;
      s.arrived = false;
      s.until = spec.waitUntilDone ? Infinity : t + Math.max(0, spec.duration);
    }
    if (s.dest) {
      if (hasNav && s.field === undefined) {
        const area = navOf(a).nearestArea(s.dest);
        s.field = area ? navOf(a).flowField(area.id) : null;
      }
      const d = s.field ? moveField(a, s.field, s.dest, dt, speed) : moveAlong(a, s.dest, dt, speed);
      if (!s.arrived && d <= Math.max(spec.distance || 0, 40)) {
        s.arrived = true;
        if (s.until === Infinity) s.until = t + Math.max(0, spec.duration);
      }
    } else if (s.until === Infinity) {
      s.until = t + Math.max(0, spec.duration);
    }
    if (t >= s.until) {
      s.active = false;
      s.count++;
      s.next = t + Math.max(0, spec.cooldown);
      return false;
    }
    return true;
  }

  function initActor(a, t) {
    a.alive = true;
    a.sampleStart = t;
    a.spawnT = t;
    a.hp = a.kind === 'tank' ? (a.tank.health || 20000) : (a.bot.health || 100);
    if (a.squadRole === 'leader' && a.squadId) squadLeaders.set(a.squadId, a);
    a.pos = a.spawnPos ? a.spawnPos.slice(0, 2) : [0, 0];
    a.z = a.spawnPos ? a.spawnPos[2] : 0;
    if (a.kind === 'bot' && hasNav) a.nav = graphFor(profileOf(a.bot, false));
    if (a.kind === 'bot') a.shield = hasDemoShield(a.bot);
    const home = hasNav ? navOf(a).nearestArea(a.spawnPos || objective) : null;
    if (home && a.kind !== 'tank') {
      a.pos[0] = Math.min(Math.max(a.pos[0], home.nw[0]), home.se[0]);
      a.pos[1] = Math.min(Math.max(a.pos[1], home.nw[1]), home.se[1]);
    }
    a.areaId = home ? home.id : null;
    a.homeArea = a.areaId;
    const jang = jitterSeq++ * GOLDEN_ANGLE + rng() * 0.5;
    const jr = 18 + rng() * 8;
    a.jx = Math.cos(jang) * jr;
    a.jy = Math.sin(jang) * jr;
    a.zs = [];
    if (a.kind === 'tank') { a.state = 'tank'; return; }
    pipeline.spawn(a, t);
    const ia = (a.bot.interrupts || [])[0] || null;
    if (ia) {
      const dest = resolvePoint(ia.point ? { point: ia.point } : { target: ia.target });
      a.ia = { spec: ia, dest, next: t + Math.max(0, ia.delay), count: 0, active: false, until: 0, arrived: false };
    }
    const tps = a.bot.teleports || [];
    if (tps.length) a.tp = tps.map(x => ({ spec: x, at: t + Math.max(0, x.delay || 0), done: false }));
    const behaviour = selectBehaviour(a, ctx, capabilities);
    if (behaviour) {
      a.state = behaviour.id;
      if (behaviour.enter) behaviour.enter(a, ctx, t);
    }
  }

  function takeBomb(a) {
    bomb.carrier = a;
    a.state = 'deliverFlag';
    a.bombLevel = 0;
    a.bombUpgradeAt = null;
    a.tauntUntil = 0;
    if (hasNav && a.kind === 'bot') a.nav = graphFor(profileOf(a.bot, true));
  }

  function moveAlong(a, targetPt, dt, speed) {
    const g = navOf(a);
    if (g.moveAlong) return g.moveAlong(a, targetPt, dt, speed);
    const dx0 = targetPt[0] - a.pos[0], dy0 = targetPt[1] - a.pos[1];
    const straight = Math.hypot(dx0, dy0);
    let wp = targetPt;
    let crossing = null;
    if (hasNav && a.areaId != null) {
      const tArea = g.areaAt(targetPt, null);
      if (tArea && tArea.id !== a.areaId) {
        const field = g.flowField(tArea.id);
        const next = g.nextToward(field, a.areaId);
        if (next != null) {
          crossing = next;
          const p = g.portal(a.areaId, next);
          if (p) wp = p;
        }
      }
    }
    let dx = wp[0] - a.pos[0], dy = wp[1] - a.pos[1];
    const d = Math.hypot(dx, dy) || 1;
    const stepLen = Math.min(d, speed * dt);
    const nx = a.pos[0] + dx / d * stepLen;
    const ny = a.pos[1] + dy / d * stepLen;
    if (hasNav && g.settle) {
      const s = g.settle(a.pos[0], a.pos[1], nx, ny, a.areaId, crossing);
      a.pos[0] = s.pos[0];
      a.pos[1] = s.pos[1];
      if (s.area) { a.areaId = s.area.id; a.z = (s.area.nw[2] + s.area.se[2]) / 2; }
    } else {
      a.pos[0] = nx;
      a.pos[1] = ny;
    }
    return straight;
  }

  function moveField(a, field, targetPt, dt, speed) {
    if (!hasNav || a.areaId == null || !field) return moveAlong(a, targetPt, dt, speed);
    const g = navOf(a);
    if (g.moveField) return g.moveField(a, field, targetPt, dt, speed);
    const tArea = g.areaAt(targetPt, null);
    if (tArea && a.areaId === tArea.id) return moveAlong(a, targetPt, dt, speed);
    const next = g.nextToward(field, a.areaId);
    if (next == null) return moveAlong(a, targetPt, dt, speed);
    const p = g.portal(a.areaId, next) || g.center(next);
    let dx = p[0] - a.pos[0], dy = p[1] - a.pos[1];
    let d = Math.hypot(dx, dy);
    if (d < 24) {
      a.areaId = next;
      const c = g.center(next);
      dx = c[0] - a.pos[0]; dy = c[1] - a.pos[1];
      d = Math.hypot(dx, dy) || 1;
    }
    const stepLen = speed * dt;
    const nx = a.pos[0] + dx / (d || 1) * Math.min(d, stepLen);
    const ny = a.pos[1] + dy / (d || 1) * Math.min(d, stepLen);
    const s = g.settle(a.pos[0], a.pos[1], nx, ny, a.areaId, next);
    a.pos[0] = s.pos[0];
    a.pos[1] = s.pos[1];
    if (s.area) { a.areaId = s.area.id; a.z = (s.area.nw[2] + s.area.se[2]) / 2; }
    return Math.hypot(targetPt[0] - a.pos[0], targetPt[1] - a.pos[1]);
  }

  function areaOf(a) {
    return a.areaId == null ? null : navOf(a).byId.get(a.areaId);
  }

  function holds(ar, x, y) {
    return ar && x >= ar.nw[0] && x <= ar.se[0] && y >= ar.nw[1] && y <= ar.se[1];
  }

  function nudge(a, dx, dy) {
    const nx = a.pos[0] + dx, ny = a.pos[1] + dy;
    if (!hasNav || a.areaId == null) { a.pos[0] = nx; a.pos[1] = ny; return; }
    const cur = areaOf(a);
    if (holds(cur, nx, ny)) { a.pos[0] = nx; a.pos[1] = ny; return; }
    const near = navOf(a).areaAt([nx, ny, a.z], a.areaId);
    if (holds(near, nx, ny)) {
      a.pos[0] = nx; a.pos[1] = ny;
      a.areaId = near.id;
      a.z = (near.nw[2] + near.se[2]) / 2;
      return;
    }
    if (!cur) return;
    a.pos[0] = Math.min(Math.max(nx, cur.nw[0]), cur.se[0]);
    a.pos[1] = Math.min(Math.max(ny, cur.nw[1]), cur.se[1]);
  }

  function dropBomb() {
    if (!bomb.carrier) return;
    const prev = bomb.carrier;
    bomb.pos = prev.pos.slice();
    bomb.carrier = null;
    if (hasNav && prev.kind === 'bot') prev.nav = graphFor(profileOf(prev.bot, false));
    if (hasNav) {
      const a = nav.areaAt(bomb.pos, null);
      bomb.areaId = a ? a.id : null;
    }
  }

  const spawnRooms = mapData.spawnRooms || [];

  function inBlueSpawn(a) {
    if (a.areaId != null) {
      const ar = nav.byId.get(a.areaId);
      if (ar && (ar.tf & TF_NAV_SPAWN_ROOM_BLUE)) return true;
    }
    if (!a.pos) return false;
    for (const r of spawnRooms) {
      if (a.pos[0] >= r.mins[0] && a.pos[0] <= r.maxs[0] &&
          a.pos[1] >= r.mins[1] && a.pos[1] <= r.maxs[1] &&
          a.z >= r.mins[2] - 96 && a.z <= r.maxs[2] + 96) return true;
    }
    return false;
  }

  function upgradeOverTime(a, t) {
    if (a.bot.isGiant || a.bot.noBombUpgrades || a.bombLevel >= 3) return;
    if (a.bombUpgradeAt == null || inBlueSpawn(a)) {
      a.bombUpgradeAt = t + BOMB_UPGRADE_1;
      return;
    }
    if (t < a.bombUpgradeAt) return;
    a.bombLevel++;
    const taunt = BOMB_TAUNT_MIN + rng() * (BOMB_TAUNT_MAX - BOMB_TAUNT_MIN);
    a.tauntUntil = t + taunt;
    a.bombUpgradeAt = a.bombLevel === 1 ? t + BOMB_UPGRADE_2 + taunt
      : a.bombLevel === 2 ? t + BOMB_UPGRADE_3 + taunt : Infinity;
  }

  function chargeStep(a, t, dt, speed) {
    if (a.chargeMeter === undefined) { a.chargeMeter = 100; a.chargeUntil = 0; }
    const mult = a.bot.chargeRechargeMult || 1;
    if (t < a.chargeUntil) return CHARGE_SPEED;
    if (a.chargeMeter >= 100) {
      a.chargeUntil = t + CHARGE_TIME * (a.bot.chargeTimeMult || 1);
      a.chargeMeter = 0;
      return CHARGE_SPEED;
    }
    a.chargeMeter = Math.min(100, a.chargeMeter + dt * Math.max(1, CHARGE_REGEN * mult));
    return speed;
  }

  function killActor(a, t) {
    if (bomb.carrier === a) dropBomb();
    a.dieT = t;
    a.alive = false;
    live.delete(a);
  }

  const live = new Set();
  const waiting = [];
  const robotLimit = Math.max(1, Math.round(opts.robotLimit || sim.robotLimit || 22));
  let cursor = 0;
  let si = 0;
  let endT = 0;
  let finished = false;
  const sorted = [...actors].sort((x, y) => x.spawnT - y.spawnT);

  const maxT = damageOn ? sim.waveEnd + 600 : sim.waveEnd + 90;

  const events = createEventBus();
  try {
    seedWaveEvents(events, wave, sim, { waveStartOutputs, wavespawnOutputs });
  } catch {}

  const ctx = {
    wave, sim, mapData, opts, events,
    rng, deathModel, teamDPS, robotLimit,
    actors, live, bomb, bombSamples, squadLeaders,
    nav, hasNav, navOf, graphFor, objective, objArea, chains,
    nests, redSpawns, spawnsByName, namedPoints,
    clsOf, eligible, zoneW, killActor, nudge, areaOf, holds, placeActor,
    hatchFieldOf, bombFieldOf, resolvePoint,
    moveAlong, moveField, takeBomb, dropBomb, upgradeOverTime
  };

  const capabilities = new Set();
  if (hasNav) capabilities.add('nav');
  if (damageOn) capabilities.add('damage');
  const pipeline = buildPipeline(ctx, capabilities);

  function step() {
    const t = si * STEP;
    if (si >= MAX_STEPS || t > maxT || (cursor >= sorted.length && !waiting.length && live.size === 0 && t > sim.waveEnd)) return false;
    endT = t;
    while (cursor < sorted.length && sorted[cursor].spawnT <= t) waiting.push(sorted[cursor++]);
    if (waiting.length) {
      let bots = 0;
      for (const a of live) if (a.kind !== 'tank') bots++;
      for (let i = 0; i < waiting.length;) {
        const a = waiting[i];
        if (a.kind !== 'tank' && bots >= robotLimit) { i++; continue; }
        waiting.splice(i, 1);
        initActor(a, t);
        live.add(a);
        if (a.kind !== 'tank') bots++;
      }
    }
    for (const a of live) {
      if (t >= a.dieT || a.done) {
        killActor(a, Math.min(t, a.dieT));
        continue;
      }
      const dt = STEP;
      if (a.kind === 'tank') {
        if (a.chain) {
          const p = chainPointAt(a.chain, a.speed * (t - a.spawnT));
          a.pos = [p[0], p[1]];
        } else a.pos = a.pos || (a.spawnPos ? a.spawnPos.slice(0, 2) : objective.slice(0, 2));
        let tculled = false;
        for (const kp of killPoints) {
          const dx = kp[0] - a.pos[0], dy = kp[1] - a.pos[1];
          const rr = kp[2] || 200;
          if (dx * dx + dy * dy < rr * rr) { killActor(a, t); tculled = true; break; }
        }
        if (tculled) continue;
        if (hasNav) {
          const na = nav.areaAt(a.pos, a.areaId);
          if (na) { a.areaId = na.id; a.z = (na.nw[2] + na.se[2]) / 2; }
        }
        continue;
      }
      const cls = clsOf(a);
      const hasFlag = bomb.carrier === a;
      let speed = botMaxSpeed(a.bot, hasFlag);
      if (a.shield) speed = chargeStep(a, t, dt, speed);
      if (t < (a.tauntUntil || 0)) {
        if (hasFlag) bomb.pos = a.pos.slice();
        continue;
      }

      if (a.tp) {
        for (const j of a.tp) {
          if (j.done || t < j.at) continue;
          j.done = true;
          const p = resolvePoint(j.spec.teleport);
          if (p) placeActor(a, p);
        }
      }

      if (a.ia && stepInterrupt(a, t, dt, speed)) {
        if (hasFlag) bomb.pos = a.pos.slice();
        continue;
      }

      const behaviour = behaviours.get(a.state);
      if (behaviour) behaviour.step(a, ctx, t, dt, speed);

      let culled = false;
      for (const kp of killPoints) {
        const dx = kp[0] - a.pos[0], dy = kp[1] - a.pos[1];
        const rr = kp[2] || 200;
        if (dx * dx + dy * dy < rr * rr) { killActor(a, t); culled = true; break; }
      }
      if (culled) continue;
      if (a.state !== 'deployBomb' && bomb.carrier !== a && !(objArea && a.homeArea === objArea.id)) {
        const hx = objective[0] - a.pos[0], hy = objective[1] - a.pos[1];
        const atHatch = hx * hx + hy * hy < HATCH_DESPAWN * HATCH_DESPAWN
          || (objArea && a.areaId === objArea.id);
        if (atHatch) {
          killActor(a, t);
          continue;
        }
      }

    }

    pipeline.run(t, STEP);
    si++;
    return true;
  }

  function stepMany(n) {
    for (let k = 0; k < n && !finished; k++) {
      if (!step()) finished = true;
    }
    return finished;
  }

  let finalized = null;
  function result() {
    if (finalized) return finalized;
    stepMany(Infinity);
    for (const a of actors) {
      a.track = new Float32Array(a.samples);
      a.ztrack = new Float32Array(a.zs || []);
      delete a.samples;
      delete a.zs;
    }
    finalized = {
      actors, objective, chains, nav, end: Math.max(endT, 10), teamDPS, deathModel,
      bomb: { samples: bombSamples, deliveredAt: bomb.deliveredAt, home: bomb.home },
      hatchDist: hatchField ? hatchField.dist : null, hatchMaxDist,
      navVolumes, route: buildBombRoute()
    };
    return finalized;
  }

  function routeStart() {
    let startArea = null, startPt = null, best = -1;
    const consider = origin => {
      if (!origin) return;
      const a = nav.nearestArea(origin);
      if (!a) return;
      const d = hatchField.dist.get(a.id);
      if (d === undefined || d <= best) return;
      best = d; startArea = a; startPt = origin;
    };
    const used = new Set();
    for (const ws of wave.wavespawns) {
      if (ws.isLogic || ws.isTank) continue;
      for (const w of (ws.where || [])) used.add(String(w).toLowerCase());
    }
    const usedSpawns = [];
    for (const k of used) usedSpawns.push(...(spawnsByName.get(k) || []));
    const enabledUsed = usedSpawns.filter(s => !s.disabled);
    for (const s of (enabledUsed.length ? enabledUsed : usedSpawns)) consider(s.origin);
    if (!startArea) for (const [k, list] of spawnsByName) if (k.startsWith('spawnbot')) for (const s of list.filter(x => !x.disabled)) consider(s.origin);
    if (!startArea) for (const s of (mapData.spawns || [])) consider(s.origin);
    return { startArea, startPt };
  }

  function buildBombRoute() {
    if (!hasNav || !objArea || !hatchField) return null;
    const { startArea, startPt } = routeStart();
    if (!startArea) return null;
    const g = graphFor(carrierProfile);
    const field = g.flowField(objArea.id);
    if (!field) return null;
    const raw = [];
    if (startPt) {
      raw.push([
        Math.min(Math.max(startPt[0], startArea.nw[0]), startArea.se[0]),
        Math.min(Math.max(startPt[1], startArea.nw[1]), startArea.se[1])
      ]);
    }
    const seen = new Set();
    let cur = startArea.id, guard = 0;
    while (cur !== objArea.id && guard++ < 4000 && !seen.has(cur)) {
      seen.add(cur);
      const nxt = g.nextToward(field, cur);
      if (nxt == null) break;
      const p = g.portal(cur, nxt) || g.center(nxt);
      if (p) raw.push([p[0], p[1]]);
      cur = nxt;
    }
    raw.push([objective[0], objective[1]]);
    const pts = [];
    for (const p of raw) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 8) pts.push(p);
    }
    return pts.length > 1 ? smoothRoute(pts) : null;
  }

  function smoothRoute(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      out.push([b[0] * 0.5 + (a[0] + c[0]) * 0.25, b[1] * 0.5 + (a[1] + c[1]) * 0.25]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  return { stepMany, result, progress: () => Math.min(1, cursor / Math.max(1, sorted.length) * 0.4 + si / MAX_STEPS * 0.6), estSteps: () => si };
}

export function simulateBotAI(wave, sim, mapData, opts = {}) {
  return createBotSim(wave, sim, mapData, opts).result();
}

export function actorZAt(a, t) {
  const z = a.ztrack;
  if (!z || !z.length) return a.z ?? 0;
  const idx = Math.round((t - a.sampleStart) / STEP);
  return z[Math.max(0, Math.min(z.length - 1, idx))];
}

export function actorPosAt(a, t) {
  if (t < a.spawnT || !a.track || !a.track.length) return null;
  const idx = (t - a.sampleStart) / STEP;
  const n = a.track.length / 2;
  if (idx <= 0) return [a.track[0], a.track[1]];
  if (idx >= n - 1) return t > a.dieT ? null : [a.track[(n - 1) * 2], a.track[(n - 1) * 2 + 1]];
  const i0 = Math.floor(idx);
  const f = idx - i0;
  return [
    a.track[i0 * 2] + (a.track[i0 * 2 + 2] - a.track[i0 * 2]) * f,
    a.track[i0 * 2 + 1] + (a.track[i0 * 2 + 3] - a.track[i0 * 2 + 1]) * f
  ];
}
