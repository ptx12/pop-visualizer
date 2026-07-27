import { openSync, readSync, closeSync } from 'fs';
import { inflateRawSync } from 'zlib';
import { decodeValveLZMA, lzmaDecode } from './lzma.js';
import { LIMITS, cap } from './limits.js';

function lumpInfo(fd, index) {
  const head = Buffer.alloc(8 + 64 * 16);
  readSync(fd, head, 0, head.length, 0);
  if (head.toString('ascii', 0, 4) !== 'VBSP') return null;
  return { fileofs: head.readInt32LE(8 + index * 16), filelen: head.readInt32LE(8 + index * 16 + 4) };
}

export function readLump(bspPath, index, maxLen = 64 * 1024 * 1024) {
  const fd = openSync(bspPath, 'r');
  try {
    const info = lumpInfo(fd, index);
    if (!info || info.filelen <= 0 || info.filelen > maxLen || info.fileofs < 0) return null;
    let lump = Buffer.alloc(info.filelen);
    readSync(fd, lump, 0, info.filelen, info.fileofs);
    if (lump.toString('ascii', 0, 4) === 'LZMA') {
      try { lump = decodeValveLZMA(lump); } catch { return null; }
      if (!lump) return null;
    }
    return lump;
  } finally {
    closeSync(fd);
  }
}

export function readStaticProps(bspPath) {
  const fd = openSync(bspPath, 'r');
  try {
    const info = lumpInfo(fd, 35);
    if (!info || info.filelen <= 0 || info.filelen > 64 * 1024 * 1024) return [];
    let buf = Buffer.alloc(info.filelen);
    readSync(fd, buf, 0, info.filelen, info.fileofs);
    if (buf.toString('ascii', 0, 4) === 'LZMA') { try { buf = decodeValveLZMA(buf); } catch { return []; } if (!buf) return []; }
    const lumpCount = buf.readInt32LE(0);
    if (lumpCount < 0 || lumpCount > 64) return [];
    let sprp = null;
    for (let i = 0; i < lumpCount; i++) {
      const b = 4 + i * 16;
      if (b + 16 > buf.length) break;
      const id = buf.toString('ascii', b, b + 4);
      if (id === 'sprp' || id === 'prps') { sprp = { version: buf.readUInt16LE(b + 6), fileofs: buf.readInt32LE(b + 8), filelen: buf.readInt32LE(b + 12) }; break; }
    }
    if (!sprp) return [];
    let ofs = sprp.fileofs - info.fileofs;
    const end = ofs + sprp.filelen;
    if (ofs < 4 || end > buf.length) return [];
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
  } catch { return []; } finally { closeSync(fd); }
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
      // Entities flagged StartDisabled are not in the world at round start — that is how maps
      // hold back destroyed-state props (e.g. rottenburg's cap_hatch_destroy_animated_prop,
      // the blown-open bomb hole) and the bomb-path holograms. This is the real, per-entity
      // marker, so it works on every map without matching model names.
      if (String(e.startdisabled || '').trim() === '1') continue;
      // Likewise rendermode 10 / renderamt 0 mean "present but not drawn".
      if (String(e.rendermode || '').trim() === '10') continue;
      if (String(e.renderamt || '').trim() === '0') continue;
      const origin = (e.origin || '0 0 0').split(/\s+/).map(parseFloat);
      if (origin.length < 3 || origin.some(v => !Number.isFinite(v))) continue;
      const ang = (e.angles || '0 0 0').split(/\s+/).map(parseFloat);
      const angles = [ang[0] || 0, ang[1] || 0, ang[2] || 0];
      let scale = parseFloat(e.modelscale);
      if (!(scale > 0.02 && scale < 64)) scale = 1;
      out.push({ model, origin: [origin[0], origin[1], origin[2]], angles, scale, dynamic: true });
    }
    return skyPropFilter(bspPath, out);
  } catch { return []; }
}

const LEAF_SZ = 32;

// The 3D skybox is built as a sealed miniature room off in a corner of the map. The engine
// never draws it as world geometry: CSkyCamera::Activate() records
// m_skyboxData.area = engine->GetArea( m_skyboxData.origin ) and CSkyboxView renders that area
// separately, scaled down and re-centred on the viewer. vbsp's area flood fill gives the sealed
// skybox room its own area number, so the area of the sky_camera identifies it exactly -- real
// portable BSP data, no geometry heuristics. Returns a per-face mask, 1 = 3D skybox only.
// Verified across 260 maps: on all 238 with both a sky_camera and spawns, the sky area is
// distinct from every spawn area. The one map where they coincide (background01, the main-menu
// backdrop, which has no sealed skybox) is caught by the play-area check below.
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

  // Self-check: if the playable space shares the sky_camera's area then this map has no sealed
  // skybox room and the area tells us nothing, so leave everything alone.
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

// Props built inside the skybox room are miniatures too (mannhattan's cargo_ship_skybox,
// chimney_skybox008, ...). Same area test, so they go with the geometry instead of hanging in
// the void at full size beside the map.
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
    // Solid leaves (area 0) are the void between rooms and would smear the play box over the
    // whole map, so only real, reachable leaves define these extents.
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
  // Second self-check: the two regions must be disjoint in space, or this is not a map with a
  // skybox room off to one side and we must not touch anything. Boxes are disjoint when a
  // separating axis exists, so one clear axis is enough.
  let separated = false;
  for (let k = 0; k < 3 && !separated; k++) separated = skyBox[3 + k] < playBox[k] || playBox[3 + k] < skyBox[k];
  if (!separated) return null;

  // Displacement and water faces are not reliably listed in a leaf's leafface array, so the
  // leaf lists alone miss part of the skybox miniature. The sky area's own leaf bounds close
  // that gap: it is a sealed room far from the play space, so anything wholly inside it is part
  // of it. Both tests come from the same area data; neither invents a distance or a size.
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
  // A face shared with any non-skybox leaf stays: only geometry exclusive to the skybox room goes.
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

// Brush model 0 is worldspawn; models 1+ belong to brush entities, and most of them are
// invisible gameplay volumes the game never draws. Nothing in the BSP marks them: their brushes
// carry CONTENTS_SOLID like any wall, their texinfo flags are 0, and vrad even builds lightmaps
// for them whenever the mapper textured the volume with a real material instead of a tools one
// (mannhattan's two map-spanning func_nav_prerequisite brushes are cp_manor/wallpaper02 and are
// fully lit). Source decides this in C++ at spawn time instead:
//   CBaseTrigger::InitTrigger()  -> AddEffects( EF_NODRAW ) unless the showtriggers cheat is set
//   CFuncNavCost/CFuncNavBlocker/CFuncNavObstruction::Spawn() -> AddEffects( EF_NODRAW )
// so the rule is per entity class, and this mirrors it. Every trigger_* class derives from
// CBaseTrigger; NODRAW_CLASS lists the rest, covering all 78 brush-entity classes present in a
// 260-map corpus. Unknown classes default to drawn, matching the engine: an entity is visible
// unless its own Spawn() hides it, so a class this list has not seen can never lose real
// geometry.
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
  'func_respawnroom', 'func_smokevolume', 'func_suggested_build', 'func_tfbot_hint',
  'func_upgradestation', 'func_useableladder', 'func_viscluster', 'func_water',
  'env_bubbles'
]);
// Blending render modes; renderamt is the entity's alpha in these, and ignored in kRenderNormal.
const BLEND_RENDERMODE = new Set(['1', '2', '3', '4', '5', '9']);

const DEG = Math.PI / 180;
// Source AngleMatrix() from mathlib, as the three rows of a matrix3x4_t, so that
// VectorTransform is out[i] = dot(in, row[i]). QAngle order is (pitch, yaw, roll).
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

export function brushModelDrawn(bspPath) {
  const models = readModels(bspPath);
  const drawn = new Uint8Array(models.length);
  const xform = new Array(models.length).fill(null);
  if (!models.length) return { models, drawn, xform };
  drawn[0] = 1;
  const text = readEntityLump(bspPath);
  if (!text) return { models, drawn, xform };
  const vec3 = (s, d = 0) => {
    const v = String(s ?? '').trim().split(/\s+/).map(parseFloat);
    return [0, 1, 2].map(i => (Number.isFinite(v[i]) ? v[i] : d));
  };
  for (const e of parseEntities(text)) {
    if (!e.model || e.model[0] !== '*') continue;
    const mi = parseInt(e.model.slice(1), 10);
    if (!Number.isInteger(mi) || mi <= 0 || mi >= models.length) continue;
    const cls = String(e.classname || '').toLowerCase();
    if (cls.startsWith('trigger_') || NODRAW_CLASS.has(cls)) continue;
    // Per-entity render state the engine honours at spawn: CFuncBrush::Spawn() calls TurnOff()
    // -> AddEffects( EF_NODRAW ) when StartDisabled is set, and kRenderNone never draws.
    const rm = String(e.rendermode ?? '').trim();
    if (String(e.startdisabled || '').trim() === '1') continue;
    if (rm === '10') continue;
    if (String(e.renderamt ?? '').trim() === '0' && BLEND_RENDERMODE.has(rm)) continue;
    drawn[mi] = 1;
    // When a brush entity has an origin brush, vbsp recentres its geometry on that origin and
    // writes the world position into the entity's "origin" key -- dmodel_t.origin stays zero
    // (measured: zero on all 13215 drawn brush entities across 242 maps, while 11669 of them
    // carry a nonzero entity origin). So the vertices in the lump are model space, and the
    // entity's origin/angles are the only thing that puts them back where the game draws them.
    const o = vec3(e.origin);
    const a = vec3(e.angles);
    const m = angleRotation(a[0], a[1], a[2]);
    if (m || o[0] || o[1] || o[2]) xform[mi] = { o, m };
  }
  return { models, drawn, xform };
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
