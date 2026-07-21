import { LIMITS, cap } from './limits.js';

export function parseNav(buf) {
  const r = { pos: 0 };
  const u8 = () => buf.readUInt8(r.pos++);
  const u16 = () => { const v = buf.readUInt16LE(r.pos); r.pos += 2; return v; };
  const u32 = () => { const v = buf.readUInt32LE(r.pos); r.pos += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(r.pos); r.pos += 4; return v; };
  const skip = n => { r.pos += n; };

  if (u32() !== 0xFEEDFACE) throw new Error('not a nav file');
  const version = u32();
  if (version < 10 || version > 16) throw new Error('unsupported nav version ' + version);
  const subVersion = version >= 10 ? u32() : 0;
  u32();
  if (version >= 14) u8();
  const placeCount = u16();
  for (let i = 0; i < placeCount; i++) skip(u16());
  if (version > 11) u8();
  const areaCount = u32();
  if (areaCount > 200000) throw new Error('implausible area count');

  const areas = new Array(areaCount);
  let totalConnections = 0;
  for (let i = 0; i < areaCount; i++) {
    const id = u32();
    if (version <= 8) u8();
    else if (version < 13) u16();
    else u32();
    const nw = [f32(), f32(), f32()];
    const se = [f32(), f32(), f32()];
    const neZ = f32();
    const swZ = f32();
    const connect = [];
    for (let d = 0; d < 4; d++) {
      const n = u32();
      if (n > 10000) throw new Error('implausible connection count');
      totalConnections += n;
      cap(totalConnections, LIMITS.navConnections, 'nav connections');
      for (let c = 0; c < n; c++) connect.push(u32());
    }
    const hideCount = u8();
    const hide = [];
    for (let h = 0; h < hideCount; h++) {
      u32();
      hide.push([f32(), f32(), f32()]);
      hide[hide.length - 1].push(u8());
    }
    if (version < 15) {
      const approachCount = u8();
      skip(approachCount * (4 + 4 + 1 + 4 + 1));
    }
    const encounterCount = u32();
    if (encounterCount > 20000) throw new Error('implausible encounter count');
    for (let e = 0; e < encounterCount; e++) {
      skip(4 + 1 + 4 + 1);
      skip(u8() * 5);
    }
    if (version >= 5) u16();
    if (version >= 6) {
      for (let d = 0; d < 2; d++) skip(u32() * 4);
    }
    if (version >= 8) skip(8);
    if (version >= 11) skip(16);
    if (version >= 16) {
      const visCount = u32();
      if (visCount > 200000) throw new Error('implausible visibility count');
      skip(visCount * 5);
      u32();
    }
    let tfAttributes = 0;
    if (subVersion >= 1) tfAttributes = u32();
    areas[i] = { id, nw, se, neZ, swZ, connect, tfAttributes };
    if (hide.length) areas[i].hide = hide;
  }
  return { version, subVersion, areas };
}

export function navSummary(nav) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of nav.areas) {
    minX = Math.min(minX, a.nw[0]);
    minY = Math.min(minY, a.nw[1]);
    maxX = Math.max(maxX, a.se[0]);
    maxY = Math.max(maxY, a.se[1]);
  }
  return { areas: nav.areas.length, bounds: [minX, minY, maxX, maxY] };
}
