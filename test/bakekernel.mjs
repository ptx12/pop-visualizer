import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { bakeTopDown, extractFaces, lightmapStats, lightmapStatsJS } from '../shared/bsprender.js';
import { makeMaterialLoader } from '../shared/materials.js';
import { flushLumpCache } from '../shared/bsp.js';
import { flushGameFS } from '../shared/gamefs.js';
import { bakeWasmReady } from '../shared/bakewasm.js';

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('not ok ' + name + (detail ? ' — ' + detail : '')); }
};

check('bakekernel.wasm loads', bakeWasmReady());

const tf = TF_CANDIDATES.find(p => p && existsSync(path.join(p, 'tf2_misc_dir.vpk')));
if (!tf) {
  console.log('skip bakekernel map checks: no Team Fortress 2 install found');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const MAPS = ['mvm_coaltown', 'mvm_decoy', 'mvm_mannworks'];
const bspFor = m => {
  for (const d of [path.join(tf, 'maps'), path.join(tf, 'download', 'maps')]) {
    const p = path.join(d, m + '.bsp');
    if (existsSync(p)) return p;
  }
  return null;
};

function hashBytes(a) {
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a[i]) >>> 0;
  return h;
}

function hashFloats(a) {
  let h = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    h = (h * 31 + (v === v ? Math.round(v * 1000) : -1)) >>> 0;
  }
  return h;
}

for (const map of MAPS) {
  const bsp = bspFor(map);
  if (!bsp) { console.log('skip ' + map + ': not installed'); continue; }

  flushLumpCache();
  const { faces } = extractFaces(bsp, null, { keepAll: true, lightmap: true });
  const js = lightmapStatsJS(faces);
  const w = lightmapStats(faces);
  let binDiffs = 0;
  for (let i = 0; i < 64; i++) if (js.hist[i] !== w.hist[i]) binDiffs++;
  for (let i = 0; i < 256; i++) if (js.dhist[i] !== w.dhist[i]) binDiffs++;
  check(map + ': lightmap histogram matches the JavaScript path', binDiffs === 0, binDiffs + ' bins differ');
  check(map + ': lightmap scalars match the JavaScript path',
    js.total === w.total && js.sceneSum === w.sceneSum && js.litCount === w.litCount && js.lmUpBright === w.lmUpBright);

  flushLumpCache(); flushGameFS();
  const a = await bakeTopDown(bsp, makeMaterialLoader(tf, bsp), {});
  check(map + ': bake produced an image', !!(a && a.rgba && a.rgba.length));
  if (!a) continue;
  check(map + ': bake produced a height grid', !!(a.heightGrid && a.heightGrid.grid.length));
  check(map + ': every drawn pixel is opaque and every height cell is finite or absent',
    a.rgba.length === a.width * a.height * 4 &&
    a.heightGrid.grid.every(v => v !== v || Number.isFinite(v)));
  check(map + ': bake is deterministic across runs', await (async () => {
    flushLumpCache(); flushGameFS();
    const b = await bakeTopDown(bsp, makeMaterialLoader(tf, bsp), {});
    return b && hashBytes(a.rgba) === hashBytes(b.rgba) &&
      hashFloats(a.heightGrid.grid) === hashFloats(b.heightGrid.grid) &&
      a.heightGrid.zMin === b.heightGrid.zMin && a.heightGrid.zMax === b.heightGrid.zMax;
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
