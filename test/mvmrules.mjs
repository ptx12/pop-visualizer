import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const run = (body, opts = {}) => {
  const wave = buildModel(parse(`WaveSchedule\n{\n Wave\n {\n${body}\n }\n}\n`), []).waves[0];
  const sim = simulateWave(wave, opts);
  const by = {};
  for (const ws of wave.wavespawns) by[(ws.name || '?').toLowerCase()] = sim.results.get(ws);
  return { wave, sim, by };
};
const spawned = r => r.events.reduce((s, e) => s + e.count, 0);
const times = r => r.events.map(e => `${e.t}x${e.count}`).join(' ');
const peakBots = sim => Math.max(...sim.curve.map(p => p.bots));
const SCOUT = 'TFBot { Class Scout }';

{
  const { by } = run(` WaveSpawn { Name a WaitBeforeStarting 7 TotalCount 1 SpawnCount 1 MaxActive 1 ${SCOUT} }`);
  check('WaitBeforeStarting delays the first spawn', by.a.firstSpawn === 7, `first=${by.a.firstSpawn}`);
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 3 SpawnCount 1 MaxActive 3 WaitBetweenSpawns 4 ${SCOUT} }`);
  check('WaitBetweenSpawns paces consecutive batches', times(by.a) === '0x1 4x1 8x1', times(by.a));
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 7 SpawnCount 3 MaxActive 9 WaitBetweenSpawns 1 ${SCOUT} }`);
  check('the last batch is partial when TotalCount is not a multiple of SpawnCount', times(by.a) === '0x3 1x3 2x1', times(by.a));
  check('the spawned total equals TotalCount', spawned(by.a) === 7, String(spawned(by.a)));
}
{
  const { sim, by } = run(` WaveSpawn { Name a TotalCount 8 SpawnCount 2 MaxActive 4 WaitBetweenSpawns 1 ${SCOUT} }`, { robotLimit: 99 });
  check('MaxActive caps one wavespawn concurrently alive', peakBots(sim) <= 4, `peak=${peakBots(sim)}`);
  check('bots held back by MaxActive are delayed, not dropped', spawned(by.a) === 8, String(spawned(by.a)));
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 3 SpawnCount 1 MaxActive 3 WaitBetweenSpawnsAfterDeath 5 ${SCOUT} }`);
  check('WaitBetweenSpawnsAfterDeath waits for the batch to die then delays', times(by.a) === '0x1 17x1 34x1', times(by.a));
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 6 SpawnCount 4 MaxActive 2 WaitBetweenSpawns 1 ${SCOUT} }`);
  check('SpawnCount above MaxActive stalls the wavespawn', by.a.blocked && spawned(by.a) === 0, `blocked=${by.a.blocked} spawned=${spawned(by.a)}`);
}
{
  const many = Array.from({ length: 5 }, (_, i) => ` WaveSpawn { Name w${i} TotalCount 10 SpawnCount 10 MaxActive 10 ${SCOUT} }`).join('\n');
  const { sim } = run(many, { robotLimit: 22 });
  const total = [...sim.results.values()].reduce((s, r) => s + spawned(r), 0);
  check('active robots never exceed the robot limit', peakBots(sim) <= 22, `peak=${peakBots(sim)}`);
  check('robots held back by the limit still spawn later', total === 50, String(total));
}
{
  const tanks = Array.from({ length: 4 }, (_, i) => ` WaveSpawn { Name t${i} TotalCount 1 SpawnCount 1 MaxActive 1 Tank { Health 30000 Speed 75 Name tank${i} } }`).join('\n');
  const { sim, by } = run(tanks + `\n WaveSpawn { Name b TotalCount 22 SpawnCount 22 MaxActive 22 ${SCOUT} }`, { robotLimit: 22 });
  check('tanks do not consume robot-limit slots', spawned(by.b) === 22 && by.b.firstSpawn === 0, `${spawned(by.b)} at ${by.b.firstSpawn}`);
  check('tanks are excluded from the robot count', peakBots(sim) === 22, `peak=${peakBots(sim)}`);
  const withTanks = Math.max(...sim.curve.map(p => p.active));
  check('tanks still register as something alive', withTanks === 26, `active peak=${withTanks}`);
}
{
  const { by, sim } = run(` WaveSpawn { Name a TotalCount 4 SpawnCount 1 MaxActive 4 WaitBetweenSpawns 2 ${SCOUT} }
 WaveSpawn { Name s Support 1 TotalCount 99 SpawnCount 1 MaxActive 2 WaitBetweenSpawns 3 ${SCOUT} }`);
  check('unlimited support does not extend the wave', sim.waveEnd === by.a.deathEnd, `${sim.waveEnd} vs ${by.a.deathEnd}`);
  check('unlimited support respawns through the wave', by.s.events.length > 1, `${by.s.events.length} spawns`);
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 20 SpawnCount 1 MaxActive 20 WaitBetweenSpawns 2 ${SCOUT} }
 WaveSpawn { Name s Support Limited TotalCount 3 SpawnCount 1 MaxActive 3 WaitBetweenSpawns 1 ${SCOUT} }`);
  check('Support Limited stops at TotalCount', spawned(by.s) === 3, String(spawned(by.s)));
}
{
  const { wave } = run(` WaveSpawn { Name a TotalCount 4 TotalCurrency 400 SpawnCount 1 MaxActive 4 ${SCOUT} }
 WaveSpawn { Name b TotalCount 2 TotalCurrency 200 SpawnCount 1 MaxActive 2 ${SCOUT} }`);
  check('wave currency sums every TotalCurrency', wave.totalCurrency === 600, String(wave.totalCurrency));
  check('wave bot count excludes support and logic wavespawns', wave.totalBots === 6, String(wave.totalBots));
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 6 SpawnCount 3 MaxActive 6 WaitBetweenSpawns 5 Squad { TFBot { Class Soldier } TFBot { Class Medic } TFBot { Class Medic } } }`);
  check('a squad spawns as one indivisible group', times(by.a) === '0x3 5x3', times(by.a));
}
{
  const { by } = run(` WaveSpawn { Name a TotalCount 6 SpawnCount 6 MaxActive 6 Mob { Count 3 TFBot { Class Scout } } }`);
  check('a Mob spawner spawns its Count together', times(by.a) === '0x6', times(by.a));
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vanilla');
const V = new Map();
const bad = (id, msg) => { if (!V.has(id)) V.set(id, []); V.get(id).push(msg); };
const EPS = 1e-6;
let waves = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pop'))) {
  const m = buildModel(parse(fs.readFileSync(path.join(dir, f), 'latin1')), []);
  for (let wi = 0; wi < m.waves.length; wi++) {
    const wave = m.waves[wi];
    waves++;
    const sim = simulateWave(wave);
    const tag = `${f} w${wi + 1}`;
    const byName = new Map();
    for (const ws of wave.wavespawns) if (ws.name) {
      const k = ws.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(ws);
    }
    for (const ws of wave.wavespawns) {
      const r = sim.results.get(ws);
      const n = ws.name || '(unnamed)';
      if (!ws.support && ws.bots.length && !r.blocked && spawned(r) !== Math.max(0, ws.totalCount)) {
        bad('every non-support wavespawn spawns exactly TotalCount', `${tag} ${n}: ${spawned(r)}/${ws.totalCount}`);
      }
      let act = 0, own = 0;
      const ev = [];
      for (const e of r.events) { ev.push([e.t, e.count]); ev.push([e.t + r.life, -e.count]); }
      ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, d] of ev) { act += d; own = Math.max(own, act); }
      if (own > ws.maxActive + EPS) bad('no wavespawn exceeds its own MaxActive', `${tag} ${n}: ${own} > ${ws.maxActive}`);
      if (r.firstSpawn < r.start - EPS) bad('nothing spawns before its own start time', `${tag} ${n}`);
      for (let i = 1; i < r.events.length; i++) {
        if (r.events[i].t < r.events[i - 1].t - EPS) bad('spawn events are ordered in time', `${tag} ${n}`);
      }
      if (ws.waitForAllSpawned && r.events.length) {
        for (const t of byName.get(ws.waitForAllSpawned.toLowerCase()) || []) {
          if (t === ws) continue;
          const tr = sim.results.get(t);
          if (tr.events.length && r.firstSpawn < tr.lastSpawn - EPS) bad('WaitForAllSpawned never fires early', `${tag} ${n}`);
        }
      }
      if (ws.waitForAllDead && r.events.length) {
        for (const t of byName.get(ws.waitForAllDead.toLowerCase()) || []) {
          if (t === ws || t.support === 'unlimited') continue;
          const tr = sim.results.get(t);
          if (tr.events.length && r.firstSpawn < tr.deathEnd - EPS) bad('WaitForAllDead never fires early', `${tag} ${n}`);
        }
      }
    }
    if (peakBots(sim) > sim.robotLimit + EPS) bad('the robot limit holds on every vanilla wave', `${tag}: ${peakBots(sim)} > ${sim.robotLimit}`);
  }
}
for (const id of [
  'every non-support wavespawn spawns exactly TotalCount',
  'the robot limit holds on every vanilla wave',
  'no wavespawn exceeds its own MaxActive',
  'nothing spawns before its own start time',
  'WaitForAllSpawned never fires early',
  'WaitForAllDead never fires early',
  'spawn events are ordered in time'
]) {
  const v = V.get(id) || [];
  check(`${id} (${waves} vanilla waves)`, v.length === 0, v.slice(0, 3).join('; '));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
