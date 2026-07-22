import { STEP } from '../bots.js';

export const damageZones = {
  id: 'damage-zones',
  order: 50,
  requires: ['damage'],
  step(ctx, t) {
    if (!ctx.live.size) return;
    let W = 0;
    const parts = [];
    for (const a of ctx.live) {
      if (a.kind !== 'bot' && a.kind !== 'tank') continue;
      const w = ctx.zoneW(a) * (a.kind === 'tank' ? 1.5 : 1);
      if (w <= 0) continue;
      parts.push([a, w]);
      W += w;
    }
    if (W <= 0) return;
    for (const [a, w] of parts) {
      a.hp -= ctx.teamDPS * STEP * w / (W + 2);
      a.lastHurtT = t;
      if (a.hp <= 0) ctx.killActor(a, t);
    }
  }
};
