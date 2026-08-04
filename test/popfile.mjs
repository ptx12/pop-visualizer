import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntityLump, readLump, pakEntries, readPakEntry } from '../shared/bsp.js';
import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const TF_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';
const MAPS_DIR = `${TF_DIR}/maps`;
const CANDIDATES = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock'];

const wasmPath = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
if (!existsSync(wasmPath)) {
  console.log('skip popfile tests: ents.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}

const map = CANDIDATES.find(m => existsSync(`${MAPS_DIR}/${m}.bsp`));
if (!map) {
  console.log('skip popfile tests: no MvM map found in ' + MAPS_DIR);
  process.exit(0);
}

const popName = `${map}.pop`;
const popPath = join(repo, 'vanilla', popName);
if (!existsSync(popPath)) {
  console.log('skip popfile tests: no shipped popfile for ' + map);
  process.exit(0);
}
console.log(`map: ${map}  popfile: ${popName}`);

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
  env: {
    emscripten_notify_memory_growth: () => {},
    __syscall_getcwd(buf, size) {
      if (!buf || size < 2) return -34;
      const bytes = new Uint8Array(ex.memory.buffer);
      bytes[buf] = 47;
      bytes[buf + 1] = 0;
      return 2;
    },
  },
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
const upload = buf => {
  if (!buf || buf.length === 0) return { ptr: 0, len: 0 };
  const p = ex.sim_ents_alloc(buf.length);
  mem().set(buf, p);
  return { ptr: p, len: buf.length };
};
const addFile = (path, pathID, buf) => {
  const b = upload(buf);
  return ex.sim_fs_add(push(path), pathID ? push(pathID) : 0, b.ptr, b.len) === 1;
};

ex.sim_ents_init(1 / 66.6667);

const bspPath = `${MAPS_DIR}/${map}.bsp`;

let navBytes = null;
let navPathID = 'MOD';
const looseNav = `${MAPS_DIR}/${map}.nav`;
if (existsSync(looseNav)) {
  navBytes = readFileSync(looseNav);
} else {
  try {
    for (const entry of pakEntries(bspPath)) {
      if (entry.name.toLowerCase().endsWith(`${map}.nav`)) {
        navBytes = readPakEntry(bspPath, entry);
        navPathID = 'BSP';
        break;
      }
    }
  } catch {}
}

check('a navigation mesh is available for the map', !!navBytes && navBytes.length > 0,
  navBytes ? navBytes.length + ' bytes' : 'no .nav loose or in the pak lump');
if (navBytes) {
  check('the in-memory filesystem accepts the nav mesh',
    addFile(`maps/${map}.nav`, navPathID, navBytes));
  check('the filesystem resolves the nav mesh by name', ex.sim_fs_exists(push(`maps/${map}.nav`)) === 1);
}

const popText = readFileSync(popPath);
for (const base of ['robot_standard.pop', 'robot_giant.pop', 'robot_gatebot.pop']) {
  const p = join(repo, 'base', base);
  if (existsSync(p)) addFile(`scripts/population/${base}`, 'MOD', readFileSync(p));
}
check('the in-memory filesystem accepts the popfile',
  addFile(`scripts/population/${popName}`, 'MOD', popText));

const upgrades = join(TF_DIR, 'scripts', 'items', 'mvm_botupgrades.txt');
if (existsSync(upgrades)) addFile('scripts/items/mvm_botupgrades.txt', 'MOD', readFileSync(upgrades));

const L = i => upload(readLump(bspPath, i));
const planes = L(1), nodes = L(5), leafs = L(10), leafBrushes = L(17);
const brushes = L(18), brushSides = L(19), models = L(14);
ex.sim_ents_load_bsp(planes.ptr, planes.len, nodes.ptr, nodes.len, leafs.ptr, leafs.len, 32,
  leafBrushes.ptr, leafBrushes.len, brushes.ptr, brushes.len, brushSides.ptr, brushSides.len,
  models.ptr, models.len, push(map));

const dInfo = L(26), dVerts = L(33), dTris = L(48);
const faces = L(7), surfEdges = L(13), edges = L(12), verts = L(3);
ex.sim_ents_load_disp(dInfo.ptr, dInfo.len, dVerts.ptr, dVerts.len, dTris.ptr, dTris.len,
  faces.ptr, faces.len, surfEdges.ptr, surfEdges.len, edges.ptr, edges.len, verts.ptr, verts.len);

const texInfo = L(6), texData = L(2), stringTable = L(44), stringData = L(43);
ex.sim_ents_load_surfaces(texInfo.ptr, texInfo.len, texData.ptr, texData.len,
  stringTable.ptr, stringTable.len, stringData.ptr, stringData.len);

const lumpText = readEntityLump(bspPath);
const lumpBytes = new TextEncoder().encode(lumpText);
const lumpPtr = ex.sim_ents_alloc(lumpBytes.length + 1);
mem().set(lumpBytes, lumpPtr);
mem()[lumpPtr + lumpBytes.length] = 0;
ex.sim_ents_load_lump(lumpPtr, lumpBytes.length);

if (navBytes) {
  const navResult = ex.sim_nav_load();
  const areas = ex.sim_nav_area_count();
  check('CNavMesh::Load parses the real nav file', navResult === 0, 'NavErrorType ' + navResult);
  check('the loaded nav mesh has areas', areas > 0, areas + ' areas');
  console.log(`  nav areas: ${areas}`);
}

const spewMark = spew.length;
const loaded = ex.sim_pop_load(push(`scripts/population/${popName}`)) === 1;
const popSpew = spew.slice(spewMark).join('').split('\n')
  .filter(l => /warning|can't open|failed|couldn't/i.test(l));
check('CPopulationManager parses the popfile through Valve\'s own parser', loaded,
  popSpew.slice(0, 4).join(' | '));

const waveCount = ex.sim_pop_wave_count();
const model = buildModel(parse(popText.toString('utf8')), []);

check('Valve\'s parser finds waves', waveCount > 0, waveCount + ' waves');
check('the wave count agrees with the popfile parser in the app',
  waveCount === model.waves.length, `wasm ${waveCount} vs js ${model.waves.length}`);

const rows = [];
for (let i = 0; i < Math.min(waveCount, model.waves.length); i++) {
  rows.push({
    wave: i + 1,
    currency: [ex.sim_pop_wave_currency(i), model.waves[i].totalCurrency],
    enemies: [ex.sim_pop_wave_enemy_count(i), model.waves[i].totalBots]
  });
}
console.log('  wave   currency (valve/app)   enemies (valve/app)');
for (const r of rows) {
  console.log(`  ${String(r.wave).padStart(4)}   ${String(r.currency[0]).padStart(8)} / ${String(r.currency[1]).padEnd(8)}   ${String(r.enemies[0]).padStart(7)} / ${r.enemies[1]}`);
}

check('per-wave currency agrees with the popfile parser in the app',
  rows.every(r => r.currency[0] === r.currency[1]),
  rows.filter(r => r.currency[0] !== r.currency[1]).map(r => `wave ${r.wave}: ${r.currency[0]} vs ${r.currency[1]}`).join(', '));
check('per-wave enemy count agrees with the popfile parser in the app',
  rows.every(r => r.enemies[0] === r.enemies[1]),
  rows.filter(r => r.enemies[0] !== r.enemies[1]).map(r => `wave ${r.wave}: ${r.enemies[0]} vs ${r.enemies[1]}`).join(', '));

const SUPPORT_CODE = { null: 0, unlimited: 1, limited: 2 };
const wsRows = [];
for (let i = 0; i < Math.min(waveCount, model.waves.length); i++) {
  const valveCount = ex.sim_pop_wavespawn_count(i);
  const appSpawns = model.waves[i].wavespawns;
  wsRows.push({ wave: i + 1, count: [valveCount, appSpawns.length], fields: [] });
  for (let j = 0; j < Math.min(valveCount, appSpawns.length); j++) {
    const app = appSpawns[j];
    const valveCurrency = ex.sim_pop_wavespawn_currency(i, j);
    wsRows[i].fields.push({
      j,
      name: [cstr(ex.sim_pop_wavespawn_name(i, j)), app.name || ''],
      total: [ex.sim_pop_wavespawn_total(i, j), app.totalCount],
      currency: [valveCurrency < 0 ? 0 : valveCurrency, app.totalCurrency],
      maxActive: [ex.sim_pop_wavespawn_max_active(i, j), app.maxActive],
      spawnCount: [ex.sim_pop_wavespawn_spawn_count(i, j), app.spawnCount],
      support: [ex.sim_pop_wavespawn_support(i, j), SUPPORT_CODE[String(app.support)]],
      before: [ex.sim_pop_wavespawn_wait_before(i, j), app.waitBeforeStarting],
      between: [ex.sim_pop_wavespawn_wait_between(i, j), app.waitBetweenSpawns]
    });
  }
}

const allFields = wsRows.flatMap(r => r.fields);
const mismatch = key => allFields
  .filter(f => Array.isArray(f[key]) && (typeof f[key][0] === 'number'
    ? Math.abs(f[key][0] - f[key][1]) > 0.001
    : f[key][0] !== f[key][1]))
  .map(f => `ws ${f.j}: ${f[key][0]} vs ${f[key][1]}`);

check('every wave has the same number of WaveSpawns in both parsers',
  wsRows.every(r => r.count[0] === r.count[1]),
  wsRows.filter(r => r.count[0] !== r.count[1]).map(r => `wave ${r.wave}: ${r.count[0]} vs ${r.count[1]}`).join(', '));
console.log(`  wavespawns cross-checked: ${allFields.length}`);

for (const [key, label] of [
  ['name', 'names'], ['total', 'TotalCount'], ['currency', 'TotalCurrency'],
  ['maxActive', 'MaxActive'], ['spawnCount', 'SpawnCount'], ['support', 'Support'],
  ['before', 'WaitBeforeStarting'], ['between', 'WaitBetweenSpawns']
]) {
  const bad = mismatch(key);
  check(`WaveSpawn ${label} agrees with the popfile parser in the app`, bad.length === 0, bad.slice(0, 4).join(', '));
}

let iconTotal = 0;
for (let i = 0; i < waveCount; i++) {
  const n = ex.sim_pop_wave_class_count(i);
  for (let s = 0; s < n; s++) {
    if (cstr(ex.sim_pop_wave_class_icon(i, s))) iconTotal++;
  }
}
check('waves carry the class icons Valve builds from the spawners', iconTotal > 0, iconTotal + ' icon slots');

const first = [];
for (let s = 0; s < ex.sim_pop_wave_class_count(0); s++) {
  first.push(`${cstr(ex.sim_pop_wave_class_icon(0, s))} x${ex.sim_pop_wave_class_quantity(0, s)}`);
}
console.log(`  wave 1: ${ex.sim_pop_wave_enemy_count(0)} enemies, $${ex.sim_pop_wave_currency(0)}, ${first.join(', ')}`);
console.log(`  popfile in use: ${cstr(ex.sim_pop_filename())}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
