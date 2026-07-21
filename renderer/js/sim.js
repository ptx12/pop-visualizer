export const DEFAULT_SIM_OPTS = {
  botLifetime: 12,
  giantLifetime: 35,
  tankLifetime: 80,
  robotLimit: 22,
  step: 0.5
};

export function simulateWave(wave, opts = {}) {
  const o = { ...DEFAULT_SIM_OPTS, ...opts };
  const robotLimit = Math.max(1, Math.round(o.robotLimit || 22));
  const byName = new Map();
  for (const ws of wave.wavespawns) {
    if (!ws.name) continue;
    const key = ws.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(ws);
  }
  const issues = [];

  function lifetimeFor(ws) {
    if (ws.isTank) {
      if (o.tankTimeFor) {
        const measured = o.tankTimeFor(ws);
        if (measured && Number.isFinite(measured)) return measured;
      }
      return o.tankLifetime;
    }
    if (ws.hasBoss) return Math.max(o.giantLifetime, o.tankLifetime * 0.75);
    if (ws.hasGiant) return o.giantLifetime;
    return o.botLifetime;
  }

  const gateStateFor = o.gateStateFor || (() => null);

  const st = wave.wavespawns.map(ws => {
    const unlimited = ws.support === 'unlimited';
    const hasBots = ws.bots.length > 0;
    const gs = gateStateFor(ws);
    return {
      ws, unlimited,
      gated: !!(gs && gs.gated),
      triggerAt: gs && Number.isFinite(gs.triggerAt) ? Math.max(0, gs.triggerAt) : null,
      life: lifetimeFor(ws),
      batch: Math.max(1, ws.squadSize > 1 ? Math.ceil(ws.spawnCount / ws.squadSize) * ws.squadSize : ws.spawnCount),
      total: hasBots ? (unlimited ? Infinity : Math.max(0, ws.totalCount)) : 0,
      countsGlobal: hasBots && !ws.isTank,
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
      s.startTime = gate + Math.max(0, s.ws.waitBeforeStarting);
      s.nextAllowed = s.startTime;
      if (s.total === 0) { s.finishedAt = s.startTime; s.lastDeath = s.startTime; }
    }
  }

  let globalActive = 0;
  let t = 0;
  let dynamicEnd = 10;
  let guard = 0;
  resolveGates();

  while (guard++ < 200000) {
    for (const s of st) {
      while (s.deaths.length && s.deaths[0][0] <= t) {
        const d = s.deaths.shift();
        s.active -= d[1];
        if (s.countsGlobal) globalActive -= d[1];
        s.lastDeath = d[0];
      }
    }
    resolveGates();
    let progress = true;
    while (progress) {
      progress = false;
      for (const s of st) {
        if (s.startTime === null || s.stuck || s.spawned >= s.total) continue;
        if (t < s.nextAllowed) continue;
        if (s.unlimited && t > dynamicEnd) continue;
        if (s.batch > s.ws.maxActive || (s.countsGlobal && s.batch > robotLimit)) { s.stuck = true; continue; }
        if (s.active + s.batch > s.ws.maxActive) { s.throttled = true; continue; }
        if (s.countsGlobal && globalActive + s.batch > robotLimit) { s.throttled = true; continue; }
        const count = Math.min(s.batch, s.total - s.spawned);
        s.events.push({ t, count });
        s.deaths.push([t + s.life, count]);
        s.deaths.sort((a, b) => a[0] - b[0]);
        s.active += count;
        if (s.countsGlobal) globalActive += count;
        s.spawned += count;
        s.nextAllowed = s.ws.waitBetweenSpawnsAfterDeath > 0
          ? t + s.life + s.ws.waitBetweenSpawnsAfterDeath
          : t + Math.max(0.05, s.ws.waitBetweenSpawns);
        if (s.spawned >= s.total) s.finishedAt = t;
        if (!s.unlimited && !s.ws.support && s.ws.bots.length && !s.ws.isLogic) dynamicEnd = Math.max(dynamicEnd, t + s.life);
        if (s.events.length > 4000) s.stuck = true;
        progress = true;
      }
    }
    let next = Infinity;
    for (const s of st) {
      if (s.deaths.length) next = Math.min(next, s.deaths[0][0]);
      if (s.startTime !== null && !s.stuck && s.spawned < s.total) {
        const cand = Math.max(s.nextAllowed, s.startTime);
        if (cand > t && !(s.unlimited && cand > dynamicEnd)) next = Math.min(next, cand);
      }
    }
    if (!Number.isFinite(next) || next <= t) break;
    t = next;
  }

  let waveEnd = 0;
  const deathEndOf = s => s.events.length ? s.events[s.events.length - 1].t + s.life : (s.startTime ?? 0);
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
      life: s.life,
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
      r.deathEnd = r.lastSpawn + s.life;
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

  const curve = buildCurve(wave, results, waveEnd, o.step);
  let peak = { t: 0, active: 0 };
  for (const p of curve) if (p.active > peak.active) peak = p;

  return { results, waveEnd, curve, peak, issues, opts: o, robotLimit };
}

function buildCurve(wave, results, waveEnd, step) {
  const deltas = [];
  for (const ws of wave.wavespawns) {
    if (!ws.bots.length) continue;
    const r = results.get(ws);
    if (!r) continue;
    for (const ev of r.events) {
      deltas.push([ev.t, ev.count]);
      deltas.push([ev.t + r.life, -ev.count]);
    }
  }
  deltas.sort((a, b) => a[0] - b[0]);
  const curve = [];
  let active = 0;
  let di = 0;
  let end = Math.max(waveEnd, deltas.length ? deltas[deltas.length - 1][0] : 0);
  if (!Number.isFinite(end) || end > 1e6) end = Math.min(waveEnd, 1e6);
  const st = Math.max(step, end / 20000);
  for (let t = 0; t <= end + st; t += st) {
    while (di < deltas.length && deltas[di][0] <= t) { active += deltas[di][1]; di++; }
    curve.push({ t, active: Math.max(0, active) });
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
