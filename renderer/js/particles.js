const num = (attrs, key, dflt = 0) => {
  const v = attrs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
};
const bool = (attrs, key, dflt = false) => {
  const v = attrs[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return dflt;
};
const vec = (attrs, key, dflt = [0, 0, 0]) => (Array.isArray(attrs[key]) ? attrs[key] : dflt);
const find = (list, re) => (list || []).find(f => re.test(f.cls || f.name || ''));
const rnd = (a, b) => a + Math.random() * (b - a);
const smoothstep = t => t * t * (3 - 2 * t);
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

function sinEst01(v) {
  const a = Math.abs(v);
  const r = a - 2 * Math.floor(a / 2);
  const odd = r >= 1;
  const x = r - (odd ? 1 : 0);
  const s = x * (4 - x * 4);
  return ((v < 0) !== odd) ? -s : s;
}

function oscillator(op) {
  if (!op) return null;
  const a = op.attrs;
  return {
    field: num(a, 'oscillation field', 7),
    rateMin: num(a, 'oscillation rate min', 0),
    rateMax: num(a, 'oscillation rate max', 0),
    freqMin: num(a, 'oscillation frequency min', 1),
    freqMax: num(a, 'oscillation frequency max', 1),
    proportional: bool(a, 'proportional 0/1', true),
    startMin: num(a, 'start time min', 0),
    startMax: num(a, 'start time max', 0),
    endMin: num(a, 'end time min', 1),
    endMax: num(a, 'end time max', 1),
    propOp: bool(a, 'start/end proportional', true),
    mult: num(a, 'oscillation multiplier', 2),
    add: num(a, 'oscillation start phase', 0.5)
  };
}

export function compileSystem(sys) {
  if (!sys) return null;
  const em = find(sys.emitters, /emit_continuously/i);
  const inst = find(sys.emitters, /emit_instantaneously/i);
  const life = find(sys.initializers, /Lifetime Random/i);
  const rad = find(sys.initializers, /Radius Random/i);
  const col = find(sys.initializers, /Color Random/i);
  const alp = find(sys.initializers, /Alpha Random/i);
  const pos = find(sys.initializers, /Position Within Sphere Random/i);
  const onModel = find(sys.initializers, /Position on Model Random/i);
  const off = find(sys.initializers, /Position Modify Offset Random/i);
  const rot = find(sys.initializers, /Rotation Random/i);
  const move = find(sys.operators, /Movement Basic/i);
  const lockBone = find(sys.operators, /Movement Lock to Bone/i);
  const rscale = find(sys.operators, /Radius Scale/i);
  const decay = find(sys.operators, /Lifespan Decay/i);
  const fadeKill = find(sys.operators, /Alpha Fade and Decay/i);
  const fadeOut = find(sys.operators, /Alpha Fade Out Random/i);
  const fadeIn = find(sys.operators, /Alpha Fade In Random/i);
  const cfade = find(sys.operators, /Color Fade/i);
  const spin = find(sys.operators, /Rotation Spin Roll/i);
  const oscs = (sys.operators || []).filter(o => /Oscillate Scalar/i.test(o.cls || o.name || '')).map(oscillator);
  const baseCol = Array.isArray(sys.color) ? sys.color : [255, 255, 255, 255];

  const def = {
    name: sys.name,
    additive: !!sys.additive,
    max: Math.max(1, Math.min(2048, sys.maxParticles || 64)),
    rate: em ? num(em.attrs, 'emission_rate', 0) : 0,
    duration: em ? num(em.attrs, 'emission_duration', 0) : 0,
    startTime: em ? num(em.attrs, 'emission_start_time', 0) : 0,
    burst: inst ? Math.max(1, num(inst.attrs, 'num_to_emit', sys.maxParticles || 1)) : 0,
    lifeMin: life ? num(life.attrs, 'lifetime_min', 0) : 1,
    lifeMax: life ? num(life.attrs, 'lifetime_max', 0) : 1,
    radMin: rad ? num(rad.attrs, 'radius_min', 1) : (sys.radius || 4),
    radMax: rad ? num(rad.attrs, 'radius_max', 1) : (sys.radius || 4),
    col1: col ? vec(col.attrs, 'color1', baseCol) : baseCol,
    col2: col ? vec(col.attrs, 'color2', baseCol) : baseCol,
    alphaMin: alp ? num(alp.attrs, 'alpha_min', 255) / 255 : 1,
    alphaMax: alp ? num(alp.attrs, 'alpha_max', 255) / 255 : 1,
    distMin: pos ? num(pos.attrs, 'distance_min', 0) : 0,
    distMax: pos ? num(pos.attrs, 'distance_max', 0) : 0,
    speedMin: pos ? num(pos.attrs, 'speed_min', 0) : 0,
    speedMax: pos ? num(pos.attrs, 'speed_max', 0) : 0,
    onModel: onModel ? { scale: num(onModel.attrs, 'hitbox scale', 1), bias: vec(onModel.attrs, 'direction bias'), tries: num(onModel.attrs, 'force to be inside model', 0) } : null,
    lockBone: !!lockBone,
    offMin: off ? vec(off.attrs, 'offset min') : [0, 0, 0],
    offMax: off ? vec(off.attrs, 'offset max') : [0, 0, 0],
    rotMin: rot ? num(rot.attrs, 'rotation_offset_min', 0) + num(rot.attrs, 'rotation_initial', 0) : 0,
    rotMax: rot ? num(rot.attrs, 'rotation_offset_max', 360) + num(rot.attrs, 'rotation_initial', 0) : 0,
    gravity: move ? vec(move.attrs, 'gravity') : [0, 0, 0],
    drag: move ? num(move.attrs, 'drag', 0) : 0,
    radStart: rscale ? num(rscale.attrs, 'radius_start_scale', 1) : 1,
    radEnd: rscale ? num(rscale.attrs, 'radius_end_scale', 1) : 1,
    radT0: rscale ? num(rscale.attrs, 'start_time', 0) : 0,
    radT1: rscale ? num(rscale.attrs, 'end_time', 1) : 1,
    hasDecay: !!decay || !!fadeKill,
    fadeKill: fadeKill ? {
      startAlpha: num(fadeKill.attrs, 'start_alpha', 1),
      endAlpha: num(fadeKill.attrs, 'end_alpha', 0),
      inStart: num(fadeKill.attrs, 'start_fade_in_time', 0),
      inEnd: num(fadeKill.attrs, 'end_fade_in_time', 0.5),
      outStart: num(fadeKill.attrs, 'start_fade_out_time', 0.5),
      outEnd: num(fadeKill.attrs, 'end_fade_out_time', 1)
    } : null,
    fadeOutMin: fadeOut ? num(fadeOut.attrs, 'fade out time min', 0.25) : 0,
    fadeOutMax: fadeOut ? num(fadeOut.attrs, 'fade out time max', 0.25) : 0,
    fadeInMin: fadeIn ? num(fadeIn.attrs, 'fade in time min', 0.25) : 0,
    fadeInMax: fadeIn ? num(fadeIn.attrs, 'fade in time max', 0.25) : 0,
    colFade: cfade ? vec(cfade.attrs, 'color_fade', null) : null,
    colFadeStart: cfade ? num(cfade.attrs, 'fade_start_time', 0) : 0,
    colFadeEnd: cfade ? num(cfade.attrs, 'fade_end_time', 1) : 1,
    colFadeEase: cfade ? bool(cfade.attrs, 'ease_in_and_out', true) : false,
    spin: spin ? num(spin.attrs, 'spin_rate_degrees', 0) : 0,
    oscRadius: oscs.find(o => o.field === 3) || null,
    oscAlpha: oscs.find(o => o.field === 7) || null
  };
  if (def.fadeKill) {
    const f = def.fadeKill;
    if (f.inEnd < f.inStart) f.inEnd = f.inStart;
    if (f.outEnd < f.outStart) f.outEnd = f.outStart;
    if (f.outStart < f.inStart) { const t = f.inStart; f.inStart = f.outStart; f.outStart = t; }
    if (f.outEnd < f.inEnd) { const t = f.inEnd; f.inEnd = f.outEnd; f.outEnd = t; }
  }
  return def;
}

function applyOsc(osc, value, p, curTime, dt) {
  if (!osc) return value;
  const lifeT = osc.propOp ? (p.life > 0 ? p.t / p.life : 0) : p.t;
  const start = osc.startMin + (osc.startMax - osc.startMin) * p.s0;
  const end = osc.endMin + (osc.endMax - osc.endMin) * p.s1;
  if (lifeT < start || lifeT >= end) return value;
  const freq = osc.freqMin + (osc.freqMax - osc.freqMin) * p.oFreq;
  const rate = osc.rateMin + (osc.rateMax - osc.rateMin) * p.oRate;
  const cos = osc.proportional
    ? osc.mult * ((p.life > 0 ? p.t / p.life : 0) * freq) + osc.add
    : (osc.mult * curTime + osc.add) * freq;
  return value + rate * dt * sinEst01(cos);
}

export const PARTICLE_STRIDE = 13;

export function createEmitter(def, sheetSeq = null) {
  if (!def) return null;
  const parts = [];
  let acc = 0, age = 0, burstDone = false;
  return {
    def,
    particles: parts,
    reset() { parts.length = 0; acc = 0; age = 0; burstDone = false; },
    step(dt, origin, sampler) {
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.1);
      age += dt;
      const spawn = () => {
        if (parts.length >= def.max) return;
        let px = origin[0], py = origin[1], pz = origin[2];
        let bone = -1, lx = 0, ly = 0, lz = 0;
        if (def.onModel && sampler) {
          const s = sampler(def.onModel);
          if (s) { px = s[0]; py = s[1]; pz = s[2]; bone = s[3]; lx = s[4]; ly = s[5]; lz = s[6]; }
        } else {
          const d = rnd(def.distMin, def.distMax);
          let ux = Math.random() * 2 - 1, uy = Math.random() * 2 - 1, uz = Math.random() * 2 - 1;
          const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
          px += ux * d; py += uy * d; pz += uz * d;
        }
        let vx = 0, vy = 0, vz = 0;
        const sp = rnd(def.speedMin, def.speedMax);
        if (sp) {
          let ux = Math.random() * 2 - 1, uy = Math.random() * 2 - 1, uz = Math.random() * 2 - 1;
          const l = Math.hypot(ux, uy, uz) || 1;
          vx = ux / l * sp; vy = uy / l * sp; vz = uz / l * sp;
        }
        const t = Math.random();
        parts.push({
          x: px + rnd(def.offMin[0], def.offMax[0]),
          y: py + rnd(def.offMin[1], def.offMax[1]),
          z: pz + rnd(def.offMin[2], def.offMax[2]),
          vx, vy, vz,
          bone, lx, ly, lz,
          life: Math.max(0.05, rnd(def.lifeMin, def.lifeMax)),
          t: 0,
          r0: rnd(def.radMin, def.radMax),
          rot: rnd(def.rotMin, def.rotMax) * Math.PI / 180,
          cr: def.col1[0] + (def.col2[0] - def.col1[0]) * t,
          cg: def.col1[1] + (def.col2[1] - def.col1[1]) * t,
          cb: def.col1[2] + (def.col2[2] - def.col1[2]) * t,
          a0: rnd(def.alphaMin, def.alphaMax),
          fadeInT: rnd(def.fadeInMin, def.fadeInMax),
          fadeOutT: rnd(def.fadeOutMin, def.fadeOutMax),
          oFreq: Math.random(), oRate: Math.random(), s0: Math.random(), s1: Math.random(),
          radius: 0, alpha: 0, drawAlpha: 0
        });
        const p = parts[parts.length - 1];
        p.radius = p.r0;
        p.alpha = p.a0;
        p.drawAlpha = p.a0;
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
        if (def.lockBone && p.bone >= 0 && sampler) {
          const w = sampler(null, p.bone, p.lx, p.ly, p.lz);
          if (w) { p.x = w[0]; p.y = w[1]; p.z = w[2]; }
        } else {
          p.vx = (p.vx + g[0] * dt) * dragK;
          p.vy = (p.vy + g[1] * dt) * dragK;
          p.vz = (p.vz + g[2] * dt) * dragK;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        }
        p.rot += def.spin * Math.PI / 180 * dt;
        const f = p.life > 0 ? clamp01(p.t / p.life) : 1;
        if (def.radT1 > def.radT0 && (def.radStart !== 1 || def.radEnd !== 1)) {
          p.radius = p.r0 * (def.radStart + (def.radEnd - def.radStart) * clamp01((f - def.radT0) / (def.radT1 - def.radT0)));
        }
        p.radius = Math.max(0.1, applyOsc(def.oscRadius, p.radius, p, p.t, dt));
        p.alpha = clamp01(applyOsc(def.oscAlpha, p.alpha, p, p.t, dt));
        let a = p.alpha;
        if (def.fadeKill) {
          const k = def.fadeKill;
          if (f >= k.inStart && f < k.inEnd) {
            const goal = p.a0 * k.startAlpha;
            a = goal + smoothstep(clamp01((f - k.inStart) / Math.max(1e-6, k.inEnd - k.inStart))) * (p.a0 - goal);
          } else if (f >= k.outStart && f < k.outEnd) {
            const goal = p.a0 * k.endAlpha;
            a = p.a0 + smoothstep(clamp01((f - k.outStart) / Math.max(1e-6, k.outEnd - k.outStart))) * (goal - p.a0);
          }
        } else {
          a = p.a0;
          if (p.fadeInT > 0) a *= Math.min(1, f / p.fadeInT);
          if (p.fadeOutT > 0) a *= Math.min(1, Math.max(0, (1 - f) / p.fadeOutT));
          else if (def.hasDecay) a *= 1 - f;
        }
        p.drawAlpha = clamp01(a);
      }
    },
    fill(out, start = 0) {
      let n = start;
      for (const p of parts) {
        if (p.drawAlpha <= 0.002) continue;
        const f = p.life > 0 ? clamp01(p.t / p.life) : 1;
        let cr = p.cr, cg = p.cg, cb = p.cb;
        if (def.colFade && def.colFadeEnd !== def.colFadeStart) {
          let T = clamp01((f - def.colFadeStart) / (def.colFadeEnd - def.colFadeStart));
          if (def.colFadeEase) T = smoothstep(T);
          cr += (def.colFade[0] - cr) * T;
          cg += (def.colFade[1] - cg) * T;
          cb += (def.colFade[2] - cb) * T;
        }
        const o = n * PARTICLE_STRIDE;
        if (o + PARTICLE_STRIDE > out.length) break;
        out[o] = p.x; out[o + 1] = p.z; out[o + 2] = -p.y;
        out[o + 3] = p.radius;
        out[o + 4] = cr / 255; out[o + 5] = cg / 255; out[o + 6] = cb / 255;
        out[o + 7] = p.drawAlpha;
        out[o + 8] = p.rot;
        if (sheetSeq && sheetSeq.frames.length) {
          const fr = sheetSeq.frames[Math.min(sheetSeq.frames.length - 1, Math.max(0, Math.floor(f * sheetSeq.frames.length)))];
          out[o + 9] = fr.uv[0]; out[o + 10] = fr.uv[1]; out[o + 11] = fr.uv[2]; out[o + 12] = fr.uv[3];
        } else {
          out[o + 9] = 0; out[o + 10] = 0; out[o + 11] = 1; out[o + 12] = 1;
        }
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
    if (r && r.system) {
      const def = compileSystem(r.system);
      const kids = [];
      for (const c of (r.children || [])) {
        const cdef = compileSystem(c.system);
        if (cdef) kids.push({ def: cdef, sheet: c.sheet || null });
      }
      out = { def, sheet: r.sheet || null, children: kids };
    }
  } catch {}
  cache.set(key, out);
  return out;
}
