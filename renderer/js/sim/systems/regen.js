const CARRIER_HEALTH_REGEN = 45;

export const carrierRegen = {
  id: 'regen',
  order: 25,
  requires: ['damage'],
  step(ctx, t, dt) {
    for (const a of ctx.live) {
      if (a.kind !== 'bot' || !a.alive || a.hp == null) continue;
      const rate = (a.bot.healthRegen || 0) + (ctx.bomb.carrier === a ? CARRIER_HEALTH_REGEN : 0);
      if (rate === 0) continue;
      const max = a.bot.health || 100;
      if (rate > 0 && a.hp >= max) continue;
      a.hp = Math.min(max, a.hp + rate * dt);
      if (a.hp <= 0) ctx.killActor(a, t);
    }
  }
};
