import { cap, LIMITS } from './limits.js';

// Valve DMX "binary 2 / format pcf 1" reader — the encoding every stock TF2 particles/*.pcf
// uses. Layout: null-terminated header string, uint16 string-table count + null-terminated
// strings, int32 element count, then ALL element headers (uint16 type-name index,
// null-terminated element name, 16-byte GUID), then one attribute block per element in the
// same order (int32 attribute count, then uint16 name index + uint8 type + value).
const AT_ELEMENT = 1, AT_FIRST_ARRAY = 15;

export function parsePCF(buf) {
  if (!buf || buf.length < 16) return null;
  const zero = buf.indexOf(0);
  if (zero < 0) return null;
  const header = buf.toString('latin1', 0, zero);
  const m = header.match(/dmx encoding binary (\d+) format pcf (\d+)/i);
  if (!m) return null;
  const encoding = parseInt(m[1], 10), format = parseInt(m[2], 10);
  if (encoding !== 2 || format !== 1) return { unsupported: header.trim(), systems: [] };

  let o = zero + 1;
  const nStr = buf.readUInt16LE(o); o += 2;
  const strings = [];
  for (let i = 0; i < nStr; i++) {
    const e = buf.indexOf(0, o);
    if (e < 0) return null;
    strings.push(buf.toString('latin1', o, e));
    o = e + 1;
  }
  const nEl = cap(buf.readInt32LE(o), LIMITS.pcfElements || 65536, 'pcf elements'); o += 4;
  const els = [];
  for (let i = 0; i < nEl; i++) {
    const ti = buf.readUInt16LE(o); o += 2;
    const e = buf.indexOf(0, o);
    if (e < 0) return null;
    const name = buf.toString('latin1', o, e); o = e + 1;
    o += 16;
    if (o > buf.length) return null;
    els.push({ type: strings[ti] || '', name, attrs: {} });
  }

  const readVal = t => {
    switch (t) {
      case AT_ELEMENT: { const v = buf.readInt32LE(o); o += 4; return { ref: v }; }
      case 2: { const v = buf.readInt32LE(o); o += 4; return v; }
      case 3: { const v = buf.readFloatLE(o); o += 4; return v; }
      case 4: { const v = buf.readUInt8(o); o += 1; return !!v; }
      case 5: { const e = buf.indexOf(0, o); const v = buf.toString('latin1', o, e); o = e + 1; return v; }
      case 6: { const n = buf.readInt32LE(o); o += 4 + Math.max(0, n); return null; }
      case 7: { const v = buf.readInt32LE(o) / 10000; o += 4; return v; }
      case 8: { const v = [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]; o += 4; return v; }
      case 9: { const v = [buf.readFloatLE(o), buf.readFloatLE(o + 4)]; o += 8; return v; }
      case 10: case 12: { const v = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]; o += 12; return v; }
      case 11: case 13: { const v = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8), buf.readFloatLE(o + 12)]; o += 16; return v; }
      case 14: { o += 64; return null; }
      default: throw new Error('unknown DMX attribute type ' + t);
    }
  };

  for (let i = 0; i < nEl; i++) {
    if (o + 4 > buf.length) break;
    const n = buf.readInt32LE(o); o += 4;
    if (n < 0 || n > 8192) break;
    for (let a = 0; a < n; a++) {
      if (o + 3 > buf.length) break;
      const si = buf.readUInt16LE(o); o += 2;
      const t = buf.readUInt8(o); o += 1;
      const key = strings[si] || ('attr' + si);
      if (t >= AT_FIRST_ARRAY) {
        const cnt = buf.readInt32LE(o); o += 4;
        if (cnt < 0 || cnt > 65536) return null;
        const base = t - (AT_FIRST_ARRAY - 1);
        const arr = [];
        for (let k = 0; k < cnt; k++) arr.push(readVal(base));
        els[i].attrs[key] = arr;
      } else els[i].attrs[key] = readVal(t);
    }
  }

  const deref = v => (v && typeof v === 'object' && v.ref !== undefined) ? els[v.ref] || null : null;
  const listOf = (el, key) => (Array.isArray(el.attrs[key]) ? el.attrs[key] : [])
    .map(deref).filter(Boolean)
    .map(c => ({ name: c.name, cls: String(c.attrs.functionName || c.name || ''), attrs: c.attrs }));

  const systems = [];
  for (const el of els) {
    if (el.type !== 'DmeParticleSystemDefinition') continue;
    systems.push({
      name: el.name,
      material: String(el.attrs.material || '').replace(/\\/g, '/').replace(/\.vmt$/i, '').toLowerCase(),
      radius: Number(el.attrs.radius) || 0,
      color: Array.isArray(el.attrs.color) ? el.attrs.color : [255, 255, 255, 255],
      maxParticles: Number(el.attrs.max_particles) || 0,
      initialParticles: Number(el.attrs.initial_particles) || 0,
      emitters: listOf(el, 'emitters'),
      initializers: listOf(el, 'initializers'),
      operators: listOf(el, 'operators'),
      renderers: listOf(el, 'renderers'),
      children: (Array.isArray(el.attrs.children) ? el.attrs.children : [])
        .map(deref).filter(Boolean)
        .map(c => String((c.attrs && c.attrs.child && deref(c.attrs.child) && deref(c.attrs.child).name) || c.name || ''))
    });
  }
  return { encoding, format, systems };
}
