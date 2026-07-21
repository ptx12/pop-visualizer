export const CLASS_BASE_SPEED = { scout: 400, soldier: 240, pyro: 300, demoman: 280, heavyweapons: 230, engineer: 300, medic: 320, sniper: 300, spy: 320, unknown: 300 };
export const TF_MAX_SPEED = 520;
export const STEP = 0.25;
const FLAG_ESCORT_RANGE = 500;
const SQUAD_ESCORT_RANGE = 500;
const DEPLOY_TIME = 1.9;
const CARRIER_PENALTY = 0.5;
const PICKUP_RANGE = 64;
const AUTO_FLAG_AGE = 1.0;
const SPY_TELEPORT_RING = 1500;
const SPY_RING_STEP = 500;
const SPY_RING_MAX = 6000;
const MAX_STEPS = 6000;

export function botMaxSpeed(bot, hasFlag) {
  let s = CLASS_BASE_SPEED[bot.cls] ?? 300;
  s *= bot.moveSpeedMult || 1;
  if (hasFlag && !bot.isGiant) s *= CARRIER_PENALTY;
  return Math.min(s, TF_MAX_SPEED);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dpsProfile(u) {
  if (u > 0.93) return 0;
  return Math.exp(-((u / 0.16) ** 2)) + 0.85 * Math.exp(-(((u - 0.8) / 0.2) ** 2)) + 0.08;
}

const AVOID_COST = 9;
const PREFER_COST = 0.45;

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

function volumeActive(v, activeNames, bombPath) {
  if (v.name) {
    const n = v.name.toLowerCase();
    if (activeNames.disabled.has(n)) return false;
    if (activeNames.enabled.has(n)) return true;
    if (v.startDisabled) return bombPath ? pathKeyOf(v.name) === bombPath : false;
    return true;
  }
  return !v.startDisabled;
}

export function activeNavVolumes(mapData, opts = {}) {
  const activeNames = {
    enabled: new Set((opts.enabledNames || []).map(s => String(s).toLowerCase())),
    disabled: new Set((opts.disabledNames || []).map(s => String(s).toLowerCase()))
  };
  return (mapData.navVolumes || []).filter(v => volumeActive(v, activeNames, opts.bombPath || null));
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

export function buildNavGraph(mapData, volumes) {
  const weights = areaWeights(mapData, volumes || []);
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

  return { byId, centers, nearestArea, areaAt, flowField, nextToward, portal, center };
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
  const nav = buildNavGraph(mapData, navVolumes);
  const chains = buildTrackChains(mapData);
  const hasNav = nav.byId.size > 0;
  const objective = findObjective(mapData, chains, opts.objectiveIdx || 0);
  const flagHome = mapData.flags[0] || null;
  const objArea = hasNav ? nav.nearestArea(objective) : null;
  const hatchField = objArea ? nav.flowField(objArea.id) : null;
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
    const instantiate = sp => {
      if (!sp) return { entries: [], squad: false };
      if (sp.kind === 'bot') return { entries: [{ bot: sp.bot }], squad: false };
      if (sp.kind === 'randomchoice') {
        const kids = (sp.children || []).filter(Boolean);
        if (!kids.length) return { entries: [], squad: false };
        return instantiate(kids[Math.floor(rng() * kids.length)]);
      }
      const entries = [];
      const walk = s => {
        if (!s) return;
        if (s.kind === 'bot') entries.push({ bot: s.bot });
        else if (s.kind === 'randomchoice') {
          const kids = (s.children || []).filter(Boolean);
          if (kids.length) walk(kids[Math.floor(rng() * kids.length)]);
        } else if (s.children) {
          for (const c of s.children) walk(c);
        }
      };
      walk(sp);
      return { entries, squad: sp.kind === 'squad' };
    };
    let pending = [];
    let pendingSquadId = null;
    let pendingIdx = 0;
    for (const ev of r.events) {
      for (let c = 0; c < ev.count; c++) {
        if (!pending.length) {
          const inst = instantiate(ws.spawner);
          if (!inst.entries.length) break;
          pending = inst.entries;
          pendingSquadId = inst.squad && pending.length > 1 ? ++squadSeq : null;
          pendingIdx = 0;
        }
        const entry = pending.shift();
        const spawn = pickSpawn(ws.where);
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
  let bombField = bomb.areaId != null ? nav.flowField(bomb.areaId) : null;

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

  function initActor(a, t) {
    a.alive = true;
    a.sampleStart = t;
    a.hp = a.kind === 'tank' ? (a.tank.health || 20000) : (a.bot.health || 100);
    if (a.squadRole === 'leader' && a.squadId) squadLeaders.set(a.squadId, a);
    a.pos = a.spawnPos ? a.spawnPos.slice(0, 2) : [0, 0];
    a.z = a.spawnPos ? a.spawnPos[2] : 0;
    a.areaId = hasNav ? (nav.nearestArea(a.spawnPos || objective) || {}).id ?? null : null;
    a.homeArea = a.areaId;
    a.jx = (rng() * 2 - 1) * 26;
    a.jy = (rng() * 2 - 1) * 26;
    if (a.kind === 'tank') { a.state = 'tank'; return; }
    const cls = clsOf(a);
    if (a.squadRole === 'member') a.state = 'escortSquadLeader';
    else if (cls === 'spy') { a.state = 'spyLeaveSpawn'; a.spyAt = t + 2 + rng(); a.spyAttempt = 0; }
    else if (cls === 'engineer') {
      a.state = 'engineerToNest';
      let best = null, bestD = Infinity;
      for (const n of nests) {
        const d = (n.origin[0] - bomb.pos[0]) ** 2 + (n.origin[1] - bomb.pos[1]) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
      a.nest = best ? best.origin : (a.spawnPos || objective);
      a.nestField = hasNav ? nav.flowField((nav.nearestArea(a.nest) || { id: -1 }).id) : null;
    }
    else if (cls === 'medic') a.state = 'medicHeal';
    else if (a.bot.ignoreFlag) a.state = 'pushToPoint';
    else {
      a.state = 'fetchFlag';
      if (!bomb.carrier && bomb.deliveredAt == null && eligible(a) && bomb.home &&
          Math.abs(bomb.pos[0] - bomb.home[0]) + Math.abs(bomb.pos[1] - bomb.home[1]) < 1 && t - a.spawnT <= AUTO_FLAG_AGE) {
        bomb.carrier = a;
        a.state = 'deliverFlag';
      }
    }
  }

  function moveAlong(a, targetPt, dt, speed) {
    const dx0 = targetPt[0] - a.pos[0], dy0 = targetPt[1] - a.pos[1];
    const straight = Math.hypot(dx0, dy0);
    let wp = targetPt;
    if (hasNav && straight > 260 && a.areaId != null) {
      const tArea = nav.areaAt(targetPt, null);
      if (tArea && tArea.id !== a.areaId) {
        const field = nav.flowField(tArea.id);
        const next = nav.nextToward(field, a.areaId);
        if (next != null) {
          const p = nav.portal(a.areaId, next);
          if (p) wp = p;
        }
      }
    }
    let dx = wp[0] - a.pos[0], dy = wp[1] - a.pos[1];
    const d = Math.hypot(dx, dy) || 1;
    const stepLen = Math.min(d, speed * dt);
    a.pos[0] += dx / d * stepLen;
    a.pos[1] += dy / d * stepLen;
    if (hasNav) {
      const na = nav.areaAt(a.pos, a.areaId);
      if (na) { a.areaId = na.id; a.z = (na.nw[2] + na.se[2]) / 2; }
    }
    return straight;
  }

  function moveField(a, field, targetPt, dt, speed) {
    if (!hasNav || a.areaId == null || !field) return moveAlong(a, targetPt, dt, speed);
    const tArea = nav.areaAt(targetPt, null);
    if (tArea && a.areaId === tArea.id) return moveAlong(a, targetPt, dt, speed);
    const next = nav.nextToward(field, a.areaId);
    if (next == null) return moveAlong(a, targetPt, dt, speed);
    const p = nav.portal(a.areaId, next) || nav.center(next);
    let dx = p[0] - a.pos[0], dy = p[1] - a.pos[1];
    let d = Math.hypot(dx, dy);
    if (d < 24) {
      a.areaId = next;
      const c = nav.center(next);
      dx = c[0] - a.pos[0]; dy = c[1] - a.pos[1];
      d = Math.hypot(dx, dy) || 1;
    }
    const stepLen = speed * dt;
    a.pos[0] += dx / (d || 1) * Math.min(d, stepLen);
    a.pos[1] += dy / (d || 1) * Math.min(d, stepLen);
    const na = nav.areaAt(a.pos, a.areaId);
    if (na) { a.areaId = na.id; a.z = (na.nw[2] + na.se[2]) / 2; }
    return Math.hypot(targetPt[0] - a.pos[0], targetPt[1] - a.pos[1]);
  }

  function dropBomb() {
    if (!bomb.carrier) return;
    bomb.pos = bomb.carrier.pos.slice();
    bomb.carrier = null;
    if (hasNav) {
      const a = nav.areaAt(bomb.pos, null);
      bomb.areaId = a ? a.id : null;
      bombField = bomb.areaId != null ? nav.flowField(bomb.areaId) : null;
    }
  }

  function killActor(a, t) {
    if (bomb.carrier === a) dropBomb();
    a.dieT = t;
    a.alive = false;
    live.delete(a);
  }

  const live = new Set();
  let cursor = 0;
  let si = 0;
  let endT = 0;
  let finished = false;
  const sorted = [...actors].sort((x, y) => x.spawnT - y.spawnT);

  const maxT = damageOn ? sim.waveEnd + 600 : sim.waveEnd + 90;

  function step() {
    const t = si * STEP;
    if (si >= MAX_STEPS || t > maxT || (cursor >= sorted.length && live.size === 0 && t > sim.waveEnd)) return false;
    endT = t;
    while (cursor < sorted.length && sorted[cursor].spawnT <= t) {
      const a = sorted[cursor++];
      initActor(a, t);
      live.add(a);
    }
    for (const a of live) {
      if (t >= a.dieT || a.done) {
        killActor(a, Math.min(t, a.dieT));
        continue;
      }
      const dt = STEP;
      if (a.kind === 'tank') {
        let tculled = false;
        for (const kp of killPoints) {
          const p0 = a.pos || (a.spawnPos ? a.spawnPos : objective);
          const dx = kp[0] - p0[0], dy = kp[1] - p0[1];
          const rr = kp[2] || 200;
          if (dx * dx + dy * dy < rr * rr) { killActor(a, t); tculled = true; break; }
        }
        if (tculled) continue;
        if (a.chain) {
          const p = chainPointAt(a.chain, a.speed * (t - a.spawnT));
          a.pos = [p[0], p[1]];
        } else a.pos = a.pos || (a.spawnPos ? a.spawnPos.slice(0, 2) : objective.slice(0, 2));
        if (hasNav) {
          const na = nav.areaAt(a.pos, a.areaId);
          if (na) a.areaId = na.id;
        }
        a.samples.push(a.pos[0], a.pos[1]);
        continue;
      }
      const cls = clsOf(a);
      const hasFlag = bomb.carrier === a;
      const speed = botMaxSpeed(a.bot, hasFlag);

      if (a.state === 'deliverFlag') {
        const d = moveField(a, hatchField, objective, dt, speed);
        bomb.pos = a.pos.slice();
        if (d < 60) {
          a.state = 'deployBomb';
          a.deployUntil = t + DEPLOY_TIME;
        }
      } else if (a.state === 'deployBomb') {
        bomb.pos = a.pos.slice();
        if (t >= a.deployUntil) {
          bomb.deliveredAt = t;
          bomb.carrier = null;
          a.done = true;
          a.dieT = t;
        }
      } else if (a.state === 'fetchFlag') {
        if (bomb.deliveredAt != null) a.state = 'pushToPoint';
        else if (bomb.carrier) a.state = 'escortFlagCarrier';
        else {
          const d = moveField(a, bombField, bomb.pos, dt, speed);
          if (d < PICKUP_RANGE && eligible(a)) {
            bomb.carrier = a;
            a.state = 'deliverFlag';
          }
        }
      } else if (a.state === 'escortFlagCarrier') {
        if (!bomb.carrier) a.state = bomb.deliveredAt != null ? 'pushToPoint' : 'fetchFlag';
        else {
          const c = bomb.carrier.pos;
          const d = Math.hypot(c[0] - a.pos[0], c[1] - a.pos[1]);
          if (d > FLAG_ESCORT_RANGE * 0.5) {
            const carrierField = bomb.carrier.areaId != null ? nav.flowField(bomb.carrier.areaId) : null;
            moveField(a, carrierField, [c[0] + a.jx, c[1] + a.jy], dt, speed);
          }
        }
      } else if (a.state === 'pushToPoint') {
        const d = moveField(a, hatchField, objective, dt, speed);
        if (d < 150) { a.pos[0] += (rng() - 0.5) * 8; a.pos[1] += (rng() - 0.5) * 8; }
      } else if (a.state === 'escortSquadLeader') {
        const leader = squadLeaders.get(a.squadId);
        if (!leader || !leader.alive) {
          a.squadRole = 'leader';
          squadLeaders.set(a.squadId, a);
          a.state = a.bot.ignoreFlag || !eligible(a) ? 'pushToPoint' : 'fetchFlag';
        } else {
          const slotAng = (a.memberIdx % 2 ? 1 : -1) * (Math.PI / 6) * (1 + (a.memberIdx >> 1) * 0.5);
          const heading = leader.heading ?? 0;
          const sx = leader.pos[0] - Math.cos(heading + slotAng) * 90;
          const sy = leader.pos[1] - Math.sin(heading + slotAng) * 90;
          const d = Math.hypot(leader.pos[0] - a.pos[0], leader.pos[1] - a.pos[1]);
          if (d > SQUAD_ESCORT_RANGE) {
            const lf = leader.areaId != null ? nav.flowField(leader.areaId) : null;
            moveField(a, lf, leader.pos, dt, speed * 1.15);
          } else {
            moveAlong(a, [sx, sy], dt, speed);
          }
        }
      } else if (a.state === 'medicHeal') {
        let target = null, bestD = Infinity;
        for (const x of live) {
          if (x === a || x.kind !== 'bot' || clsOf(x) === 'medic') continue;
          if (a.squadId && x.squadId !== a.squadId) continue;
          const d = (x.pos[0] - a.pos[0]) ** 2 + (x.pos[1] - a.pos[1]) ** 2;
          if (d < bestD) { bestD = d; target = x; }
        }
        if (target) {
          const d = Math.hypot(target.pos[0] - a.pos[0], target.pos[1] - a.pos[1]);
          if (d > 120) {
            const tf = target.areaId != null ? nav.flowField(target.areaId) : null;
            moveField(a, tf, target.pos, dt, speed);
          }
        } else moveField(a, hatchField, objective, dt, speed);
      } else if (a.state === 'spyLeaveSpawn') {
        if (t >= a.spyAt) {
          const victim = redSpawns[Math.floor(rng() * redSpawns.length)];
          let placed = false;
          for (let attempt = 0; attempt <= 9 && !placed; attempt++) {
            const ring = Math.min(SPY_TELEPORT_RING + a.spyAttempt * SPY_RING_STEP, SPY_RING_MAX);
            const cand = [];
            for (const ar of nav.byId.values()) {
              const c = nav.center(ar.id);
              const d = Math.hypot(c[0] - victim[0], c[1] - victim[1]);
              if (d > ring * 0.4 && d < ring) cand.push(ar);
            }
            if (cand.length) {
              const ar = cand[Math.floor(rng() * cand.length)];
              const c = nav.center(ar.id);
              a.pos = [c[0], c[1]];
              a.areaId = ar.id;
              a.state = 'spyLurk';
              a.victim = victim;
              placed = true;
            } else a.spyAttempt++;
          }
          if (!placed) { a.state = 'spyLurk'; a.victim = victim; }
        }
      } else if (a.state === 'spyLurk') {
        const d = Math.hypot(a.victim[0] - a.pos[0], a.victim[1] - a.pos[1]);
        if (d > 350) {
          const vf = hasNav ? nav.flowField((nav.nearestArea(a.victim) || {}).id) : null;
          moveField(a, vf, a.victim, dt, speed * 0.6);
        }
      } else if (a.state === 'engineerToNest') {
        const d = moveField(a, a.nestField, a.nest, dt, speed);
        if (d < 40) a.state = 'engineerBuild';
      } else if (a.state === 'engineerBuild') {
      }

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

      const px = a.samples.length >= 2 ? a.samples[a.samples.length - 2] : a.pos[0];
      const py = a.samples.length >= 2 ? a.samples[a.samples.length - 1] : a.pos[1];
      if (Math.hypot(a.pos[0] - px, a.pos[1] - py) > 1) a.heading = Math.atan2(a.pos[1] - py, a.pos[0] - px);
      a.samples.push(a.pos[0], a.pos[1]);
    }

    if (damageOn && live.size) {
      let W = 0;
      const parts = [];
      for (const a of live) {
        if (a.kind !== 'bot' && a.kind !== 'tank') continue;
        const w = zoneW(a) * (a.kind === 'tank' ? 1.5 : 1);
        if (w <= 0) continue;
        parts.push([a, w]);
        W += w;
      }
      if (W > 0) {
        for (const [a, w] of parts) {
          a.hp -= teamDPS * STEP * w / (W + 2);
          if (a.hp <= 0) killActor(a, t);
        }
      }
    }
    bombSamples.push(bomb.carrier ? bomb.carrier.pos.slice() : bomb.pos.slice());
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
      delete a.samples;
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
    const raw = [];
    if (startPt) raw.push([startPt[0], startPt[1]]);
    const seen = new Set();
    let cur = startArea.id, guard = 0;
    while (cur !== objArea.id && guard++ < 4000 && !seen.has(cur)) {
      seen.add(cur);
      const nxt = nav.nextToward(hatchField, cur);
      if (nxt == null) break;
      const p = nav.portal(cur, nxt) || nav.center(nxt);
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
