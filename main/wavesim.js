import fs from 'node:fs';
import path from 'node:path';
import { readEntityLump, readLump, pakEntries, readPakEntry } from '../shared/bsp.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { rankNavCandidates } from '../shared/navpick.js';

const TICK_INTERVAL = 1 / 66.6667;
const SAMPLE_TICKS = 4;
const MAX_SECONDS = 240;

let wasmBytes = null;
let scriptCache = null;

function loadWasm() {
  if (!wasmBytes) {
    const url = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
    const buf = fs.readFileSync(url);
    wasmBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return wasmBytes;
}

function gameScripts(tfPath) {
  if (scriptCache) return scriptCache;
  const vpk = path.join(tfPath, 'tf2_misc_dir.vpk');
  const out = [];
  if (fs.existsSync(vpk)) {
    for (const [name, entry] of indexVPK(vpk, (ext, dir) => (ext === 'txt' || ext === 'ctx' || ext === 'pop') && dir.startsWith('scripts'))) {
      out.push([name, readVPKEntry(vpk, entry)]);
    }
  }
  scriptCache = out;
  return out;
}

function navSearchDirs(tfPath, popDir) {
  const dirs = [];
  if (popDir) {
    dirs.push(popDir, path.join(popDir, 'maps'), path.join(path.dirname(popDir), 'maps'));
  }
  dirs.push(path.join(tfPath, 'maps'), path.join(tfPath, 'download', 'maps'));
  try {
    for (const c of fs.readdirSync(path.join(tfPath, 'custom'), { withFileTypes: true })) {
      if (!c.isDirectory() || c.name === 'workshop') continue;
      dirs.push(path.join(tfPath, 'custom', c.name, 'maps'));
      dirs.push(path.join(tfPath, 'custom', c.name, 'download', 'maps'));
    }
  } catch {}
  return dirs;
}

function navCandidates(bspPath, tfPath, popDir) {
  const out = [];
  for (const d of navSearchDirs(tfPath, popDir)) {
    try {
      for (const n of fs.readdirSync(d)) {
        if (!n.toLowerCase().endsWith('.nav')) continue;
        out.push({ name: n.toLowerCase().replace(/\.nav$/, ''), kind: 'file', where: path.join(d, n) });
      }
    } catch {}
  }
  try {
    const vpk = path.join(tfPath, 'tf2_misc_dir.vpk');
    for (const [key, entry] of indexVPK(vpk, (ext, dir) => ext === 'nav' && dir.startsWith('maps'))) {
      out.push({ name: key.split('/').pop().replace(/\.nav$/, ''), kind: 'vpk', where: vpk, entry });
    }
  } catch {}
  try {
    for (const p of pakEntries(bspPath)) {
      if (!p.name.toLowerCase().endsWith('.nav')) continue;
      out.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', where: bspPath, entry: p, size: p.uncompSize });
    }
  } catch {}
  return out;
}

function navBytesFor(bspPath, mapName, tfPath, popDir) {
  for (const pick of rankNavCandidates(navCandidates(bspPath, tfPath, popDir), mapName)) {
    try {
      let bytes = null;
      if (pick.kind === 'file') bytes = fs.readFileSync(pick.where);
      else if (pick.kind === 'vpk') bytes = readVPKEntry(pick.where, pick.entry);
      else bytes = readPakEntry(pick.where, pick.entry);
      if (bytes && bytes.length) return { bytes, pathID: pick.kind === 'pak' ? 'BSP' : 'MOD' };
    } catch {}
  }
  return null;
}

function instantiate() {
  let ex = null;
  const decoder = new TextDecoder();
  const spew = [];
  const fdWrite = (fd, iov, iovcnt, pnum) => {
    const view = new DataView(ex.memory.buffer);
    const bytes = new Uint8Array(ex.memory.buffer);
    let total = 0;
    for (let i = 0; i < iovcnt; i++) {
      const ptr = view.getUint32(iov + i * 8, true);
      const len = view.getUint32(iov + i * 8 + 4, true);
      if (spew.length < 4000) spew.push(decoder.decode(bytes.subarray(ptr, ptr + len)));
      total += len;
    }
    view.setUint32(pnum, total, true);
    return 0;
  };
  const imports = {
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
  };
  return { imports, spew, attach: e => { ex = e; }, decoder };
}

function popfilesOnDisk(dir) {
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase().endsWith('.pop')) out.push([name, fs.readFileSync(path.join(dir, name))]);
    }
  } catch {}
  return out;
}

export async function simulateWave({ bspPath, mapName, popShortName, popPath, popDir, waveIndex = 0, seconds = 120, killPoints = [], tfPath }) {
  const resolvedTF = tfPath || await (await import('./tfpath.js')).detectTFPath();
  if (!resolvedTF) return { actors: [], end: 0, note: 'Team Fortress 2 was not found.' };
  if (!fs.existsSync(bspPath)) return { actors: [], end: 0, note: 'The map bsp was not found.' };

  const host = instantiate();
  let ex;
  try {
    const mod = await WebAssembly.instantiate(loadWasm(), host.imports);
    ex = mod.instance.exports;
    host.attach(ex);
    if (ex._initialize) ex._initialize();
    if (ex.sim_ents_init(TICK_INTERVAL) !== 1) return { actors: [], end: 0, note: 'The simulation core did not start.' };
  } catch (err) {
    return { actors: [], end: 0, note: 'The simulation core did not load: ' + err.message };
  }

  const mem = () => new Uint8Array(ex.memory.buffer);
  const cstr = ptr => {
    if (!ptr) return '';
    const m = mem();
    let end = ptr;
    while (m[end]) end++;
    return host.decoder.decode(m.subarray(ptr, end));
  };
  const push = str => {
    const bytes = new TextEncoder().encode(String(str) + '\0');
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
  const addFile = (rel, pathID, buf) => {
    const b = upload(buf);
    return ex.sim_fs_add(push(rel), pathID ? push(pathID) : 0, b.ptr, b.len) === 1;
  };

  const nav = navBytesFor(bspPath, mapName, resolvedTF, popDir);
  if (!nav) return { actors: [], end: 0, note: 'No navigation mesh for ' + mapName + '; robots cannot path without one.' };
  addFile(`maps/${mapName}.nav`, nav.pathID, nav.bytes);

  for (const [name, bytes] of gameScripts(resolvedTF)) addFile(name, 'MOD', bytes);
  ex.sim_tf_init_class_data();

  const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (const [name, bytes] of popfilesOnDisk(path.join(repoRoot, 'base'))) {
    addFile('scripts/population/' + name.toLowerCase(), 'MOD', bytes);
  }
  for (const dir of [path.join(resolvedTF, 'scripts', 'population'), popDir].filter(Boolean)) {
    for (const [name, bytes] of popfilesOnDisk(dir)) addFile('scripts/population/' + name.toLowerCase(), 'MOD', bytes);
  }
  let chosenShortName = popShortName;
  if (popPath && fs.existsSync(popPath)) {
    const base = path.basename(popPath);
    addFile('scripts/population/' + base.toLowerCase(), 'MOD', fs.readFileSync(popPath));
    for (const [name, bytes] of popfilesOnDisk(path.dirname(popPath))) {
      addFile('scripts/population/' + name.toLowerCase(), 'MOD', bytes);
    }
    chosenShortName = base.replace(/\.pop$/i, '');
  }

  const L = i => upload(readLump(bspPath, i));
  const p1 = L(1), n = L(5), lf = L(10), lb = L(17), br = L(18), bs = L(19), md = L(14);
  ex.sim_ents_load_bsp(p1.ptr, p1.len, n.ptr, n.len, lf.ptr, lf.len, 32, lb.ptr, lb.len,
    br.ptr, br.len, bs.ptr, bs.len, md.ptr, md.len, push(mapName));
  const di = L(26), dv = L(33), dt = L(48), fa = L(7), se = L(13), ed = L(12), vt = L(3);
  ex.sim_ents_load_disp(di.ptr, di.len, dv.ptr, dv.len, dt.ptr, dt.len,
    fa.ptr, fa.len, se.ptr, se.len, ed.ptr, ed.len, vt.ptr, vt.len);
  const ti = L(6), td = L(2), st = L(44), sd = L(43);
  ex.sim_ents_load_surfaces(ti.ptr, ti.len, td.ptr, td.len, st.ptr, st.len, sd.ptr, sd.len);

  const lumpText = readEntityLump(bspPath);
  if (!lumpText) return { actors: [], end: 0, note: 'The map entity lump could not be read.' };
  const lumpBytes = new TextEncoder().encode(lumpText);
  const lp = ex.sim_ents_alloc(lumpBytes.length + 1);
  mem().set(lumpBytes, lp);
  mem()[lp + lumpBytes.length] = 0;
  ex.sim_ents_load_lump(lp, lumpBytes.length);

  if (ex.sim_nav_area_count() <= 0) {
    return { actors: [], end: 0, note: 'The navigation mesh for ' + mapName + ' did not load.' };
  }

  if (chosenShortName && ex.sim_pop_set_next(push(chosenShortName)) !== 1) {
    return { actors: [], end: 0,
      note: 'The population manager would not load ' + chosenShortName + '.pop.' };
  }
  ex.sim_ents_full_frame(1);
  ex.sim_bots_add(push('red'), push('scout'));

  const zones = (killPoints || []).filter(k => Array.isArray(k) && Number.isFinite(k[0]) && Number.isFinite(k[1]) && k[2] > 0);
  const killZonesActive = zones.length > 0 && typeof ex.sim_killzones_set === 'function';
  if (killZonesActive) {
    const zp = ex.sim_ents_alloc(zones.length * 3 * 4);
    const zf = new Float32Array(ex.memory.buffer, zp, zones.length * 3);
    for (let i = 0; i < zones.length; i++) {
      zf[i * 3] = zones[i][0];
      zf[i * 3 + 1] = zones[i][1];
      zf[i * 3 + 2] = zones[i][2];
    }
    ex.sim_killzones_set(zp, zones.length);
  }

  const out = ex.sim_ents_alloc(64 * 12 * 4);
  const tankOut = ex.sim_ents_alloc(16 * 9 * 4);
  const actors = new Map();
  const limit = Math.round(Math.min(Math.max(seconds, 10), MAX_SECONDS) / TICK_INTERVAL);

  let started = false;
  let jumped = waveIndex === 0;
  let startT = 0;
  let end = 0;

  let killed = 0;
  for (let tick = 1; tick <= limit; tick++) {
    ex.sim_ents_frame();
    if (killZonesActive) killed += ex.sim_killzones_apply();
    if (!jumped && ex.sim_pop_wave_count() > waveIndex) {
      jumped = ex.sim_pop_jump_to_wave(waveIndex) === 1;
    }
    if (jumped && !started && ex.sim_pop_wave_count() > 0) {
      started = ex.sim_pop_start_wave() === 1;
      if (started) startT = ex.sim_ents_curtime();
      continue;
    }
    if (!started || tick % SAMPLE_TICKS !== 0) continue;

    const t = ex.sim_ents_curtime() - startT;
    const written = ex.sim_bots_state(out, 64);
    const f = new Float32Array(ex.memory.buffer, out, written * 12);
    for (let i = 0; i < written; i++) {
      const b = f.subarray(i * 12, i * 12 + 12);
      if (b[11] !== 3) continue;
      const index = b[0];
      const handle = ex.sim_bots_handle(index);
      const key = handle || index;
      if (b[10] <= 0) {
        const dead = actors.get(key);
        if (dead && !Number.isFinite(dead.dieT)) dead.dieT = t;
        continue;
      }
      let a = actors.get(key);
      if (!a) {
        a = {
          id: key,
          kind: 'bot',
          cls: cstr(ex.sim_bots_class(index)),
          name: '',
          wsIndex: -1,
          wsName: '',
          mission: 0,
          isGiant: ex.sim_bots_is_giant(index) === 1,
          scale: 1,
          maxHealth: 0,
          spawnT: t,
          dieT: Infinity,
          track: []
        };
        actors.set(key, a);
      }
      if (a.wsIndex < 0) {
        a.wsIndex = ex.sim_bots_wavespawn(index);
        a.wsName = cstr(ex.sim_bots_wavespawn_name(index));
      }
      if (!a.mission) a.mission = ex.sim_bots_mission(index);
      if (!a.name) a.name = cstr(ex.sim_bots_name(index));
      if (!a.cls) a.cls = cstr(ex.sim_bots_class(index));
      a.scale = ex.sim_bots_scale(index);
      a.maxHealth = ex.sim_bots_max_health(index);
      a.isGiant = a.isGiant || ex.sim_bots_is_giant(index) === 1;
      if (ex.sim_bots_has_flag(index) === 1) {
        a.carriedBomb = true;
        if (a.bombT == null) a.bombT = t;
      }
      a.track.push([t, b[1], b[2], b[3], b[5]]);
      a.lastT = t;
    }

    const tanksWritten = ex.sim_tanks_state(tankOut, 16);
    const tf = new Float32Array(ex.memory.buffer, tankOut, tanksWritten * 9);
    for (let i = 0; i < tanksWritten; i++) {
      const b = tf.subarray(i * 9, i * 9 + 9);
      const entIndex = b[0];
      const key = 'tank:' + ex.sim_tanks_handle(entIndex);
      let a = actors.get(key);
      if (!a) {
        a = {
          id: key,
          kind: 'tank',
          cls: null,
          name: '',
          wsIndex: -1,
          wsName: '',
          mission: 0,
          isGiant: false,
          scale: 1,
          maxHealth: b[8],
          spawnT: t,
          dieT: Infinity,
          track: []
        };
        actors.set(key, a);
      }
      if (a.wsIndex < 0) a.wsIndex = ex.sim_tanks_wavespawn(entIndex);
      if (!a.pathLength) a.pathLength = ex.sim_tanks_path_length(entIndex);
      a.health = b[7];
      a.maxHealth = b[8];
      a.currency = ex.sim_tanks_currency(entIndex);
      a.track.push([t, b[1], b[2], b[3], b[5]]);
      a.lastT = t;
    }
    end = t;
  }

  const gone = SAMPLE_TICKS * TICK_INTERVAL * 2;
  const list = [...actors.values()].filter(a => a.track.length > 1);
  for (const a of list) {
    if (!Number.isFinite(a.dieT)) a.dieT = a.lastT < end - gone ? a.lastT : Infinity;
    a.state = Number.isFinite(a.dieT) ? 'died' : 'active';
    delete a.lastT;
  }

  const waveSpawns = [];
  for (let i = 0; i < ex.sim_pop_wavespawn_count(waveIndex); i++) {
    waveSpawns.push({
      index: i,
      name: cstr(ex.sim_pop_wavespawn_name(waveIndex, i)),
      totalCount: ex.sim_pop_wavespawn_total(waveIndex, i),
      totalCurrency: ex.sim_pop_wavespawn_currency(waveIndex, i),
      maxActive: ex.sim_pop_wavespawn_max_active(waveIndex, i),
      spawnCount: ex.sim_pop_wavespawn_spawn_count(waveIndex, i),
      support: ex.sim_pop_wavespawn_support(waveIndex, i),
      waitBeforeStarting: ex.sim_pop_wavespawn_wait_before(waveIndex, i),
      waitBetweenSpawns: ex.sim_pop_wavespawn_wait_between(waveIndex, i)
    });
  }

  return {
    actors: list,
    waveSpawns,
    end,
    started,
    map: mapName,
    waveIndex,
    killed,
    tracked: actors.size,
    killZones: zones.length,
    note: list.length ? null : 'The wave produced no robots in the simulated window.'
  };
}

export async function register() {
  const { ipcMain } = await import('electron');
  const { findBSPFor } = await import('./maps.js');
  const { detectTFPath } = await import('./tfpath.js');

  ipcMain.handle('sim:wave', async (e, opts) => {
    const o = opts || {};
    try {
      const tfPath = o.tfPath || await detectTFPath();
      if (!tfPath) return { actors: [], end: 0, note: 'Team Fortress 2 was not found.' };
      const best = await findBSPFor(o.popName, tfPath, o.popDir);
      if (!best) return { actors: [], end: 0, note: 'No map found for ' + (o.popName || 'this popfile') + '.' };
      return await simulateWave({
        bspPath: best.full,
        mapName: best.name,
        popPath: o.popPath,
        popDir: o.popDir,
        popShortName: o.popShortName,
        waveIndex: o.waveIndex || 0,
        seconds: o.seconds || 120,
        killPoints: o.killPoints,
        tfPath
      });
    } catch (err) {
      return { actors: [], end: 0, note: 'Wave simulation failed: ' + err.message };
    }
  });
}
