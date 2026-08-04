import { PARK_WAIT } from './gating.js';
import { missionWaveSpawn } from './popmodel.js';

export const DEFAULT_SIM_OPTS = {
  teamDPS: 1000,
  robotLimit: 22,
  step: 0.5
};

const MIN_HEALTH = 1;

export function wavespawnHealth(ws) {
  if (!ws.bots || !ws.bots.length) return 0;
  let weighted = 0, mults = 0;
  for (const e of ws.bots) {
    const hp = e.bot ? e.bot.health : e.tank ? e.tank.health : (e.other && e.other.health) || 0;
    weighted += hp * e.mult;
    mults += e.mult;
  }
  return mults ? Math.max(MIN_HEALTH, weighted / mults) : 0;
}

const countsTowardLimit = ws => ws.bots.length > 0 && !ws.isTank;

export function simulateWave(wave, opts = {}) {
  const o = { ...DEFAULT_SIM_OPTS, ...opts };
  const robotLimit = Math.max(1, Math.round(o.robotLimit || 22));
  const missionSpawns = (o.missions || []).map(missionWaveSpawn);
  const probeSpawns = (o.probes || []).filter(Boolean);
  const entries = (missionSpawns.length || probeSpawns.length)
    ? wave.wavespawns.concat(missionSpawns, probeSpawns)
    : wave.wavespawns;
  const byName = new Map();
  for (const ws of wave.wavespawns) {
    if (!ws.name) continue;
    const key = ws.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(ws);
  }
  const issues = [];

  const teamDPS = Math.max(1, Number.isFinite(o.teamDPS) ? o.teamDPS : DEFAULT_SIM_OPTS.teamDPS);

  function reachesGoalAt(ws) {
    if (!ws.isTank || !o.tankTimeFor) return Infinity;
    const measured = o.tankTimeFor(ws);
    return measured && Number.isFinite(measured) ? measured : Infinity;
  }

  const gateStateFor = o.gateStateFor || (() => null);

  const st = entries.map(ws => {
    const unlimited = ws.support === 'unlimited';
    const hasBots = ws.bots.length > 0;
    const gs = gateStateFor(ws);
    const parkedSelf = !gs && Math.max(0, ws.waitBeforeStarting || 0) >= PARK_WAIT;
    return {
      ws, unlimited,
      gated: !!(gs && gs.gated) || parkedSelf,
      parked: !!(gs && gs.parked) || parkedSelf,
      triggerAt: gs && Number.isFinite(gs.triggerAt) ? Math.max(0, gs.triggerAt) : null,
      hp: wavespawnHealth(ws),
      goalAt: reachesGoalAt(ws),
      cohorts: [],
      batch: Math.max(1, ws.squadSize > 1 ? Math.ceil(ws.spawnCount / ws.squadSize) * ws.squadSize : ws.spawnCount),
      total: hasBots ? (unlimited ? Infinity : Math.max(0, ws.totalCount)) : 0,
      countsGlobal: countsTowardLimit(ws),
      spawned: 0, active: 0,
      deaths: [],
      events: [],
      nextAllowed: 0,
      startTime: null,
      gate: 0,
      finishedAt: null,
      lastDeath: null,
      stuck: false,
      throttled: false,
      cyc: false,
      depsSpawned: [], depsDead: []
    };
  });
  const byWs = new Map(st.map(s => [s.ws, s]));

  for (const s of st) {
    if (s.ws.waitForAllSpawned) {
      const targets = byName.get(s.ws.waitForAllSpawned.toLowerCase()) || [];
      if (!targets.length) issues.push({ ws: s.ws, type: 'missing-ref', ref: s.ws.waitForAllSpawned, kind: 'WaitForAllSpawned' });
      for (const tws of targets) if (tws !== s.ws) s.depsSpawned.push(byWs.get(tws));
    }
    if (s.ws.waitForAllDead) {
      const targets = byName.get(s.ws.waitForAllDead.toLowerCase()) || [];
      if (!targets.length) issues.push({ ws: s.ws, type: 'missing-ref', ref: s.ws.waitForAllDead, kind: 'WaitForAllDead' });
      for (const tws of targets) if (tws !== s.ws) s.depsDead.push(byWs.get(tws));
    }
  }

  {
    const color = new Map();
    const stack = [];
    const mark = s => {
      color.set(s, 1);
      stack.push(s);
      for (const d of [...s.depsSpawned, ...s.depsDead]) {
        if (color.get(d) === 1) {
          const from = stack.indexOf(d);
          for (let i = Math.max(0, from); i < stack.length; i++) {
            if (!stack[i].cyc) { stack[i].cyc = true; issues.push({ ws: stack[i].ws, type: 'dependency-cycle' }); }
          }
        } else if (!color.has(d)) mark(d);
      }
      stack.pop();
      color.set(s, 2);
    };
    for (const s of st) if (!color.has(s)) mark(s);
  }

  for (const s of st) {
    if (s.cyc) { s.startTime = 0; s.finishedAt = 0; s.lastDeath = 0; s.total = 0; }
  }

  const spawnedGate = d => {
    if (d.unlimited) return d.startTime;
    return d.finishedAt;
  };
  const deadGate = d => {
    if (d.unlimited) return d.startTime;
    if (d.finishedAt === null || d.active > 0 || d.deaths.length) return null;
    return Math.max(d.finishedAt, d.lastDeath ?? d.finishedAt);
  };

  function resolveGates() {
    let resolved = false;
    for (const s of st) {
      if (s.startTime !== null) continue;
      if (s.gated && s.triggerAt === null) { s.stuck = true; continue; }
      let gate = s.gated ? s.triggerAt : 0;
      let ok = true;
      for (const d of s.depsSpawned) {
        const g = spawnedGate(d);
        if (g === null) { ok = false; break; }
        gate = Math.max(gate, g);
      }
      if (ok) for (const d of s.depsDead) {
        const g = deadGate(d);
        if (g === null) { ok = false; break; }
        gate = Math.max(gate, g);
      }
      if (!ok) continue;
      s.gate = gate;
      s.startTime = gate + (s.parked ? 0 : Math.max(0, s.ws.waitBeforeStarting));
      s.nextAllowed = s.startTime;
      if (s.total === 0) { s.finishedAt = s.startTime; s.lastDeath = s.startTime; }
      resolved = true;
    }
    return resolved;
  }

  let globalActive = 0;
  let t = 0;
  let guard = 0;
  resolveGates();

  const waveStillRunning = () => st.some(s => !s.unlimited && !s.ws.support && s.ws.bots.length && !s.ws.isLogic && (s.spawned < s.total || s.cohorts.length));

  const liveCount = () => {
    let n = 0;
    for (const s of st) for (const c of s.cohorts) n += c.n;
    return n;
  };

  function advanceDamage(from, to) {
    let cur = from;
    let spins = 0;
    while (cur < to - 1e-9 && spins++ < 500) {
      const alive = liveCount();
      if (!alive) return;
      const share = teamDPS / alive;
      let step = to - cur;
      for (const s of st) {
        for (const c of s.cohorts) {
          const byHp = c.hp / share;
          const byGoal = Number.isFinite(s.goalAt) ? (c.born + s.goalAt) - cur : Infinity;
          step = Math.min(step, Math.max(0, Math.min(byHp, byGoal)));
        }
      }
      if (!(step > 1e-9)) step = Math.min(to - cur, 1e-6);
      cur += step;
      for (const s of st) {
        const keep = [];
        for (const c of s.cohorts) {
          c.hp -= share * step;
          const reachedGoal = Number.isFinite(s.goalAt) && cur >= c.born + s.goalAt - 1e-9;
          if (c.hp <= 1e-9 || reachedGoal) {
            c.ev.dieT = cur;
            s.active -= c.n;
            if (s.countsGlobal) globalActive -= c.n;
            s.lastDeath = cur;
          } else keep.push(c);
        }
        s.cohorts = keep;
      }
    }
  }

  function nextDeathAfter(now) {
    const alive = liveCount();
    if (!alive) return Infinity;
    const share = teamDPS / alive;
    let best = Infinity;
    for (const s of st) {
      for (const c of s.cohorts) {
        const byHp = now + c.hp / share;
        const byGoal = Number.isFinite(s.goalAt) ? c.born + s.goalAt : Infinity;
        best = Math.min(best, byHp, byGoal);
      }
    }
    return best;
  }

  while (guard++ < 200000) {
    let progress = true;
    while (progress) {
      progress = resolveGates();
      for (const s of st) {
        if (s.startTime === null || s.stuck || s.spawned >= s.total) continue;
        if (t < s.nextAllowed) continue;
        if (s.unlimited && !waveStillRunning()) continue;
        if (s.batch > s.ws.maxActive || (s.countsGlobal && s.batch > robotLimit)) { s.stuck = true; continue; }
        if (s.active + s.batch > s.ws.maxActive) { s.throttled = true; continue; }
        if (s.countsGlobal && globalActive + s.batch > robotLimit) { s.throttled = true; continue; }
        const count = Math.min(s.batch, s.total - s.spawned);
        const ev = { t, count, dieT: null };
        s.events.push(ev);
        s.cohorts.push({ n: count, hp: s.hp, born: t, ev });
        s.active += count;
        if (s.countsGlobal) globalActive += count;
        s.spawned += count;
        s.pendingAfterDeath = s.ws.waitBetweenSpawnsAfterDeath > 0 ? ev : null;
        s.nextAllowed = s.ws.waitBetweenSpawnsAfterDeath > 0
          ? Infinity
          : t + Math.max(0.05, s.ws.waitBetweenSpawns);
        if (s.spawned >= s.total) s.finishedAt = t;
        if (s.events.length > 4000) s.stuck = true;
        progress = true;
      }
    }
    for (const s of st) {
      if (s.pendingAfterDeath && s.pendingAfterDeath.dieT !== null) {
        s.nextAllowed = s.pendingAfterDeath.dieT + s.ws.waitBetweenSpawnsAfterDeath;
        s.pendingAfterDeath = null;
      }
    }
    let next = nextDeathAfter(t);
    for (const s of st) {
      if (s.startTime !== null && !s.stuck && s.spawned < s.total) {
        const cand = Math.max(s.nextAllowed, s.startTime);
        if (cand > t) next = Math.min(next, cand);
      }
    }
    if (!Number.isFinite(next) || next <= t) {
      if (liveCount()) { advanceDamage(t, nextDeathAfter(t)); t = nextDeathAfter(t) > t ? t : t; }
      break;
    }
    advanceDamage(t, next);
    t = next;
  }
  while (liveCount() && guard++ < 400000) {
    const nd = nextDeathAfter(t);
    if (!Number.isFinite(nd) || nd <= t) break;
    advanceDamage(t, nd);
    t = nd;
  }

  let waveEnd = 0;
  const dieOf = ev => (ev.dieT !== null ? ev.dieT : ev.t);
  const meanLife = s => s.events.length ? s.events.reduce((a, e) => a + (dieOf(e) - e.t), 0) / s.events.length : 0;
  const deathEndOf = s => s.events.length ? Math.max(...s.events.map(dieOf)) : (s.startTime ?? 0);
  for (const s of st) {
    if (s.ws.support || !s.ws.bots.length) continue;
    waveEnd = Math.max(waveEnd, deathEndOf(s));
  }
  if (waveEnd === 0) for (const s of st) waveEnd = Math.max(waveEnd, deathEndOf(s));
  waveEnd = Math.min(Math.max(waveEnd, 10), 1e6);

  const results = new Map();
  for (const s of st) {
    const r = {
      start: s.startTime ?? 0,
      gate: s.gate,
      firstSpawn: 0, lastSpawn: 0, deathEnd: 0,
      events: s.events,
      life: meanLife(s),
      gated: s.gated,
      triggerAt: s.triggerAt,
      untriggered: !!(s.gated && s.triggerAt === null),
      blocked: !!((s.stuck && !s.gated) || s.throttled),
      batch: s.batch,
      deps: { spawned: s.depsSpawned.map(d => d.ws), dead: s.depsDead.map(d => d.ws) },
      pendingSupport: false
    };
    if (s.events.length) {
      r.firstSpawn = s.events[0].t;
      r.lastSpawn = s.events[s.events.length - 1].t;
      r.deathEnd = deathEndOf(s);
    } else {
      r.firstSpawn = r.lastSpawn = r.deathEnd = r.start;
    }
    if (!s.ws.bots.length) r.deathEnd = r.lastSpawn;
    if (s.events.length) {
      const cad = s.ws.waitBetweenSpawnsAfterDeath > 0 ? Math.max(0.05, s.ws.waitBetweenSpawnsAfterDeath) : Math.max(0.05, s.ws.waitBetweenSpawns);
      const per = Math.max(1, s.batch);
      const count = Math.max(1, Math.ceil(Math.max(1, s.ws.totalCount) / per));
      r.tickTimes = [];
      for (let i = 0; i < count; i++) r.tickTimes.push(r.firstSpawn + i * cad);
      r.barEnd = r.firstSpawn + (count - 1) * cad;
    } else {
      r.tickTimes = [];
      r.barEnd = r.firstSpawn;
    }
    if (s.unlimited) {
      r.deathEnd = Math.max(r.deathEnd, waveEnd);
      r.supportUntil = waveEnd;
    }
    results.set(s.ws, r);
  }

  const curve = buildCurve(entries, results, waveEnd, o.step);
  let peak = { t: 0, active: 0, bots: 0 };
  for (const p of curve) if (p.bots > peak.bots) peak = p;

  const missions = missionSpawns.map(ws => ({ ws, mission: ws.mission, result: results.get(ws) }));
  const probes = probeSpawns.map(ws => ({ ws, result: results.get(ws) }));
  return { results, waveEnd, curve, peak, issues, opts: o, robotLimit, missions, probes };
}

function buildCurve(entries, results, waveEnd, step) {
  const deltas = [];
  for (const ws of entries) {
    if (!ws.bots.length) continue;
    const r = results.get(ws);
    if (!r) continue;
    const counts = countsTowardLimit(ws) ? 1 : 0;
    for (const ev of r.events) {
      deltas.push([ev.t, ev.count, counts]);
      deltas.push([ev.dieT !== null ? ev.dieT : ev.t + r.life, -ev.count, counts]);
    }
  }
  deltas.sort((a, b) => a[0] - b[0]);
  const curve = [];
  let active = 0;
  let bots = 0;
  let di = 0;
  let end = Math.max(waveEnd, deltas.length ? deltas[deltas.length - 1][0] : 0);
  if (!Number.isFinite(end) || end > 1e6) end = Math.min(waveEnd, 1e6);
  const st = Math.max(step, end / 20000);
  for (let t = 0; t <= end + st; t += st) {
    while (di < deltas.length && deltas[di][0] <= t) {
      active += deltas[di][1];
      if (deltas[di][2]) bots += deltas[di][1];
      di++;
    }
    curve.push({ t, active: Math.max(0, active), bots: Math.max(0, bots) });
  }
  return curve;
}

export function overlappingSpawns(wave, simResult) {
  const spans = [];
  for (const ws of wave.wavespawns) {
    const r = simResult.results.get(ws);
    if (!r || !r.events.length) continue;
    spans.push({ ws, a: r.firstSpawn, b: r.lastSpawn });
  }
  const overlaps = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = Math.max(spans[i].a, spans[j].a);
      const b = Math.min(spans[i].b, spans[j].b);
      if (b - a > 0.5) overlaps.push({ a: spans[i].ws, b: spans[j].ws, from: a, to: b });
    }
  }
  return overlaps;
}
