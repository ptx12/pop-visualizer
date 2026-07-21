import { readLump } from './bsp.js';

const SURF_SKY2D = 0x2, SURF_SKY = 0x4, SURF_WARP = 0x8, SURF_TRIGGER = 0x40, SURF_NODRAW = 0x80, SURF_HINT = 0x100, SURF_SKIP = 0x200;
const SKIP_FLAGS = SURF_SKY2D | SURF_SKY | SURF_TRIGGER | SURF_NODRAW | SURF_HINT | SURF_SKIP;
const LUM = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const ROOF_CLEARANCE = 170;

export function buildNavCeil(nav, points = []) {
  const areas = (nav && nav.areas) || [];
  const pts = (points || []).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!areas.length && !pts.length) return null;
  const CELL = 160, PAD = 4;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const a of areas) { ext(a.nw[0], a.nw[1]); ext(a.se[0], a.se[1]); }
  for (const p of pts) ext(p[0], p[1]);
  if (!isFinite(minX)) return null;
  minX -= CELL * PAD; minY -= CELL * PAD; maxX += CELL * PAD; maxY += CELL * PAD;
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const rows = Math.max(1, Math.ceil((maxY - minY) / CELL));
  if (cols * rows > 4000000) return null;
  const z = new Float32Array(cols * rows).fill(-Infinity);
  const stamp = (x0, y0, x1, y1, az) => {
    const c0 = Math.max(0, Math.floor((x0 - minX) / CELL) - PAD);
    const c1 = Math.min(cols - 1, Math.floor((x1 - minX) / CELL) + PAD);
    const r0 = Math.max(0, Math.floor((y0 - minY) / CELL) - PAD);
    const r1 = Math.min(rows - 1, Math.floor((y1 - minY) / CELL) + PAD);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      if (az > z[i]) z[i] = az;
    }
  };
  for (const a of areas) stamp(a.nw[0], a.nw[1], a.se[0], a.se[1], Math.max(a.nw[2], a.se[2], a.neZ, a.swZ));
  for (const p of pts) stamp(p[0], p[1], p[0], p[1], Number.isFinite(p[2]) ? p[2] : 0);
  return (x, y) => {
    const c = Math.floor((x - minX) / CELL), r = Math.floor((y - minY) / CELL);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const v = z[r * cols + c];
    return v === -Infinity ? null : v;
  };
}

function readVerts(buf) {
  const out = new Float32Array(buf.length / 12 * 3);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export function extractFaces(bspPath, cull = null) {
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
  const lightBuf = readLump(bspPath, 8);
  if (!facesBuf || !vertsBuf || !edgesBuf || !surfedgesBuf || !planesBuf || !texinfoBuf) return { faces: [], bounds: null };

  const verts = readVerts(vertsBuf);
  const numFaces = Math.floor(facesBuf.length / 56);
  const numTexinfo = Math.floor(texinfoBuf.length / 72);
  const numTexdata = texdataBuf ? Math.floor(texdataBuf.length / 32) : 0;

  const matName = ti => {
    if (ti < 0 || ti >= numTexinfo) return '';
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
    if (ti < 0 || ti >= numTexinfo || !texdataBuf) return [128, 128, 128];
    const td = texinfoBuf.readInt32LE(ti * 72 + 68);
    if (td < 0 || td >= numTexdata) return [128, 128, 128];
    const f = v => Math.max(14, Math.min(235, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)));
    return [f(texdataBuf.readFloatLE(td * 32)), f(texdataBuf.readFloatLE(td * 32 + 4)), f(texdataBuf.readFloatLE(td * 32 + 8))];
  };
  const texVecs = ti => {
    const b = ti * 72;
    return [
      [texinfoBuf.readFloatLE(b), texinfoBuf.readFloatLE(b + 4), texinfoBuf.readFloatLE(b + 8), texinfoBuf.readFloatLE(b + 12)],
      [texinfoBuf.readFloatLE(b + 16), texinfoBuf.readFloatLE(b + 20), texinfoBuf.readFloatLE(b + 24), texinfoBuf.readFloatLE(b + 28)]
    ];
  };
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
      const s = Math.pow(2, lightBuf.readInt8(p + 3)) / 255;
      r += lightBuf[p] * s; g += lightBuf[p + 1] * s; b += lightBuf[p + 2] * s;
    }
    return [r / count, g / count, b / count];
  };

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

  const faces = [];
  const dispDone = new Set();
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = pts => { for (const p of pts) { bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]); bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]); } };

  for (let fi = 0; fi < numFaces; fi++) {
    const base = fi * 56;
    const planenum = facesBuf.readUInt16LE(base);
    const side = facesBuf.readUInt8(base + 2);
    const ti = facesBuf.readInt16LE(base + 10);
    const di = facesBuf.readInt16LE(base + 12);
    if (ti < 0) continue;
    const flags = texinfoBuf.readInt32LE(ti * 72 + 64);
    if (flags & SKIP_FLAGS) continue;
    const name = matName(ti);
    if (name.startsWith('tools/')) continue;
    const tv = texVecs(ti);
    const col = matColor(ti);
    const isWater = !!(flags & SURF_WARP);

    if (di >= 0 && dispInfoBuf && dispVertsBuf) {
      if (dispDone.has(di)) continue;
      dispDone.add(di);
      const quads = dispQuads(di, faceVerts(fi), dispInfoBuf, dispVertsBuf);
      const light = faceLight(fi);
      for (const q of quads) {
        let z = 0, cx = 0, cy = 0;
        for (const p of q) { z += p[2]; cx += p[0]; cy += p[1]; }
        z /= q.length; cx /= q.length; cy /= q.length;
        if (cull && cull(cx, cy, z)) continue;
        faces.push({ pts: q, tv, col, name, light, water: isWater, z });
        grow(q);
      }
      continue;
    }
    let nz = planesBuf.readFloatLE(planenum * 20 + 8);
    if (side) nz = -nz;
    if (nz < 0.25) continue;
    const pts = faceVerts(fi);
    if (!pts) continue;
    let area2 = 0;
    for (let i = 1; i + 1 < pts.length; i++) area2 += Math.abs((pts[i][0] - pts[0][0]) * (pts[i + 1][1] - pts[0][1]) - (pts[i + 1][0] - pts[0][0]) * (pts[i][1] - pts[0][1]));
    if (area2 < 60) continue;
    let z = 0, cx = 0, cy = 0;
    for (const p of pts) { z += p[2]; cx += p[0]; cy += p[1]; }
    z /= pts.length; cx /= pts.length; cy /= pts.length;
    if (cull && cull(cx, cy, z)) continue;
    faces.push({ pts, tv, col, name, light: faceLight(fi), water: isWater, z });
    grow(pts);
  }
  return { faces, bounds: faces.length ? bounds : null };
}

function dispQuads(di, corners, dispInfoBuf, dispVertsBuf) {
  if (!corners || corners.length !== 4) return [];
  const base = di * 176;
  if (base + 176 > dispInfoBuf.length) return [];
  const start = [dispInfoBuf.readFloatLE(base), dispInfoBuf.readFloatLE(base + 4), dispInfoBuf.readFloatLE(base + 8)];
  const vertStart = dispInfoBuf.readInt32LE(base + 12);
  const power = dispInfoBuf.readInt32LE(base + 20);
  if (power < 2 || power > 4) return [];
  const n = (1 << power) + 1;
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = (corners[i][0] - start[0]) ** 2 + (corners[i][1] - start[1]) ** 2 + (corners[i][2] - start[2]) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  const c = [corners[bestI], corners[(bestI + 1) % 4], corners[(bestI + 2) % 4], corners[(bestI + 3) % 4]];
  const grid = [];
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1);
    const left = [c[0][0] + (c[1][0] - c[0][0]) * t, c[0][1] + (c[1][1] - c[0][1]) * t, c[0][2] + (c[1][2] - c[0][2]) * t];
    const right = [c[3][0] + (c[2][0] - c[3][0]) * t, c[3][1] + (c[2][1] - c[3][1]) * t, c[3][2] + (c[2][2] - c[3][2]) * t];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const vi = vertStart + j * n + i;
      if (vi * 20 + 20 > dispVertsBuf.length) return [];
      const vx = dispVertsBuf.readFloatLE(vi * 20), vy = dispVertsBuf.readFloatLE(vi * 20 + 4), vz = dispVertsBuf.readFloatLE(vi * 20 + 8);
      const dist = dispVertsBuf.readFloatLE(vi * 20 + 12);
      grid.push([left[0] + (right[0] - left[0]) * s + vx * dist, left[1] + (right[1] - left[1]) * s + vy * dist, left[2] + (right[2] - left[2]) * s + vz * dist]);
    }
  }
  const quads = [];
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    quads.push([grid[j * n + i], grid[j * n + i + 1], grid[(j + 1) * n + i + 1], grid[(j + 1) * n + i]]);
  }
  return quads;
}

function faceShade(face, white) {
  if (!face.light) return { m: 0.82, tint: [1, 1, 1] };
  const lum = LUM(face.light[0], face.light[1], face.light[2]);
  const v = Math.pow(Math.min(1, lum / white), 1 / 2.2);
  const m = 0.5 + 0.62 * v;
  const tint = lum > 1e-5 ? [face.light[0] / lum, face.light[1] / lum, face.light[2] / lum] : [1, 1, 1];
  const mix = 0.2;
  return { m, tint: tint.map(t => 1 - mix + mix * Math.max(0.4, Math.min(2, t))) };
}

export async function bakeTopDown(bspPath, loadTexture, opts = {}) {
  const points = [...(opts.spawns || []).map(s => s.origin), ...(opts.tracks || []).map(t => t.origin)];
  const ceilAt = buildNavCeil(opts.nav, points);
  const clearance = Number.isFinite(opts.roofClearance) ? opts.roofClearance : ROOF_CLEARANCE;
  const cull = ceilAt ? (cx, cy, z) => { const c = ceilAt(cx, cy); return c !== null && z > c + clearance; } : null;
  const { faces, bounds } = extractFaces(bspPath, cull);
  if (!faces.length || !bounds) return null;

  const lums = [];
  for (const f of faces) if (f.light) lums.push(LUM(f.light[0], f.light[1], f.light[2]));
  lums.sort((a, b) => a - b);
  const white = lums.length >= 8 ? Math.max(1e-4, lums[Math.floor(lums.length * 0.97)]) : 1;

  const texCache = new Map();
  for (const f of faces) {
    if (texCache.has(f.name)) continue;
    let tex = null;
    try { tex = await loadTexture(f.name); } catch {}
    texCache.set(f.name, tex && tex.rgba && tex.width && tex.height ? tex : null);
  }

  const W = bounds[2] - bounds[0], H = bounds[3] - bounds[1];
  if (W <= 0 || H <= 0) return null;
  const maxDim = opts.maxDim || 2560;
  const scale = Math.min(maxDim / W, maxDim / H, 1.4);
  const outW = Math.max(64, Math.round(W * scale)), outH = Math.max(64, Math.round(H * scale));
  const img = new Uint8ClampedArray(outW * outH * 4);

  faces.sort((a, b) => a.z - b.z);
  for (const f of faces) rasterFace(img, outW, outH, bounds, scale, f, texCache.get(f.name), faceShade(f, white));

  return { width: outW, height: outH, bounds, rgba: img, scale };
}

function rasterFace(img, W, H, bounds, scale, face, tex, shade) {
  const [tv0, tv1] = face.tv;
  const vp = face.pts.map(p => {
    const sx = (p[0] - bounds[0]) * scale;
    const sy = (bounds[3] - p[1]) * scale;
    const u = p[0] * tv0[0] + p[1] * tv0[1] + p[2] * tv0[2] + tv0[3];
    const v = p[0] * tv1[0] + p[1] * tv1[1] + p[2] * tv1[2] + tv1[3];
    return { sx, sy, u, v };
  });
  for (let i = 1; i + 1 < vp.length; i++) rasterTri(img, W, H, vp[0], vp[i], vp[i + 1], face, tex, shade);
}

function rasterTri(img, W, H, a, b, c, face, tex, shade) {
  const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
  const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
  if (minX > maxX || minY > maxY) return;
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx);
  if (Math.abs(area) < 1e-6) return;
  const inv = 1 / area;
  const [tr, tg, tb] = face.col;
  const sm = shade.m, st = shade.tint;
  const hasTex = !!tex;
  const tw = hasTex ? tex.width : 0, th = hasTex ? tex.height : 0, tpx = hasTex ? tex.rgba : null;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b.sx - px) * (c.sy - py) - (b.sy - py) * (c.sx - px)) * inv;
      const w1 = ((c.sx - px) * (a.sy - py) - (c.sy - py) * (a.sx - px)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
      let r, g, bl;
      if (hasTex) {
        const u = a.u * w0 + b.u * w1 + c.u * w2;
        const v = a.v * w0 + b.v * w1 + c.v * w2;
        let tx = Math.floor(u) % tw; if (tx < 0) tx += tw;
        let ty = Math.floor(v) % th; if (ty < 0) ty += th;
        const tp = (ty * tw + tx) * 4;
        r = tpx[tp]; g = tpx[tp + 1]; bl = tpx[tp + 2];
      } else { r = tr; g = tg; bl = tb; }
      if (face.water) { r = r * 0.4 + 52 * 0.6; g = g * 0.4 + 88 * 0.6; bl = bl * 0.4 + 120 * 0.6; }
      const o = (y * W + x) * 4;
      img[o] = r * sm * st[0];
      img[o + 1] = g * sm * st[1];
      img[o + 2] = bl * sm * st[2];
      img[o + 3] = 255;
    }
  }
}
