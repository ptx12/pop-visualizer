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
      origin: [lump.readFloatLE(i + 24), lump.readFloatLE(i + 28), lump.readFloatLE(i + 32)]
    });
  }
  return out;
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
    let kv;
    kvRe.lastIndex = 0;
    while ((kv = kvRe.exec(m[1])) !== null) ent[kv[1].toLowerCase()] = kv[2];
    if (ent.classname) out.push(ent);
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
