import { normalizeClass } from './popmodel.js';
import { killRadiusOf } from './killzones.js';

export const PLAYBACK_UNAVAILABLE_NOTE = 'Bot movement playback needs the desktop app and a navigation mesh for this map.';

const SIM_SECONDS = 120;

export function botPlaybackAvailable() {
  return typeof window !== 'undefined' && !!(window.popnative && window.popnative.simulateWave);
}

function synthesize(actor) {
  return {
    cls: normalizeClass(actor.cls || 'scout'),
    name: actor.name || null,
    isGiant: !!actor.isGiant,
    isBoss: false,
    scale: actor.scale > 0 ? actor.scale : (actor.isGiant ? 1.75 : 1),
    items: [],
    itemStyles: {},
    revertItemStyles: {},
    attributes: [],
    tags: [],
    alwaysCrit: false,
    health: actor.maxHealth > 0 ? actor.maxHealth : null
  };
}

function scoreSpec(spec, actor, cls, name) {
  let score = 0;
  if (name && String(spec.name || '').trim().toLowerCase() === name) score += 4;
  if (cls && normalizeClass(spec.cls || '') === cls) score += 2;
  if (!!spec.isGiant === !!actor.isGiant) score += 1;
  return score;
}

const MISSION_TYPE = {
  destroysentries: 2,
  sniper: 3,
  spy: 4,
  engineer: 5,
  seekanddestroy: 2
};

function pickEntry(entries, actor) {
  const cls = normalizeClass(actor.cls || '');
  const name = String(actor.name || '').trim().toLowerCase();
  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < entries.length; i++) {
    const score = scoreSpec(entries[i].bot, actor, cls, name);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function matchMission(actor, missions) {
  const wanted = actor.mission | 0;
  if (!wanted) return null;
  for (const m of Array.isArray(missions) ? missions : []) {
    if (MISSION_TYPE[String(m.objective || '').trim().toLowerCase()] !== wanted) continue;
    const entries = (m.bots || []).filter(e => e && e.bot);
    if (!entries.length) continue;
    const idx = pickEntry(entries, actor);
    return {
      ws: { name: 'Mission: ' + (m.objective || 'unnamed'), node: m.node, mission: m },
      spec: entries[idx].bot,
      memberIdx: idx
    };
  }
  return null;
}

export function matchSpawner(actor, wave, missions) {
  const spawns = wave && Array.isArray(wave.wavespawns) ? wave.wavespawns : [];
  const ws = actor.wsIndex >= 0 && actor.wsIndex < spawns.length ? spawns[actor.wsIndex] : null;
  if (!ws) {
    const fromMission = matchMission(actor, missions);
    if (fromMission) return fromMission;
    return { ws: { name: actor.wsName || '', node: null }, spec: null, memberIdx: 0 };
  }

  const entries = (ws.bots || []).filter(e => e && e.bot);
  if (!entries.length) return { ws, spec: null, memberIdx: 0 };

  const idx = pickEntry(entries, actor);
  return { ws, spec: entries[idx].bot, memberIdx: idx };
}

export function matchTank(actor, wave) {
  const spawns = wave && Array.isArray(wave.wavespawns) ? wave.wavespawns : [];
  const ws = actor.wsIndex >= 0 && actor.wsIndex < spawns.length ? spawns[actor.wsIndex] : null;
  if (!ws) return { ws: { name: actor.wsName || '', node: null }, spec: null };
  const entry = (ws.bots || []).find(e => e && e.tank);
  return { ws, spec: entry ? entry.tank : null };
}

function prepare(actor, wave, missions) {
  const track = actor.track || [];
  const dist = new Float64Array(track.length);
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    dist[i] = dist[i - 1] + Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]);
  }
  const travelled = dist.length ? dist[dist.length - 1] : 0;
  const span = track.length > 1 ? track[track.length - 1][0] - track[0][0] : 0;

  if (actor.kind === 'tank') {
    const { ws, spec } = matchTank(actor, wave);
    const tank = spec
      ? { ...spec }
      : {
          kind: 'tank',
          health: actor.maxHealth > 0 ? actor.maxHealth : null,
          speed: span > 0 ? Math.round(travelled / span) : 0,
          name: 'tankboss',
          skin: 0,
          scale: 1,
          model: null,
          immobile: false,
          disableSmokestack: false
        };
    if (tank.health == null && actor.maxHealth > 0) tank.health = actor.maxHealth;
    return { ...actor, tank, matched: !!spec, spawned: true, memberIdx: 0, ws, dist, travelled };
  }

  const { ws, spec, memberIdx } = matchSpawner(actor, wave, missions);
  const bot = spec ? { ...spec } : synthesize(actor);
  if (bot.health == null && actor.maxHealth > 0) bot.health = actor.maxHealth;
  if (bot.scale == null) bot.scale = actor.scale > 0 ? actor.scale : (bot.isGiant ? 1.75 : 1);

  return { ...actor, bot, matched: !!spec, spawned: true, memberIdx, ws, dist, travelled };
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
  const state = { done: false, actors: [], waveSpawns: [], end: 0, bomb: null, bombs: [], nav: null, note: null, requested: false };

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
      seconds: opts.seconds || SIM_SECONDS,
      killPoints: (Array.isArray(opts.killPoints) ? opts.killPoints : [])
        .filter(kp => Array.isArray(kp) && Number.isFinite(kp[0]) && Number.isFinite(kp[1]))
        .map(kp => [kp[0], kp[1], killRadiusOf(kp)]),
      deathModel: opts.deathModel || null
    }).then(res => {
      const r = res || {};
      state.actors = (r.actors || []).map(a => prepare(a, wave, opts.missions));
      state.waveSpawns = r.waveSpawns || [];
      state.end = r.end || 0;
      state.bomb = r.bomb || null;
      state.bombs = r.bombs || [];
      state.nav = r.nav || null;
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
        waveSpawns: state.waveSpawns,
        end: state.end,
        bomb: state.bomb,
        bombs: state.bombs,
        nav: state.nav,
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
