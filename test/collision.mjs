import { readFileSync, existsSync } from 'node:fs';
import { readLump } from '../shared/bsp.js';
import { parseNav } from '../shared/nav.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const MAPS_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf/maps';
const CANDIDATES = ['mvm_coaltown', 'mvm_decoy', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock'];

const CONTENTS_SOLID = 0x1;
const MASK_PLAYERSOLID = 0x1 | 0x4000 | 0x10000 | 0x2 | 0x2000000 | 0x8;

const wasmPath = new URL('../wasm/simcore/build/simcollision.wasm', import.meta.url);
if (!existsSync(wasmPath)) {
  console.log('skip collision tests: simcollision.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}

const withNav = CANDIDATES.find(
  m => existsSync(`${MAPS_DIR}/${m}.bsp`) && existsSync(`${MAPS_DIR}/${m}.nav`));
const map = withNav || CANDIDATES.find(m => existsSync(`${MAPS_DIR}/${m}.bsp`));
if (!map) {
  console.log('skip collision tests: no MvM map found in ' + MAPS_DIR);
  process.exit(0);
}
const bspPath = `${MAPS_DIR}/${map}.bsp`;
console.log('map: ' + map);

const mod = await WebAssembly.instantiate(readFileSync(wasmPath), {
  env: { emscripten_notify_memory_growth: () => {} },
  wasi_snapshot_preview1: {
    proc_exit: () => {}, fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0,
    environ_sizes_get: () => 0, environ_get: () => 0,
  },
});
const ex = mod.instance.exports;
if (ex._initialize) ex._initialize();
const mem = () => new Uint8Array(ex.memory.buffer);

const upload = buf => {
  if (!buf || buf.length === 0) return { ptr: 0, len: 0 };
  const ptr = ex.sim_alloc(buf.length);
  mem().set(buf, ptr);
  return { ptr, len: buf.length };
};

const planes = upload(readLump(bspPath, 1));
const nodes = upload(readLump(bspPath, 5));
const leafs = upload(readLump(bspPath, 10));
const leafBrushes = upload(readLump(bspPath, 17));
const brushes = upload(readLump(bspPath, 18));
const brushSides = upload(readLump(bspPath, 19));
const models = upload(readLump(bspPath, 14));

const ok = ex.sim_collision_load(
  planes.ptr, planes.len, nodes.ptr, nodes.len, leafs.ptr, leafs.len, 32,
  leafBrushes.ptr, leafBrushes.len, brushes.ptr, brushes.len,
  brushSides.ptr, brushSides.len, models.ptr, models.len);

check('collision world loads from a real bsp', ok === 1);

const dispInfo = upload(readLump(bspPath, 26));
const dispVerts = upload(readLump(bspPath, 33));
const dispTris = upload(readLump(bspPath, 48));
const faces = upload(readLump(bspPath, 7));
const surfEdges = upload(readLump(bspPath, 13));
const edges = upload(readLump(bspPath, 12));
const bspVerts = upload(readLump(bspPath, 3));

const dispTrees = ex.sim_disp_load(
  dispInfo.ptr, dispInfo.len, dispVerts.ptr, dispVerts.len, dispTris.ptr, dispTris.len,
  faces.ptr, faces.len, surfEdges.ptr, surfEdges.len, edges.ptr, edges.len,
  bspVerts.ptr, bspVerts.len);
console.log(`  displacements: ${ex.sim_disp_count()} declared, ${dispTrees} collision trees built`);
check('displacement collision trees are built', dispTrees > 0, dispTrees + ' trees');

const nPlanes = ex.sim_collision_stats(0);
const nNodes = ex.sim_collision_stats(1);
const nLeafs = ex.sim_collision_stats(2);
const nBrushes = ex.sim_collision_stats(3);
console.log(`  planes=${nPlanes} nodes=${nNodes} leafs=${nLeafs} brushes=${nBrushes}`);

check('bsp has plausible plane count', nPlanes > 100);
check('bsp has plausible node count', nNodes > 100);
check('bsp has plausible leaf count', nLeafs > 100);
check('bsp has plausible brush count', nBrushes > 100);

const traceDown = (x, y, z, dist = 4096) => {
  const f = ex.sim_trace_hull(x, y, z, x, y, z - dist, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID);
  return {
    fraction: f,
    endz: ex.sim_trace_result(3),
    nz: ex.sim_trace_result(6),
    startsolid: ex.sim_trace_result(7) !== 0,
  };
};

const navPath = `${MAPS_DIR}/${map}.nav`;
let navAreas = [];
if (existsSync(navPath)) {
  try {
    const nav = parseNav(readFileSync(navPath));
    navAreas = (nav && nav.areas) || [];
  } catch (e) {
    console.log('  nav load failed: ' + e.message);
  }
}

if (navAreas.length === 0) {
  console.log('  no nav areas available; skipping ground-truth comparison');
} else {
  console.log(`  nav areas: ${navAreas.length}`);
  let hits = 0, near = 0, tested = 0;
  let worst = 0;
  const step = Math.max(1, Math.floor(navAreas.length / 200));

  for (let i = 0; i < navAreas.length; i += step) {
    const a = navAreas[i];
    if (!a || !a.nw || !a.se) continue;
    const cx = (a.nw[0] + a.se[0]) / 2;
    const cy = (a.nw[1] + a.se[1]) / 2;
    const cz = (a.nw[2] + a.se[2]) / 2;
    tested++;

    const r = traceDown(cx, cy, cz + 40);
    if (r.startsolid) continue;
    if (r.fraction < 1) {
      hits++;
      const dz = Math.abs(r.endz - cz);
      if (dz < 32) near++;
      else if (dz > worst) worst = dz;
    }
  }

  check('downward traces from nav area centres hit world geometry',
    tested > 0 && hits / tested > 0.9, `${hits}/${tested} hit`);
  console.log(`  ground agreement: ${near}/${hits} within 32u, worst miss ${worst.toFixed(1)}u`);
  check('trace ground height agrees with the nav mesh',
    hits > 0 && near / hits > 0.9, `${near}/${hits} within 32u (worst miss ${worst.toFixed(1)}u)`);

  const a = navAreas.find(x => x && x.nw && x.se);
  const cx = (a.nw[0] + a.se[0]) / 2;
  const cy = (a.nw[1] + a.se[1]) / 2;
  const cz = (a.nw[2] + a.se[2]) / 2;

  const floor = traceDown(cx, cy, cz + 40);
  check('floor hit reports an upward facing plane normal', floor.nz > 0.7,
    'nz=' + floor.nz.toFixed(3));

  const insideZ = floor.endz - 8;
  const deep = ex.sim_trace_hull(cx, cy, insideZ, cx, cy, insideZ + 4, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID);
  check('a trace starting inside world solid reports startsolid',
    ex.sim_trace_result(7) !== 0, 'fraction=' + deep);

  const contents = ex.sim_point_contents(cx, cy, insideZ);
  check('point contents just below a floor surface reports solid',
    (contents & CONTENTS_SOLID) !== 0, 'contents=0x' + (contents >>> 0).toString(16));

  const air = ex.sim_point_contents(cx, cy, cz + 32);
  check('point contents just above the floor is not solid',
    (air & CONTENTS_SOLID) === 0, 'contents=0x' + (air >>> 0).toString(16));

  const upFrac = ex.sim_trace_hull(cx, cy, cz + 16, cx, cy, cz + 16, 0, 0, 0, 0, 0, 0, MASK_PLAYERSOLID);
  check('a zero length trace in open air is unobstructed', upFrac === 1);

  const hull = ex.sim_trace_hull(cx, cy, cz + 40, cx, cy, cz - 4096,
    -24, -24, 0, 24, 24, 82, MASK_PLAYERSOLID);
  const hullEndZ = ex.sim_trace_result(3);
  check('a player sized hull trace also lands on the floor', hull < 1,
    'fraction=' + hull);
  check('hull trace floor is at or above the ray floor',
    hullEndZ >= floor.endz - 1, `hull=${hullEndZ.toFixed(1)} ray=${floor.endz.toFixed(1)}`);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
