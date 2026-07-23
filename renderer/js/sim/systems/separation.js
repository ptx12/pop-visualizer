import { botScale, botMaxSpeed, HULL_HALF_XY, HULL_HEIGHT } from '../bots.js';

const MAX_SEPARATION_FORCE = 256;
const SUBSTEPS = 2;

export const separation = {
  id: 'separation',
  order: 10,
  init(ctx) {
    const n = ctx.actors.length;
    return {
      act: new Array(n),
      px: new Float64Array(n), py: new Float64Array(n),
      hx: new Float64Array(n), hz: new Float64Array(n), zc: new Float64Array(n),
      dx: new Float64Array(n), dy: new Float64Array(n), hit: new Int32Array(n)
    };
  },
  step(ctx, t, dt, s) {
    if (ctx.botPushaway === false) return;
    for (let k = 0; k < SUBSTEPS; k++) pass(ctx, dt / SUBSTEPS, s);
  }
};

function pass(ctx, dt, s) {
  let n = 0;
  for (const a of ctx.live) {
    if (a.kind !== 'bot' || !a.pos || a.bot.noPushAway) continue;
    const scale = botScale(a.bot);
    s.act[n] = a;
    s.px[n] = a.pos[0];
    s.py[n] = a.pos[1];
    s.hx[n] = HULL_HALF_XY * scale;
    s.hz[n] = HULL_HEIGHT * scale;
    s.zc[n] = (a.z || 0) + HULL_HEIGHT * scale / 2;
    n++;
  }
  if (n < 2) return;
  let moves = 0;
  for (let i = 0; i < n; i++) {
    let hx = 0, hy = 0, hj = -1;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const ddx = s.px[j] - s.px[i], ddy = s.py[j] - s.py[i];
      const rx = s.hx[i] + s.hx[j];
      if (ddx >= rx || ddx <= -rx || ddy >= rx || ddy <= -rx) continue;
      const dz = s.zc[j] - s.zc[i];
      const rz = (s.hz[i] + s.hz[j]) / 2;
      if (dz >= rz || dz <= -rz) continue;
      hx = ddx; hy = ddy; hj = j;
      break;
    }
    if (hj < 0) continue;
    const a = s.act[i];
    const dist = Math.hypot(hx, hy);
    const avoidRadius = s.hx[hj] * 2 * Math.SQRT2;
    const push = avoidRadius > 0
      ? Math.min(MAX_SEPARATION_FORCE, Math.max(0, (avoidRadius - dist) / avoidRadius * MAX_SEPARATION_FORCE))
      : 0;
    if (push < 0.01) continue;
    let ddx = hx, ddy = hy;
    if (ddx * ddx + ddy * ddy < 1e-4) { ddx = a.jx; ddy = a.jy; }
    const sn = a.samples.length;
    let vx = sn >= 2 ? a.pos[0] - a.samples[sn - 2] : 0;
    let vy = sn >= 2 ? a.pos[1] - a.samples[sn - 1] : 0;
    if (Math.hypot(vx, vy) < 0.1) { vx = Math.cos(a.heading || 0); vy = Math.sin(a.heading || 0); }
    let nx = -vy, ny = vx;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (ddx * nx + ddy * ny >= 0) { nx = -nx; ny = -ny; }
    const slide = Math.min(push, botMaxSpeed(a.bot, ctx.bomb.carrier === a, ctx.carrierPenalty, ctx.maxSpeed)) * dt;
    s.hit[moves] = i;
    s.dx[moves] = nx * slide;
    s.dy[moves] = ny * slide;
    moves++;
  }
  for (let k = 0; k < moves; k++) ctx.nudge(s.act[s.hit[k]], s.dx[k], s.dy[k]);
}
