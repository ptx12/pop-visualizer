import { readFileSync, existsSync } from 'node:fs';
import { readEntityLump } from '../shared/bsp.js';

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

let ex = null;
const decoder = new TextDecoder();
const spew = [];

function fdWrite(fd, iov, iovcnt, pnum) {
  const view = new DataView(ex.memory.buffer);
  const bytes = new Uint8Array(ex.memory.buffer);
  let total = 0;
  for (let i = 0; i < iovcnt; i++) {
    const ptr = view.getUint32(iov + i * 8, true);
    const len = view.getUint32(iov + i * 8 + 4, true);
    spew.push(decoder.decode(bytes.subarray(ptr, ptr + len)));
    total += len;
  }
  view.setUint32(pnum, total, true);
  return 0;
}

const mod = await WebAssembly.instantiate(readFileSync(wasmPath), {
  env: { emscripten_notify_memory_growth: () => {} },
  wasi_snapshot_preview1: {
    proc_exit: () => {}, fd_write: fdWrite, fd_close: () => 0, fd_seek: () => 0,
    environ_sizes_get: () => 0, environ_get: () => 0, clock_time_get: () => 0,
  },
});
ex = mod.instance.exports;
if (ex._initialize) ex._initialize();

const mem = () => new Uint8Array(ex.memory.buffer);
const cstr = ptr => {
  if (!ptr) return '';
  const m = mem();
  let end = ptr;
  while (m[end]) end++;
  return decoder.decode(m.subarray(ptr, end));
};
const push = str => {
  const bytes = new TextEncoder().encode(str + '\0');
  const p = ex.sim_ents_alloc(bytes.length);
  mem().set(bytes, p);
  return p;
};

check('entity system initialises', ex.sim_ents_init(1 / 66.6667) === 1);

const lump = new TextEncoder().encode(readEntityLump(`${MAPS_DIR}/${map}.bsp`));
check('bsp entity lump is readable', lump.length > 1000, `${lump.length} bytes`);

const ptr = ex.sim_ents_alloc(lump.length + 1);
mem().set(lump, ptr);
mem()[ptr + lump.length] = 0;

let count = 0;
try {
  count = ex.sim_ents_load_lump(ptr, lump.length);
} catch (e) {
  console.log('FAIL map entities spawn — ' + e.message);
  console.log(spew.join('').split('\n').slice(-15).join('\n'));
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
check('the engine creates its own entities alongside the map', byClass.has('soundent') && byClass.has('player_manager'),
  [...byClass.keys()].join(', '));
check('entities carry targetnames from the lump', names.size > 5, names.size + ' named');

const distinct = byClass.size;
console.log(`  distinct classnames: ${distinct}`);
check('the lump yields many distinct classnames', distinct > 10, distinct + ' classes');

const logicClasses = [...byClass.keys()].filter(c => c.startsWith('logic_') || c.startsWith('trigger_') || c.startsWith('filter_'));
console.log(`  logic/trigger/filter classes: ${logicClasses.join(', ') || 'none'}`);
check('invisible map logic is parsed, not just visible geometry', logicClasses.length > 0,
  logicClasses.length + ' classes');

let originsSeen = 0;
for (let i = 0; i < count; i++) {
  if (ex.sim_ents_origin(i, 0) || ex.sim_ents_origin(i, 1) || ex.sim_ents_origin(i, 2)) originsSeen++;
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

const relay = (() => {
  for (let i = 0; i < count; i++) {
    if (cstr(ex.sim_ents_classname(i)) === 'logic_relay') return cstr(ex.sim_ents_targetname(i));
  }
  return null;
})();

if (relay) {
  const before = ex.sim_ents_count();
  check('an input can be queued against a named entity',
    ex.sim_ents_fire_input(push(relay), push('Kill'), 0, 0) === 1);
  for (let i = 0; i < 4; i++) ex.sim_ents_frame();
  check('the event queue delivers a Kill input to its target', ex.sim_ents_count() < before,
    `${before} -> ${ex.sim_ents_count()}`);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
