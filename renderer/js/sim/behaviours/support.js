import { RANGES, healTarget } from '../systems/healing.js';

const SPY_TELEPORT_RING = 1500;
const SPY_RING_STEP = 500;
const SPY_RING_MAX = 6000;
const SPY_ATTEMPTS = 9;
const SPY_LURK_RANGE = 350;
const SPY_LURK_SPEED = 0.6;
const NEST_ARRIVE_RANGE = 40;

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

export const engineerToNest = {
  id: 'engineerToNest',
  order: 30,
  selects(a, ctx) { return ctx.clsOf(a) === 'engineer'; },
  enter(a, ctx) {
    let best = null, bestD = Infinity;
    for (const n of ctx.nests) {
      const d = (n.origin[0] - ctx.bomb.pos[0]) ** 2 + (n.origin[1] - ctx.bomb.pos[1]) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    a.nest = best ? best.origin : (a.spawnPos || ctx.objective);
    a.nestField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(a.nest) || { id: -1 }).id) : null;
  },
  step(a, ctx, t, dt, speed) {
    const d = ctx.moveField(a, a.nestField, a.nest, dt, speed);
    if (d < NEST_ARRIVE_RANGE) a.state = 'engineerBuild';
  }
};

const TELEPORTER_BUILD_TIME = 10;

export const engineerBuild = {
  id: 'engineerBuild',
  step(a, ctx, t) {
    const where = (a.bot && a.bot.teleportWhere) || [];
    if (!where.length || a.builtTeleporter) return;
    a.builtTeleporter = true;
    let pos = a.nest || a.pos;
    let bestD = Infinity;
    for (const h of ctx.teleExits || []) {
      const d = (h.origin[0] - a.pos[0]) ** 2 + (h.origin[1] - a.pos[1]) ** 2;
      if (d < bestD) { bestD = d; pos = h.origin; }
    }
    ctx.teleporters.push({
      pos: [pos[0], pos[1], Number.isFinite(pos[2]) ? pos[2] : (a.z || 0)],
      where: new Set(where.map(w => String(w).toLowerCase())),
      readyAt: t + TELEPORTER_BUILD_TIME,
      by: a
    });
  }
};

const BUSTER_ARRIVE_RANGE = 90;

export function isSentryBuster(a) {
  const m = a.ws && a.ws.mission;
  return !!(m && /destroysentr/i.test(String(m.objective || '')));
}

export const busterToSentry = {
  id: 'busterToSentry',
  order: 25,
  selects(a, ctx) { return isSentryBuster(a) && (ctx.nests || []).length > 0; },
  enter(a, ctx) {
    let best = null, bestD = Infinity;
    for (const n of ctx.nests) {
      const d = (n.origin[0] - a.pos[0]) ** 2 + (n.origin[1] - a.pos[1]) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    a.sentry = best ? best.origin : ctx.objective;
    a.sentryField = ctx.hasNav ? ctx.navOf(a).flowField((ctx.navOf(a).nearestArea(a.sentry) || { id: -1 }).id) : null;
  },
  step(a, ctx, t, dt, speed) {
    const d = ctx.moveField(a, a.sentryField, a.sentry, dt, speed);
    if (d < BUSTER_ARRIVE_RANGE) { a.reachedSentry = true; ctx.killActor(a, t); }
  }
};

const GATE_CAPTURE_RANGE = 180;

export const gatebotToGate = {
  id: 'gatebotToGate',
  order: 22,
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
    const d = ctx.moveField(a, a.gateField, a.gate.pos, dt, speed);
    if (d > GATE_CAPTURE_RANGE) return;
    a.gate.holders++;
    if (a.gate.holders < a.gate.def.capCount) return;
    a.gate.progress += dt;
    if (a.gate.progress >= a.gate.def.capTime) ctx.captureGate(a.gate, t);
  }
};
