import { readLump } from './bsp.js';

const SURF_SKY2D = 0x2, SURF_SKY = 0x4, SURF_WARP = 0x8, SURF_TRIGGER = 0x40, SURF_NODRAW = 0x80, SURF_HINT = 0x100, SURF_SKIP = 0x200;
const SKIP_FLAGS = SURF_SKY2D | SURF_SKY | SURF_TRIGGER | SURF_NODRAW | SURF_HINT | SURF_SKIP;

function readVerts(buf) {
  const out = new Float32Array(buf.length / 12 * 3);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export function extractGeometry(bspPath) {
  const planesBuf = readLump(bspPath, 1);
  const vertsBuf = readLump(bspPath, 3);
  const texinfoBuf = readLump(bspPath, 6);
  const facesBuf = readLump(bspPath, 7);
  const edgesBuf = readLump(bspPath, 12);
  const surfedgesBuf = readLump(bspPath, 13);
  const texdataBuf = readLump(bspPath, 2);
  const strTableBuf = readLump(bspPath, 44);
  const strDataBuf = readLump(bspPath, 43);
  const dispInfoBuf = readLump(bspPath, 26);
  const dispVertsBuf = readLump(bspPath, 33);
  if (!facesBuf || !vertsBuf || !edgesBuf || !surfedgesBuf || !planesBuf) return null;

  const verts = readVerts(vertsBuf);
  const numFaces = Math.floor(facesBuf.length / 56);
  const numTexinfo = texinfoBuf ? Math.floor(texinfoBuf.length / 72) : 0;
  const numTexdata = texdataBuf ? Math.floor(texdataBuf.length / 32) : 0;

  const matName = ti => {
    if (!texinfoBuf || ti < 0 || ti >= numTexinfo) return '';
    const td = texinfoBuf.readInt32LE(ti * 72 + 68);
    if (!texdataBuf || !strTableBuf || !strDataBuf || td < 0 || td >= numTexdata) return '';
    const sid = texdataBuf.readInt32LE(td * 32 + 12);
    if (sid < 0 || sid * 4 + 4 > strTableBuf.length) return '';
    const ofs = strTableBuf.readInt32LE(sid * 4);
    if (ofs < 0 || ofs >= strDataBuf.length) return '';
    const end = strDataBuf.indexOf(0, ofs);
    return strDataBuf.toString('latin1', ofs, end >= 0 ? end : ofs).toLowerCase();
  };

  const matColor = ti => {
    if (!texinfoBuf || ti < 0 || ti >= numTexinfo || !texdataBuf) return [128, 128, 128];
    const td = texinfoBuf.readInt32LE(ti * 72 + 68);
    if (td < 0 || td >= numTexdata) return [128, 128, 128];
    const r = texdataBuf.readFloatLE(td * 32);
    const g = texdataBuf.readFloatLE(td * 32 + 4);
    const b = texdataBuf.readFloatLE(td * 32 + 8);
    const f = v => Math.max(14, Math.min(235, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)));
    return [f(r), f(g), f(b)];
  };

  const lightBuf = readLump(bspPath, 8);
  const faceLight = fi => {
    if (!lightBuf) return null;
    const base = fi * 56;
    const ofs = facesBuf.readInt32LE(base + 20);
    if (ofs < 0) return null;
    const lw = facesBuf.readInt32LE(base + 36) + 1;
    const lh = facesBuf.readInt32LE(base + 40) + 1;
    if (lw < 1 || lh < 1 || lw > 512 || lh > 512) return null;
    const count = lw * lh;
    if (ofs + count * 4 > lightBuf.length) return null;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < count; i++) {
      const p = ofs + i * 4;
      const e = lightBuf.readInt8(p + 3);
      const s = Math.pow(2, e) / 255;
      r += lightBuf[p] * s;
      g += lightBuf[p + 1] * s;
      b += lightBuf[p + 2] * s;
    }
    return [r / count, g / count, b / count];
  };

  const polys = [];
  const dispDone = new Set();

  const faceVerts = fi => {
    const firstedge = facesBuf.readInt32LE(fi * 56 + 4);
    const numedges = facesBuf.readInt16LE(fi * 56 + 8);
    if (numedges < 3 || numedges > 64) return null;
    const pts = [];
    for (let e = 0; e < numedges; e++) {
      const se = surfedgesBuf.readInt32LE((firstedge + e) * 4);
      const ei = Math.abs(se);
      if (ei * 4 + 4 > edgesBuf.length) return null;
      const v = se >= 0 ? edgesBuf.readUInt16LE(ei * 4) : edgesBuf.readUInt16LE(ei * 4 + 2);
      if (v * 3 + 2 >= verts.length) return null;
      pts.push([verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]]);
    }
    return pts;
  };

  for (let fi = 0; fi < numFaces; fi++) {
    const base = fi * 56;
    const planenum = facesBuf.readUInt16LE(base);
    const side = facesBuf.readUInt8(base + 2);
    const ti = facesBuf.readInt16LE(base + 10);
    const di = facesBuf.readInt16LE(base + 12);

    if (ti >= 0 && texinfoBuf) {
      const flags = texinfoBuf.readInt32LE(ti * 72 + 64);
      if (flags & SKIP_FLAGS) continue;
      const isWater = !!(flags & SURF_WARP);
      const name = matName(ti);
      if (name.startsWith('tools/')) continue;
      if (di >= 0 && dispInfoBuf && dispVertsBuf) {
        if (dispDone.has(di)) continue;
        dispDone.add(di);
        emitDisp(polys, di, faceVerts(fi), dispInfoBuf, dispVertsBuf, matColor(ti), isWater, faceLight(fi));
        continue;
      }
      let nz = planesBuf.readFloatLE(planenum * 20 + 8);
      if (side) nz = -nz;
      if (nz < 0.25) continue;
      const pts = faceVerts(fi);
      if (!pts) continue;
      let area2 = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        area2 += Math.abs((pts[i][0] - pts[0][0]) * (pts[i + 1][1] - pts[0][1]) - (pts[i + 1][0] - pts[0][0]) * (pts[i][1] - pts[0][1]));
      }
      if (area2 < 60) continue;
      let z = 0;
      for (const p of pts) z += p[2];
      z /= pts.length;
      const col = isWater ? [52, 88, 120] : matColor(ti);
      polys.push({ z, col, pts, water: isWater, light: faceLight(fi) });
    }
  }

  applyLighting(polys);
  polys.sort((a, b) => a.z - b.z);

  let floats = 0;
  for (const p of polys) floats += 5 + p.pts.length * 2;
  const out = new Float32Array(floats);
  let o = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polys) {
    out[o++] = p.pts.length;
    out[o++] = p.col[0];
    out[o++] = p.col[1];
    out[o++] = p.col[2];
    out[o++] = p.z;
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    for (const pt of p.pts) {
      out[o++] = pt[0];
      out[o++] = pt[1];
      minX = Math.min(minX, pt[0]);
      minY = Math.min(minY, pt[1]);
      maxX = Math.max(maxX, pt[0]);
      maxY = Math.max(maxY, pt[1]);
    }
  }
  return { polys: polys.length, data: out, bounds: [minX, minY, maxX, maxY], zRange: [minZ, maxZ], lit: polys.some(p => p.lit) };
}

const LUM = l => l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;

function applyLighting(polys) {
  const lums = [];
  for (const p of polys) if (p.light) lums.push(LUM(p.light));
  if (lums.length < 8) return;
  lums.sort((a, b) => a - b);
  const white = Math.max(1e-4, lums[Math.floor(lums.length * 0.97)]);
  const floorLum = lums[Math.floor(lums.length * 0.02)];
  for (const p of polys) {
    if (!p.light) continue;
    const lum = LUM(p.light);
    const v = Math.pow(Math.min(1, lum / white), 1 / 2.2);
    const shade = 0.58 + 0.5 * v;
    const tint = lum > 1e-5 ? [p.light[0] / lum, p.light[1] / lum, p.light[2] / lum] : [1, 1, 1];
    const mix = 0.22;
    p.col = [0, 1, 2].map(i => {
      const t = 1 - mix + mix * Math.max(0.35, Math.min(2.2, tint[i]));
      return Math.max(6, Math.min(252, Math.round(p.col[i] * shade * t)));
    });
    p.lit = true;
    if (lum <= floorLum) p.shadow = true;
  }
}

function emitDisp(polys, di, corners, dispInfoBuf, dispVertsBuf, col, isWater, light) {
  if (!corners || corners.length !== 4) return;
  const base = di * 176;
  if (base + 176 > dispInfoBuf.length) return;
  const start = [dispInfoBuf.readFloatLE(base), dispInfoBuf.readFloatLE(base + 4), dispInfoBuf.readFloatLE(base + 8)];
  const vertStart = dispInfoBuf.readInt32LE(base + 12);
  const power = dispInfoBuf.readInt32LE(base + 20);
  if (power < 2 || power > 4) return;
  const n = (1 << power) + 1;

  let best = 0, bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = (corners[i][0] - start[0]) ** 2 + (corners[i][1] - start[1]) ** 2 + (corners[i][2] - start[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const c = [corners[best], corners[(best + 1) % 4], corners[(best + 2) % 4], corners[(best + 3) % 4]];

  const grid = [];
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1);
    const left = [c[0][0] + (c[1][0] - c[0][0]) * t, c[0][1] + (c[1][1] - c[0][1]) * t, c[0][2] + (c[1][2] - c[0][2]) * t];
    const right = [c[3][0] + (c[2][0] - c[3][0]) * t, c[3][1] + (c[2][1] - c[3][1]) * t, c[3][2] + (c[2][2] - c[3][2]) * t];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const vi = vertStart + j * n + i;
      if (vi * 20 + 20 > dispVertsBuf.length) return;
      const vx = dispVertsBuf.readFloatLE(vi * 20);
      const vy = dispVertsBuf.readFloatLE(vi * 20 + 4);
      const vz = dispVertsBuf.readFloatLE(vi * 20 + 8);
      const dist = dispVertsBuf.readFloatLE(vi * 20 + 12);
      grid.push([
        left[0] + (right[0] - left[0]) * s + vx * dist,
        left[1] + (right[1] - left[1]) * s + vy * dist,
        left[2] + (right[2] - left[2]) * s + vz * dist
      ]);
    }
  }
  const step = power === 4 ? 2 : 1;
  for (let j = 0; j + step < n; j += step) {
    for (let i = 0; i + step < n; i += step) {
      const p00 = grid[j * n + i], p10 = grid[j * n + i + step], p11 = grid[(j + step) * n + i + step], p01 = grid[(j + step) * n + i];
      const z = (p00[2] + p10[2] + p11[2] + p01[2]) / 4;
      polys.push({ z, col: isWater ? [52, 88, 120] : col, pts: [p00, p10, p11, p01], water: isWater, light });
    }
  }
}
