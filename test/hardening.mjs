import { decodeValveLZMA, lzmaDecode } from '../shared/lzma.js';
import { decodeVTF } from '../shared/vtf.js';
import { parseVVD, parseVTX, parseMDL } from '../shared/mdl.js';
import { parseNav } from '../shared/nav.js';
import { readPakEntry } from '../shared/bsp.js';
import { indexVPK } from '../shared/vpk.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let fail = 0;
function throws(label, fn) {
  try { fn(); console.log('FAIL ' + label + ' (did not throw)'); fail++; }
  catch { console.log('ok   ' + label); }
}
function noThrow(label, fn) {
  try { fn(); console.log('ok   ' + label); }
  catch (e) { console.log('FAIL ' + label + ' (' + e.message + ')'); fail++; }
}

throws('lzma: 4GB declared output rejected', () => {
  const b = Buffer.alloc(64);
  b.write('LZMA', 0, 'ascii');
  b.writeUInt32LE(0xFFFFFFF0, 4);
  b.writeUInt32LE(20, 8);
  decodeValveLZMA(b);
});

throws('lzma: declared compressed size exceeds buffer', () => {
  const b = Buffer.alloc(64);
  b.write('LZMA', 0, 'ascii');
  b.writeUInt32LE(1000, 4);
  b.writeUInt32LE(0xFFFFFFF0, 8);
  decodeValveLZMA(b);
});

throws('lzma: absurd ratio rejected', () => {
  lzmaDecode(Buffer.from([0x5d, 0, 0, 0, 0]), Buffer.alloc(10), 200 * 1024 * 1024);
});

throws('vtf: 65535x65535 dimension rejected', () => {
  const b = Buffer.alloc(96);
  b.write('VTF\0', 0, 'ascii');
  b.writeUInt32LE(7, 4);
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(80, 12);
  b.writeUInt16LE(65535, 16);
  b.writeUInt16LE(65535, 18);
  b.writeInt32LE(13, 52);
  decodeVTF(b);
});

throws('vtf: zero dimension rejected', () => {
  const b = Buffer.alloc(96);
  b.write('VTF\0', 0, 'ascii');
  b.writeUInt32LE(7, 4);
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(80, 12);
  b.writeUInt16LE(0, 16);
  b.writeUInt16LE(64, 18);
  b.writeInt32LE(13, 52);
  decodeVTF(b);
});

throws('vvd: 2.1B vertex count rejected (no fixups)', () => {
  const b = Buffer.alloc(64);
  b.write('IDSV', 0, 'ascii');
  b.writeInt32LE(1, 12);
  b.writeInt32LE(0x7FFFFFFF, 16);
  b.writeInt32LE(0, 48);
  b.writeInt32LE(64, 52);
  b.writeInt32LE(64, 56);
  parseVVD(b);
});

throws('nav: implausible area count rejected', () => {
  const b = Buffer.alloc(64);
  b.writeUInt32LE(0xFEEDFACE, 0);
  b.writeUInt32LE(16, 4);
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(0, 12);
  b.writeUInt8(0, 16);
  b.writeUInt16LE(0, 17);
  b.writeUInt8(0, 19);
  b.writeUInt32LE(300000, 20);
  parseNav(b);
});

noThrow('non-LZMA buffer returns null (no throw)', () => {
  const r = decodeValveLZMA(Buffer.from('NOPE and some more bytes here....'));
  if (r !== null) throw new Error('expected null');
});

function mdlHeader(size = 512) {
  const b = Buffer.alloc(size);
  b.write('IDST', 0, 'ascii');
  b.writeInt32LE(44, 4);
  return b;
}

noThrow('mdl: minimal valid header parses', () => {
  const r = parseMDL(mdlHeader());
  if (r.bones.length || r.textures.length) throw new Error('expected empty');
});

throws('mdl: 2.1B bone count rejected', () => {
  const b = mdlHeader();
  b.writeInt32LE(0x7FFFFFFF, 156);
  parseMDL(b);
});

throws('mdl: absurd skinref count rejected', () => {
  const b = mdlHeader();
  b.writeInt32LE(100000, 220);
  b.writeInt32LE(100000, 224);
  parseMDL(b);
});

throws('vtx: absurd strip-group vertex count rejected', () => {
  const b = Buffer.alloc(128);
  b.writeInt32LE(7, 0);
  b.writeInt32LE(1, 28);
  b.writeInt32LE(36, 32);
  b.writeInt32LE(1, 36);
  b.writeInt32LE(8, 40);
  b.writeInt32LE(1, 44);
  b.writeInt32LE(8, 48);
  b.writeInt32LE(1, 52);
  b.writeInt32LE(8, 56);
  b.writeInt32LE(1, 60);
  b.writeInt32LE(12, 64);
  b.writeInt32LE(0x7FFFFFFF, 72);
  parseVTX(b);
});

throws('bsp: 4GB pak entry compressed size rejected', () => {
  readPakEntry(join(tmpdir(), 'popvis_nonexistent.bsp'), { compSize: 0xFFFFFFF0, uncompSize: 0, localOfs: 0, pakOfs: 0, method: 0 });
});

throws('vpk: implausible tree size rejected', () => {
  const p = join(tmpdir(), 'popvis_bad_' + process.pid + '_dir.vpk');
  const b = Buffer.alloc(28);
  b.writeUInt32LE(0x55aa1234, 0);
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(0xFFFFFFF0, 8);
  writeFileSync(p, b);
  try { indexVPK(p); } finally { unlinkSync(p); }
});

process.exit(fail ? 1 : 0);
