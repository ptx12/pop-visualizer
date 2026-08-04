import { openSync, readSync, closeSync, statSync } from 'fs';
import { inflateRawSync } from 'zlib';
import { decodeValveLZMA, lzmaDecode } from './lzma.js';
import { LIMITS, cap } from './limits.js';

function lumpInfo(fd, index) {
  const head = Buffer.alloc(8 + 64 * 16);
  readSync(fd, head, 0, head.length, 0);
  if (head.toString('ascii', 0, 4) !== 'VBSP') return null;
  return { fileofs: head.readInt32LE(8 + index * 16), filelen: head.readInt32LE(8 + index * 16 + 4) };
}

const LUMP_CACHE_MAX = 320 * 1024 * 1024;
const lumpCache = new Map();
let lumpCacheBytes = 0;

export function flushLumpCache() {
  lumpCache.clear();
  lumpCacheBytes = 0;
}

function fileStamp(bspPath) {
  try {
    const s = statSync(bspPath);
    return s.size + ':' + s.mtimeMs;
  } catch {
    return null;
  }
}

function cacheGet(key) {
  if (!lumpCache.has(key)) return undefined;
  const v = lumpCache.get(key);
  lumpCache.delete(key);
  lumpCache.set(key, v);
  return v;
}

function cacheSet(key, buf) {
  const size = buf ? buf.length : 0;
  if (size > LUMP_CACHE_MAX) return buf;
  lumpCache.set(key, buf);
  lumpCacheBytes += size;
  while (lumpCacheBytes > LUMP_CACHE_MAX && lumpCache.size > 1) {
    const oldest = lumpCache.keys().next().value;
    const dropped = lumpCache.get(oldest);
    lumpCache.delete(oldest);
    lumpCacheBytes -= dropped ? dropped.length : 0;
  }
  return buf;
}

export function readLump(bspPath, index, maxLen = 64 * 1024 * 1024) {
  const stamp = fileStamp(bspPath);
  const key = stamp === null ? null : bspPath + '|' + stamp + '|' + index + '|' + maxLen;
  if (key !== null) {
    const hit = cacheGet(key);
    if (hit !== undefined) return hit;
  }
  const fd = openSync(bspPath, 'r');
  let out = null;
  try {
    const info = lumpInfo(fd, index);
    if (!info || info.filelen <= 0 || info.filelen > maxLen || info.fileofs < 0) return key === null ? null : cacheSet(key, null);
    let lump = Buffer.alloc(info.filelen);
    readSync(fd, lump, 0, info.filelen, info.fileofs);
    if (lump.toString('ascii', 0, 4) === 'LZMA') {
      try { lump = decodeValveLZMA(lump); } catch { lump = null; }
    }
    out = lump || null;
  } finally {
    closeSync(fd);
  }
  return key === null ? out : cacheSet(key, out);
}

const GAMELUMPFLAG_COMPRESSED = 0x0001;

export function gameLump(bspPath, wantIds) {
  const fd = openSync(bspPath, 'r');
  let raw = null, base = 0;
  try {
    const info = lumpInfo(fd, 35);
    if (!info || info.filelen <= 0 || info.filelen > 64 * 1024 * 1024) return null;
    raw = Buffer.alloc(info.filelen);
    readSync(fd, raw, 0, info.filelen, info.fileofs);
    base = info.fileofs;
  } finally {
    closeSync(fd);
  }
  if (raw.toString('ascii', 0, 4) === 'LZMA') {
    try { raw = decodeValveLZMA(raw); } catch { return null; }
    if (!raw) return null;
  }
  const lumpCount = raw.readInt32LE(0);
  if (lumpCount < 0 || lumpCount > 64) return null;
  const dir = [];
  for (let i = 0; i < lumpCount; i++) {
    const b = 4 + i * 16;
    if (b + 16 > raw.length) break;
    dir.push({
      id: raw.toString('ascii', b, b + 4),
      flags: raw.readUInt16LE(b + 4),
      version: raw.readUInt16LE(b + 6),
      fileofs: raw.readInt32LE(b + 8),
      filelen: raw.readInt32LE(b + 12)
    });
  }
  const idx = dir.findIndex(d => wantIds.includes(d.id));
  if (idx < 0) return null;
  const g = dir[idx];
  const start = g.fileofs - base;
  if (start < 0 || start >= raw.length) return null;
  if (!(g.flags & GAMELUMPFLAG_COMPRESSED)) {
    const end = Math.min(raw.length, start + g.filelen);
    return { version: g.version, buf: raw.subarray(start, end) };
  }
  let limit = raw.length;
  for (const d of dir) if (d.fileofs - base > start && d.fileofs - base < limit) limit = d.fileofs - base;
  let buf = null;
  try { buf = decodeValveLZMA(raw.subarray(start, limit)); } catch { return null; }
  return buf ? { version: g.version, buf } : null;
}

export function readStaticProps(bspPath) {
  try {
    const g = gameLump(bspPath, ['sprp', 'prps']);
    if (!g) return [];
    const buf = g.buf;
    const sprp = { version: g.version };
    let ofs = 0;
    const end = buf.length;
    if (ofs + 4 > buf.length) return [];
    const dictCount = buf.readInt32LE(ofs); ofs += 4;
    if (dictCount < 0 || dictCount > 20000) return [];
    const dict = [];
    for (let i = 0; i < dictCount; i++) {
      if (ofs + 128 > buf.length) return [];
      const s = buf.toString('latin1', ofs, ofs + 128);
      const z = s.indexOf('\0');
      dict.push((z >= 0 ? s.slice(0, z) : s).replace(/\\/g, '/').toLowerCase());
      ofs += 128;
    }
    if (ofs + 4 > buf.length) return [];
    const leafCount = buf.readInt32LE(ofs); ofs += 4;
    if (leafCount < 0) return [];
    ofs += leafCount * 2;
    if (ofs + 4 > buf.length) return [];
    const propCount = buf.readInt32LE(ofs); ofs += 4;
    if (propCount <= 0 || propCount > 200000) return [];
    const bytesPerProp = Math.floor((end - ofs) / propCount);
    if (bytesPerProp < 26 || ofs + propCount * bytesPerProp > buf.length) return [];
    const props = [];
    for (let i = 0; i < propCount; i++) {
      const b = ofs + i * bytesPerProp;
      const origin = [buf.readFloatLE(b), buf.readFloatLE(b + 4), buf.readFloatLE(b + 8)];
      if (origin[0] !== origin[0]) continue;
      const angles = [buf.readFloatLE(b + 12), buf.readFloatLE(b + 16), buf.readFloatLE(b + 20)];
      const propType = buf.readUInt16LE(b + 24);
      const model = dict[propType];
      if (!model) continue;
      let scale = 1;
      if (sprp.version >= 11 && bytesPerProp >= 28) { const s = buf.readFloatLE(b + bytesPerProp - 4); if (s > 0.02 && s < 64) scale = s; }
      props.push({ model: model.replace(/\.mdl$/i, ''), origin, angles, scale });
    }
    return skyPropFilter(bspPath, props);
  } catch { return []; }
}

const DYN_PROP_CLASSES = new Set(['prop_dynamic', 'prop_dynamic_override', 'prop_physics', 'prop_physics_override', 'prop_physics_multiplayer']);
const DYN_PROP_SKIP = /robot_hologram|bot_worker|\/arrow|_glow|holo|_destruction|_gib|_broken|_damage/i;
export function readDynamicProps(bspPath) {
  try {
    const text = readEntityLump(bspPath);
    if (!text) return [];
    const out = [];
    for (const e of parseEntities(text)) {
      if (!DYN_PROP_CLASSES.has(e.classname)) continue;
      let model = e.model;
      if (!model || model[0] === '*' || DYN_PROP_SKIP.test(model)) continue;
      model = model.replace(/\\/g, '/').replace(/\.mdl$/i, '').toLowerCase();
      const startDisabled = String(e.startdisabled || '').trim() === '1';
      if (String(e.rendermode || '').trim() === '10') continue;
      if (String(e.renderamt || '').trim() === '0') continue;
      const origin = (e.origin || '0 0 0').split(/\s+/).map(parseFloat);
      if (origin.length < 3 || origin.some(v => !Number.isFinite(v))) continue;
      const ang = (e.angles || '0 0 0').split(/\s+/).map(parseFloat);
      const angles = [ang[0] || 0, ang[1] || 0, ang[2] || 0];
      let scale = parseFloat(e.modelscale);
      if (!(scale > 0.02 && scale < 64)) scale = 1;
      const name = String(e.targetname || '').trim().toLowerCase() || null;
      const parent = String(e.parentname || '').trim().toLowerCase() || null;
      out.push({ model, origin: [origin[0], origin[1], origin[2]], angles, scale, dynamic: true, name, parent, startDisabled });
    }
    return skyPropFilter(bspPath, out);
  } catch { return []; }
}

const LEAF_SZ = 32;

export function skyAreaIndex(bspPath) {
  const planesBuf = readLump(bspPath, 1);
  const nodesBuf = readLump(bspPath, 5);
  const leafsBuf = readLump(bspPath, 10);
  const modelsBuf = readLump(bspPath, 14);
  if (!planesBuf || !nodesBuf || !leafsBuf || !modelsBuf) return null;
  const text = readEntityLump(bspPath);
  if (!text) return null;
  const ents = parseEntities(text);
  const vec = s => {
    const v = String(s || '').trim().split(/\s+/).map(parseFloat);
    return v.length >= 3 && v.every(Number.isFinite) ? v : null;
  };
  const sky = ents.find(e => e.classname === 'sky_camera');
  const skyOrigin = sky && vec(sky.origin);
  if (!skyOrigin) return null;

  const headnode = modelsBuf.readInt32LE(36);
  const nLeafs = Math.floor(leafsBuf.length / LEAF_SZ);
  const leafAt = p => {
    let n = headnode, guard = 0;
    while (n >= 0 && guard++ < 8192) {
      const pn = nodesBuf.readInt32LE(n * 32);
      const d = p[0] * planesBuf.readFloatLE(pn * 20) + p[1] * planesBuf.readFloatLE(pn * 20 + 4) +
                p[2] * planesBuf.readFloatLE(pn * 20 + 8) - planesBuf.readFloatLE(pn * 20 + 12);
      n = nodesBuf.readInt32LE(n * 32 + (d >= 0 ? 4 : 8));
    }
    const li = -1 - n;
    return li >= 0 && li < nLeafs ? li : -1;
  };
  const areaOf = li => leafsBuf.readUInt16LE(li * LEAF_SZ + 6) & 0x1ff;

  const skyLeaf = leafAt(skyOrigin);
  if (skyLeaf < 0) return null;
  const skyArea = areaOf(skyLeaf);

  const playAreas = new Set();
  for (const e of ents) {
    if (!/^info_player_(teamspawn|start)$/.test(e.classname)) continue;
    const o = vec(e.origin);
    if (!o) continue;
    const li = leafAt([o[0], o[1], o[2] + 40]);
    if (li >= 0) playAreas.add(areaOf(li));
  }
  if (!playAreas.size || playAreas.has(skyArea)) return null;

  return { leafsBuf, nLeafs, leafAt, areaOf, skyArea, inSkyArea: p => { const li = leafAt(p); return li >= 0 && areaOf(li) === skyArea; } };
}

function skyPropFilter(bspPath, props) {
  if (!props.length) return props;
  try {
    const idx = skyAreaIndex(bspPath);
    if (!idx) return props;
    return props.filter(p => !idx.inSkyArea(p.origin));
  } catch { return props; }
}

export function skyboxFaceMask(bspPath) {
  const idx = skyAreaIndex(bspPath);
  if (!idx) return null;
  const { leafsBuf, nLeafs, areaOf, skyArea } = idx;
  const leafFaceBuf = readLump(bspPath, 16);
  const facesBuf = readLump(bspPath, 7);
  if (!leafFaceBuf || !facesBuf) return null;

  const numFaces = Math.floor(facesBuf.length / 56);
  const inSky = new Uint8Array(numFaces), inPlay = new Uint8Array(numFaces);
  const skyBox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const playBox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let li = 0; li < nLeafs; li++) {
    const isSky = areaOf(li) === skyArea;
    const box = isSky ? skyBox : playBox;
    if (isSky || areaOf(li) !== 0) {
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], leafsBuf.readInt16LE(li * LEAF_SZ + 8 + k * 2));
        box[3 + k] = Math.max(box[3 + k], leafsBuf.readInt16LE(li * LEAF_SZ + 14 + k * 2));
      }
    }
    const first = leafsBuf.readUInt16LE(li * LEAF_SZ + 20);
    const count = leafsBuf.readUInt16LE(li * LEAF_SZ + 22);
    const mark = isSky ? inSky : inPlay;
    for (let k = 0; k < count; k++) {
      const o = (first + k) * 2;
      if (o + 2 > leafFaceBuf.length) break;
      const fi = leafFaceBuf.readUInt16LE(o);
      if (fi < numFaces) mark[fi] = 1;
    }
  }
  if (!isFinite(skyBox[0]) || !isFinite(playBox[0])) return null;
  let separated = false;
  for (let k = 0; k < 3 && !separated; k++) separated = skyBox[3 + k] < playBox[k] || playBox[3 + k] < skyBox[k];
  if (!separated) return null;

  const vb = readLump(bspPath, 3), eb = readLump(bspPath, 12), sb = readLump(bspPath, 13);
  if (vb && eb && sb) {
    const PAD = 1;
    for (let fi = 0; fi < numFaces; fi++) {
      if (inSky[fi] || inPlay[fi]) continue;
      const fe = facesBuf.readInt32LE(fi * 56 + 4), ne = facesBuf.readInt16LE(fi * 56 + 8);
      if (ne < 3) continue;
      let all = true;
      for (let e = 0; e < ne && all; e++) {
        const o = (fe + e) * 4;
        if (o + 4 > sb.length) { all = false; break; }
        const se = sb.readInt32LE(o), ei = Math.abs(se);
        if (ei * 4 + 4 > eb.length) { all = false; break; }
        const v = se >= 0 ? eb.readUInt16LE(ei * 4) : eb.readUInt16LE(ei * 4 + 2);
        if (v * 12 + 12 > vb.length) { all = false; break; }
        for (let k = 0; k < 3; k++) {
          const c = vb.readFloatLE(v * 12 + k * 4);
          if (c < skyBox[k] - PAD || c > skyBox[3 + k] + PAD) { all = false; break; }
        }
      }
      if (all) inSky[fi] = 1;
    }
  }
  for (let fi = 0; fi < numFaces; fi++) if (inPlay[fi]) inSky[fi] = 0;
  return inSky;
}

export function readEntityLump(bspPath) {
  const lump = readLump(bspPath, 0);
  if (!lump) return null;
  const end = lump.indexOf(0);
  return lump.toString('latin1', 0, end >= 0 ? end : lump.length);
}

export function readModels(bspPath) {
  const lump = readLump(bspPath, 14);
  if (!lump) return [];
  const out = [];
  for (let i = 0; i + 48 <= lump.length; i += 48) {
    out.push({
      mins: [lump.readFloatLE(i), lump.readFloatLE(i + 4), lump.readFloatLE(i + 8)],
      maxs: [lump.readFloatLE(i + 12), lump.readFloatLE(i + 16), lump.readFloatLE(i + 20)],
      origin: [lump.readFloatLE(i + 24), lump.readFloatLE(i + 28), lump.readFloatLE(i + 32)],
      firstface: lump.readInt32LE(i + 40),
      numfaces: lump.readInt32LE(i + 44)
    });
  }
  return out;
}

const NODRAW_CLASS = new Set([
  'dispenser_touch_trigger',
  'func_achievement', 'func_areaportal', 'func_areaportalwindow', 'func_bomb_reset',
  'func_capturezone', 'func_clip_vphysics', 'func_croc', 'func_detail_blocker',
  'func_dustcloud', 'func_dustmotes', 'func_flag_alert', 'func_flagdetectionzone',
  'func_ladder', 'func_nav_avoid', 'func_nav_avoidance_obstacle', 'func_nav_blocker',
  'func_nav_prefer', 'func_nav_prerequisite', 'func_no_annotations', 'func_nobevel',
  'func_nobuild', 'func_nogrenades', 'func_occluder', 'func_passtime_goal',
  'func_passtime_goalie_zone', 'func_passtime_no_ball_zone', 'func_powerupvolume',
  'func_precipitation', 'func_proprrespawnzone', 'func_regenerate', 'func_respawnflag',
  'func_respawnroom', 'func_respawnroomvisualizer', 'func_smokevolume', 'func_suggested_build', 'func_tfbot_hint',
  'func_upgradestation', 'func_useableladder', 'func_viscluster', 'func_water',
  'env_bubbles'
]);
const BLEND_RENDERMODE = new Set(['1', '2', '3', '4', '5', '9']);
const DOOR_LINEAR = new Set(['func_door', 'func_movelinear']);
const DOOR_ROTATING = new Set(['func_door_rotating']);
const SF_DOOR_START_OPEN = 1;
const SF_DOOR_ROTATE_BACKWARDS = 2;
const SF_DOOR_NONSOLID_TO_PLAYER = 4;
const SF_DOOR_PASSABLE = 8;
const SF_DOOR_TOGGLE = 32;
const SF_DOOR_TOUCH_OPENS = 1024;
const SF_DOOR_ROTATE_X = 64;
const SF_DOOR_ROTATE_Y = 128;
const SF_MOVELINEAR_NOT_SOLID = 8;
const DOOR_DEFAULT_SPEED = 100;
const DOOR_DEFAULT_WAIT = 4;
const DOOR_ROTATE_DEFAULT_DEGREES = 90;
const MOVELINEAR_DEFAULT_DISTANCE = 100;
const OUTPUT_SEP = String.fromCharCode(27);

const DEG = Math.PI / 180;
function angleRotation(pitch, yaw, roll) {
  if (!pitch && !yaw && !roll) return null;
  const p = pitch * DEG, y = yaw * DEG, r = roll * DEG;
  const sp = Math.sin(p), cp = Math.cos(p), sy = Math.sin(y), cy = Math.cos(y), sr = Math.sin(r), cr = Math.cos(r);
  return [
    cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy,
    cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy,
    -sp, sr * cp, cr * cp
  ];
}

export function applyBrushXform(xf, p) {
  if (!xf) return p;
  const m = xf.m, o = xf.o;
  if (!m) return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  return [
    p[0] * m[0] + p[1] * m[1] + p[2] * m[2] + o[0],
    p[0] * m[3] + p[1] * m[4] + p[2] * m[5] + o[1],
    p[0] * m[6] + p[1] * m[7] + p[2] * m[8] + o[2]
  ];
}

export function composeBrushXform(outer, inner) {
  if (!outer) return inner;
  if (!inner) return outer;
  const o = applyBrushXform(outer, inner.o);
  if (!outer.m) return { o, m: inner.m };
  if (!inner.m) return { o, m: outer.m };
  const a = outer.m, b = inner.m, m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return { o, m };
}

function axisRotation(axis, deg) {
  const t = deg * DEG, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  const [x, y, z] = axis;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k
  ];
}

export function doorPoseXform(door, frac) {
  const f = Math.max(0, Math.min(1, frac));
  if (!door || !f) return null;
  if (door.kind === 'rotate') {
    const m = axisRotation(door.axis, door.degrees * f);
    const p = door.hinge;
    return {
      m,
      o: [
        p[0] - (p[0] * m[0] + p[1] * m[1] + p[2] * m[2]),
        p[1] - (p[0] * m[3] + p[1] * m[4] + p[2] * m[5]),
        p[2] - (p[0] * m[6] + p[1] * m[7] + p[2] * m[8])
      ]
    };
  }
  const d = door.travel * f;
  if (!d) return null;
  return { m: null, o: [door.dir[0] * d, door.dir[1] * d, door.dir[2] * d] };
}

function moveDirVector(s) {
  const v = String(s ?? '').trim().split(/\s+/).map(parseFloat);
  const p = Number.isFinite(v[0]) ? v[0] : 0;
  const y = Number.isFinite(v[1]) ? v[1] : 0;
  const r = Number.isFinite(v[2]) ? v[2] : 0;
  if (p === -1 && y === 0 && r === 0) return [0, 0, 1];
  if (p === -2 && y === 0 && r === 0) return [0, 0, -1];
  const pr = p * DEG, yr = y * DEG;
  return [Math.cos(pr) * Math.cos(yr), Math.cos(pr) * Math.sin(yr), -Math.sin(pr)];
}

function num(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultVec3(s) {
  const v = String(s ?? '').trim().split(/\s+/).map(parseFloat);
  return [0, 1, 2].map(i => (Number.isFinite(v[i]) ? v[i] : 0));
}

export function doorRecord(e, model, mi, vec3 = defaultVec3) {
  const cls = String(e.classname || '').toLowerCase();
  const linear = DOOR_LINEAR.has(cls);
  if (!linear && !DOOR_ROTATING.has(cls)) return null;
  const flags = parseInt(e.spawnflags, 10) || 0;
  const name = String(e.targetname || '').toLowerCase() || null;
  const speed = Math.max(1, num(e.speed, DOOR_DEFAULT_SPEED));
  const wait = num(e.wait, DOOR_DEFAULT_WAIT);
  const base = {
    model: mi, name, cls, speed, wait,
    autoReturn: !(flags & SF_DOOR_TOGGLE) && wait >= 0,
    touchOpens: !!(flags & SF_DOOR_TOUCH_OPENS)
  };
  if (linear) {
    const dir = moveDirVector(e.movedir);
    let travel, spawnFrac;
    if (cls === 'func_movelinear') {
      travel = num(e.movedistance, MOVELINEAR_DEFAULT_DISTANCE);
      spawnFrac = Math.max(0, Math.min(1, num(e.startposition, 0)));
      base.autoReturn = false;
      base.touchOpens = false;
      base.solid = !(flags & SF_MOVELINEAR_NOT_SOLID);
    } else {
      const size = [model.maxs[0] - model.mins[0], model.maxs[1] - model.mins[1], model.maxs[2] - model.mins[2]];
      travel = Math.abs(dir[0] * size[0]) + Math.abs(dir[1] * size[1]) + Math.abs(dir[2] * size[2]) - num(e.lip, 0);
      spawnFrac = (flags & SF_DOOR_START_OPEN) || String(e.spawnpos ?? '').trim() === '1' ? 1 : 0;
      base.solid = !(flags & SF_DOOR_PASSABLE) && !(flags & SF_DOOR_NONSOLID_TO_PLAYER);
    }
    if (!(travel > 0)) return null;
    return { ...base, kind: 'linear', dir, travel, spawnFrac, duration: travel / speed };
  }
  const axis = (flags & SF_DOOR_ROTATE_X) ? [1, 0, 0] : (flags & SF_DOOR_ROTATE_Y) ? [0, 1, 0] : [0, 0, 1];
  let degrees = num(e.distance, DOOR_ROTATE_DEFAULT_DEGREES);
  if (flags & SF_DOOR_ROTATE_BACKWARDS) degrees = -degrees;
  if (!degrees) return null;
  return {
    ...base, kind: 'rotate', axis, degrees, hinge: vec3(e.origin),
    spawnFrac: (flags & SF_DOOR_START_OPEN) || String(e.spawnpos ?? '').trim() === '1' ? 1 : 0,
    solid: !(flags & SF_DOOR_PASSABLE) && !(flags & SF_DOOR_NONSOLID_TO_PLAYER),
    duration: Math.abs(degrees) / speed
  };
}

export function brushModelDrawn(bspPath, movers = null) {
  const models = readModels(bspPath);
  const drawn = new Uint8Array(models.length);
  const xform = new Array(models.length).fill(null);
  const doors = [];
  const doorOf = new Int32Array(models.length).fill(-1);
  if (!models.length) return { models, drawn, xform, doors, doorOf };
  drawn[0] = 1;
  const text = readEntityLump(bspPath);
  if (!text) return { models, drawn, xform, doors, doorOf };
  const vec3 = (s, d = 0) => {
    const v = String(s ?? '').trim().split(/\s+/).map(parseFloat);
    return [0, 1, 2].map(i => (Number.isFinite(v[i]) ? v[i] : d));
  };
  const ents = parseEntities(text);
  for (const e of ents) {
    if (!e.model || e.model[0] !== '*') continue;
    const mi = parseInt(e.model.slice(1), 10);
    if (!Number.isInteger(mi) || mi <= 0 || mi >= models.length) continue;
    const cls = String(e.classname || '').toLowerCase();
    if (cls.startsWith('trigger_') || NODRAW_CLASS.has(cls)) continue;
    const rm = String(e.rendermode ?? '').trim();
    if (String(e.startdisabled || '').trim() === '1') continue;
    if (rm === '10') continue;
    if (String(e.renderamt ?? '').trim() === '0' && BLEND_RENDERMODE.has(rm)) continue;
    drawn[mi] = 1;
    const o = vec3(e.origin);
    const a = vec3(e.angles);
    const m = angleRotation(a[0], a[1], a[2]);
    if (m || o[0] || o[1] || o[2]) xform[mi] = { o, m };
    const door = movers ? movers.get(mi) || null : doorRecord(e, models[mi], mi, vec3);
    if (door) { doorOf[mi] = doors.length; doors.push(door); }
  }
  return { models, drawn, xform, doors, doorOf };
}

export function pakEntries(bspPath) {
  const fd = openSync(bspPath, 'r');
  try {
    const info = lumpInfo(fd, 40);
    if (!info || info.filelen < 22) return [];
    const tailLen = Math.min(info.filelen, 66000);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, info.fileofs + info.filelen - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOfs = tail.readUInt32LE(eocd + 16);
    if (cdSize <= 0 || cdSize > 64 * 1024 * 1024) return [];
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, info.fileofs + cdOfs);
    const out = [];
    let i = 0;
    while (i + 46 <= cd.length && cd.readUInt32LE(i) === 0x02014b50) {
      const method = cd.readUInt16LE(i + 10);
      const compSize = cd.readUInt32LE(i + 20);
      const uncompSize = cd.readUInt32LE(i + 24);
      const nameLen = cd.readUInt16LE(i + 28);
      const extraLen = cd.readUInt16LE(i + 30);
      const commentLen = cd.readUInt16LE(i + 32);
      const localOfs = cd.readUInt32LE(i + 42);
      const name = cd.toString('latin1', i + 46, i + 46 + nameLen);
      out.push({ name: name.toLowerCase().replace(/\\/g, '/'), method, compSize, uncompSize, localOfs, pakOfs: info.fileofs });
      i += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

export function readPakEntry(bspPath, entry) {
  if (entry.localOfs < 0 || entry.pakOfs < 0) return null;
  cap(entry.compSize, LIMITS.zipEntry, 'pak entry compressed size');
  cap(entry.uncompSize, LIMITS.zipEntry, 'pak entry uncompressed size');
  const fd = openSync(bspPath, 'r');
  try {
    const local = Buffer.alloc(30);
    readSync(fd, local, 0, 30, entry.pakOfs + entry.localOfs);
    if (local.readUInt32LE(0) !== 0x04034b50) return null;
    const nameLen = local.readUInt16LE(26);
    const extraLen = local.readUInt16LE(28);
    const data = Buffer.alloc(entry.compSize);
    readSync(fd, data, 0, entry.compSize, entry.pakOfs + entry.localOfs + 30 + nameLen + extraLen);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: LIMITS.zipEntry });
    if (entry.method === 14) {
      const propSize = data.readUInt16LE(2);
      const props = data.subarray(4, 4 + propSize);
      return lzmaDecode(props, data.subarray(4 + propSize), entry.uncompSize);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

export function parseEntities(text) {
  const out = [];
  const blockRe = /\{([^}]*)\}/g;
  const kvRe = /"([^"]*)"\s*"([^"]*)"/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const ent = {};
    const outputs = [];
    let kv;
    kvRe.lastIndex = 0;
    while ((kv = kvRe.exec(m[1])) !== null) {
      const key = kv[1].toLowerCase();
      ent[key] = kv[2];
      if (key.startsWith('on')) outputs.push({ key, value: kv[2] });
    }
    if (!ent.classname) continue;
    if (outputs.length) ent.outputs = outputs;
    out.push(ent);
  }
  return out;
}

export function pathTracks(entities) {
  const map = new Map();
  for (const e of entities) {
    if (e.classname !== 'path_track' || !e.targetname) continue;
    const org = (e.origin || '0 0 0').split(/\s+/).map(parseFloat);
    if (org.length < 3 || org.some(v => !Number.isFinite(v))) continue;
    if (!map.has(e.targetname.toLowerCase())) {
      map.set(e.targetname.toLowerCase(), { name: e.targetname, origin: org, target: (e.target || '').toLowerCase() });
    }
  }
  return map;
}

export function chainLength(tracks, startName) {
  const start = tracks.get(String(startName).toLowerCase());
  if (!start) return null;
  const visited = new Set();
  let cur = start;
  let distance = 0;
  let count = 1;
  while (cur.target && tracks.has(cur.target) && !visited.has(cur.target)) {
    visited.add(cur.target);
    const next = tracks.get(cur.target);
    const dx = next.origin[0] - cur.origin[0];
    const dy = next.origin[1] - cur.origin[1];
    const dz = next.origin[2] - cur.origin[2];
    distance += Math.sqrt(dx * dx + dy * dy + dz * dz);
    cur = next;
    count++;
    if (count > 4096) break;
  }
  return { distance: Math.round(distance), nodes: count, endNode: cur.name };
}
