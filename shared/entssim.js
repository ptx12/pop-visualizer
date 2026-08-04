import { readEntityLump, readLump } from './bsp.js';

const TICK_INTERVAL = 1 / 66.6667;
const MOVETYPE_PUSH = 7;
const WAVE_START_RELAY = 'wave_start_relay';
const OPEN_INPUTS = ['Open', 'Start'];
const CLOSE_INPUTS = ['Close', 'Stop'];
const SETTLE_FRAMES = 12;
const START_DEADLINE_FRAMES = Math.ceil(1 / TICK_INTERVAL);
const MAX_SAMPLE_FRAMES = 4000;
const POSE_EPSILON = 1e-4;

let wasmBytes = null;
let wasmMissing = false;
const cache = new Map();

async function loadWasmBytes() {
  if (wasmBytes) return wasmBytes;
  if (wasmMissing) return null;
  const url = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
  try {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(url);
    wasmBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return wasmBytes;
  } catch {
    wasmMissing = true;
    return null;
  }
}

function makeHost() {
  let ex = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const spew = [];
  const imports = {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      proc_exit: () => {},
      fd_write(fd, iov, iovcnt, pnum) {
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
      },
      fd_close: () => 0,
      fd_seek: () => 0,
      environ_sizes_get: () => 0,
      environ_get: () => 0,
      clock_time_get: () => 0
    }
  };
  imports.env.__syscall_getcwd = (buf, size) => {
    if (!buf || size < 2) return -34;
    const bytes = new Uint8Array(ex.memory.buffer);
    bytes[buf] = 47;
    bytes[buf + 1] = 0;
    return 2;
  };
  return {
    imports,
    spew,
    attach(exports) { ex = exports; },
    get exports() { return ex; },
    bytes: () => new Uint8Array(ex.memory.buffer),
    cstr(ptr) {
      if (!ptr) return '';
      const m = new Uint8Array(ex.memory.buffer);
      let end = ptr;
      while (m[end]) end++;
      return decoder.decode(m.subarray(ptr, end));
    },
    push(str) {
      const b = encoder.encode(str + '\0');
      const p = ex.sim_ents_alloc(b.length);
      new Uint8Array(ex.memory.buffer).set(b, p);
      return p;
    },
    upload(buf) {
      if (!buf || !buf.length) return { ptr: 0, len: 0 };
      const p = ex.sim_ents_alloc(buf.length);
      new Uint8Array(ex.memory.buffer).set(buf, p);
      return { ptr: p, len: buf.length };
    }
  };
}

function poseEqual(a, b) {
  for (let i = 0; i < 6; i++) if (Math.abs(a[i] - b[i]) > POSE_EPSILON) return false;
  return true;
}

function angleDelta(a, b) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

const FLOAT32_ULP = Math.pow(2, -22);

function poseTolerance(track) {
  let peak = 1;
  for (const s of track) {
    for (let i = 0; i < 6; i++) peak = Math.max(peak, Math.abs(s.pose[i]));
  }
  return peak * FLOAT32_ULP;
}

function constantStep(track, pick) {
  if (track.length < 4) return 0;
  const steps = [];
  for (let i = 2; i < track.length - 1; i++) steps.push(pick(track[i - 1], track[i]));
  if (!steps.length) return 0;
  const first = steps[0];
  if (!(first > 0)) return 0;
  const tolerance = poseTolerance(track);
  for (const s of steps) if (Math.abs(s - first) > tolerance) return 0;
  return first;
}

function describeMotion(track) {
  const first = track[0].pose;
  const last = track[track.length - 1].pose;
  const move = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
  const turn = [angleDelta(first[3], last[3]), angleDelta(first[4], last[4]), angleDelta(first[5], last[5])];
  const travel = Math.hypot(move[0], move[1], move[2]);
  const spin = Math.hypot(turn[0], turn[1], turn[2]);

  if (spin > travel) {
    const axisIndex = turn.reduce((best, v, i) => (Math.abs(v) > Math.abs(turn[best]) ? i : best), 0);
    const degrees = turn[axisIndex];
    const perTick = constantStep(track, (a, b) => Math.abs(angleDelta(a.pose[3 + axisIndex], b.pose[3 + axisIndex])));
    const speed = perTick ? perTick / TICK_INTERVAL : 0;
    return {
      kind: 'rotate',
      axis: axisIndex === 0 ? [0, 1, 0] : axisIndex === 1 ? [0, 0, 1] : [1, 0, 0],
      degrees,
      hinge: [first[0], first[1], first[2]],
      speed,
      duration: speed ? Math.abs(degrees) / speed : track[track.length - 1].t - track[0].t
    };
  }

  const dir = travel > 0 ? [move[0] / travel, move[1] / travel, move[2] / travel] : [0, 0, 0];
  const perTick = constantStep(track, (a, b) =>
    Math.hypot(b.pose[0] - a.pose[0], b.pose[1] - a.pose[1], b.pose[2] - a.pose[2]));
  const speed = perTick ? perTick / TICK_INTERVAL : 0;
  return {
    kind: 'linear',
    dir,
    travel,
    speed,
    duration: speed ? travel / speed : track[track.length - 1].t - track[0].t
  };
}

export async function loadEntitySim(bspPath, mapName) {
  if (cache.has(bspPath)) return cache.get(bspPath);
  const result = await buildEntitySim(bspPath, mapName);
  if (result) {
    result.movers = result.moverTracks();
    result.paths = result.pathGraph();
    const timeline = result.moverTimeline(WAVE_START_RELAY);
    for (const m of result.movers) {
      const keys = timeline && timeline.keys.get(m.model);
      m.keys = keys && keys.length ? keys : [{ t: 0, frac: m.spawnFrac }];
    }
    result.waveStartTruncated = !!(timeline && timeline.truncated);
    result.reset();
  }
  cache.set(bspPath, result);
  return result;
}

export function getEntitySim(bspPath) {
  return cache.get(bspPath) || null;
}

export function entitySimPathChain(bspPath, startName) {
  const sim = cache.get(bspPath);
  if (!sim || !sim.paths || !sim.paths.size) return null;
  const wanted = String(startName || '').toLowerCase();
  let node = null;
  for (const n of sim.paths.values()) {
    if (n.name.toLowerCase() === wanted) { node = n; break; }
  }
  if (!node) return null;

  const seen = new Set([node.index]);
  let distance = 0;
  let count = 1;
  let last = node;
  while (last.next >= 0 && !seen.has(last.next)) {
    const next = sim.paths.get(last.next);
    if (!next) break;
    seen.add(next.index);
    distance += Math.hypot(next.origin[0] - last.origin[0], next.origin[1] - last.origin[1],
      next.origin[2] - last.origin[2]);
    last = next;
    count++;
  }
  return { distance: Math.round(distance), nodes: count, endNode: last.name };
}

export function entitySimMovers(bspPath) {
  const sim = cache.get(bspPath);
  if (!sim || !sim.movers) return null;
  const byModel = new Map();
  for (const m of sim.movers) byModel.set(m.model, m);
  return byModel;
}

export function flushEntitySims() {
  cache.clear();
}

async function buildEntitySim(bspPath, mapName) {
  const bytes = await loadWasmBytes();
  if (!bytes) return null;

  const host = makeHost();
  let ex;
  try {
    const mod = await WebAssembly.instantiate(bytes, host.imports);
    ex = mod.instance.exports;
    host.attach(ex);
    if (ex._initialize) ex._initialize();
    if (ex.sim_ents_init(TICK_INTERVAL) !== 1) return null;
  } catch {
    return null;
  }

  const name = mapName || bspPath.replace(/\\/g, '/').split('/').pop().replace(/\.bsp$/i, '');
  const lumps = {};
  const load = index => {
    const buf = readLump(bspPath, index);
    lumps[index] = host.upload(buf);
    return lumps[index];
  };

  try {
    const planes = load(1), nodes = load(5), leafs = load(10), leafBrushes = load(17);
    const brushes = load(18), brushSides = load(19), models = load(14);
    ex.sim_ents_load_bsp(planes.ptr, planes.len, nodes.ptr, nodes.len, leafs.ptr, leafs.len, 32,
      leafBrushes.ptr, leafBrushes.len, brushes.ptr, brushes.len, brushSides.ptr, brushSides.len,
      models.ptr, models.len, host.push(name));

    const dInfo = load(26), dVerts = load(33), dTris = load(48);
    const faces = load(7), surfEdges = load(13), edges = load(12), verts = load(3);
    ex.sim_ents_load_disp(dInfo.ptr, dInfo.len, dVerts.ptr, dVerts.len, dTris.ptr, dTris.len,
      faces.ptr, faces.len, surfEdges.ptr, surfEdges.len, edges.ptr, edges.len, verts.ptr, verts.len);

    const texInfo = load(6), texData = load(2), stringTable = load(44), stringData = load(43);
    ex.sim_ents_load_surfaces(texInfo.ptr, texInfo.len, texData.ptr, texData.len,
      stringTable.ptr, stringTable.len, stringData.ptr, stringData.len);

    const text = readEntityLump(bspPath);
    if (!text) return null;
    const lump = new TextEncoder().encode(text);
    const ptr = ex.sim_ents_alloc(lump.length + 1);
    new Uint8Array(ex.memory.buffer).set(lump, ptr);
    new Uint8Array(ex.memory.buffer)[ptr + lump.length] = 0;
    if (ex.sim_ents_load_lump(ptr, lump.length) <= 0) return null;
  } catch {
    return null;
  }

  const outFloat = ex.sim_ents_alloc(7 * 4);
  const outInt = ex.sim_ents_alloc(7 * 4);
  const outBounds = ex.sim_ents_alloc(6 * 4);

  const outPose = ex.sim_ents_alloc(6 * 4);
  const pose = index => {
    if (!ex.sim_ents_pose(index, outPose)) return [0, 0, 0, 0, 0, 0];
    return Array.from(new Float32Array(ex.memory.buffer, outPose, 6));
  };
  const poseOf = handle => {
    if (!ex.sim_ents_pose_handle(handle, outPose)) return null;
    return Array.from(new Float32Array(ex.memory.buffer, outPose, 6));
  };

  const sim = {
    map: name,
    bspPath,
    get count() { return ex.sim_ents_count(); },
    get curtime() { return ex.sim_ents_curtime(); },
    supports(classname) {
      return ex.sim_ents_class_supported(host.push(String(classname || ''))) === 1;
    },
    reset() { return ex.sim_ents_reset(); },
    frame() { ex.sim_ents_frame(); },
    acceptsInput(index, input) {
      return ex.sim_ents_accepts_input(index, host.push(String(input || ''))) === 1;
    },
    fireInput(index, input, param, delay = 0) {
      return ex.sim_ents_fire_input_index(index, host.push(input),
        param ? host.push(param) : 0, delay) === 1;
    },
    fireInputNamed(target, input, param, delay = 0) {
      return ex.sim_ents_fire_input(host.push(target), host.push(input),
        param ? host.push(param) : 0, delay) === 1;
    },
    entity(index) {
      if (index < 0 || index >= ex.sim_ents_count()) return null;
      const p = pose(index);
      const hasBounds = ex.sim_ents_bounds(index, outBounds) === 1;
      const b = hasBounds ? Array.from(new Float32Array(ex.memory.buffer, outBounds, 6)) : null;
      return {
        index,
        classname: host.cstr(ex.sim_ents_classname(index)),
        targetname: host.cstr(ex.sim_ents_targetname(index)),
        model: host.cstr(ex.sim_ents_model(index)),
        origin: [p[0], p[1], p[2]],
        angles: [p[3], p[4], p[5]],
        solid: ex.sim_ents_solid(index),
        movetype: ex.sim_ents_movetype(index),
        mins: b ? [b[0], b[1], b[2]] : null,
        maxs: b ? [b[3], b[4], b[5]] : null
      };
    },
    entities() {
      const n = ex.sim_ents_count();
      const out = [];
      for (let i = 0; i < n; i++) out.push(sim.entity(i));
      return out;
    },
    trace(start, end, mins, maxs, mask, hitEntities) {
      const fraction = ex.sim_ents_trace(start[0], start[1], start[2], end[0], end[1], end[2],
        mins ? mins[0] : 0, mins ? mins[1] : 0, mins ? mins[2] : 0,
        maxs ? maxs[0] : 0, maxs ? maxs[1] : 0, maxs ? maxs[2] : 0,
        mask, hitEntities ? 1 : 0, outFloat, outInt);
      const f = new Float32Array(ex.memory.buffer, outFloat, 7);
      const i = new Int32Array(ex.memory.buffer, outInt, 7);
      return {
        fraction,
        endpos: [f[0], f[1], f[2]],
        normal: [f[3], f[4], f[5]],
        planeDist: f[6],
        contents: i[0],
        startsolid: i[1] !== 0,
        allsolid: i[2] !== 0,
        entindex: i[3],
        surfaceFlags: i[4],
        dispFlags: i[5],
        surface: host.cstr(ex.sim_ents_trace_surface())
      };
    },
    handle(index) { return ex.sim_ents_handle(index); },
    poseOf,
    fireInputOn(handle, input, param, delay = 0) {
      return ex.sim_ents_fire_input_handle(handle, host.push(input),
        param ? host.push(param) : 0, delay) === 1;
    },
    findByModel(model) {
      const n = ex.sim_ents_count();
      for (let i = 0; i < n; i++) {
        if (host.cstr(ex.sim_ents_model(i)) === model) return i;
      }
      return -1;
    },
    moverTracks() { return sampleMovers(sim, ex, pose); },
    moverTimeline(seed) { return recordTimeline(sim, ex, sim.movers || [], seed || null); },
    pathGraph() {
      const nodes = new Map();
      const n = ex.sim_ents_count();
      for (let i = 0; i < n; i++) {
        if (host.cstr(ex.sim_ents_classname(i)) !== 'path_track') continue;
        const e = sim.entity(i);
        nodes.set(i, {
          index: i,
          name: e.targetname,
          origin: e.origin,
          radius: ex.sim_ents_path_radius(i),
          next: ex.sim_ents_path_link(i, 0),
          prev: ex.sim_ents_path_link(i, 1),
          alt: ex.sim_ents_path_link(i, 2)
        });
      }
      return nodes;
    },
    addFile(path, pathID, bytes) {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const p = ex.sim_ents_alloc(buf.length + 1);
      new Uint8Array(ex.memory.buffer).set(buf, p);
      new Uint8Array(ex.memory.buffer)[p + buf.length] = 0;
      const ok = ex.sim_fs_add(host.push(String(path)), pathID ? host.push(String(pathID)) : 0,
        p, buf.length) === 1;
      ex.sim_ents_free(p);
      return ok;
    },
    fileExists(path) { return ex.sim_fs_exists(host.push(String(path))) === 1; },
    get fileCount() { return ex.sim_fs_count(); },
    resetFiles() { ex.sim_fs_reset(); },
    loadNav() { return ex.sim_nav_load(); },
    get navAreaCount() { return ex.sim_nav_area_count(); },
    loadPopfile(fullPath) { return ex.sim_pop_load(host.push(String(fullPath))) === 1; },
    get popfile() { return host.cstr(ex.sim_pop_filename()); },
    get waveCount() { return ex.sim_pop_wave_count(); },
    wave(index) {
      if (index < 0 || index >= ex.sim_pop_wave_count()) return null;
      const classes = [];
      const n = ex.sim_pop_wave_class_count(index);
      for (let i = 0; i < n; i++) {
        classes.push({
          icon: host.cstr(ex.sim_pop_wave_class_icon(index, i)),
          count: ex.sim_pop_wave_class_quantity(index, i),
          flags: ex.sim_pop_wave_class_flags(index, i)
        });
      }
      return {
        index,
        description: host.cstr(ex.sim_pop_wave_description(index)),
        enemies: ex.sim_pop_wave_enemy_count(index),
        currency: ex.sim_pop_wave_currency(index),
        classes
      };
    }
  };

  return sim;
}

function sampleOne(sim, ex, model, input) {
  sim.reset();
  const index = sim.findByModel(model);
  if (index < 0) return null;
  const handle = sim.handle(index);
  const start = sim.poseOf(handle);
  if (!start) return null;
  if (!sim.fireInputOn(handle, input)) return null;

  const track = [{ t: ex.sim_ents_curtime(), pose: start }];
  let still = 0;
  let moved = false;
  for (let f = 0; f < MAX_SAMPLE_FRAMES; f++) {
    sim.frame();
    const p = sim.poseOf(handle);
    if (!p) break;
    const last = track[track.length - 1].pose;
    if (poseEqual(p, last)) {
      if (moved && ++still >= SETTLE_FRAMES) break;
      if (!moved && f >= START_DEADLINE_FRAMES) break;
      continue;
    }
    moved = true;
    still = 0;
    track.push({ t: ex.sim_ents_curtime(), pose: p });
  }
  if (!moved) return null;
  const t0 = track[0].t;
  for (const s of track) s.t -= t0;
  return track;
}

const OBSERVE_QUIET_SECONDS = 2;
const OBSERVE_CAP_SECONDS = 60;
const FRAC_EPSILON = 1e-4;

function moverFraction(mover, p) {
  const a = mover.track[0].pose;
  if (mover.kind === 'rotate') {
    if (!mover.degrees) return 0;
    const i = mover.axis[1] ? 0 : mover.axis[2] ? 1 : 2;
    return angleDelta(a[3 + i], p[3 + i]) / mover.degrees;
  }
  if (!(mover.travel > 0)) return 0;
  return ((p[0] - a[0]) * mover.dir[0] + (p[1] - a[1]) * mover.dir[1] +
    (p[2] - a[2]) * mover.dir[2]) / mover.travel;
}

function simplifyKeys(keys) {
  if (keys.length < 3) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1], b = keys[i], c = keys[i + 1];
    const span = c.t - a.t;
    const predicted = span > 0 ? a.frac + (c.frac - a.frac) * ((b.t - a.t) / span) : a.frac;
    if (Math.abs(b.frac - predicted) > FRAC_EPSILON) out.push(b);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

function recordTimeline(sim, ex, movers, seed) {
  sim.reset();
  const tracked = [];
  for (const m of movers) {
    const index = sim.findByModel('*' + m.model);
    if (index < 0) continue;
    tracked.push({ mover: m, handle: sim.handle(index), keys: [], last: null });
  }
  if (!tracked.length) return { keys: new Map(), truncated: false, seconds: 0 };

  if (seed && !sim.fireInputNamed(seed, 'Trigger')) return null;

  const t0 = ex.sim_ents_curtime();
  for (const t of tracked) {
    const p = sim.poseOf(t.handle);
    t.last = p ? moverFraction(t.mover, p) : 0;
    t.keys.push({ t: 0, frac: t.last });
  }

  const quietFrames = Math.ceil(OBSERVE_QUIET_SECONDS / TICK_INTERVAL);
  const capFrames = Math.ceil(OBSERVE_CAP_SECONDS / TICK_INTERVAL);
  let quiet = 0;
  let truncated = true;
  let frames = 0;
  for (; frames < capFrames; frames++) {
    sim.frame();
    let changed = false;
    const now = ex.sim_ents_curtime() - t0;
    for (const t of tracked) {
      const p = sim.poseOf(t.handle);
      if (!p) continue;
      const frac = moverFraction(t.mover, p);
      if (Math.abs(frac - t.last) <= FRAC_EPSILON) continue;
      changed = true;
      t.last = frac;
      t.keys.push({ t: now, frac });
    }
    if (changed) quiet = 0;
    else if (++quiet >= quietFrames) { truncated = false; break; }
  }

  const keys = new Map();
  for (const t of tracked) keys.set(t.mover.model, simplifyKeys(t.keys));
  return { keys, truncated, seconds: frames * TICK_INTERVAL };
}

function sampleMovers(sim, ex, pose) {
  const out = [];
  const n = ex.sim_ents_count();
  const movers = [];
  for (let i = 0; i < n; i++) {
    if (ex.sim_ents_movetype(i) !== MOVETYPE_PUSH) continue;
    const entity = sim.entity(i);
    if (!entity.model.startsWith('*')) continue;
    movers.push(entity);
  }

  for (const entity of movers) {
    entity.openInputs = OPEN_INPUTS.filter(i => sim.acceptsInput(entity.index, i));
    entity.closeInputs = CLOSE_INPUTS.filter(i => sim.acceptsInput(entity.index, i));
  }

  for (const entity of movers) {
    let track = null;
    let opened = true;
    for (const input of entity.openInputs) {
      track = sampleOne(sim, ex, entity.model, input);
      if (track) break;
    }
    if (!track) {
      for (const input of entity.closeInputs) {
        track = sampleOne(sim, ex, entity.model, input);
        if (track) { opened = false; break; }
      }
    }
    if (!track) continue;

    if (!opened) {
      const span = track[track.length - 1].t;
      track = track.map(s => ({ t: span - s.t, pose: s.pose })).reverse();
    }

    const motion = describeMotion(track);
    out.push({
      index: entity.index,
      model: parseInt(entity.model.slice(1), 10),
      name: entity.targetname.toLowerCase() || null,
      cls: entity.classname,
      spawnFrac: opened ? 0 : 1,
      track,
      ...motion
    });
  }

  sim.reset();
  return out;
}
