import { LIMITS, cap } from './limits.js';

function cstr(buf, ofs) {
  if (ofs <= 0 || ofs >= buf.length) return '';
  const end = buf.indexOf(0, ofs);
  return buf.toString('latin1', ofs, end >= 0 ? end : buf.length);
}

export function parseMDL(buf) {
  if (buf.length < 244 || buf.toString('ascii', 0, 4) !== 'IDST') throw new Error('not a studiomdl');
  const version = buf.readInt32LE(4);
  if (version < 44 || version > 49) throw new Error('unsupported mdl version ' + version);
  const h = {
    version,
    checksum: buf.readInt32LE(8),
    name: buf.toString('latin1', 12, 12 + 64).replace(/\0.*$/, ''),
    flags: buf.readInt32LE(152),
    numbones: buf.readInt32LE(156),
    boneindex: buf.readInt32LE(160),
    numlocalanim: buf.readInt32LE(180),
    localanimindex: buf.readInt32LE(184),
    numlocalseq: buf.readInt32LE(188),
    localseqindex: buf.readInt32LE(192),
    numtextures: buf.readInt32LE(204),
    textureindex: buf.readInt32LE(208),
    numcdtextures: buf.readInt32LE(212),
    cdtextureindex: buf.readInt32LE(216),
    numskinref: buf.readInt32LE(220),
    numskinfamilies: buf.readInt32LE(224),
    skinindex: buf.readInt32LE(228),
    numbodyparts: buf.readInt32LE(232),
    bodypartindex: buf.readInt32LE(236)
  };

  cap(h.numtextures, LIMITS.mdlTextures, 'mdl textures');
  cap(h.numcdtextures, LIMITS.mdlCdTextures, 'mdl cdtextures');
  cap(h.numskinfamilies, LIMITS.mdlSkinFamilies, 'mdl skinfamilies');
  cap(h.numskinref, LIMITS.mdlSkinRefs, 'mdl skinrefs');
  cap(h.numbones, LIMITS.mdlBones, 'mdl bones');
  cap(h.numbodyparts, LIMITS.mdlBodyParts, 'mdl bodyparts');
  cap(h.numlocalseq, LIMITS.mdlSeq, 'mdl sequences');
  cap(h.numlocalanim, LIMITS.mdlAnims, 'mdl anims');

  const textures = [];
  for (let i = 0; i < h.numtextures; i++) {
    const base = h.textureindex + i * 64;
    if (base + 64 > buf.length) break;
    textures.push(cstr(buf, base + buf.readInt32LE(base)));
  }
  const cdtextures = [];
  for (let i = 0; i < h.numcdtextures; i++) {
    const io = h.cdtextureindex + i * 4;
    if (io < 0 || io + 4 > buf.length) break;
    const ofs = buf.readInt32LE(io);
    cdtextures.push(cstr(buf, ofs).replace(/\\/g, '/'));
  }
  const skins = [];
  for (let f = 0; f < h.numskinfamilies; f++) {
    const fam = [];
    for (let r = 0; r < h.numskinref; r++) {
      const so = h.skinindex + (f * h.numskinref + r) * 2;
      if (so < 0 || so + 2 > buf.length) break;
      fam.push(buf.readInt16LE(so));
    }
    skins.push(fam);
  }

  const bones = [];
  for (let i = 0; i < h.numbones; i++) {
    const base = h.boneindex + i * 216;
    if (base + 216 > buf.length) break;
    bones.push({
      name: cstr(buf, base + buf.readInt32LE(base)),
      parent: buf.readInt32LE(base + 4),
      pos: [buf.readFloatLE(base + 28), buf.readFloatLE(base + 32), buf.readFloatLE(base + 36)],
      quat: [buf.readFloatLE(base + 40), buf.readFloatLE(base + 44), buf.readFloatLE(base + 48), buf.readFloatLE(base + 52)],
      rot: [buf.readFloatLE(base + 56), buf.readFloatLE(base + 60), buf.readFloatLE(base + 64)],
      posscale: [buf.readFloatLE(base + 68), buf.readFloatLE(base + 72), buf.readFloatLE(base + 76)],
      rotscale: [buf.readFloatLE(base + 80), buf.readFloatLE(base + 84), buf.readFloatLE(base + 88)]
    });
  }

  const bodyparts = [];
  for (let bp = 0; bp < h.numbodyparts; bp++) {
    const bpBase = h.bodypartindex + bp * 16;
    if (bpBase < 0 || bpBase + 16 > buf.length) break;
    const numModels = buf.readInt32LE(bpBase + 4);
    cap(numModels, LIMITS.mdlModels, 'mdl models');
    const modelIndex = bpBase + buf.readInt32LE(bpBase + 12);
    const models = [];
    for (let m = 0; m < numModels; m++) {
      const mb = modelIndex + m * 148;
      if (mb < 0 || mb + 148 > buf.length) break;
      const nummeshes = buf.readInt32LE(mb + 72);
      cap(nummeshes, LIMITS.mdlMeshes, 'mdl meshes');
      const meshindex = mb + buf.readInt32LE(mb + 76);
      const numvertices = buf.readInt32LE(mb + 80);
      const vertexindex = buf.readInt32LE(mb + 84);
      const meshes = [];
      for (let me = 0; me < nummeshes; me++) {
        const meb = meshindex + me * 116;
        if (meb + 116 > buf.length) break;
        meshes.push({
          material: buf.readInt32LE(meb),
          numvertices: buf.readInt32LE(meb + 8),
          vertexoffset: buf.readInt32LE(meb + 12)
        });
      }
      models.push({
        name: buf.toString('latin1', mb, mb + 64).replace(/\0.*$/, ''),
        numvertices, vertexindex: vertexindex / 48,
        meshes
      });
    }
    bodyparts.push({ name: cstr(buf, bpBase + buf.readInt32LE(bpBase)), models });
  }

  const sequences = [];
  for (let i = 0; i < h.numlocalseq; i++) {
    const base = h.localseqindex + i * 212;
    if (base + 212 > buf.length) break;
    sequences.push({
      label: cstr(buf, base + buf.readInt32LE(base + 4)),
      activity: cstr(buf, base + buf.readInt32LE(base + 8)),
      anim0: buf.readInt16LE(base + buf.readInt32LE(base + 100))
    });
  }
  const anims = [];
  for (let i = 0; i < h.numlocalanim; i++) {
    const base = h.localanimindex + i * 100;
    if (base + 100 > buf.length) break;
    anims.push({
      index: i,
      base,
      name: cstr(buf, base + buf.readInt32LE(base + 4)),
      fps: buf.readFloatLE(base + 8),
      flags: buf.readInt32LE(base + 12),
      numframes: buf.readInt32LE(base + 16),
      animblock: buf.readInt32LE(base + 52),
      animindex: buf.readInt32LE(base + 56)
    });
  }

  return { header: h, textures, cdtextures, skins, bones, bodyparts, sequences, anims, buf };
}

const STUDIO_ANIM_RAWPOS = 0x01;
const STUDIO_ANIM_RAWROT = 0x02;
const STUDIO_ANIM_ANIMPOS = 0x04;
const STUDIO_ANIM_ANIMROT = 0x08;
const STUDIO_ANIM_DELTA = 0x10;
const STUDIO_ANIM_RAWROT2 = 0x20;

function quat48(buf, ofs) {
  const x = buf.readUInt16LE(ofs), y = buf.readUInt16LE(ofs + 2), zw = buf.readUInt16LE(ofs + 4);
  const qx = (x - 32768) / 32768;
  const qy = (y - 32768) / 32768;
  const qz = ((zw & 0x7fff) - 16384) / 16384;
  const sum = qx * qx + qy * qy + qz * qz;
  let qw = Math.sqrt(Math.max(0, 1 - sum));
  if (zw & 0x8000) qw = -qw;
  return [qx, qy, qz, qw];
}

function quat64(buf, ofs) {
  const lo = buf.readUInt32LE(ofs), hi = buf.readUInt32LE(ofs + 4);
  const xr = lo & 0x1fffff;
  const yr = ((lo >>> 21) | ((hi & 0x3ff) << 11)) & 0x1fffff;
  const zr = (hi >>> 10) & 0x1fffff;
  const qx = (xr - 1048576) / 1048576.5;
  const qy = (yr - 1048576) / 1048576.5;
  const qz = (zr - 1048576) / 1048576.5;
  let qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
  if (hi & 0x80000000) qw = -qw;
  return [qx, qy, qz, qw];
}

function readRLEValue(buf, valuesOfs, frame) {
  let ofs = valuesOfs;
  let f = frame;
  let guard = 0;
  for (;;) {
    if (ofs + 2 > buf.length || guard++ > 10000) return 0;
    const valid = buf.readUInt8(ofs);
    const total = buf.readUInt8(ofs + 1);
    if (total === 0) return 0;
    if (f < total) {
      const idx = Math.min(f, valid - 1);
      if (idx < 0) return 0;
      return buf.readInt16LE(ofs + 2 + idx * 2);
    }
    f -= total;
    ofs += 2 + valid * 2;
  }
}

export function sampleAnim(mdl, animDesc, frame) {
  const buf = mdl.buf;
  const bones = mdl.bones;
  const out = bones.map(b => ({ pos: b.pos.slice(), quat: b.quat.slice() }));
  if (animDesc.animblock !== 0 || animDesc.animindex <= 0) return { bones: out, ok: false };
  let ofs = animDesc.base + animDesc.animindex;
  let guard = 0;
  while (ofs + 4 <= buf.length && guard++ < 512) {
    const boneIdx = buf.readUInt8(ofs);
    const flags = buf.readUInt8(ofs + 1);
    const nextofs = buf.readInt16LE(ofs + 2);
    if (boneIdx === 255) break;
    if (boneIdx >= bones.length) break;
    const b = bones[boneIdx];
    const o = out[boneIdx];
    let p = ofs + 4;
    if (flags & STUDIO_ANIM_RAWROT2) {
      o.quat = quat64(buf, p);
      p += 8;
    } else if (flags & STUDIO_ANIM_RAWROT) {
      o.quat = quat48(buf, p);
      p += 6;
    }
    if (flags & STUDIO_ANIM_RAWPOS) {
      const f16 = i => {
        const hbits = buf.readUInt16LE(p + i * 2);
        const s = (hbits & 0x8000) ? -1 : 1;
        const e = (hbits >> 10) & 0x1f;
        const m = hbits & 0x3ff;
        if (e === 0) return s * m * Math.pow(2, -24);
        if (e === 31) return s * 65504;
        return s * (1 + m / 1024) * Math.pow(2, e - 15);
      };
      o.pos = [f16(0), f16(1), f16(2)];
      p += 6;
    }
    if (flags & STUDIO_ANIM_ANIMROT) {
      const base = p;
      const rot = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const vofs = buf.readInt16LE(base + a * 2);
        rot[a] = vofs ? readRLEValue(buf, base + vofs, frame) * b.rotscale[a] : 0;
      }
      const delta = !!(flags & STUDIO_ANIM_DELTA);
      const rx = rot[0] + (delta ? 0 : b.rot[0]);
      const ry = rot[1] + (delta ? 0 : b.rot[1]);
      const rz = rot[2] + (delta ? 0 : b.rot[2]);
      const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
      const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
      const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
      o.quat = [
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz
      ];
      p += 6;
    }
    if (flags & STUDIO_ANIM_ANIMPOS) {
      const base = p;
      const delta = !!(flags & STUDIO_ANIM_DELTA);
      for (let a = 0; a < 3; a++) {
        const vofs = buf.readInt16LE(base + a * 2);
        const v = vofs ? readRLEValue(buf, base + vofs, frame) * b.posscale[a] : 0;
        o.pos[a] = v + (delta ? 0 : b.pos[a]);
      }
      p += 6;
    }
    if (nextofs === 0) break;
    ofs += nextofs;
  }
  return { bones: out, ok: true };
}

export function parseVVD(buf) {
  if (buf.length < 64 || buf.toString('ascii', 0, 4) !== 'IDSV') throw new Error('not a vvd');
  const numLODs = buf.readInt32LE(12);
  const numLodVerts0 = buf.readInt32LE(16);
  const numFixups = buf.readInt32LE(48);
  const fixupStart = buf.readInt32LE(52);
  const vertexStart = buf.readInt32LE(56);

  const readVert = i => {
    const o = vertexStart + i * 48;
    return {
      weights: [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
      bones: [buf.readUInt8(o + 12), buf.readUInt8(o + 13), buf.readUInt8(o + 14)],
      numBones: buf.readUInt8(o + 15),
      pos: [buf.readFloatLE(o + 16), buf.readFloatLE(o + 20), buf.readFloatLE(o + 24)],
      normal: [buf.readFloatLE(o + 28), buf.readFloatLE(o + 32), buf.readFloatLE(o + 36)],
      uv: [buf.readFloatLE(o + 40), buf.readFloatLE(o + 44)]
    };
  };

  let verts;
  if (numFixups > 0) {
    cap(numFixups, LIMITS.vvdVerts, 'vvd fixups');
    verts = [];
    for (let i = 0; i < numFixups; i++) {
      const fo = fixupStart + i * 12;
      const lod = buf.readInt32LE(fo);
      const src = buf.readInt32LE(fo + 4);
      const count = buf.readInt32LE(fo + 8);
      if (lod < 0) continue;
      cap(verts.length + count, LIMITS.vvdVerts, 'vvd verts');
      for (let v = 0; v < count; v++) verts.push(readVert(src + v));
    }
  } else {
    cap(numLodVerts0, LIMITS.vvdVerts, 'vvd verts');
    verts = new Array(numLodVerts0);
    for (let i = 0; i < numLodVerts0; i++) verts[i] = readVert(i);
  }
  return { numLODs, verts };
}

export function parseVTX(buf) {
  if (buf.length < 36) throw new Error('vtx too small');
  const version = buf.readInt32LE(0);
  if (version !== 7) throw new Error('unsupported vtx version ' + version);
  const numBodyParts = buf.readInt32LE(28);
  const bodyPartOffset = buf.readInt32LE(32);
  const bodyparts = [];
  for (let bp = 0; bp < numBodyParts; bp++) {
    const bpo = bodyPartOffset + bp * 8;
    const numModels = buf.readInt32LE(bpo);
    const modelOffset = bpo + buf.readInt32LE(bpo + 4);
    const models = [];
    for (let m = 0; m < numModels; m++) {
      const mo = modelOffset + m * 8;
      const numLODs = buf.readInt32LE(mo);
      const lodOffset = mo + buf.readInt32LE(mo + 4);
      const lo = lodOffset;
      const numMeshes = buf.readInt32LE(lo);
      const meshOffset = lo + buf.readInt32LE(lo + 4);
      const meshes = [];
      for (let me = 0; me < numMeshes; me++) {
        const meo = meshOffset + me * 9;
        const numStripGroups = buf.readInt32LE(meo);
        cap(numStripGroups, LIMITS.mdlMeshes, 'vtx strip groups');
        const sgOffset = meo + buf.readInt32LE(meo + 4);
        const indices = [];
        for (let sg = 0; sg < numStripGroups; sg++) {
          const sgo = sgOffset + sg * 25;
          if (sgo < 0 || sgo + 25 > buf.length) break;
          const numVerts = buf.readInt32LE(sgo);
          const vertOffset = sgo + buf.readInt32LE(sgo + 4);
          const numIndices = buf.readInt32LE(sgo + 8);
          const indexOffset = sgo + buf.readInt32LE(sgo + 12);
          const numStrips = buf.readInt32LE(sgo + 16);
          const stripOffset = sgo + buf.readInt32LE(sgo + 20);
          cap(numVerts, LIMITS.vvdVerts, 'vtx strip-group verts');
          cap(numStrips, LIMITS.mdlMeshes, 'vtx strips');
          const origIds = new Array(numVerts);
          for (let v = 0; v < numVerts; v++) {
            origIds[v] = buf.readUInt16LE(vertOffset + v * 9 + 4);
          }
          for (let st = 0; st < numStrips; st++) {
            const so = stripOffset + st * 27;
            if (so < 0 || so + 27 > buf.length) break;
            const sNumIdx = buf.readInt32LE(so);
            cap(sNumIdx, LIMITS.vvdVerts, 'vtx strip indices');
            const sIdxOfs = buf.readInt32LE(so + 4);
            const flags = buf.readUInt8(so + 18);
            const isList = (flags & 1) !== 0;
            if (isList) {
              for (let ii = 0; ii < sNumIdx; ii++) {
                const local = buf.readUInt16LE(indexOffset + (sIdxOfs + ii) * 2);
                indices.push(origIds[local]);
              }
            } else {
              for (let ii = 0; ii + 2 < sNumIdx; ii++) {
                const a = origIds[buf.readUInt16LE(indexOffset + (sIdxOfs + ii) * 2)];
                const b = origIds[buf.readUInt16LE(indexOffset + (sIdxOfs + ii + 1) * 2)];
                const c = origIds[buf.readUInt16LE(indexOffset + (sIdxOfs + ii + 2) * 2)];
                if (a === b || b === c || a === c) continue;
                if (ii % 2 === 0) indices.push(a, b, c);
                else indices.push(b, a, c);
              }
            }
          }
        }
        meshes.push({ indices });
      }
      models.push({ meshes });
    }
    bodyparts.push({ models });
  }
  return { version, bodyparts };
}

export function buildMeshes(mdl, vvd, vtx) {
  const out = [];
  for (let bp = 0; bp < mdl.bodyparts.length; bp++) {
    const mBP = mdl.bodyparts[bp];
    const xBP = vtx.bodyparts[bp];
    if (!xBP) break;
    const model = mBP.models[0];
    const xModel = xBP.models[0];
    if (!model || !xModel) continue;
    for (let me = 0; me < model.meshes.length; me++) {
      const mesh = model.meshes[me];
      const xMesh = xModel.meshes[me];
      if (!xMesh || !xMesh.indices.length) continue;
      const vertBase = model.vertexindex + mesh.vertexoffset;
      const idx = new Uint32Array(xMesh.indices.length);
      for (let i = 0; i < xMesh.indices.length; i++) idx[i] = vertBase + xMesh.indices[i];
      out.push({ material: mesh.material, indices: idx, bodypart: bp });
    }
  }
  return { meshes: out, verts: vvd.verts };
}
