export const PLAYBACK_UNAVAILABLE_NOTE = 'Bot movement playback needs the desktop app and a navigation mesh for this map.';

const SIM_SECONDS = 120;

export function botPlaybackAvailable() {
  return typeof window !== 'undefined' && !!(window.popnative && window.popnative.simulateWave);
}

function makeBot(actor) {
  return {
    cls: actor.cls || 'scout',
    name: null,
    isGiant: !!actor.isGiant,
    isBoss: false,
    scale: actor.isGiant ? 1.75 : 1,
    items: [],
    itemStyles: {},
    revertItemStyles: {},
    attributes: [],
    tags: [],
    alwaysCrit: false,
    health: null
  };
}

function prepare(actor) {
  const track = actor.track || [];
  const dist = new Float64Array(track.length);
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    dist[i] = dist[i - 1] + Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]);
  }
  return {
    ...actor,
    bot: makeBot(actor),
    spawned: true,
    memberIdx: 0,
    ws: null,
    dist,
    travelled: dist.length ? dist[dist.length - 1] : 0
  };
}

function sample(a, t) {
  const track = a.track;
  if (!track || !track.length) return null;
  if (t <= track[0][0]) return { i: 0, j: 0, f: 0 };
  const last = track.length - 1;
  if (t >= track[last][0]) return { i: last, j: last, f: 0 };

  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= t) lo = mid; else hi = mid;
  }
  const span = track[hi][0] - track[lo][0];
  return { i: lo, j: hi, f: span > 0 ? (t - track[lo][0]) / span : 0 };
}

function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * f;
}

export function createBotSim(wave, sim, mapData, opts = {}) {
  const state = { done: false, actors: [], end: 0, note: null, requested: false };

  const request = () => {
    state.requested = true;
    if (!botPlaybackAvailable()) {
      state.note = PLAYBACK_UNAVAILABLE_NOTE;
      state.done = true;
      return;
    }
    window.popnative.simulateWave({
      popName: opts.popName || null,
      popPath: opts.popPath || null,
      popDir: opts.popDir || null,
      waveIndex: wave ? wave.index : 0,
      seconds: opts.seconds || SIM_SECONDS
    }).then(res => {
      const r = res || {};
      state.actors = (r.actors || []).map(prepare);
      state.end = r.end || 0;
      state.note = r.note || null;
      state.done = true;
    }).catch(err => {
      state.note = 'Wave simulation failed: ' + (err && err.message ? err.message : err);
      state.done = true;
    });
  };

  return {
    stepMany() {
      if (!state.requested) request();
      return state.done;
    },
    progress() {
      return state.done ? 1 : 0.5;
    },
    result() {
      return {
        actors: state.actors,
        end: state.end,
        note: state.note,
        unavailable: !state.actors.length,
        source: 'source'
      };
    }
  };
}

export function actorPosAt(a, t) {
  const s = sample(a, t);
  if (!s) return null;
  const p = a.track[s.i], q = a.track[s.j];
  return [p[1] + (q[1] - p[1]) * s.f, p[2] + (q[2] - p[2]) * s.f];
}

export function actorZAt(a, t) {
  const s = sample(a, t);
  if (!s) return 0;
  const p = a.track[s.i], q = a.track[s.j];
  return p[3] + (q[3] - p[3]) * s.f;
}

export function actorYawAt(a, t) {
  const s = sample(a, t);
  if (!s) return 0;
  return lerpAngle(a.track[s.i][4], a.track[s.j][4], s.f);
}

export function actorDistAt(a, t) {
  const s = sample(a, t);
  if (!s || !a.dist) return 0;
  return a.dist[s.i] + (a.dist[s.j] - a.dist[s.i]) * s.f;
}
