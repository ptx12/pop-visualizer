import { readLump, brushModelDrawn, applyBrushXform, composeBrushXform, doorPoseXform, skyboxFaceMask, readEntityLump, parseEntities } from './bsp.js';
import { tonemapWithDefaults } from './tonemap.js';
import { bakeWasm } from './bakewasm.js';

const SURF_SKY2D = 0x2, SURF_SKY = 0x4, SURF_WARP = 0x8, SURF_TRIGGER = 0x40, SURF_NODRAW = 0x80, SURF_HINT = 0x100, SURF_SKIP = 0x200;
const SKIP_FLAGS = SURF_SKY2D | SURF_SKY | SURF_TRIGGER | SURF_NODRAW | SURF_HINT | SURF_SKIP;
const TOOLS_MAT = /(^|\/)(tools|skybox)\/|areaportal/i;
const LUM = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const ROOF_CLEARANCE = 110;
const SKY_DIM = 0.5;
const SKY_DESAT = 0.4;
export const LM_RANGE = 16;

const LM_LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) LM_LIN[i] = Math.pow(i / 255, 2.2) * LM_RANGE;
const LM_POW_BIN = new Float64Array(256);
for (let i = 0; i < 256; i++) LM_POW_BIN[i] = Math.pow(i / 255, 2.2);
const EXP2 = new Float64Array(256);
for (let i = 0; i < 256; i++) EXP2[i] = Math.pow(2, i < 128 ? i : i - 256);

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
  {
    const queue = new Int32Array(cols * rows);
    let head = 0, tail = 0;
    for (let i = 0; i < z.length; i++) if (z[i] !== -Infinity) queue[tail++] = i;
    while (head < tail) {
      const i = queue[head++];
      const c = i % cols, r = (i - c) / cols;
      const zi = z[i];
      if (c > 0 && z[i - 1] === -Infinity) { z[i - 1] = zi; queue[tail++] = i - 1; }
      if (c + 1 < cols && z[i + 1] === -Infinity) { z[i + 1] = zi; queue[tail++] = i + 1; }
      if (r > 0 && z[i - cols] === -Infinity) { z[i - cols] = zi; queue[tail++] = i - cols; }
      if (r + 1 < rows && z[i + cols] === -Infinity) { z[i + cols] = zi; queue[tail++] = i + cols; }
    }
  }
  const lookup = (x, y) => {
    const c = Math.floor((x - minX) / CELL), r = Math.floor((y - minY) / CELL);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const v = z[r * cols + c];
    return v === -Infinity ? null : v;
  };
  lookup.inBounds = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  lookup.grid = { z, cols, rows, minX, minY, cell: CELL };
  return lookup;
}

function readVerts(buf) {
  const out = new Float32Array(buf.length / 12 * 3);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function triNormal(pts) {
  const ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], uz = pts[1][2] - pts[0][2];
  const vx = pts[2][0] - pts[0][0], vy = pts[2][1] - pts[0][1], vz = pts[2][2] - pts[0][2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function packLightmaps(faces, maxDim = 4096) {
  const items = faces.filter(f => f.lm);
  let total = 16;
  for (const f of items) total += (f.lm.w + 2) * (f.lm.h + 2);
  let W = 512;
  while (W < maxDim && total > W * W * 0.72) W <<= 1;
  const GUT = 1;
  items.sort((a, b) => b.lm.h - a.lm.h);
  let x = 4, y = 0, shelfH = 4, H = 4;
  for (const f of items) {
    const w = f.lm.w + GUT, h = f.lm.h + GUT;
    if (x + w > W) { x = 0; y += shelfH; shelfH = 0; }
    if (y + h > maxDim) { f.lmPlace = null; continue; }
    f.lmPlace = { x, y };
    x += w;
    if (h > shelfH) shelfH = h;
    if (y + shelfH > H) H = y + shelfH;
  }
  H = Math.min(maxDim, H);
  const rgba = new Uint8Array(W * H * 4);
  const white = Math.round(Math.pow(1 / LM_RANGE, 1 / 2.2) * 255);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const o = (j * W + i) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = white; rgba[o + 3] = 255; }
  for (const f of items) {
    if (!f.lmPlace) continue;
    const { w, h, bytes } = f.lm, { x: px, y: py } = f.lmPlace;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = (j * w + i) * 4, o = ((py + j) * W + (px + i)) * 4;
      if (o + 3 >= rgba.length) continue;
      rgba[o] = bytes[s]; rgba[o + 1] = bytes[s + 1]; rgba[o + 2] = bytes[s + 2]; rgba[o + 3] = 255;
    }
  }
  return { rgba, width: W, height: H, whiteU: 0.5 / W, whiteV: 0.5 / H };
}

export function extractWorldFaces(bspPath, opts = {}) {
  const points = [...(opts.spawns || []).map(s => s.origin), ...(opts.tracks || []).map(t => t.origin)];
  const ceilAt = buildNavCeil(opts.nav, points);
  const cull = ceilAt ? (cx, cy) => !ceilAt.inBounds(cx, cy) : null;
  const { faces, bounds, movers } = extractFaces(bspPath, cull, { keepAll: true, lightmap: true, movers: true });
  if (!faces.length || !bounds) return null;

  const atlas = packLightmaps(faces);

  const groups = new Map();
  for (const f of faces) {
    const [tv0, tv1] = f.tv;
    const n = f.normal || [0, 0, 1];
    const nx = n[0], ny = n[2], nz = -n[1];
    const lm = f.lm, place = f.lmPlace;
    const mover = Number.isInteger(f.mover) ? f.mover : -1;
    const key = mover >= 0 ? mover + ':' + f.name : f.name;
    let g = groups.get(key);
    if (!g) { g = { name: f.name, mover, pos: [], uv: [], nrm: [], lm: [] }; groups.set(key, g); }
    let dispMap = null;
    if (lm && place && f.st && f.dispCorners && f.dispCorners.length === 4) {
      const S = lm.vecs[0], T = lm.vecs[1];
      const pr = c => [c[0] * S[0] + c[1] * S[1] + c[2] * S[2] + S[3], c[0] * T[0] + c[1] * T[1] + c[2] * T[2] + T[3]];
      const L0 = pr(f.dispCorners[0]), L1 = pr(f.dispCorners[1]), L3 = pr(f.dispCorners[3]);
      const lenS = Math.hypot(L3[0] - L0[0], L3[1] - L0[1]);
      const lenT = Math.hypot(L1[0] - L0[0], L1[1] - L0[1]);
      const su = lm.w - 1, sv = lm.h - 1;
      const swap = (Math.abs(lenS - sv) + Math.abs(lenT - su)) < (Math.abs(lenS - su) + Math.abs(lenT - sv));
      dispMap = { swap, su, sv };
    }
    const local = f.lpts;
    const emit = (p, idx) => {
      const q = local ? local[idx] : p;
      g.pos.push(p[0], p[2], -p[1]);
      g.uv.push(q[0] * tv0[0] + q[1] * tv0[1] + q[2] * tv0[2] + tv0[3], q[0] * tv1[0] + q[1] * tv1[1] + q[2] * tv1[2] + tv1[3]);
      g.nrm.push(nx, ny, nz);
      if (lm && place) {
        let lu, lv;
        if (dispMap && f.st[idx]) {
          const pu = dispMap.swap ? f.st[idx][1] : f.st[idx][0];
          const pv = dispMap.swap ? f.st[idx][0] : f.st[idx][1];
          lu = pu * dispMap.su;
          lv = pv * dispMap.sv;
        } else {
          const S = lm.vecs[0], T = lm.vecs[1];
          lu = q[0] * S[0] + q[1] * S[1] + q[2] * S[2] + S[3] - lm.mins[0];
          lv = q[0] * T[0] + q[1] * T[1] + q[2] * T[2] + T[3] - lm.mins[1];
        }
        lu = Math.max(0, Math.min(lm.w - 1, lu));
        lv = Math.max(0, Math.min(lm.h - 1, lv));
        g.lm.push((place.x + lu + 0.5) / atlas.width, (place.y + lv + 0.5) / atlas.height);
      } else {
        g.lm.push(atlas.whiteU, atlas.whiteV);
      }
    };
    for (let i = 1; i + 1 < f.pts.length; i++) { emit(f.pts[0], 0); emit(f.pts[i], i); emit(f.pts[i + 1], i + 1); }
  }

  const materials = [];
  for (const g of groups.values()) {
    if (!g.pos.length) continue;
    materials.push({
      name: g.name,
      mover: g.mover >= 0 ? g.mover : null,
      positions: Float32Array.from(g.pos),
      uvs: Float32Array.from(g.uv),
      normals: Float32Array.from(g.nrm),
      lm: Float32Array.from(g.lm),
      count: g.pos.length / 3
    });
  }
  const { hist, dhist, total, sceneSum, litCount, lmUpBright } = lightmapStats(faces);
  const NB = 64;
  let l2 = 1;
  if (total) { let acc = 0; for (let k = NB - 1; k >= 0; k--) { acc += hist[k]; if (acc >= 0.02 * total) { l2 = (k + 0.5) / NB; break; } } }
  const avgScene = total ? sceneSum / total : 0.1;
  const target = Math.max(0.60 / Math.max(0.02, l2), 0.03 / Math.max(0.004, avgScene));
  const tm = tonemapWithDefaults(opts.tonemap);
  const exposure = tm.tonemapScale !== null
    ? tm.tonemapScale
    : Math.max(tm.autoExposureMin, Math.min(tm.autoExposureMax, target));
  let minLight = 0.05;
  if (litCount) { let acc = 0; for (let k = 0; k < 256; k++) { acc += dhist[k]; if (acc >= 0.10 * litCount) { minLight = k / 255; break; } } }
  minLight = Math.max(0.02, Math.min(0.16, minLight));

  return { materials, movers, bounds, lightmap: { rgba: atlas.rgba, width: atlas.width, height: atlas.height, range: LM_RANGE }, exposure, minLight, lmUpBright };
}

const ALBEDO_REF = 0.25;

function faceAlbedo(f) {
  return f.refl ? Math.max(0.02, Math.min(1, LUM(f.refl[0], f.refl[1], f.refl[2]))) : ALBEDO_REF;
}

function faceIsUp(f) {
  const n = f.normal;
  return !!(n && n[2] >= 0.9);
}

export function lightmapStats(faces) {
  const lit = faces.filter(f => f.lm && f.lm.bytes && f.lm.bytes.length >= 4);
  const m = bakeWasm();
  if (m && lit.length) {
    try {
      let bytes = 0;
      for (const f of lit) bytes += f.lm.bytes.length;
      const ptr = m.lm_reserve(bytes, lit.length * 4);
      const heap = new Uint8Array(m.memory.buffer, ptr, bytes);
      const table = new Float64Array(m.memory.buffer, m.lm_faces_addr(), lit.length * 4);
      let at = 0;
      for (let i = 0; i < lit.length; i++) {
        const b = lit[i].lm.bytes;
        heap.set(b, at);
        table[i * 4] = at;
        table[i * 4 + 1] = b.length;
        table[i * 4 + 2] = faceAlbedo(lit[i]);
        table[i * 4 + 3] = faceIsUp(lit[i]) ? 1 : 0;
        at += b.length;
      }
      new Float64Array(m.memory.buffer, m.lm_lin_addr(), 256).set(LM_LIN);
      new Float64Array(m.memory.buffer, m.lm_powb_addr(), 256).set(LM_POW_BIN);
      m.lm_stats(lit.length);
      const o = new Float64Array(m.memory.buffer, m.lm_out_addr(), 324);
      return {
        hist: o.slice(4, 68),
        dhist: o.slice(68, 324),
        total: o[0],
        sceneSum: o[1],
        litCount: o[2],
        lmUpBright: o[3]
      };
    } catch {}
  }
  return lightmapStatsJS(faces);
}

export function lightmapStatsJS(faces) {
  const NB = 64, hist = new Float64Array(NB);
  const dhist = new Float64Array(256);
  let total = 0, sceneSum = 0, litCount = 0;
  for (const f of faces) {
    if (!f.lm) continue;
    const albedo = faceAlbedo(f);
    const b = f.lm.bytes;
    for (let i = 0; i < b.length; i += 4) {
      const r = LM_LIN[b[i]], g = LM_LIN[b[i + 1]], bl = LM_LIN[b[i + 2]];
      const sl = Math.min(1, albedo * LUM(r, g, bl));
      hist[Math.min(NB - 1, Math.floor(sl * NB))]++; total++; sceneSum += sl;
      if (sl > 0.0005) { dhist[Math.min(255, Math.floor(Math.pow(sl, 1 / 2.2) * 255))]++; litCount++; }
    }
  }
  const upLums = [];
  for (const f of faces) {
    if (!f.lm || !faceIsUp(f)) continue;
    const b = f.lm.bytes;
    let sum = 0, cnt = 0;
    for (let i = 0; i < b.length; i += 4) {
      sum += LUM(LM_LIN[b[i]], LM_LIN[b[i + 1]], LM_LIN[b[i + 2]]);
      cnt++;
    }
    if (cnt) upLums.push(sum / cnt);
  }
  upLums.sort((a, b) => a - b);
  return {
    hist, dhist, total, sceneSum, litCount,
    lmUpBright: upLums.length ? upLums[Math.floor(upLums.length * 0.9)] : 0
  };
}

export function extractFaces(bspPath, cull = null, opts = {}) {
  const keepAll = !!opts.keepAll;
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
  const hdrLightBuf = opts.lightmap ? readLump(bspPath, 53) : null;
  const lmBuf = hdrLightBuf || lightBuf;
  if (!facesBuf || !vertsBuf || !edgesBuf || !surfedgesBuf || !planesBuf || !texinfoBuf) return { faces: [], bounds: null };

  const verts = readVerts(vertsBuf);
  const numFaces = Math.floor(facesBuf.length / 56);
  const numTexinfo = Math.floor(texinfoBuf.length / 72);
  const numTexdata = texdataBuf ? Math.floor(texdataBuf.length / 32) : 0;

  const faceDrawn = new Uint8Array(numFaces).fill(1);
  const faceXform = new Array(numFaces).fill(null);
  const faceMover = new Int32Array(numFaces).fill(-1);
  let movers = [];
  try {
    const { models, drawn, xform, doors, doorOf } = brushModelDrawn(bspPath);
    movers = doors;
    if (models.length > 1) {
      faceDrawn.fill(0);
      for (let mi = 0; mi < models.length; mi++) {
        if (!drawn[mi]) continue;
        const m = models[mi];
        const di = doorOf[mi];
        const door = di >= 0 ? doors[di] : null;
        const pose = door && !opts.movers ? doorPoseXform(door, door.spawnFrac) : null;
        const xf = pose ? composeBrushXform(pose, xform[mi]) : xform[mi];
        const end = Math.min(numFaces, m.firstface + m.numfaces);
        for (let f = Math.max(0, m.firstface); f < end; f++) {
          faceDrawn[f] = 1;
          faceXform[f] = xf;
          if (door && opts.movers) faceMover[f] = di;
        }
      }
    }
  } catch {}
  try {
    const skyMask = skyboxFaceMask(bspPath);
    if (skyMask) for (let f = 0; f < numFaces && f < skyMask.length; f++) if (skyMask[f]) faceDrawn[f] = 0;
  } catch {}

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
  const matRefl = ti => {
    if (ti < 0 || ti >= numTexinfo || !texdataBuf) return null;
    const td = texinfoBuf.readInt32LE(ti * 72 + 68);
    if (td < 0 || td >= numTexdata) return null;
    const r = texdataBuf.readFloatLE(td * 32), g = texdataBuf.readFloatLE(td * 32 + 4), b = texdataBuf.readFloatLE(td * 32 + 8);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
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
      const s = EXP2[lightBuf[p + 3]] / 255;
      r += lightBuf[p] * s; g += lightBuf[p + 1] * s; b += lightBuf[p + 2] * s;
    }
    return [r / count, g / count, b / count];
  };
  const faceLightmap = (fi, ti) => {
    if (!lmBuf) return null;
    const base = fi * 56;
    if (facesBuf.readUInt8(base + 16) === 255) return null;
    const ofs = facesBuf.readInt32LE(base + 20);
    if (ofs < 0) return null;
    const w = facesBuf.readInt32LE(base + 36) + 1;
    const h = facesBuf.readInt32LE(base + 40) + 1;
    if (w < 1 || h < 1 || w > 256 || h > 256) return null;
    const count = w * h;
    if (ofs + count * 4 > lmBuf.length) return null;
    const bytes = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const p = ofs + i * 4;
      const sc = EXP2[lmBuf[p + 3]] / 255;
      for (let c = 0; c < 3; c++) {
        const lin = Math.min(1, Math.max(0, lmBuf[p + c] * sc) / LM_RANGE);
        bytes[i * 4 + c] = Math.round(Math.pow(lin, 1 / 2.2) * 255);
      }
      bytes[i * 4 + 3] = 255;
    }
    const b = ti * 72;
    return {
      w, h,
      mins: [facesBuf.readInt32LE(base + 28), facesBuf.readInt32LE(base + 32)],
      vecs: [
        [texinfoBuf.readFloatLE(b + 32), texinfoBuf.readFloatLE(b + 36), texinfoBuf.readFloatLE(b + 40), texinfoBuf.readFloatLE(b + 44)],
        [texinfoBuf.readFloatLE(b + 48), texinfoBuf.readFloatLE(b + 52), texinfoBuf.readFloatLE(b + 56), texinfoBuf.readFloatLE(b + 60)]
      ],
      bytes
    };
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
    if (!faceDrawn[fi]) continue;
    const base = fi * 56;
    const planenum = facesBuf.readUInt16LE(base);
    const side = facesBuf.readUInt8(base + 2);
    const ti = facesBuf.readInt16LE(base + 10);
    const di = facesBuf.readInt16LE(base + 12);
    if (ti < 0) continue;
    const flags = texinfoBuf.readInt32LE(ti * 72 + 64);
    if (flags & SKIP_FLAGS) continue;
    const name = matName(ti);
    if (TOOLS_MAT.test(name)) continue;
    const tv = texVecs(ti);
    const col = matColor(ti);
    const refl = matRefl(ti);
    const isWater = !!(flags & SURF_WARP);
    const xf = faceXform[fi];
    const toWorld = xf ? pts => pts.map(p => applyBrushXform(xf, p)) : null;

    if (di >= 0 && dispInfoBuf && dispVertsBuf) {
      if (dispDone.has(di)) continue;
      dispDone.add(di);
      const dq = dispQuads(di, faceVerts(fi), dispInfoBuf, dispVertsBuf);
      const light = faceLight(fi);
      const lm = opts.lightmap ? faceLightmap(fi, ti) : null;
      for (const e of dq.quads) {
        const q = toWorld ? toWorld(e.pts) : e.pts;
        let z = 0, cx = 0, cy = 0;
        for (const p of q) { z += p[2]; cx += p[0]; cy += p[1]; }
        z /= q.length; cx /= q.length; cy /= q.length;
        if (cull && cull(cx, cy, z)) continue;
        faces.push({ pts: q, lpts: toWorld ? e.pts : null, st: e.st, dispCorners: dq.corners, tv, col, refl, name, light, lm, water: isWater, z, mover: faceMover[fi], normal: keepAll ? triNormal(q) : null });
        grow(q);
      }
      continue;
    }
    let pnx = planesBuf.readFloatLE(planenum * 20), pny = planesBuf.readFloatLE(planenum * 20 + 4), pnz = planesBuf.readFloatLE(planenum * 20 + 8);
    if (side) { pnx = -pnx; pny = -pny; pnz = -pnz; }
    if (xf && xf.m) {
      const m = xf.m;
      const rx = pnx * m[0] + pny * m[1] + pnz * m[2];
      const ry = pnx * m[3] + pny * m[4] + pnz * m[5];
      const rz = pnx * m[6] + pny * m[7] + pnz * m[8];
      pnx = rx; pny = ry; pnz = rz;
    }
    if (!keepAll && pnz < 0.25) continue;
    const lpts = faceVerts(fi);
    if (!lpts) continue;
    const pts = toWorld ? toWorld(lpts) : lpts;
    if (keepAll) {
      let a3 = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        const ux = pts[i][0] - pts[0][0], uy = pts[i][1] - pts[0][1], uz = pts[i][2] - pts[0][2];
        const vx = pts[i + 1][0] - pts[0][0], vy = pts[i + 1][1] - pts[0][1], vz = pts[i + 1][2] - pts[0][2];
        a3 += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      }
      if (a3 < 24) continue;
    } else {
      let area2 = 0;
      for (let i = 1; i + 1 < pts.length; i++) area2 += Math.abs((pts[i][0] - pts[0][0]) * (pts[i + 1][1] - pts[0][1]) - (pts[i + 1][0] - pts[0][0]) * (pts[i][1] - pts[0][1]));
      if (area2 < 60) continue;
    }
    let z = 0, cx = 0, cy = 0;
    for (const p of pts) { z += p[2]; cx += p[0]; cy += p[1]; }
    z /= pts.length; cx /= pts.length; cy /= pts.length;
    if (cull && cull(cx, cy, z)) continue;
    faces.push({ pts, lpts: toWorld ? lpts : null, tv, col, refl, name, light: faceLight(fi), lm: opts.lightmap ? faceLightmap(fi, ti) : null, water: isWater, z, mover: faceMover[fi], normal: keepAll ? [pnx, pny, pnz] : null });
    grow(pts);
  }
  return { faces, bounds: faces.length ? bounds : null, movers };
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
  const grid = [], flat = [], st = [];
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
      const fx = left[0] + (right[0] - left[0]) * s, fy = left[1] + (right[1] - left[1]) * s, fz = left[2] + (right[2] - left[2]) * s;
      grid.push([fx + vx * dist, fy + vy * dist, fz + vz * dist]);
      flat.push([fx, fy, fz]);
      st.push([s, t]);
    }
  }
  const quads = [];
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    const a = j * n + i, b = j * n + i + 1, c2 = (j + 1) * n + i + 1, d = (j + 1) * n + i;
    quads.push({ pts: [grid[a], grid[b], grid[c2], grid[d]], st: [st[a], st[b], st[c2], st[d]] });
  }
  return { quads, corners: c };
}

const CELL_PX = 7;

function mipLevelFor(face, tex, scale) {
  const [tv0, tv1] = face.tv;
  const texPerWorld = Math.max(Math.hypot(tv0[0], tv0[1], tv0[2]), Math.hypot(tv1[0], tv1[1], tv1[2]));
  const texPerPx = texPerWorld / scale;
  return Math.min(tex.mips.length - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, texPerPx)))));
}

function mipDown(cur) {
  const w = cur.width >> 1, h = cur.height >> 1;
  const m = bakeWasm();
  if (m) {
    try {
      const srcLen = cur.width * cur.height * 4, dstLen = w * h * 4;
      const ptr = m.mip_reserve(srcLen, dstLen);
      new Uint8Array(m.memory.buffer, ptr, srcLen).set(cur.rgba);
      m.mip_down(cur.width, cur.height);
      const rgba = new Uint8ClampedArray(dstLen);
      rgba.set(new Uint8Array(m.memory.buffer, m.mip_dst_addr(), dstLen));
      return { rgba, width: w, height: h };
    } catch {}
  }
  return mipDownJS(cur);
}

function mipDownJS(cur) {
  const w = cur.width >> 1, h = cur.height >> 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s0 = ((y * 2) * cur.width + x * 2) * 4;
      const s1 = s0 + 4;
      const s2 = s0 + cur.width * 4;
      const s3 = s2 + 4;
      const d = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) rgba[d + c] = (cur.rgba[s0 + c] + cur.rgba[s1 + c] + cur.rgba[s2 + c] + cur.rgba[s3 + c]) / 4;
    }
  }
  return { rgba, width: w, height: h };
}

function withMips(tex) {
  const mips = [{ rgba: tex.rgba, width: tex.width, height: tex.height }];
  let cur = mips[0];
  while (cur.width > 32 && cur.height > 32) {
    cur = mipDown(cur);
    mips.push(cur);
  }
  return { mips };
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
  const cull = ceilAt ? (cx, cy) => !ceilAt.inBounds(cx, cy) : null;
  const roof = ceilAt ? { at: ceilAt, clearance } : null;
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
    texCache.set(f.name, tex && tex.rgba && tex.width && tex.height ? withMips(tex) : null);
  }

  const W = bounds[2] - bounds[0], H = bounds[3] - bounds[1];
  if (W <= 0 || H <= 0) return null;
  const maxDim = opts.maxDim || 2560;
  const scale = Math.min(maxDim / W, maxDim / H, 1.4);
  const outW = Math.max(64, Math.round(W * scale)), outH = Math.max(64, Math.round(H * scale));
  const img = new Uint8ClampedArray(outW * outH * 4);
  const heightBuf = new Float32Array(outW * outH).fill(NaN);

  faces.sort((a, b) => a.z - b.z);

  for (const f of faces) rasterFace(img, heightBuf, outW, outH, bounds, scale, f, texCache.get(f.name), faceShade(f, white), roof);

  if (opts.relief !== false) applyRelief(img, heightBuf, outW, outH, scale);

  const heightGrid = opts.heightGrid === false ? null : downsampleHeights(heightBuf, outW, outH);

  if (opts.sky !== false) {
    const sky = await loadSkyTexture(bspPath, loadTexture);
    if (sky) {
      const dim = Number.isFinite(opts.skyDim) ? opts.skyDim : SKY_DIM;
      const desat = Number.isFinite(opts.skyDesat) ? opts.skyDesat : SKY_DESAT;
      fillSky(img, outW, outH, sky, dim, desat);
    }
  }

  return { width: outW, height: outH, bounds, rgba: img, scale, heightGrid };
}

function skyNameOf(bspPath) {
  try {
    const ents = parseEntities(readEntityLump(bspPath) || '');
    for (const e of ents) {
      if (e.classname !== 'worldspawn' || !e.skyname) continue;
      const n = String(e.skyname).trim().toLowerCase();
      if (n) return n;
    }
  } catch {}
  return null;
}

async function loadSkyTexture(bspPath, loadTexture) {
  const sky = skyNameOf(bspPath);
  if (!sky) return null;
  for (const side of ['up', 'ft', 'lf', 'rt', 'bk']) {
    let tex = null;
    try { tex = await loadTexture('skybox/' + sky + side); } catch {}
    if (tex && tex.rgba && tex.width > 0 && tex.height > 0) return tex;
  }
  return null;
}

function fillSky(img, W, H, tex, dim, desat) {
  const tw = tex.width, th = tex.height, tp = tex.rgba;
  const s = Math.max(W / tw, H / th);
  const ox = (W - tw * s) / 2, oy = (H - th * s) / 2;
  for (let y = 0; y < H; y++) {
    const ty = Math.max(0, Math.min(th - 1, (y - oy) / s));
    const ty0 = Math.floor(ty), ty1 = Math.min(th - 1, ty0 + 1), fy = ty - ty0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (img[o + 3] > 0) continue;
      const tx = Math.max(0, Math.min(tw - 1, (x - ox) / s));
      const tx0 = Math.floor(tx), tx1 = Math.min(tw - 1, tx0 + 1), fx = tx - tx0;
      const p00 = (ty0 * tw + tx0) * 4, p01 = (ty0 * tw + tx1) * 4;
      const p10 = (ty1 * tw + tx0) * 4, p11 = (ty1 * tw + tx1) * 4;
      const px = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const top = tp[p00 + c] * (1 - fx) + tp[p01 + c] * fx;
        const bot = tp[p10 + c] * (1 - fx) + tp[p11 + c] * fx;
        px[c] = top * (1 - fy) + bot * fy;
      }
      const lum = LUM(px[0], px[1], px[2]);
      for (let c = 0; c < 3; c++) img[o + c] = (px[c] * (1 - desat) + lum * desat) * dim;
      img[o + 3] = 255;
    }
  }
}

function downsampleHeights(h, W, H, cellPx = 7) {
  const gw = Math.max(2, Math.ceil(W / cellPx));
  const gh = Math.max(2, Math.ceil(H / cellPx));
  const grid = new Float32Array(gw * gh).fill(NaN);
  let zMin = Infinity, zMax = -Infinity;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0, cnt = 0, tot = 0;
      const x0 = gx * cellPx, y0 = gy * cellPx;
      for (let y = y0; y < Math.min(H, y0 + cellPx); y++) {
        for (let x = x0; x < Math.min(W, x0 + cellPx); x++) {
          tot++;
          const v = h[y * W + x];
          if (v === v) { sum += v; cnt++; }
        }
      }
      if (cnt > 0 && cnt >= tot * 0.25) {
        const z = sum / cnt;
        grid[gy * gw + gx] = z;
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    }
  }
  if (!Number.isFinite(zMin)) { zMin = 0; zMax = 0; }
  return { grid, gw, gh, cellPx, zMin, zMax };
}

function applyRelief(img, h, W, H, scale) {
  let n = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < h.length; i++) { const v = h[i]; if (v === v) { n++; sum += v; sumSq += v * v; } }
  if (n < 16) return;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(1, sumSq / n - mean * mean));
  const lo = mean - 1.6 * std;
  const span = Math.max(1, 3.2 * std);

  let lx = -0.62, ly = -0.5, lz = 1;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const GRAD_CLAMP = 48;
  const STRENGTH = 0.09;
  const AMBIENT = 0.7;
  const GAIN = 2;
  const TINT = 0.15;
  const clamp = (g) => g > GRAD_CLAMP ? GRAD_CLAMP : g < -GRAD_CLAMP ? -GRAD_CLAMP : g;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const c = h[i];
      if (c !== c) continue;
      const hl = h[i - 1], hr = h[i + 1], hu = h[i - W], hd = h[i + W];
      const gx = clamp((hr === hr ? hr : c) - (hl === hl ? hl : c));
      const gy = clamp((hd === hd ? hd : c) - (hu === hu ? hu : c));
      let nx = -gx * STRENGTH, ny = -gy * STRENGTH, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const d = (nx * lx + ny * ly + nz * lz) / nl;
      let f = AMBIENT + (1 - AMBIENT) * Math.max(0, d) * GAIN;
      const norm = Math.max(0, Math.min(1, (c - lo) / span));
      f *= (1 - TINT) + 2 * TINT * norm;
      const drop = Math.max((hl === hl ? hl : c) - c, (hu === hu ? hu : c) - c, (hr === hr ? hr : c) - c, (hd === hd ? hd : c) - c);
      if (drop > 8) f *= Math.max(0.5, 1 - Math.min(1, drop / 180) * 0.45);
      if (f < 0.4) f = 0.4; else if (f > 1.5) f = 1.5;
      const o = i * 4;
      img[o] = img[o] * f;
      img[o + 1] = img[o + 1] * f;
      img[o + 2] = img[o + 2] * f;
    }
  }
}

function rasterFace(img, hbuf, W, H, bounds, scale, face, tex, shade, roof) {
  const [tv0, tv1] = face.tv;
  const vp = face.pts.map(p => {
    const sx = (p[0] - bounds[0]) * scale;
    const sy = (bounds[3] - p[1]) * scale;
    const u = p[0] * tv0[0] + p[1] * tv0[1] + p[2] * tv0[2] + tv0[3];
    const v = p[0] * tv1[0] + p[1] * tv1[1] + p[2] * tv1[2] + tv1[3];
    return { sx, sy, u, v };
  });
  for (let i = 1; i + 1 < vp.length; i++) rasterTri(img, hbuf, W, H, vp[0], vp[i], vp[i + 1], face, tex, shade, bounds, scale, roof);
}

function rasterTri(img, hbuf, W, H, a, b, c, face, tex, shade, bounds, scale, roof) {
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
  let hasTex = !!tex;
  let tw = 0, th = 0, tpx = null, mipDiv = 1;
  if (hasTex) {
    const [tv0, tv1] = face.tv;
    const texPerWorld = Math.max(Math.hypot(tv0[0], tv0[1], tv0[2]), Math.hypot(tv1[0], tv1[1], tv1[2]));
    const texPerPx = texPerWorld / scale;
    const level = Math.min(tex.mips.length - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, texPerPx)))));
    const m = tex.mips[level];
    tw = m.width; th = m.height; tpx = m.rgba; mipDiv = 1 << level;
  }

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b.sx - px) * (c.sy - py) - (b.sy - py) * (c.sx - px)) * inv;
      const w1 = ((c.sx - px) * (a.sy - py) - (c.sy - py) * (a.sx - px)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
      if (roof) {
        const cz = roof.at(bounds[0] + px / scale, bounds[3] - py / scale);
        if (cz !== null && face.z > cz + roof.clearance) continue;
      }
      let r, g, bl;
      if (hasTex) {
        const u = (a.u * w0 + b.u * w1 + c.u * w2) / mipDiv;
        const v = (a.v * w0 + b.v * w1 + c.v * w2) / mipDiv;
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
      hbuf[y * W + x] = face.z;
    }
  }
}
