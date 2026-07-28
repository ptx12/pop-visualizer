import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { lzmaDecode, lzmaDecodeJS, lzmaWasmReady } from '../shared/lzma.js';

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf'
];

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('not ok ' + name); }
};

const tf = TF_CANDIDATES.find(p => existsSync(p));

check('lzmakernel.wasm loads', lzmaWasmReady());

function lzmaLumps(bspPath) {
  const buf = readFileSync(bspPath);
  const out = [];
  if (buf.length < 8 + 64 * 16) return out;
  for (let i = 0; i < 64; i++) {
    const off = buf.readUInt32LE(8 + i * 16);
    const len = buf.readUInt32LE(8 + i * 16 + 4);
    if (!len || len < 17 || off + len > buf.length) continue;
    const lump = buf.subarray(off, off + len);
    if (lump.toString('ascii', 0, 4) !== 'LZMA') continue;
    const actual = lump.readUInt32LE(4);
    const lzSize = lump.readUInt32LE(8);
    if (17 + lzSize > lump.length || !actual) continue;
    out.push({ lump: i, props: lump.subarray(12, 17), src: lump.subarray(17, 17 + lzSize), actual });
  }
  return out;
}

if (!tf) {
  console.log('skip  no Team Fortress 2 install found — wasm/JS equivalence not exercised');
} else {
  const dirs = ['maps', 'download/maps'].map(d => path.join(tf, d)).filter(existsSync);
  const bsps = [];
  for (const d of dirs) {
    for (const f of readdirSync(d)) if (f.toLowerCase().endsWith('.bsp')) bsps.push(path.join(d, f));
  }
  bsps.sort();
  const sample = bsps.slice(0, 12);

  let lumps = 0;
  let bytes = 0;
  let mismatched = 0;
  let tWasm = 0;
  let tJs = 0;

  for (const bsp of sample) {
    let found;
    try { found = lzmaLumps(bsp); } catch { continue; }
    for (const e of found) {
      let a, b;
      const t0 = performance.now();
      try { a = lzmaDecode(e.props, e.src, e.actual); } catch { a = null; }
      tWasm += performance.now() - t0;
      const t1 = performance.now();
      try { b = lzmaDecodeJS(e.props, e.src, e.actual); } catch { b = null; }
      tJs += performance.now() - t1;
      lumps++;
      bytes += e.actual;
      if (!a || !b || a.length !== b.length || !a.equals(b)) {
        mismatched++;
        console.log('     mismatch in ' + path.basename(bsp) + ' lump ' + e.lump);
      }
    }
  }

  check('found LZMA-compressed lumps to compare', lumps > 0);
  check('wasm output is byte-identical to the JS decoder (' + lumps + ' lumps, ' + (bytes / 1048576).toFixed(1) + ' MB)', mismatched === 0);
  if (lumps > 0) {
    console.log('     wasm ' + (tWasm / 1000).toFixed(2) + 's vs js ' + (tJs / 1000).toFixed(2) + 's  ->  ' +
      (tJs / Math.max(1e-6, tWasm)).toFixed(1) + 'x faster');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
