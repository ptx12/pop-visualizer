const CARRIER_HEALTH_REGEN = 45;

export const carrierRegen = {
  id: 'carrier-regen',
  order: 25,
  requires: ['damage'],
  step(ctx, t, dt) {
    const carrier = ctx.bomb.carrier;
    if (!carrier || !carrier.alive || carrier.hp == null || carrier.kind !== 'bot') return;
    const max = carrier.bot.health || 100;
    if (carrier.hp >= max) return;
    carrier.hp = Math.min(max, carrier.hp + CARRIER_HEALTH_REGEN * dt);
  }
};
