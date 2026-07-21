import { decodeVTF, decodeImageJs, vtfWasmReady } from '../shared/vtf.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

check('vtfkernel.wasm loads', vtfWasmReady());
if (!vtfWasmReady()) {
  console.log('\nvtfkernel.wasm missing or invalid — run npm run build:wasm');
  process.exit(1);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FMT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, I8: 5, IA88: 6, A8: 8,
  ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, DXT1A: 20
};

const BPP = { 0: 4, 1: 4, 2: 3, 3: 3, 5: 1, 6: 2, 8: 1, 11: 4, 12: 4, 16: 4 };

function dataSize(w, h, fmt) {
  if (fmt === FMT.DXT1 || fmt === FMT.DXT1A) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fmt === FMT.DXT3 || fmt === FMT.DXT5) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  return w * h * BPP[fmt];
}

function makeVTF(w, h, fmt, seed) {
  const size = dataSize(w, h, fmt);
  const buf = Buffer.alloc(80 + size);
  buf.write('VTF\0', 0, 'ascii');
  buf.writeUInt32LE(7, 4);
  buf.writeUInt32LE(2, 8);
  buf.writeUInt32LE(80, 12);
  buf.writeUInt16LE(w, 16);
  buf.writeUInt16LE(h, 18);
  buf.writeUInt16LE(1, 24);
  buf.writeInt32LE(fmt, 52);
  buf[56] = 1;
  buf.writeInt32LE(-1, 57);
  buf[61] = 0;
  buf[62] = 0;
  const r = rng(seed);
  for (let i = 0; i < size; i++) buf[80 + i] = Math.floor(r() * 256);
  return buf;
}

const cases = [
  ['DXT1', FMT.DXT1], ['DXT1A', FMT.DXT1A], ['DXT3', FMT.DXT3], ['DXT5', FMT.DXT5],
  ['RGBA8888', FMT.RGBA8888], ['ABGR8888', FMT.ABGR8888], ['ARGB8888', FMT.ARGB8888],
  ['BGRA8888', FMT.BGRA8888], ['BGRX8888', FMT.BGRX8888], ['RGB888', FMT.RGB888],
  ['BGR888', FMT.BGR888], ['I8', FMT.I8], ['IA88', FMT.IA88], ['A8', FMT.A8]
];

const sizes = [[4, 4], [16, 16], [64, 32], [13, 7], [1, 1]];

let mismatched = 0, compared = 0, pixels = 0;
for (const [name, fmt] of cases) {
  let bad = 0;
  for (const [w, h] of sizes) {
    const buf = makeVTF(w, h, fmt, w * 31 + h * 7 + fmt);
    let a, b;
    try { a = decodeVTF(buf).rgba; } catch (e) { bad++; continue; }
    try { b = decodeImageJs(buf, 80, w, h, fmt); } catch (e) { bad++; continue; }
    compared++;
    pixels += w * h;
    if (a.length !== b.length) { bad++; continue; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; break; }
  }
  if (bad) mismatched += bad;
  check(name + ' matches the JS decoder at every size', bad === 0, bad + ' of ' + sizes.length + ' differ');
}

check('all formats compared', compared === cases.length * sizes.length, compared + ' comparisons');
check('zero pixel differences', mismatched === 0);

const big = makeVTF(256, 256, FMT.DXT5, 99);
const t0 = performance.now();
for (let i = 0; i < 20; i++) decodeVTF(big);
const tW = performance.now() - t0;
const t1 = performance.now();
for (let i = 0; i < 20; i++) decodeImageJs(big, 80, 256, 256, FMT.DXT5);
const tJ = performance.now() - t1;
check('wasm is not slower than JS', tW <= tJ * 1.2, `wasm ${tW.toFixed(0)}ms vs js ${tJ.toFixed(0)}ms`);
console.log(`     20x 256x256 DXT5: wasm ${tW.toFixed(0)}ms, js ${tJ.toFixed(0)}ms (${(tJ / Math.max(tW, 0.001)).toFixed(1)}x)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
