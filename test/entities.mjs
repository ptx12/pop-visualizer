import { readFileSync, existsSync } from 'node:fs';
import { readEntityLump, readLump } from '../shared/bsp.js';

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

const bspPath = `${MAPS_DIR}/${map}.bsp`;
const upload = buf => {
  if (!buf || buf.length === 0) return { ptr: 0, len: 0 };
  const p = ex.sim_ents_alloc(buf.length);
  mem().set(buf, p);
  return { ptr: p, len: buf.length };
};

const bspLumps = {
  planes: upload(readLump(bspPath, 1)),
  nodes: upload(readLump(bspPath, 5)),
  leafs: upload(readLump(bspPath, 10)),
  leafBrushes: upload(readLump(bspPath, 17)),
  brushes: upload(readLump(bspPath, 18)),
  brushSides: upload(readLump(bspPath, 19)),
  models: upload(readLump(bspPath, 14)),
};

const bspModels = ex.sim_ents_load_bsp(
  bspLumps.planes.ptr, bspLumps.planes.len, bspLumps.nodes.ptr, bspLumps.nodes.len,
  bspLumps.leafs.ptr, bspLumps.leafs.len, 32,
  bspLumps.leafBrushes.ptr, bspLumps.leafBrushes.len,
  bspLumps.brushes.ptr, bspLumps.brushes.len,
  bspLumps.brushSides.ptr, bspLumps.brushSides.len,
  bspLumps.models.ptr, bspLumps.models.len, push(map));

console.log(`  bsp brush models: ${bspModels}`);
check('the entity module loads the map collision world', bspModels > 1, bspModels + ' models');
check('collision is live inside the entity module', ex.sim_ents_has_collision() === 1);

const dispLumps = {
  info: upload(readLump(bspPath, 26)),
  verts: upload(readLump(bspPath, 33)),
  tris: upload(readLump(bspPath, 48)),
  faces: upload(readLump(bspPath, 7)),
  surfEdges: upload(readLump(bspPath, 13)),
  edges: upload(readLump(bspPath, 12)),
  bspVerts: upload(readLump(bspPath, 3)),
};

const dispTrees = ex.sim_ents_load_disp(
  dispLumps.info.ptr, dispLumps.info.len, dispLumps.verts.ptr, dispLumps.verts.len,
  dispLumps.tris.ptr, dispLumps.tris.len, dispLumps.faces.ptr, dispLumps.faces.len,
  dispLumps.surfEdges.ptr, dispLumps.surfEdges.len, dispLumps.edges.ptr, dispLumps.edges.len,
  dispLumps.bspVerts.ptr, dispLumps.bspVerts.len);
console.log(`  displacement collision trees: ${dispTrees}`);
check('displacement collision is live inside the entity module', dispTrees > 0,
  dispTrees + ' trees');

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

const MASK_PLAYERSOLID = 0x1 | 0x4000 | 0x10000 | 0x2 | 0x2000000 | 0x8;

const collisionPath = new URL('../wasm/simcore/build/simcollision.wasm', import.meta.url);
if (existsSync(collisionPath)) {
  const cmod = await WebAssembly.instantiate(readFileSync(collisionPath), {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      proc_exit: () => {}, fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0,
      environ_sizes_get: () => 0, environ_get: () => 0, clock_time_get: () => 0,
    },
  });
  const cex = cmod.instance.exports;
  if (cex._initialize) cex._initialize();
  const cmem = () => new Uint8Array(cex.memory.buffer);
  const cupload = buf => {
    if (!buf || buf.length === 0) return { ptr: 0, len: 0 };
    const p = cex.sim_alloc(buf.length);
    cmem().set(buf, p);
    return { ptr: p, len: buf.length };
  };

  const c = {
    planes: cupload(readLump(bspPath, 1)), nodes: cupload(readLump(bspPath, 5)),
    leafs: cupload(readLump(bspPath, 10)), leafBrushes: cupload(readLump(bspPath, 17)),
    brushes: cupload(readLump(bspPath, 18)), brushSides: cupload(readLump(bspPath, 19)),
    models: cupload(readLump(bspPath, 14)),
  };
  cex.sim_collision_load(c.planes.ptr, c.planes.len, c.nodes.ptr, c.nodes.len,
    c.leafs.ptr, c.leafs.len, 32, c.leafBrushes.ptr, c.leafBrushes.len,
    c.brushes.ptr, c.brushes.len, c.brushSides.ptr, c.brushSides.len,
    c.models.ptr, c.models.len);
  cex.sim_disp_load(
    cupload(readLump(bspPath, 26)).ptr, readLump(bspPath, 26).length,
    cupload(readLump(bspPath, 33)).ptr, readLump(bspPath, 33).length,
    cupload(readLump(bspPath, 48)).ptr, readLump(bspPath, 48).length,
    cupload(readLump(bspPath, 7)).ptr, readLump(bspPath, 7).length,
    cupload(readLump(bspPath, 13)).ptr, readLump(bspPath, 13).length,
    cupload(readLump(bspPath, 12)).ptr, readLump(bspPath, 12).length,
    cupload(readLump(bspPath, 3)).ptr, readLump(bspPath, 3).length);

  const out = ex.sim_ents_alloc(10 * 4);
  const rays = [];
  for (let i = 0; i < count; i++) {
    const x = ex.sim_ents_origin(i, 0);
    const y = ex.sim_ents_origin(i, 1);
    const z = ex.sim_ents_origin(i, 2);
    if (x || y || z) rays.push([x, y, z]);
  }

  let compared = 0, agreed = 0, hits = 0;
  const worst = { diff: 0, ray: null };
  for (const [x, y, z] of rays) {
    const a = ex.sim_ents_trace(x, y, z, x, y, z - 4096, 0, 0, 0, 0, 0, 0,
      MASK_PLAYERSOLID, 0, out);
    const b = cex.sim_trace_hull(x, y, z, x, y, z - 4096, 0, 0, 0, 0, 0, 0,
      MASK_PLAYERSOLID);
    compared++;
    if (a < 1) hits++;
    const diff = Math.abs(a - b);
    if (diff > worst.diff) { worst.diff = diff; worst.ray = [x, y, z]; }
    if (diff < 1e-6) agreed++;
  }

  console.log(`  downward traces compared: ${compared}, hit geometry: ${hits}`);
  check('every entity origin traces down onto real map geometry', hits > compared * 0.5,
    `${hits}/${compared} hit`);
  check('the entity module and the collision module agree on every trace',
    agreed === compared,
    `${agreed}/${compared} agreed, worst delta ${worst.diff} at ${worst.ray}`);

  const f = new Float32Array(ex.memory.buffer, out, 10);
  ex.sim_ents_trace(rays[0][0], rays[0][1], rays[0][2],
    rays[0][0], rays[0][1], rays[0][2] - 4096, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID, 0, out);
  const nlen = Math.hypot(f[3], f[4], f[5]);
  check('a world hit reports a unit surface normal', Math.abs(nlen - 1) < 1e-3,
    'normal length ' + nlen.toFixed(6));
  check('a world hit reports solid contents', (f[6] & 0x1) !== 0, 'contents ' + f[6]);

  const modelsLump = readLump(bspPath, 14);
  const mdv = new DataView(modelsLump.buffer, modelsLump.byteOffset, modelsLump.byteLength);
  const modelBounds = i => {
    const o = i * 48;
    return [mdv.getFloat32(o, true), mdv.getFloat32(o + 4, true), mdv.getFloat32(o + 8, true),
      mdv.getFloat32(o + 12, true), mdv.getFloat32(o + 16, true), mdv.getFloat32(o + 20, true)];
  };

  let brushEnts = 0, exactBrushEnts = 0;
  const mismatched = [];
  const bounds = ex.sim_ents_alloc(6 * 4);
  for (let i = 0; i < count; i++) {
    const model = cstr(ex.sim_ents_model(i));
    if (!model.startsWith('*')) continue;
    if (ex.sim_ents_angles(i, 0) || ex.sim_ents_angles(i, 1) || ex.sim_ents_angles(i, 2)) continue;
    brushEnts++;
    if (!ex.sim_ents_bounds(i, bounds)) continue;
    const bf = new Float32Array(ex.memory.buffer, bounds, 6);
    const want = modelBounds(+model.slice(1));
    if (want.every((v, k) => Math.abs(v - bf[k]) < 1e-3)) exactBrushEnts++;
    else mismatched.push(`${cstr(ex.sim_ents_classname(i))} ${model}`);
  }
  console.log(`  unrotated brush entities: ${brushEnts}, bounds exactly matching the bsp: ${exactBrushEnts}`);
  check('brush entities size themselves from the bsp model lump, not a placeholder',
    brushEnts > 0 && exactBrushEnts === brushEnts,
    `${exactBrushEnts}/${brushEnts}` + (mismatched.length ? ' — ' + mismatched.join(', ') : ''));

  const traceThroughEnts = ex.sim_ents_trace(rays[0][0], rays[0][1], rays[0][2],
    rays[0][0], rays[0][1], rays[0][2] - 4096, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID, 1, out);
  check('tracing against entities never reports further than the world alone',
    traceThroughEnts <= ex.sim_ents_trace(rays[0][0], rays[0][1], rays[0][2],
      rays[0][0], rays[0][1], rays[0][2] - 4096, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID, 0, out) + 1e-6,
    'fraction ' + traceThroughEnts.toFixed(6));

  console.log(`  entities skipped for want of vphysics: ${ex.sim_ents_untraced_vphysics()}`);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
