export function createEventBus() {
  const listeners = new Map();
  const queue = [];
  let fired = 0;
  let dirty = false;

  const key = name => String(name || '').trim().toLowerCase();

  function on(input, fn) {
    const k = key(input);
    if (!listeners.has(k)) listeners.set(k, []);
    listeners.get(k).push(fn);
    return () => {
      const list = listeners.get(k);
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function deliver(ev) {
    fired++;
    for (const fn of listeners.get(key(ev.input)) || []) fn(ev);
    for (const fn of listeners.get('*') || []) fn(ev);
  }

  function schedule(t, ev) {
    if (!ev || !Number.isFinite(t)) return null;
    const entry = {
      t, seq: queue.length,
      target: ev.target || '',
      input: ev.input || 'Trigger',
      param: ev.param || '',
      source: ev.source || null,
      via: ev.via || null
    };
    queue.push(entry);
    dirty = true;
    return entry;
  }

  function drain(t) {
    if (!queue.length) return 0;
    if (dirty) {
      queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
      dirty = false;
    }
    let n = 0;
    while (queue.length && queue[0].t <= t) {
      deliver(queue.shift());
      n++;
    }
    return n;
  }

  return {
    on,
    schedule,
    drain,
    emit(ev) { deliver({ t: null, ...ev }); },
    pending() { return queue.length; },
    fired() { return fired; },
    upcoming() { return queue.slice().sort((a, b) => a.t - b.t || a.seq - b.seq); }
  };
}

export const eventPump = {
  id: 'events',
  order: 5,
  step(ctx, t) {
    ctx.events.drain(t);
  }
};

const WS_OUTPUT_TIME = {
  firstspawnoutput: r => r.firstSpawn,
  lastspawnoutput: r => r.lastSpawn,
  doneoutput: r => r.deathEnd
};

export function seedWaveEvents(bus, wave, sim, api) {
  let n = 0;
  for (const o of api.waveStartOutputs(wave)) {
    bus.schedule(Math.max(0, o.delay || 0), { ...o, source: 'wave' });
    n++;
  }
  for (const ws of wave.wavespawns) {
    const r = sim.results.get(ws);
    if (!r) continue;
    for (const [key, at] of Object.entries(WS_OUTPUT_TIME)) {
      for (const o of api.wavespawnOutputs(ws, key)) {
        const base = at(r);
        if (!Number.isFinite(base)) continue;
        bus.schedule(base + Math.max(0, o.delay || 0), { ...o, source: ws.name || 'wavespawn' });
        n++;
      }
    }
  }
  return n;
}
