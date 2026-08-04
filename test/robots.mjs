import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntityLump, readLump, pakEntries, readPakEntry } from '../shared/bsp.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';

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
  console.log('skip robot tests: ents.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}
const map = CANDIDATES.find(m => existsSync(`${MAPS_DIR}/${m}.bsp`));
if (!map || !existsSync(join(repo, 'vanilla', `${map}.pop`))) {
  console.log('skip robot tests: no MvM map plus shipped popfile available');
  process.exit(0);
}
const vpkPath = `${TF_DIR}/tf2_misc_dir.vpk`;
if (!existsSync(vpkPath)) {
  console.log('skip robot tests: tf2_misc_dir.vpk not found');
  process.exit(0);
}
console.log(`map: ${map}`);

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
  if (!buf || !buf.length) return { ptr: 0, len: 0 };
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
let navBytes = null, navPathID = 'MOD';
if (existsSync(`${MAPS_DIR}/${map}.nav`)) navBytes = readFileSync(`${MAPS_DIR}/${map}.nav`);
else {
  try {
    for (const e of pakEntries(bspPath)) {
      if (e.name.toLowerCase().endsWith(`${map}.nav`)) { navBytes = readPakEntry(bspPath, e); navPathID = 'BSP'; break; }
    }
  } catch {}
}
if (!navBytes) {
  console.log('skip robot tests: no navigation mesh for ' + map);
  process.exit(0);
}
addFile(`maps/${map}.nav`, navPathID, navBytes);

for (const base of ['robot_standard.pop', 'robot_giant.pop', 'robot_gatebot.pop']) {
  const p = join(repo, 'base', base);
  if (existsSync(p)) addFile(`scripts/population/${base}`, 'MOD', readFileSync(p));
}
addFile(`scripts/population/${map}.pop`, 'MOD', readFileSync(join(repo, 'vanilla', `${map}.pop`)));

let scriptCount = 0;
for (const [name, entry] of indexVPK(vpkPath, (ext, dir) => (ext === 'txt' || ext === 'ctx') && dir.startsWith('scripts'))) {
  addFile(name, 'MOD', readVPKEntry(vpkPath, entry));
  scriptCount++;
}
check('the game script files load out of the vpk', scriptCount > 100, scriptCount + ' files');
check('the player class scripts parse through Valve\'s own reader',
  ex.sim_tf_init_class_data() === 9, ex.sim_tf_init_class_data() + ' of 9 classes');

const L = i => upload(readLump(bspPath, i));
const p1 = L(1), n = L(5), lf = L(10), lb = L(17), br = L(18), bs = L(19), md = L(14);
ex.sim_ents_load_bsp(p1.ptr, p1.len, n.ptr, n.len, lf.ptr, lf.len, 32, lb.ptr, lb.len,
  br.ptr, br.len, bs.ptr, bs.len, md.ptr, md.len, push(map));
const di = L(26), dv = L(33), dt = L(48), fa = L(7), se = L(13), ed = L(12), vt = L(3);
ex.sim_ents_load_disp(di.ptr, di.len, dv.ptr, dv.len, dt.ptr, dt.len,
  fa.ptr, fa.len, se.ptr, se.len, ed.ptr, ed.len, vt.ptr, vt.len);
const ti = L(6), td = L(2), st = L(44), sd = L(43);
ex.sim_ents_load_surfaces(ti.ptr, ti.len, td.ptr, td.len, st.ptr, st.len, sd.ptr, sd.len);

const lumpBytes = new TextEncoder().encode(readEntityLump(bspPath));
const lp = ex.sim_ents_alloc(lumpBytes.length + 1);
mem().set(lumpBytes, lp);
mem()[lp + lumpBytes.length] = 0;
ex.sim_ents_load_lump(lp, lumpBytes.length);

check('ServerActivate loads the navigation mesh for the map', ex.sim_nav_area_count() > 0,
  ex.sim_nav_area_count() + ' areas');

ex.sim_pop_set_next(push(map));
ex.sim_ents_full_frame(1);

const defender = ex.sim_bots_add(push('red'), push('scout'));
check('a defender joins through the game\'s own bot path', defender > 0, 'player index ' + defender);

const out = ex.sim_ents_alloc(64 * 12 * 4);
const readBots = () => {
  const w = ex.sim_bots_state(out, 64);
  const f = new Float32Array(ex.memory.buffer, out, w * 12);
  const list = [];
  for (let i = 0; i < w; i++) {
    const b = f.subarray(i * 12, i * 12 + 12);
    list.push({ index: b[0], pos: [b[1], b[2], b[3]], speed: Math.hypot(b[7], b[8], b[9]), health: b[10], team: b[11] });
  }
  return list;
};

let started = false;
const samples = [];
for (let tick = 1; tick <= 2600; tick++) {
  ex.sim_ents_frame();
  if (!started && ex.sim_pop_wave_count() > 0) { ex.sim_pop_start_wave(); started = true; }
  if (tick % 330 === 0) samples.push({ t: ex.sim_ents_curtime(), bots: readBots() });
}

check('the population manager started the wave', started);
check('the round is running', ex.sim_gamerules_state() === 4, 'state ' + ex.sim_gamerules_state());

const robotsAt = s => s.bots.filter(b => b.team === 3);
const peak = Math.max(...samples.map(s => robotsAt(s).length));
check('robots spawn from the popfile through CTFBotSpawner', peak > 0, peak + ' at peak');

const first = samples.find(s => robotsAt(s).length > 0);
const last = samples[samples.length - 1];
console.log(`  robots: ${samples.map(s => robotsAt(s).length).join(' -> ')} over ${last.t.toFixed(0)}s`);

const moved = first && robotsAt(last).some(b => {
  const start = robotsAt(first)[0];
  return start && Math.hypot(b.pos[0] - start.pos[0], b.pos[1] - start.pos[1]) > 512;
});
check('robots walk away from their spawn along the nav mesh', !!moved);

const anyMoving = robotsAt(last).some(b => b.speed > 50);
check('robots carry real locomotion velocity', anyMoving,
  robotsAt(last).map(b => b.speed.toFixed(0)).join(','));

const sane = samples.every(s => robotsAt(s).every(b =>
  Number.isFinite(b.pos[0]) && Math.abs(b.pos[0]) < 16384 &&
  Math.abs(b.pos[1]) < 16384 && Math.abs(b.pos[2]) < 16384));
check('no robot leaves the map bounds', sane);

const alive = robotsAt(last).every(b => b.health > 0);
check('spawned robots carry the health their class data gives them', alive,
  robotsAt(last).map(b => b.health).join(','));

const classes = new Set();
for (const s of samples) for (const b of robotsAt(s)) classes.add(cstr(ex.sim_bots_class(b.index)));
check('robots are given real player classes', classes.size > 0 && !classes.has(''),
  [...classes].join(','));
console.log(`  classes seen: ${[...classes].join(', ')}`);

const { simulateWave } = await import('../main/wavesim.js');
const { actorPosAt, actorZAt, actorYawAt, actorDistAt } = await import('../renderer/js/botplayback.js');

const run = await simulateWave({
  bspPath, mapName: map, popShortName: map, waveIndex: 0, seconds: 45, tfPath: TF_DIR
});
check('the wave runner returns actors for the renderer', run.actors.length > 0,
  run.note || run.actors.length + ' actors');
console.log(`  wave runner: ${run.actors.length} actors over ${run.end.toFixed(1)}s`);

if (run.actors.length) {
  check('every actor track is time ordered',
    run.actors.every(a => a.track.every((p, i) => i === 0 || p[0] >= a.track[i - 1][0])));
  check('wave time starts at zero, not at level load',
    Math.min(...run.actors.map(a => a.spawnT)) < 1,
    'earliest spawn ' + Math.min(...run.actors.map(a => a.spawnT)).toFixed(2) + 's');

  const dist = new Float64Array(run.actors[0].track.length);
  for (let i = 1; i < run.actors[0].track.length; i++) {
    const p = run.actors[0].track[i - 1], q = run.actors[0].track[i];
    dist[i] = dist[i - 1] + Math.hypot(q[1] - p[1], q[2] - p[2], q[3] - p[3]);
  }
  const a = { ...run.actors[0], dist };
  const mid = (a.spawnT + a.dieT) / 2;
  const pos = actorPosAt(a, mid);
  check('the playback sampler reads a position back out of a track',
    !!pos && Number.isFinite(pos[0]) && Number.isFinite(actorZAt(a, mid)),
    pos ? pos.map(x => x.toFixed(0)).join(',') : 'null');
  check('the sampler reports monotonic distance travelled',
    actorDistAt(a, a.dieT) >= actorDistAt(a, mid) && actorDistAt(a, mid) > 0,
    actorDistAt(a, a.dieT).toFixed(0) + ' units');
  check('the sampler returns a finite heading', Number.isFinite(actorYawAt(a, mid)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
