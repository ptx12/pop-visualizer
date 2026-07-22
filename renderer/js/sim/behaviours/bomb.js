const DEPLOY_TIME = 1.9;
const PICKUP_RANGE = 64;
const AUTO_FLAG_AGE = 1.0;
const FLAG_ESCORT_RANGE = 500;
const FLAG_ESCORT_GIVE_UP_RANGE = 1000;
const FLAG_ESCORT_MAX_COUNT = 4;
const DEPLOY_RANGE = 60;

function escortCount(ctx) {
  let n = 0;
  for (const x of ctx.live) if (x.state === 'escortFlagCarrier') n++;
  return n;
}

export const fetchFlag = {
  id: 'fetchFlag',
  order: 60,
  selects() { return true; },
  enter(a, ctx, t) {
    const bomb = ctx.bomb;
    if (!bomb.carrier && bomb.deliveredAt == null && ctx.eligible(a) && bomb.home &&
        Math.abs(bomb.pos[0] - bomb.home[0]) + Math.abs(bomb.pos[1] - bomb.home[1]) < 1 &&
        t - a.spawnT <= AUTO_FLAG_AGE) {
      ctx.takeBomb(a);
    }
  },
  step(a, ctx, t, dt, speed) {
    const bomb = ctx.bomb;
    if (bomb.deliveredAt != null) { a.state = 'pushToPoint'; return; }
    if (bomb.carrier) { a.state = 'escortFlagCarrier'; return; }
    const d = ctx.moveField(a, ctx.bombFieldOf(a), bomb.pos, dt, speed);
    if (d < PICKUP_RANGE && ctx.eligible(a)) ctx.takeBomb(a);
  }
};

export const deliverFlag = {
  id: 'deliverFlag',
  step(a, ctx, t, dt, speed) {
    ctx.upgradeOverTime(a, t);
    const d = ctx.moveField(a, ctx.hatchFieldOf(a), ctx.objective, dt, speed);
    ctx.bomb.pos = a.pos.slice();
    if (d < DEPLOY_RANGE) {
      a.state = 'deployBomb';
      a.deployUntil = t + DEPLOY_TIME;
    }
  }
};

export const deployBomb = {
  id: 'deployBomb',
  step(a, ctx, t) {
    ctx.bomb.pos = a.pos.slice();
    if (t < a.deployUntil) return;
    ctx.bomb.deliveredAt = t;
    ctx.bomb.carrier = null;
    a.done = true;
    a.dieT = t;
  }
};

export const escortFlagCarrier = {
  id: 'escortFlagCarrier',
  step(a, ctx, t, dt, speed) {
    const bomb = ctx.bomb;
    if (!bomb.carrier) {
      a.state = bomb.deliveredAt != null ? 'pushToPoint' : 'fetchFlag';
      return;
    }
    const c = bomb.carrier.pos;
    const d = Math.hypot(c[0] - a.pos[0], c[1] - a.pos[1]);
    if (d > FLAG_ESCORT_GIVE_UP_RANGE) { a.state = 'pushToPoint'; return; }
    if (d <= FLAG_ESCORT_RANGE * 0.5) return;
    if (escortCount(ctx) > FLAG_ESCORT_MAX_COUNT) { a.state = 'pushToPoint'; return; }
    const field = bomb.carrier.areaId != null ? ctx.navOf(a).flowField(bomb.carrier.areaId) : null;
    ctx.moveField(a, field, [c[0] + a.jx, c[1] + a.jy], dt, speed);
  }
};

export const pushToPoint = {
  id: 'pushToPoint',
  order: 50,
  selects(a) { return !!a.bot.ignoreFlag; },
  step(a, ctx, t, dt, speed) {
    ctx.moveField(a, ctx.hatchFieldOf(a), ctx.objective, dt, speed);
  }
};
