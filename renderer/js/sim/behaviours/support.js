import { RANGES, healTarget } from '../systems/healing.js';

const SPY_TELEPORT_RING = 1500;
const SPY_RING_STEP = 500;
const SPY_RING_MAX = 6000;
const SPY_ATTEMPTS = 9;
const SPY_LURK_RANGE = 350;
const SPY_LURK_SPEED = 0.6;

export const medicHeal = {
  id: 'medicHeal',
  order: 40,
  selects(a, ctx) { return ctx.clsOf(a) === 'medic'; },
  step(a, ctx, t, dt, speed) {
    const target = healTarget(ctx, a);
    a.patient = target;
    if (!target) {
      ctx.moveField(a, ctx.hatchFieldOf(a), ctx.objective, dt, speed);
      return;
    }
    const d = Math.hypot(target.pos[0] - a.pos[0], target.pos[1] - a.pos[1]);
    if (d > RANGES.START_FOLLOW_RANGE) a.following = true;
    else if (d < RANGES.STOP_FOLLOW_RANGE) a.following = false;
    if (!a.following) return;
    const field = target.areaId != null ? ctx.navOf(a).flowField(target.areaId) : null;
    ctx.moveField(a, field, target.pos, dt, speed);
  }
};

export const spyLeaveSpawn = {
  id: 'spyLeaveSpawn',
  order: 20,
  selects(a, ctx) { return ctx.clsOf(a) === 'spy'; },
  enter(a, ctx, t) {
    a.spyAt = t + 2 + ctx.rng();
    a.spyAttempt = 0;
  },
  step(a, ctx, t) {
    if (t < a.spyAt) return;
    const victim = ctx.redSpawns[Math.floor(ctx.rng() * ctx.redSpawns.length)];
    const nav = ctx.nav;
    for (let attempt = 0; attempt <= SPY_ATTEMPTS; attempt++) {
      const ring = Math.min(SPY_TELEPORT_RING + a.spyAttempt * SPY_RING_STEP, SPY_RING_MAX);
      const cand = [];
      for (const ar of nav.byId.values()) {
        const c = nav.center(ar.id);
        const d = Math.hypot(c[0] - victim[0], c[1] - victim[1]);
        if (d > ring * 0.4 && d < ring) cand.push(ar);
      }
      if (cand.length) {
        const ar = cand[Math.floor(ctx.rng() * cand.length)];
        const c = nav.center(ar.id);
        a.pos = [c[0], c[1]];
        a.areaId = ar.id;
        a.state = 'spyLurk';
        a.victim = victim;
        return;
      }
      a.spyAttempt++;
    }
    a.state = 'spyLurk';
    a.victim = victim;
  }
};

export const spyLurk = {
  id: 'spyLurk',
  step(a, ctx, t, dt, speed) {
    const d = Math.hypot(a.victim[0] - a.pos[0], a.victim[1] - a.pos[1]);
    if (d <= SPY_LURK_RANGE) return;
    const g = ctx.navOf(a);
    const field = ctx.hasNav ? g.flowField((g.nearestArea(a.victim) || {}).id) : null;
    ctx.moveField(a, field, a.victim, dt, speed * SPY_LURK_SPEED);
  }
};

const NEST_ARRIVE_RANGE = 25;
const HINT_TELEPORT_DELAY = 0.1;
const FIND_NEST_RETRY_MIN = 1;
const FIND_NEST_RETRY_MAX = 2;
const HINT_BOMB_FORWARD_RANGE = 0;
const HINT_BOMB_BACKWARD_RANGE = 3000;
const HINT_MIN_DISTANCE_FROM_BOMB = 1300;

export function findEngineerNest(ctx, rng, t = 0, outOfRangeOk = true) {
  const all = ctx.nests || [];
  const nests = ctx.hintLive ? all.filter(n => ctx.hintLive(n, t)) : all;
  if (!nests.length) return null;
  const bombDist = ctx.hatchDistAt(ctx.bomb.pos);
  const outside = ctx.hatchDistOutsideSpawns();
  if (bombDist == null || outside == null) return nests[Math.floor(rng() * nests.length)] || null;
  const hatchDist = Math.min(outside, bombDist);
  const back = hatchDist + HINT_BOMB_BACKWARD_RANGE;
  const fwd = hatchDist - HINT_BOMB_FORWARD_RANGE;
  const inBand = [], beyond = [], ahead = [];
  for (const n of nests) {
    const d = ctx.hatchDistAt(n.origin);
    if (d == null) continue;
    if (d > fwd && d < back) {
      const away = Math.hypot(n.origin[0] - ctx.bomb.pos[0], n.origin[1] - ctx.bomb.pos[1]);
      if (away >= HINT_MIN_DISTANCE_FROM_BOMB) inBand.push(n);
    } else if (d > back) beyond.push(n);
    else ahead.push(n);
  }
  const pick = list => (list.length ? list[Math.floor(rng() * list.length)] : null);
  const chosen = pick(inBand);
  if (chosen || !outOfRangeOk) return chosen;
  return pick(beyond) || pick(ahead);
}

export const engineerToNest = {
  id: 'engineerToNest',
  order: 30,
  selects(a, ctx) { return ctx.clsOf(a) === 'engineer'; },
  enter(a, ctx, t) {
    a.nestRetryAt = t;
    takeNest(a, ctx, t);
  },
  step(a, ctx, t, dt, speed) {
    if (a.nestWaiting) {
      if (t < a.nestRetryAt) return;
      takeNest(a, ctx, t);
      if (a.nestWaiting) return;
    }
    if (a.hintTeleportAt != null) {
      if (t < a.hintTeleportAt) return;
      a.hintTeleportAt = null;
      a.viaTeleporter = true;
      ctx.placeActor(a, a.nest);
      a.state = 'engineerBuild';
      return;
    }
    const d = ctx.moveField(a, a.nestField, a.nest, dt, speed);
    if (d <= NEST_ARRIVE_RANGE || d <= speed * dt) a.state = 'engineerBuild';
  }
};

function takeNest(a, ctx, t) {
  const toHint = !!(a.bot && a.bot.teleportToHint);
  const best = findEngineerNest(ctx, ctx.rng, t, !toHint);
  if (!best && toHint && (ctx.nests || []).length) {
    a.nestWaiting = true;
    a.nestRetryAt = t + FIND_NEST_RETRY_MIN + ctx.rng() * (FIND_NEST_RETRY_MAX - FIND_NEST_RETRY_MIN);
    return;
  }
  a.nestWaiting = false;
  a.nestHint = best;
  a.nest = best ? best.origin : (a.spawnPos || ctx.objective);
  a.nestField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(a.nest) || { id: -1 }).id) : null;
  a.hintTeleportAt = toHint && best ? t + HINT_TELEPORT_DELAY : null;
}

export const engineerBuild = {
  id: 'engineerBuild',
  step(a, ctx, t) {
    const where = (a.bot && a.bot.teleportWhere) || [];
    if (!where.length || a.builtTeleporter) return;
    a.builtTeleporter = true;
    let pos = a.nest || a.pos;
    const nestName = a.nestHint && a.nestHint.name;
    const live = (ctx.teleExits || []).filter(h => !ctx.hintLive || ctx.hintLive(h, t));
    const owned = nestName ? live.filter(h => h.name === nestName) : [];
    if (owned.length) pos = owned[Math.floor(ctx.rng() * owned.length)].origin;
    else {
      let bestD = Infinity;
      for (const h of live) {
        const d = (h.origin[0] - a.pos[0]) ** 2 + (h.origin[1] - a.pos[1]) ** 2;
        if (d < bestD) { bestD = d; pos = h.origin; }
      }
    }
    ctx.teleporters.push({
      pos: [pos[0], pos[1], Number.isFinite(pos[2]) ? pos[2] : (a.z || 0)],
      where: new Set(where.map(w => String(w).toLowerCase())),
      readyAt: t + (ctx.teleporterBuildTime || 0),
      by: a
    });
  }
};


export function isSentryBuster(a) {
  const m = a.ws && a.ws.mission;
  return !!(m && /destroysentr/i.test(String(m.objective || '')));
}

export const busterToSentry = {
  id: 'busterToSentry',
  order: 25,
  selects(a, ctx) { return isSentryBuster(a) && (ctx.nests || []).length > 0; },
  enter(a, ctx, t) {
    const nests = ctx.hintLive ? (ctx.nests || []).filter(n => ctx.hintLive(n, t)) : (ctx.nests || []);
    let best = null, bestD = Infinity;
    for (const n of nests) {
      const d = (n.origin[0] - a.pos[0]) ** 2 + (n.origin[1] - a.pos[1]) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    a.sentry = best ? best.origin : ctx.objective;
    a.sentryField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(a.sentry) || { id: -1 }).id) : null;
  },
  step(a, ctx, t, dt, speed) {
    ctx.moveField(a, a.sentryField, a.sentry, dt, speed);
    if (ctx.sameArea(a, a.sentry)) { a.reachedSentry = true; ctx.killActor(a, t); }
  }
};

const inGateVolume = (a, g) => {
  const b = g.def.bounds;
  if (!b) return false;
  const z = a.z ?? 0;
  return a.pos[0] >= b.mins[0] && a.pos[0] <= b.maxs[0]
    && a.pos[1] >= b.mins[1] && a.pos[1] <= b.maxs[1]
    && z >= b.mins[2] - 64 && z <= b.maxs[2] + 64;
};

export const gatebotToGate = {
  id: 'gatebotToGate',
  order: 45,
  selects(a, ctx) { return !!(a.isGatebot && ctx.nextGate && ctx.nextGate()); },
  enter(a, ctx) {
    const g = ctx.nextGate();
    a.gate = g;
    a.gateField = g && ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(g.pos) || { id: -1 }).id) : null;
  },
  step(a, ctx, t, dt, speed) {
    if (!a.gate || a.gate.capturedAt !== null) {
      const g = ctx.nextGate();
      if (!g) { a.state = 'fetchFlag'; return; }
      a.gate = g;
      a.gateField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(g.pos) || { id: -1 }).id) : null;
    }
    const order = ctx.navOrder ? ctx.navOrder(a, t) : null;
    if (order && order.prereq !== a.navOrderFrom) {
      a.navOrderFrom = order.prereq;
      a.navOrderDest = order.dest || null;
      a.navWaitUntil = order.wait != null ? t + order.wait : null;
      a.navOrderField = order.dest && ctx.hasNav
        ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(order.dest) || { id: -1 }).id)
        : null;
    }
    if (a.navWaitUntil != null) {
      if (t < a.navWaitUntil) return;
      a.navWaitUntil = null;
    }
    if (a.navOrderDest) {
      const od = ctx.moveField(a, a.navOrderField, a.navOrderDest, dt, speed);
      if (od > NEST_ARRIVE_RANGE && !inGateVolume(a, a.gate)) return;
      a.navOrderDest = null;
      a.navOrderFrom = null;
    } else {
      ctx.moveField(a, a.gateField, a.gate.pos, dt, speed);
    }
    if (!inGateVolume(a, a.gate)) return;
    if (!ctx.gateCappable(a.gate, t)) return;
    a.gate.holders++;
  }
};


export const sniperToSpot = {
  id: 'sniperToSpot',
  order: 26,
  selects(a, ctx) { return ctx.clsOf(a) === 'sniper' && (ctx.sniperSpots || []).length > 0; },
  enter(a, ctx, t) {
    const all = ctx.sniperSpots || [];
    const spots = ctx.hintLive ? all.filter(h => ctx.hintLive(h, t)) : all;
    let best = null, bestD = Infinity;
    for (const h of spots) {
      const d = (h.origin[0] - ctx.bomb.pos[0]) ** 2 + (h.origin[1] - ctx.bomb.pos[1]) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
    a.sniperSpot = best ? best.origin : (a.spawnPos || ctx.objective);
    a.sniperField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(a.sniperSpot) || { id: -1 }).id) : null;
  },
  step(a, ctx, t, dt, speed) {
    ctx.moveField(a, a.sniperField, a.sniperSpot, dt, speed);
    if (ctx.sameArea(a, a.sniperSpot)) a.state = 'sniperLurk';
  }
};

export const idle = {
  id: 'idle',
  order: 5,
  selects(a) { return !!(a.bot && behaviourIsIdle(a.bot.action)); },
  step() {}
};

const behaviourIsIdle = action => /^(idle|passive)$/i.test(String(action || '').trim());

export const sniperLurk = {
  id: 'sniperLurk',
  step() {}
};
