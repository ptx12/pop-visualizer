import { buildNavGraphWasm, navWasmReady } from './navwasm.js';
import { STEP, botMaxSpeed, dpsProfile, botScale, hasDemoShield, mulberry32, CLASS_BASE_SPEED, TF_MAX_SPEED } from './sim/bots.js';

export { STEP, botMaxSpeed, dpsProfile, botScale, hasDemoShield, mulberry32, CLASS_BASE_SPEED, TF_MAX_SPEED };

const MAX_STEPS = 6000;
const GOAL_TOLERANCE = 25;
export const ACTOR_CAP = 2500;
export const RNG_SEED_BASE = 0x7f4a7c15;
const BOMB_MAX_LEVEL = 3;
const BOMB_UPGRADE_1 = 5;
const BOMB_UPGRADE_2 = 15;
const BOMB_UPGRADE_3 = 15;
const BOMB_TAUNT_MIN = 3;
const BOMB_TAUNT_MAX = 5;
const CHARGE_SPEED = 750;
const CHARGE_TIME = 1.5;
const CHARGE_REGEN = 8.3;
const TF_NAV_SPAWN_ROOM_BLUE = 0x4;
const TF_NAV_SPAWN_ROOM_RED = 0x2;
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
    if (mapPaths && mapPaths.pool.has(n)) {
      if (mapPaths.on.has(n)) return true;
      if (mapPaths.off.has(n)) return false;
      return !v.startDisabled;
    }
    if (v.startDisabled) return bombPath ? pathKeyOf(v.name) === bombPath : false;
    return true;
  }
  return !v.startDisabled;
}

function mapPathSets(mapData, bombPath) {
  const paths = mapData.bombPaths || [];
  if (!paths.length) return null;
  const pool = new Set();
  for (const p of paths) {
    for (const n of p.enable) pool.add(n);
    for (const n of p.disable || []) pool.add(n);
  }
  const chosen = bombPath ? paths.find(p => p.key === bombPath) : null;
  return {
    pool,
    on: new Set(chosen ? chosen.enable : []),
    off: new Set(chosen && chosen.disable ? chosen.disable : [])
  };
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

const NAV_MAX_JUMP_HEIGHT = 57;

export function navAreaZ(a, x, y) {
  const dx = a.se[0] - a.nw[0];
  const dy = a.se[1] - a.nw[1];
  const u = Math.abs(dx) < 1e-9 ? 0 : Math.max(0, Math.min(1, (x - a.nw[0]) / dx));
  const v = Math.abs(dy) < 1e-9 ? 0 : Math.max(0, Math.min(1, (y - a.nw[1]) / dy));
  const neZ = Number.isFinite(a.neZ) ? a.neZ : a.nw[2];
  const swZ = Number.isFinite(a.swZ) ? a.swZ : a.se[2];
  const north = a.nw[2] + u * (neZ - a.nw[2]);
  const south = swZ + u * (a.se[2] - swZ);
  return north + v * (south - north);
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
      const az = navAreaZ(a, p[0], p[1]);
      const dz = az - (p[2] ?? az);
      const d = (cx - p[0]) ** 2 + (cy - p[1]) ** 2 + dz * dz * 0.4;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function areaAt(p, hintId) {
    const hit = areaContaining(p[0], p[1], p[2], hintId);
    return hit || nearestArea(p);
  }

  function flowField(targetId) {
    if (fields.has(targetId)) return fields.get(targetId);
    const dist = new Map([[targetId, 0]]);
    const heap = [[0, 0, targetId]];
    let seq = 1;
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = it => {
      heap.push(it);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(heap[i], heap[p])) break;
        const t = heap[i]; heap[i] = heap[p]; heap[p] = t;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          const t = heap[i]; heap[i] = heap[m]; heap[m] = t;
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, , cur] = pop();
      if (d > (dist.get(cur) ?? Infinity)) continue;
      const cc = center(cur);
      for (const p of rev.get(cur) || []) {
        const pc = center(p);
        const step = Math.hypot(pc[0] - cc[0], pc[1] - cc[1]) + Math.abs(pc[2] - cc[2]) * 0.5;
        const nd = d + step * (weights.get(p) || 1);
        if (nd < (dist.get(p) ?? Infinity)) {
          dist.set(p, nd);
          push([nd, seq++, p]);
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

  function betterGround(best, cand, x, y, z) {
    if (!best) return true;
    const limit = z + NAV_MAX_JUMP_HEIGHT;
    const cz = navAreaZ(cand, x, y);
    const bz = navAreaZ(best, x, y);
    const cOk = cz <= limit;
    const bOk = bz <= limit;
    if (cOk !== bOk) return cOk;
    return cOk ? cz > bz : cz < bz;
  }

  function areaContaining(x, y, z, hintId) {
    const flat = !Number.isFinite(z);
    let best = null;
    const consider = a => {
      if (!holds(a, x, y)) return false;
      if (flat) { best = a; return true; }
      if (betterGround(best, a, x, y, z)) best = a;
      return false;
    };
    const h = byId.get(hintId);
    if (h) {
      if (holds(h, x, y)) return h;
      for (const n of h.connect) {
        const c = byId.get(n);
        if (holds(c, x, y)) return c;
      }
    }
    for (const a of byId.values()) if (consider(a)) return best;
    return best;
  }

  function settle(px, py, pz, nx, ny, curId, crossing) {
    const hit = areaContaining(nx, ny, pz, curId);
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
    const here = areaContaining(px, py, pz, curId) || byId.get(curId);
    if (!here) return { pos: [nx, ny], area: null };
    const cx = Math.min(Math.max(nx, here.nw[0]), here.se[0]);
    const cy = Math.min(Math.max(ny, here.nw[1]), here.se[1]);
    return { pos: [cx, cy], area: here };
  }

  return { byId, centers, nearestArea, areaAt, flowField, nextToward, portal, center, settle, areaContaining };
}

export function buildTrackChains(mapData, extraTankPaths = []) {
  const trackMap = new Map();
  for (const t of mapData.tracks) if (!trackMap.has(t.name)) trackMap.set(t.name, t);
  const extraByName = new Map();
  for (const p of extraTankPaths || []) if (p && p.name && p.nodes && p.nodes.length > 1) extraByName.set(String(p.name).toLowerCase(), p.nodes);
  const chains = new Map();
  const chainFor = start => {
    let key = String(start || '').toLowerCase();
    if (extraByName.has(key)) {
      if (chains.has(key)) return chains.get(key);
      const pts = extraByName.get(key);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const chain = { poly: pts, cum };
      chains.set(key, chain);
      return chain;
    }
    if (!trackMap.has(key)) {
      const alt = key.replace(/_([a-z])(\d+)$/, '_$2');
      if (trackMap.has(alt)) key = alt;
    }
    if (chains.has(key)) return chains.get(key);
    let cur = trackMap.get(key);
    const pts = [];
    const names = [];
    const seen = new Set();
    while (cur && !seen.has(cur.name)) {
      seen.add(cur.name);
      pts.push(cur.origin);
      names.push(cur.name);
      cur = trackMap.get(cur.target);
    }
    let chain = null;
    if (pts.length > 1) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      chain = { poly: pts, cum, names };
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
  return [
    poly[lo][0] + (poly[lo + 1][0] - poly[lo][0]) * f,
    poly[lo][1] + (poly[lo + 1][1] - poly[lo][1]) * f,
    poly[lo][2] + (poly[lo + 1][2] - poly[lo][2]) * f
  ];
}

export function objectiveCandidates(mapData, chains) {
  const out = [];
  const placed = p => p && (Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1);
  const caps = mapData.capzones.filter(placed);
  caps.forEach((c, i) => out.push({ label: caps.length > 1 ? 'hatch ' + (i + 1) : 'hatch', pos: c }));
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
  if (!out.length) {
    const flags = mapData.flags.filter(placed);
    flags.forEach((f, i) => out.push({ label: flags.length > 1 ? 'bomb ' + (i + 1) : 'bomb', pos: f }));
  }
  if (!out.length) out.push({ label: 'map origin', pos: [0, 0, 0] });
  return out;
}

function findObjective(mapData, chains, idx) {
  const cands = objectiveCandidates(mapData, chains);
  return (cands[idx] || cands[0]).pos;
}

const PREREQ_Z_SLACK = 64;

export function isSentryBuster(a) {
  const m = a.ws && a.ws.mission;
  return !!(m && /destroysentr/i.test(String(m.objective || '')));
}
