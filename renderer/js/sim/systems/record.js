export const bombFollow = {
  id: 'bomb-follow',
  order: 30,
  step(ctx) {
    const carrier = ctx.bomb.carrier;
    if (carrier && carrier.pos) ctx.bomb.pos = carrier.pos.slice();
  }
};

export const record = {
  id: 'record',
  order: 40,
  step(ctx) {
    for (const a of ctx.live) {
      const n = a.samples.length;
      if (n >= 2) {
        const px = a.samples[n - 2], py = a.samples[n - 1];
        if (Math.hypot(a.pos[0] - px, a.pos[1] - py) > 1) a.heading = Math.atan2(a.pos[1] - py, a.pos[0] - px);
      }
      a.samples.push(a.pos[0], a.pos[1]);
      a.zs.push(a.z || 0);
    }
  }
};

export const bombTrail = {
  id: 'bomb-trail',
  order: 60,
  step(ctx) {
    ctx.bombSamples.push(ctx.bomb.carrier ? ctx.bomb.carrier.pos.slice() : ctx.bomb.pos.slice());
  }
};
