export const EMIT_SURFACE = 0, EMIT_POINT = 1, EMIT_SPOTLIGHT = 2, EMIT_SKYLIGHT = 3,
  EMIT_QUAKELIGHT = 4, EMIT_SKYAMBIENT = 5;

// Point -> leaf, descending the BSP tree the way the engine does.
export function pointLeaf(L, x, y, z) {
  let n = 0;
  for (let guard = 0; guard < 4096; guard++) {
    if (n < 0) return -n - 1;
    const p = L.nodes[n * 3] * 4;
    const d = L.planes[p] * x + L.planes[p + 1] * y + L.planes[p + 2] * z - L.planes[p + 3];
    n = L.nodes[n * 3 + (d >= 0 ? 1 : 2)];
  }
  return 0;
}

// Mod_LeafAmbientColorAtPos: inverse-squared-distance weighted average of the leaf's ambient
// samples, falling back to the nearest sampled leaf when this one carries none. Returns the
// 6-face ambient cube (+X,-X,+Y,-Y,+Z,-Z) in TF world axes.
export function ambientCubeAt(L, x, y, z) {
  const out = new Float32Array(18);
  if (!L) return out;
  let leaf = pointLeaf(L, x, y, z);
  if (leaf < 0 || leaf >= L.ambCount.length) return out;
  let count = L.ambCount[leaf];
  if (!count) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < L.ambCount.length; i++) {
      if (!L.ambCount[i]) continue;
      const cx = (L.leafMins[i * 3] + L.leafMaxs[i * 3]) / 2;
      const cy = (L.leafMins[i * 3 + 1] + L.leafMaxs[i * 3 + 1]) / 2;
      const cz = (L.leafMins[i * 3 + 2] + L.leafMaxs[i * 3 + 2]) / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return out;
    leaf = best; count = L.ambCount[leaf];
  }
  const first = L.ambFirst[leaf];
  const mnx = L.leafMins[leaf * 3], mny = L.leafMins[leaf * 3 + 1], mnz = L.leafMins[leaf * 3 + 2];
  const mxx = L.leafMaxs[leaf * 3], mxy = L.leafMaxs[leaf * 3 + 1], mxz = L.leafMaxs[leaf * 3 + 2];
  let totalFactor = 0;
  for (let i = 0; i < count; i++) {
    const s = first + i;
    if (s * 3 + 2 >= L.ambPos.length) break;
    const sx = mnx + (mxx - mnx) * (L.ambPos[s * 3] / 255);
    const sy = mny + (mxy - mny) * (L.ambPos[s * 3 + 1] / 255);
    const sz = mnz + (mxz - mnz) * (L.ambPos[s * 3 + 2] / 255);
    const d2 = (sx - x) ** 2 + (sy - y) ** 2 + (sz - z) ** 2;
    const factor = 1 / (d2 + 1);
    totalFactor += factor;
    for (let k = 0; k < 18; k++) out[k] += L.cubes[s * 18 + k] * factor;
  }
  if (totalFactor > 0) for (let k = 0; k < 18; k++) out[k] /= totalFactor;
  return out;
}

// Engine_WorldLightDistanceFalloff, plus the spotlight cone gate, used to rank lights.
export function lightStrengthAt(w, x, y, z) {
  if (w.type === EMIT_SKYAMBIENT) return 0;
  const dx = w.origin[0] - x, dy = w.origin[1] - y, dz = w.origin[2] - z;
  const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
  if (w.radius > 0 && d > w.radius) return 0;
  let falloff;
  if (w.type === EMIT_SKYLIGHT) falloff = 1;
  else if (w.type === EMIT_QUAKELIGHT) falloff = Math.max(0, w.linear_attn - d);
  else if (w.type === EMIT_SURFACE) falloff = d2 > 0 ? 1 / d2 : 0;
  else {
    const den = w.constant_attn + w.linear_attn * d + w.quadratic_attn * d2;
    falloff = den > 0 ? 1 / den : 0;
  }
  if (w.type === EMIT_SPOTLIGHT && d > 0) {
    const dot2 = -((dx / d) * w.normal[0] + (dy / d) * w.normal[1] + (dz / d) * w.normal[2]);
    if (dot2 <= w.stopdot2) return 0;
  }
  const lum = w.intensity[0] * 0.2126 + w.intensity[1] * 0.7152 + w.intensity[2] * 0.0722;
  return falloff * lum;
}

// The engine keeps the strongest MAXLOCALLIGHTS lights per model.
export function pickLocalLights(L, x, y, z, max = 4) {
  if (!L || !L.lights) return [];
  const scored = [];
  for (const w of L.lights) {
    const s = lightStrengthAt(w, x, y, z);
    if (s > 0) scored.push({ w, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, max).map(e => e.w);
}
