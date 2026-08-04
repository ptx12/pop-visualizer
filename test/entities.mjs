import { readFileSync, existsSync } from 'node:fs';
import { readLump } from '../shared/bsp.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const MAPS_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf/maps';
const CANDIDATES = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock'];

const wasmPath = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
if (!existsSync(wasmPath)) {
  console.log('skip entity tests: ents.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}

const map = CANDIDATES.find(m => existsSync(`${MAPS_DIR}/${m}.bsp`));
if (!map) {
  console.log('skip entity tests: no MvM map found in ' + MAPS_DIR);
  process.exit(0);
}
console.log('map: ' + map);

const mod = await WebAssembly.instantiate(readFileSync(wasmPath), {
  env: { emscripten_notify_memory_growth: () => {} },
  wasi_snapshot_preview1: {
    proc_exit: () => {}, fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0,
    environ_sizes_get: () => 0, environ_get: () => 0, clock_time_get: () => 0,
  },
});
const ex = mod.instance.exports;
if (ex._initialize) ex._initialize();

const mem = () => new Uint8Array(ex.memory.buffer);
const cstr = ptr => {
  if (!ptr) return '';
  const m = mem();
  let end = ptr;
  while (m[end]) end++;
  return new TextDecoder().decode(m.subarray(ptr, end));
};

check('entity system initialises', ex.sim_ents_init(1 / 66.6667) === 1);

const lump = readLump(`${MAPS_DIR}/${map}.bsp`, 0);
check('bsp entity lump is readable', lump && lump.length > 1000, `${lump ? lump.length : 0} bytes`);

const ptr = ex.sim_ents_alloc(lump.length);
mem().set(lump, ptr);

let count = 0;
try {
  count = ex.sim_ents_load_lump(ptr, lump.length);
} catch (e) {
  console.log('FAIL map entities spawn — ' + e.message);
  console.log('');
  console.log('The entity system links and initialises, but spawning reaches an engine');
  console.log('interface that is still null. Implementing IVEngineServer and IVModelInfo');
  console.log('over the app own BSP and model readers is the next step.');
  process.exit(1);
}
console.log(`  entities spawned: ${count}`);
check('map entities spawn through MapEntity_ParseAllEntities', count > 50, count + ' entities');

const byClass = new Map();
const names = new Set();
for (let i = 0; i < count; i++) {
  const cls = cstr(ex.sim_ents_classname(i));
  byClass.set(cls, (byClass.get(cls) || 0) + 1);
  const n = cstr(ex.sim_ents_targetname(i));
  if (n) names.add(n);
}

check('worldspawn exists exactly once', byClass.get('worldspawn') === 1,
  String(byClass.get('worldspawn')));
check('entities carry targetnames from the lump', names.size > 5, names.size + ' named');

const distinct = byClass.size;
console.log(`  distinct classnames: ${distinct}`);
check('the lump yields many distinct classnames', distinct > 15, distinct + ' classes');

const logicClasses = [...byClass.keys()].filter(c => c.startsWith('logic_') || c.startsWith('trigger_') || c.startsWith('filter_'));
console.log(`  logic/trigger/filter classes: ${logicClasses.join(', ') || 'none'}`);
check('invisible map logic is parsed, not just visible geometry', logicClasses.length > 0,
  logicClasses.length + ' classes');

let originsSeen = 0;
for (let i = 0; i < count; i++) {
  const x = ex.sim_ents_origin(i, 0);
  const y = ex.sim_ents_origin(i, 1);
  const z = ex.sim_ents_origin(i, 2);
  if (x !== 0 || y !== 0 || z !== 0) originsSeen++;
}
check('entities keep the origins the lump gave them', originsSeen > count / 4,
  `${originsSeen}/${count} non-zero`);

const t0 = ex.sim_ents_curtime();
for (let i = 0; i < 66; i++) ex.sim_ents_frame();
const t1 = ex.sim_ents_curtime();
check('a second of frames advances curtime by one second',
  Math.abs((t1 - t0) - 66 / 66.6667) < 0.01, `${t0.toFixed(3)} -> ${t1.toFixed(3)}`);
check('the entity list survives a second of thinking', ex.sim_ents_count() > 0,
  ex.sim_ents_count() + ' entities');

const target = [...names][0];
check('an input can be queued against a named entity',
  ex.sim_ents_fire_input(
    (() => { const p = ex.sim_ents_alloc(target.length + 1); mem().set(new TextEncoder().encode(target + '\0'), p); return p; })(),
    (() => { const s = 'Kill\0'; const p = ex.sim_ents_alloc(s.length); mem().set(new TextEncoder().encode(s), p); return p; })(),
    0, 0) === 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
