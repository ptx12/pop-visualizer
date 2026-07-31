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
  return { sim, by };
};

const A = 'WaveSpawn { Name a TotalCount 4 SpawnCount 1 MaxActive 4 WaitBetweenSpawns 2 TFBot { Class Scout } }';
const near = (x, y) => Math.abs(x - y) < 1e-6;

{
  const { by } = run(`${A}\n WaveSpawn { Name b WaitForAllSpawned a TotalCount 2 SpawnCount 1 MaxActive 2 WaitBetweenSpawns 1 TFBot { Class Soldier } }`);
  check('WaitForAllSpawned fires at the target last spawn', near(by.b.firstSpawn, by.a.lastSpawn), `first=${by.b.firstSpawn} lastSpawn=${by.a.lastSpawn}`);
  check('WaitForAllSpawned does not wait for the target to die', by.b.firstSpawn < by.a.deathEnd, `first=${by.b.firstSpawn} deathEnd=${by.a.deathEnd}`);
  check('WaitForAllSpawned start matches its first spawn', near(by.b.start, by.b.firstSpawn), `start=${by.b.start} first=${by.b.firstSpawn}`);
}

{
  const { by } = run(`${A}\n WaveSpawn { Name b WaitForAllDead a TotalCount 2 SpawnCount 1 MaxActive 2 WaitBetweenSpawns 1 TFBot { Class Soldier } }`);
  check('WaitForAllDead fires at the target last death', near(by.b.firstSpawn, by.a.deathEnd), `first=${by.b.firstSpawn} deathEnd=${by.a.deathEnd}`);
  check('WaitForAllDead start matches its first spawn', near(by.b.start, by.b.firstSpawn), `start=${by.b.start} first=${by.b.firstSpawn}`);
}

{
  const spawned = run(`${A}\n WaveSpawn { Name b WaitForAllSpawned a TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Soldier } }`).by.b.firstSpawn;
  const dead = run(`${A}\n WaveSpawn { Name b WaitForAllDead a TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Soldier } }`).by.b.firstSpawn;
  check('the two gate kinds give different times', spawned < dead, `spawned=${spawned} dead=${dead}`);
}

{
  const one = 'TotalCount 2 SpawnCount 1 MaxActive 2 WaitBetweenSpawns 1 TFBot { Class Scout }';
  const { by } = run(` WaveSpawn { Name a ${one} }\n WaveSpawn { Name b WaitForAllSpawned a ${one} }\n WaveSpawn { Name c WaitForAllSpawned b ${one} }`);
  check('a chain of WaitForAllSpawned resolves without a lifetime gap', near(by.b.firstSpawn, 1) && near(by.c.firstSpawn, 2), `b=${by.b.firstSpawn} c=${by.c.firstSpawn}`);
}

{
  const { by } = run(`${A}\n WaveSpawn { Name b WaitForAllSpawned a WaitBeforeStarting 5 TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Soldier } }`);
  check('WaitBeforeStarting stacks on the gate', near(by.b.firstSpawn, by.a.lastSpawn + 5), `first=${by.b.firstSpawn} gate=${by.a.lastSpawn}`);
}

{
  const tank = 'WaveSpawn { Name tank TotalCount 1 SpawnCount 1 MaxActive 1 Tank { Health 30000 Speed 75 Name tankboss } }';
  const b = 'WaveSpawn { Name b TotalCount 3 SpawnCount 1 MaxActive 3 WaitBetweenSpawns 1 TFBot { Class Soldier } }';
  const opts = { tankTimeFor: () => 107 };
  const spawned = run(`${tank}\n ${b.replace('Name b', 'Name b WaitForAllSpawned tank')}`, opts).by.b;
  const dead = run(`${tank}\n ${b.replace('Name b', 'Name b WaitForAllDead tank')}`, opts).by.b;
  check('WaitForAllSpawned on a tank does not wait for the tank', near(spawned.firstSpawn, 0), `first=${spawned.firstSpawn}`);
  check('WaitForAllDead on a tank waits for the tank to be killed', near(dead.firstSpawn, 30), `first=${dead.firstSpawn}`);

  const tough = 'WaveSpawn { Name tank TotalCount 1 SpawnCount 1 MaxActive 1 Tank { Health 300000 Speed 75 Name tankboss } }';
  const late = run(`${tough}\n ${b.replace('Name b', 'Name b WaitForAllDead tank')}`, opts).by.b;
  check('a tank that cannot be killed in time dies when it reaches the hatch', near(late.firstSpawn, 107), `first=${late.firstSpawn}`);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
