// CPU particle simulator driving TF2's own particle definitions (parsed from particles/*.pcf).
// Implements the operator/initializer set that actually dominates the stock content — measured
// across all 134 stock files, these cover the overwhelming majority of every system:
//   emitters      emit_continuously, emit_instantaneously
//   initializers  Lifetime/Radius/Color/Alpha Random, Position Within Sphere Random,
//                 Position Modify Offset Random, Rotation Random
//   operators     Movement Basic (gravity/drag), Radius Scale, Lifespan Decay,
//                 Alpha Fade Out/In Random, Alpha Fade and Decay, Color Fade, Rotation Spin Roll
//   renderer      render_animated_sprites
const num = (attrs, key, dflt = 0) => {
  const v = attrs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
};
const vec = (attrs, key) => (Array.isArray(attrs[key]) ? attrs[key] : [0, 0, 0]);
const find = (list, re) => (list || []).find(f => re.test(f.cls || f.name || ''));
const rnd = (a, b) => a + Math.random() * (b - a);

export function compileSystem(sys) {
  if (!sys) return null;
  const em = find(sys.emitters, /emit_continuously/i);
  const inst = find(sys.emitters, /emit_instantaneously/i);
  const life = find(sys.initializers, /Lifetime Random/i);
  const rad = find(sys.initializers, /Radius Random/i);
  const col = find(sys.initializers, /Color Random/i);
  const alp = find(sys.initializers, /Alpha Random/i);
  const pos = find(sys.initializers, /Position Within Sphere Random/i);
  const off = find(sys.initializers, /Position Modify Offset Random/i);
  const rot = find(sys.initializers, /Rotation Random/i);
  const move = find(sys.operators, /Movement Basic/i);
  const rscale = find(sys.operators, /Radius Scale/i);
  const decay = find(sys.operators, /Lifespan Decay/i);
  const fadeOut = find(sys.operators, /Alpha Fade Out Random|Alpha Fade and Decay/i);
  const fadeIn = find(sys.operators, /Alpha Fade In Random/i);
  const cfade = find(sys.operators, /Color Fade/i);
  const spin = find(sys.operators, /Rotation Spin Roll/i);
  const baseCol = Array.isArray(sys.color) ? sys.color : [255, 255, 255, 255];

  return {
    name: sys.name,
    additive: !!sys.additive,
    max: Math.max(1, Math.min(2048, sys.maxParticles || 64)),
    rate: em ? num(em.attrs, 'emission_rate', 0) : 0,
    duration: em ? num(em.attrs, 'emission_duration', 0) : 0,
    startTime: em ? num(em.attrs, 'emission_start_time', 0) : 0,
    burst: inst ? Math.max(1, num(inst.attrs, 'num_to_emit', sys.maxParticles || 1)) : 0,
    lifeMin: life ? num(life.attrs, 'lifetime_min', 1) : 1,
    lifeMax: life ? num(life.attrs, 'lifetime_max', 1) : 1,
    radMin: rad ? num(rad.attrs, 'radius_min', sys.radius || 4) : (sys.radius || 4),
    radMax: rad ? num(rad.attrs, 'radius_max', sys.radius || 4) : (sys.radius || 4),
    col1: col ? (Array.isArray(col.attrs.color1) ? col.attrs.color1 : baseCol) : baseCol,
    col2: col ? (Array.isArray(col.attrs.color2) ? col.attrs.color2 : baseCol) : baseCol,
    alphaMin: alp ? num(alp.attrs, 'alpha_min', 255) / 255 : 1,
    alphaMax: alp ? num(alp.attrs, 'alpha_max', 255) / 255 : 1,
    distMin: pos ? num(pos.attrs, 'distance_min', 0) : 0,
    distMax: pos ? num(pos.attrs, 'distance_max', 0) : 0,
    speedMin: pos ? num(pos.attrs, 'speed_min', 0) : 0,
    speedMax: pos ? num(pos.attrs, 'speed_max', 0) : 0,
    offMin: off ? vec(off.attrs, 'offset min') : [0, 0, 0],
    offMax: off ? vec(off.attrs, 'offset max') : [0, 0, 0],
    rotMin: rot ? num(rot.attrs, 'rotation_initial_min', 0) : 0,
    rotMax: rot ? num(rot.attrs, 'rotation_initial_max', 0) : 0,
    gravity: move ? vec(move.attrs, 'gravity') : [0, 0, 0],
    drag: move ? num(move.attrs, 'drag', 0) : 0,
    radEnd: rscale ? num(rscale.attrs, 'radius_end_scale', 1) : 1,
    radStart: rscale ? num(rscale.attrs, 'radius_start_scale', 1) : 1,
    hasDecay: !!decay,
    fadeOut: fadeOut ? Math.max(0.01, num(fadeOut.attrs, 'fade_out_time', 0.5)) : 0,
    fadeIn: fadeIn ? Math.max(0.01, num(fadeIn.attrs, 'proportional fade in time', num(fadeIn.attrs, 'fade_in_time', 0.25))) : 0,
    colFade: cfade ? (Array.isArray(cfade.attrs.color_fade) ? cfade.attrs.color_fade : null) : null,
    spin: spin ? num(spin.attrs, 'rotation_rate', 0) : 0
  };
}

export function createEmitter(def) {
  if (!def) return null;
  const parts = [];
  let acc = 0, age = 0, burstDone = false;
  return {
    def,
    particles: parts,
    reset() { parts.length = 0; acc = 0; age = 0; burstDone = false; },
    // origin is in TF world space; the caller supplies it every step so the effect follows
    // whatever it is attached to (a bomb on a carrier's back, a robot, a tank).
    step(dt, origin) {
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.1);
      age += dt;
      const spawn = p => {
        if (parts.length >= def.max) return;
        const d = rnd(def.distMin, def.distMax);
        let ux = Math.random() * 2 - 1, uy = Math.random() * 2 - 1, uz = Math.random() * 2 - 1;
        const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
        const sp = rnd(def.speedMin, def.speedMax);
        const t = Math.random();
        parts.push({
          x: origin[0] + ux * d + rnd(def.offMin[0], def.offMax[0]),
          y: origin[1] + uy * d + rnd(def.offMin[1], def.offMax[1]),
          z: origin[2] + uz * d + rnd(def.offMin[2], def.offMax[2]),
          vx: ux * sp, vy: uy * sp, vz: uz * sp,
          life: Math.max(0.05, rnd(def.lifeMin, def.lifeMax)),
          t: 0,
          r0: rnd(def.radMin, def.radMax),
          rot: rnd(def.rotMin, def.rotMax) * Math.PI / 180,
          cr: def.col1[0] + (def.col2[0] - def.col1[0]) * t,
          cg: def.col1[1] + (def.col2[1] - def.col1[1]) * t,
          cb: def.col1[2] + (def.col2[2] - def.col1[2]) * t,
          a0: rnd(def.alphaMin, def.alphaMax)
        });
      };
      if (def.burst && !burstDone) { burstDone = true; for (let i = 0; i < def.burst; i++) spawn(); }
      if (def.rate > 0 && age >= def.startTime && (!def.duration || age <= def.startTime + def.duration)) {
        acc += def.rate * dt;
        while (acc >= 1) { acc -= 1; spawn(); }
      }
      const g = def.gravity, dragK = Math.max(0, 1 - def.drag * dt);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (def.hasDecay && p.t >= p.life) { parts.splice(i, 1); continue; }
        if (!def.hasDecay && p.t >= p.life * 4) { parts.splice(i, 1); continue; }
        p.vx = (p.vx + g[0] * dt) * dragK;
        p.vy = (p.vy + g[1] * dt) * dragK;
        p.vz = (p.vz + g[2] * dt) * dragK;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += def.spin * dt;
      }
    },
    // Packs live particles for the GL sprite batch: TF world xyz -> GL (x, z, -y).
    fill(out) {
      let n = 0;
      for (const p of parts) {
        const f = Math.min(1, p.t / Math.max(0.001, p.life));
        let a = p.a0;
        if (def.fadeIn) a *= Math.min(1, f / def.fadeIn);
        if (def.fadeOut) a *= Math.min(1, Math.max(0, (1 - f) / def.fadeOut));
        else if (def.hasDecay) a *= 1 - f;
        if (a <= 0.002) continue;
        const rs = def.radStart + (def.radEnd - def.radStart) * f;
        let cr = p.cr, cg = p.cg, cb = p.cb;
        if (def.colFade) {
          cr += (def.colFade[0] - cr) * f;
          cg += (def.colFade[1] - cg) * f;
          cb += (def.colFade[2] - cb) * f;
        }
        const o = n * 9;
        out[o] = p.x; out[o + 1] = p.z; out[o + 2] = -p.y;
        out[o + 3] = Math.max(0.1, p.r0 * rs);
        out[o + 4] = cr / 255; out[o + 5] = cg / 255; out[o + 6] = cb / 255;
        out[o + 7] = a;
        out[o + 8] = p.rot;
        n++;
      }
      return n;
    }
  };
}

const cache = new Map();

export async function loadSystem(name, tfPath) {
  const key = String(name || '').toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try {
    const r = await window.popnative.particlesSystem(name, tfPath);
    if (r && r.system) out = { def: compileSystem(r.system), sheet: r.sheet || null };
  } catch {}
  cache.set(key, out);
  return out;
}
