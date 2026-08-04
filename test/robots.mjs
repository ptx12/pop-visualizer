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
const CANDIDATES = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock',
  'mvm_mannworks', 'mvm_ghost_town'];

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

  const { parse } = await import('../renderer/js/kv.js');
  const { buildModel, normalizeClass } = await import('../renderer/js/popmodel.js');
  const { matchSpawner } = await import('../renderer/js/botplayback.js');
  const model = buildModel(parse(readFileSync(join(repo, 'vanilla', `${map}.pop`), 'utf8')), []);
  const wave0 = model.waves[0];

  check('Valve\'s WaveSpawn ordinals index the app\'s parsed wave',
    run.waveSpawns.length === wave0.wavespawns.length,
    `${run.waveSpawns.length} vs ${wave0.wavespawns.length}`);

  const placed = run.actors.filter(a => a.wsIndex >= 0);
  check('robots report the WaveSpawn that spawned them',
    placed.length > 0 && placed.every(a => a.wsIndex < wave0.wavespawns.length),
    `${placed.length} of ${run.actors.length} actors carry an ordinal`);

  check('robots carry the name their popfile spawner gives them',
    run.actors.every(a => a.name && a.name.length > 0),
    run.actors.map(a => a.name).join(','));

  const linked = run.actors.map(a => matchSpawner(a, wave0, model.missions));
  check('every robot resolves to a bot definition in the popfile',
    linked.every(l => l.spec),
    linked.filter(l => !l.spec).length + ' unresolved');
  check('the resolved definition is the same class the game spawned',
    linked.every((l, i) => !l.spec || normalizeClass(l.spec.cls || '') === run.actors[i].cls),
    linked.map((l, i) => l.spec ? `${l.spec.cls}/${run.actors[i].cls}` : '-').join(' '));
  check('resolved definitions agree with the game on giant status',
    linked.every((l, i) => !l.spec || !!l.spec.isGiant === !!run.actors[i].isGiant));

  check('robots carry the health their class data gives them through the runner',
    run.actors.every(a => a.maxHealth > 0), run.actors.map(a => a.maxHealth).join(','));
  check('robot model scale is real and positive',
    run.actors.every(a => a.scale > 0 && a.scale <= 4), run.actors.map(a => a.scale.toFixed(2)).join(','));

  const { botModelBase, botWeaponModels, botCosmeticModels, botActivity } = await import('../renderer/js/botmodels.js');
  const { botDisplayName } = await import('../renderer/js/popmodel.js');
  const { botMaxSpeed } = await import('../renderer/js/navpaths.js');

  const drawn = linked.filter(l => l.spec).map(l => {
    const bot = { ...l.spec };
    return {
      model: botModelBase(bot),
      weapons: botWeaponModels(bot, bot.itemStyles),
      cosmetics: botCosmeticModels(bot, bot.itemStyles),
      activity: botActivity(bot),
      label: botDisplayName(bot),
      speed: botMaxSpeed(bot, false)
    };
  });

  check('the map view resolves a model for every matched robot',
    drawn.length > 0 && drawn.every(d => typeof d.model === 'string' && d.model.startsWith('models/')),
    [...new Set(drawn.map(d => d.model))].join(', '));
  check('the map view resolves a display name for every matched robot',
    drawn.every(d => d.label && d.label.length > 0), [...new Set(drawn.map(d => d.label))].join(', '));
  check('the map view resolves a walk speed for every matched robot',
    drawn.every(d => Number.isFinite(d.speed) && d.speed > 0),
    [...new Set(drawn.map(d => Math.round(d.speed)))].join(','));
  check('weapon and cosmetic lookups return arrays, not throws',
    drawn.every(d => Array.isArray(d.weapons) && Array.isArray(d.cosmetics)));

  const tip = a => `${botDisplayName(a.bot)} — ${a.bot.health} HP\n${a.state}\nfrom "${a.ws.name || 'unnamed'}"`;
  const prepared = run.actors.map(a => {
    const l = matchSpawner(a, wave0, model.missions);
    return { ...a, bot: l.spec || { cls: a.cls, health: a.maxHealth }, ws: l.ws };
  });
  check('the hover tooltip never dereferences a missing wavespawn',
    prepared.every(a => typeof tip(a) === 'string' && !tip(a).includes('undefined')),
    prepared.map(a => tip(a).split('\n')[0]).slice(0, 3).join(' | '));

  console.log(`  models: ${[...new Set(drawn.map(d => d.model))].join(', ')}`);

  const names = [...new Set(run.actors.map(a => a.name))];
  console.log(`  identities: ${names.join(', ')}`);
  console.log(`  wavespawn ordinals: ${run.actors.map(a => a.wsIndex).join(',')}`);

  const tankWave = model.waves.findIndex(w => w.wavespawns.some(w2 => w2.isTank));
  if (tankWave < 0) {
    console.log('  no tank wave in this popfile; skipping tank checks');
  } else {
    const { matchTank } = await import('../renderer/js/botplayback.js');
    const tankRun = await simulateWave({
      bspPath, mapName: map, popShortName: map, waveIndex: tankWave, seconds: 60, tfPath: TF_DIR
    });
    const tanks = tankRun.actors.filter(a => a.kind === 'tank');
    check('CTFTankBoss spawns and reaches the renderer', tanks.length > 0,
      `wave ${tankWave + 1}: ${tanks.length} tanks of ${tankRun.actors.length} actors`);

    if (tanks.length) {
      const t0 = tanks[0];
      const moved = Math.hypot(
        t0.track[t0.track.length - 1][1] - t0.track[0][1],
        t0.track[t0.track.length - 1][2] - t0.track[0][2]);
      check('the tank drives along its path_track chain', moved > 1024, Math.round(moved) + ' units');
      check('the tank carries the health the popfile gives it', t0.maxHealth > 0, String(t0.maxHealth));

      const linkedTank = matchTank(t0, model.waves[tankWave]);
      check('the tank resolves to the Tank spawner in the popfile', !!linkedTank.spec,
        linkedTank.spec ? `${linkedTank.spec.health} HP, ${linkedTank.spec.speed} HU/s` : 'unresolved');
      if (linkedTank.spec) {
        check('the simulated tank health matches the popfile Tank block',
          t0.maxHealth === linkedTank.spec.health, `${t0.maxHealth} vs ${linkedTank.spec.health}`);
      }
      console.log(`  tank: ${Math.round(moved)} units over ${(t0.dieT === Infinity ? tankRun.end : t0.dieT).toFixed(1)}s, ${t0.maxHealth} HP, ws ${t0.wsIndex}`);
    }
  }

  const altName = `${map}_advanced`;
  const altPath = join(repo, 'vanilla', `${altName}.pop`);
  if (!existsSync(altPath)) {
    console.log('  no secondary popfile for ' + map + '; skipping popfile selection checks');
  } else {
    const alt = buildModel(parse(readFileSync(altPath, 'utf8')), []);
    const altTankWave = alt.waves.findIndex(w => w.wavespawns.some(w2 => w2.isTank));
    const altIndex = altTankWave < 0 ? 0 : altTankWave;
    const altRun = await simulateWave({
      bspPath, mapName: map, popShortName: altName, popPath: altPath,
      popDir: join(repo, 'vanilla'), waveIndex: altIndex, seconds: 70, tfPath: TF_DIR
    });
    const valveTotals = (altRun.waveSpawns || []).map(s => s.totalCount);
    const appTotals = alt.waves[altIndex].wavespawns.map(s => s.totalCount);
    const defaultTotals = model.waves[altIndex].wavespawns.map(s => s.totalCount);
    check('the requested popfile is the one the simulation runs',
      valveTotals.length === appTotals.length && valveTotals.every((v, i) => v === appTotals[i]),
      `valve [${valveTotals}] vs requested [${appTotals}] (map default is [${defaultTotals}])`);

    if (altTankWave >= 0) {
      const altTanks = altRun.actors.filter(a => a.kind === 'tank');
      check('a tank spawns from the requested popfile too', altTanks.length > 0,
        `${altName} wave ${altTankWave + 1}: ${altTanks.length} tanks of ${altRun.actors.length} actors`);
      if (altTanks.length) {
        const spec = alt.waves[altTankWave].wavespawns.find(w => w.isTank).bots.find(b => b.tank).tank;
        check('the tank from the requested popfile carries its own health',
          altTanks[0].maxHealth === spec.health, `${altTanks[0].maxHealth} vs ${spec.health}`);
      }
    }
    console.log(`  ${altName} wave ${altIndex + 1}: ${altRun.actors.length} actors, wavespawn totals [${valveTotals}]`);
  }
}

for (const other of CANDIDATES) {
  const otherBsp = `${MAPS_DIR}/${other}.bsp`;
  const otherPop = join(repo, 'vanilla', `${other}.pop`);
  if (!existsSync(otherBsp) || !existsSync(otherPop)) continue;
  let run = null;
  let failure = '';
  try {
    run = await simulateWave({
      bspPath: otherBsp, mapName: other, popShortName: other, popPath: otherPop,
      popDir: join(repo, 'vanilla'), waveIndex: 0, seconds: 25, tfPath: TF_DIR
    });
  } catch (err) {
    failure = err.message;
  }
  check(`${other} simulates its first wave`,
    !failure && run && run.actors.length > 0,
    failure || (run ? run.note || '0 actors' : 'no run'));
  if (run && run.actors.length) console.log(`  ${other}: ${run.actors.length} actors`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
