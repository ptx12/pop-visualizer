const SPAWN_OUTPUTS = /^on(mapspawn|newgame|loadgame|multinewmap|multinewround)$/i;

export const TONEMAP_DEFAULTS = { bloomScale: 1, autoExposureMin: 0.5, autoExposureMax: 2, tonemapScale: null };

export function readTonemapSettings(ents) {
  const out = { bloomScale: null, autoExposureMin: null, autoExposureMax: null, tonemapScale: null };
  if (!Array.isArray(ents)) return out;

  const controllers = new Set();
  let unnamed = false;
  for (const e of ents) {
    if (String(e.classname || '').toLowerCase() !== 'env_tonemap_controller') continue;
    const n = String(e.targetname || '').toLowerCase();
    if (n) controllers.add(n);
    else unnamed = true;
  }
  if (!controllers.size && !unnamed) return out;

  const num = v => {
    const f = parseFloat(String(v).trim());
    return Number.isFinite(f) ? f : null;
  };

  for (const e of ents) {
    if (String(e.classname || '').toLowerCase() !== 'logic_auto') continue;
    for (const [key, val] of Object.entries(e)) {
      if (!SPAWN_OUTPUTS.test(key)) continue;
      for (const raw of (Array.isArray(val) ? val : [val])) {
        const parts = String(raw).split(/[\x1b,]/);
        if (parts.length < 3) continue;
        const target = parts[0].trim().toLowerCase();
        if (!controllers.has(target)) continue;
        const input = parts[1].trim().toLowerCase();
        const param = num(parts[2]);
        if (param === null) continue;
        if (input === 'setbloomscale') out.bloomScale = Math.max(0, param);
        else if (input === 'setautoexposuremin') out.autoExposureMin = Math.max(0, param);
        else if (input === 'setautoexposuremax') out.autoExposureMax = Math.max(0, param);
        else if (input === 'settonemapscale') out.tonemapScale = Math.max(0, param);
      }
    }
  }

  if (out.autoExposureMin !== null && out.autoExposureMax !== null && out.autoExposureMin > out.autoExposureMax) {
    const t = out.autoExposureMin;
    out.autoExposureMin = out.autoExposureMax;
    out.autoExposureMax = t;
  }
  return out;
}

export function tonemapWithDefaults(t) {
  const s = t || {};
  return {
    bloomScale: s.bloomScale === null || s.bloomScale === undefined ? TONEMAP_DEFAULTS.bloomScale : s.bloomScale,
    autoExposureMin: s.autoExposureMin === null || s.autoExposureMin === undefined ? TONEMAP_DEFAULTS.autoExposureMin : s.autoExposureMin,
    autoExposureMax: s.autoExposureMax === null || s.autoExposureMax === undefined ? TONEMAP_DEFAULTS.autoExposureMax : s.autoExposureMax,
    tonemapScale: s.tonemapScale === null || s.tonemapScale === undefined ? TONEMAP_DEFAULTS.tonemapScale : s.tonemapScale
  };
}
