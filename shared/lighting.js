import { readLump } from './bsp.js';

const NODE_SZ = 32, LEAF_SZ = 32, WL_SZ = 88, AMB_SZ = 28, AMBIDX_SZ = 4, PLANE_SZ = 20;

export { EMIT_SURFACE, EMIT_POINT, EMIT_SPOTLIGHT, EMIT_SKYLIGHT, EMIT_QUAKELIGHT, EMIT_SKYAMBIENT,
  pointLeaf, ambientCubeAt, lightStrengthAt, pickLocalLights } from './lightmath.js';

// Valve's TexLightToLinear / ColorRGBExp32ToVector: linear = mantissa * 2^exponent.
// (No /255 — that scaling belongs to the lightmap's own storage path, not to RGBE.)
function rgbe(buf, o) {
  const s = Math.pow(2, buf.readInt8(o + 3));
  return [buf[o] * s, buf[o + 1] * s, buf[o + 2] * s];
}

// The map's compiled lights (dworldlight_t) — the same lights the engine feeds to models.
// HDR set (lump 54) preferred, LDR (15) as fallback, matching the lightmap choice.
export function readWorldLights(bspPath) {
  const buf = readLump(bspPath, 54) || readLump(bspPath, 15);
  if (!buf || buf.length % WL_SZ) return [];
  const out = [];
  for (let i = 0; i < buf.length / WL_SZ; i++) {
    const o = i * WL_SZ;
    out.push({
      origin: [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
      intensity: [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)],
      normal: [buf.readFloatLE(o + 24), buf.readFloatLE(o + 28), buf.readFloatLE(o + 32)],
      type: buf.readInt32LE(o + 40),
      style: buf.readInt32LE(o + 44),
      stopdot: buf.readFloatLE(o + 48),
      stopdot2: buf.readFloatLE(o + 52),
      exponent: buf.readFloatLE(o + 56),
      radius: buf.readFloatLE(o + 60),
      constant_attn: buf.readFloatLE(o + 64),
      linear_attn: buf.readFloatLE(o + 68),
      quadratic_attn: buf.readFloatLE(o + 72)
    });
  }
  return out;
}

// Per-leaf ambient cubes (LUMP_LEAF_AMBIENT_LIGHTING 55/56 + INDEX 51/52) plus the BSP
// node/plane/leaf-bounds data needed to find which leaf a world point falls in. This is
// exactly the data the engine's light cache uses to light models.
export function extractLighting(bspPath) {
  const planesBuf = readLump(bspPath, 1);
  const nodesBuf = readLump(bspPath, 5);
  const leafsBuf = readLump(bspPath, 10);
  if (!planesBuf || !nodesBuf || !leafsBuf) return null;
  const hdr = !!readLump(bspPath, 55);
  const ambBuf = hdr ? readLump(bspPath, 55) : readLump(bspPath, 56);
  const idxBuf = hdr ? readLump(bspPath, 51) : readLump(bspPath, 52);
  if (!ambBuf || !idxBuf || ambBuf.length % AMB_SZ || idxBuf.length % AMBIDX_SZ) return null;

  const nPlanes = Math.floor(planesBuf.length / PLANE_SZ);
  const planes = new Float32Array(nPlanes * 4);
  for (let i = 0; i < nPlanes; i++) {
    const o = i * PLANE_SZ;
    planes[i * 4] = planesBuf.readFloatLE(o);
    planes[i * 4 + 1] = planesBuf.readFloatLE(o + 4);
    planes[i * 4 + 2] = planesBuf.readFloatLE(o + 8);
    planes[i * 4 + 3] = planesBuf.readFloatLE(o + 12);
  }
  const nNodes = Math.floor(nodesBuf.length / NODE_SZ);
  const nodes = new Int32Array(nNodes * 3);
  for (let i = 0; i < nNodes; i++) {
    const o = i * NODE_SZ;
    nodes[i * 3] = nodesBuf.readInt32LE(o);
    nodes[i * 3 + 1] = nodesBuf.readInt32LE(o + 4);
    nodes[i * 3 + 2] = nodesBuf.readInt32LE(o + 8);
  }
  const nLeafs = Math.floor(leafsBuf.length / LEAF_SZ);
  const leafMins = new Int16Array(nLeafs * 3), leafMaxs = new Int16Array(nLeafs * 3);
  for (let i = 0; i < nLeafs; i++) {
    const o = i * LEAF_SZ;
    for (let k = 0; k < 3; k++) {
      leafMins[i * 3 + k] = leafsBuf.readInt16LE(o + 8 + k * 2);
      leafMaxs[i * 3 + k] = leafsBuf.readInt16LE(o + 14 + k * 2);
    }
  }
  const nIdx = Math.min(nLeafs, Math.floor(idxBuf.length / AMBIDX_SZ));
  const ambCount = new Uint16Array(nLeafs), ambFirst = new Uint16Array(nLeafs);
  for (let i = 0; i < nIdx; i++) {
    ambCount[i] = idxBuf.readUInt16LE(i * AMBIDX_SZ);
    ambFirst[i] = idxBuf.readUInt16LE(i * AMBIDX_SZ + 2);
  }
  const nAmb = Math.floor(ambBuf.length / AMB_SZ);
  const cubes = new Float32Array(nAmb * 18);
  const ambPos = new Uint8Array(nAmb * 3);
  for (let i = 0; i < nAmb; i++) {
    const o = i * AMB_SZ;
    for (let f = 0; f < 6; f++) {
      const c = rgbe(ambBuf, o + f * 4);
      cubes[i * 18 + f * 3] = c[0]; cubes[i * 18 + f * 3 + 1] = c[1]; cubes[i * 18 + f * 3 + 2] = c[2];
    }
    ambPos[i * 3] = ambBuf[o + 24]; ambPos[i * 3 + 1] = ambBuf[o + 25]; ambPos[i * 3 + 2] = ambBuf[o + 26];
  }
  return { planes, nodes, leafMins, leafMaxs, ambCount, ambFirst, cubes, ambPos, lights: readWorldLights(bspPath), hdr };
}
