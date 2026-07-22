const STOP_FOLLOW_RANGE = 75;
const START_FOLLOW_RANGE = 250;
const MAX_HEAL_RANGE = 600;
const HEAL_RATE = 24;
const HEAL_RAMP = 3;
const RAMP_DELAY = 10;

export const RANGES = { STOP_FOLLOW_RANGE, START_FOLLOW_RANGE, MAX_HEAL_RANGE };

export function healTarget(ctx, a) {
  if (a.patient && a.patient.alive) return a.patient;
  if (a.squadId) {
    const lead = ctx.squadLeaders.get(a.squadId);
    if (lead && lead.alive && lead !== a) return lead;
  }
  let best = null, bestD = Infinity;
  for (const x of ctx.live) {
    if (x === a || x.kind !== 'bot' || ctx.clsOf(x) === 'medic') continue;
    if (a.squadId && x.squadId !== a.squadId) continue;
    const d = (x.pos[0] - a.pos[0]) ** 2 + (x.pos[1] - a.pos[1]) ** 2;
    if (d < bestD) { bestD = d; best = x; }
  }
  return best;
}

export const healing = {
  id: 'healing',
  order: 20,
  spawn(a, ctx) {
    if (a.kind !== 'bot' || ctx.clsOf(a) !== 'medic') return;
    a.patient = null;
    a.following = false;
    a.healed = 0;
  },
  step(ctx, t, dt) {
    for (const a of ctx.live) {
      if (a.kind !== 'bot' || ctx.clsOf(a) !== 'medic') continue;
      a.patient = healTarget(ctx, a);
      const p = a.patient;
      if (!p || !p.alive || p.hp == null) continue;
      const max = p.bot.health || 100;
      if (p.hp >= max) continue;
      const d = Math.hypot(p.pos[0] - a.pos[0], p.pos[1] - a.pos[1]);
      if (d > MAX_HEAL_RANGE) continue;
      const ramp = t - (p.lastHurtT ?? -Infinity) >= RAMP_DELAY ? HEAL_RAMP : 1;
      p.hp = Math.min(max, p.hp + HEAL_RATE * ramp * dt);
      a.healed += HEAL_RATE * ramp * dt;
    }
  }
};
