import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateBotAI, ACTOR_CAP } from '../renderer/js/botai.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

function corridor(n) {
  const areas = [];
  for (let i = 0; i < n; i++) {
    const connect = [];
    if (i > 0) connect.push(i - 1);
    if (i < n - 1) connect.push(i + 1);
    areas.push({
      id: i,
      nw: [i * 200, 0, i * 8],
      se: [(i + 1) * 200, 300, i * 8],
      neZ: i * 8, swZ: i * 8,
      connect, tfAttributes: 0
    });
  }
  return { areas };
}

const N = 12;
const AT = i => [i * 200 + 100, 150, i * 8];
const mapData = {
  map: 'test_corridor',
  nav: corridor(N),
  spawns: [{ name: 'spawnbot', origin: AT(0) }],
  redSpawns: [], flags: [], capzones: [AT(N - 1)],
  tracks: [], hints: [], navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: []
};

function runWave(text) {
  const model = buildModel(parse(text), []);
  const wave = model.waves[0];
  const sim = simulateWave(wave, { robotLimit: model.robotLimit });
  return simulateBotAI(wave, sim, mapData, { deathModel: 'hatch' });
}

const waveOf = spawns => `WaveSchedule\n{\n\tWave\n\t{\n${spawns}\t}\n}\n`;
const wsOf = (name, total, maxActive, spawnCount, waitBetween) => `\t\tWaveSpawn
\t\t{
\t\t\tName\t${name}
\t\t\tTotalCount\t${total}
\t\t\tMaxActive\t${maxActive}
\t\t\tSpawnCount\t${spawnCount}
\t\t\tWaitBetweenSpawns\t${waitBetween}
\t\t\tWhere\tspawnbot
\t\t\tTFBot
\t\t\t{
\t\t\t\tClass\tScout
\t\t\t\tSkill\tEasy
\t\t\t}
\t\t}
`;

const flood = runWave(waveOf(wsOf('a', 1000, 22, 22, 0) + wsOf('b', 1000, 22, 22, 0) + wsOf('c', 1000, 22, 22, 0)));
check('flood run reports truncation', !!flood.truncation);
check('flood hit the actor cap', flood.truncation && flood.truncation.capHit === true);
check('actor count stays at the cap (small documented overshoot)', flood.actors.length >= ACTOR_CAP && flood.actors.length <= ACTOR_CAP + 3, String(flood.actors.length));
check('skipped count reflects the uncreated remainder', flood.truncation && flood.truncation.skipped > 400 && flood.truncation.skipped <= 3000 - ACTOR_CAP, flood.truncation && String(flood.truncation.skipped));
check('flood reports only the creation cap, not an early end', flood.truncation && !flood.truncation.endedEarly, flood.truncation && String(flood.truncation.endedEarly));
check('every created flood actor reaches the map', flood.actors.every(a => a.spawned));

const contested = runWave(waveOf(wsOf('a', 60, 22, 22, 0) + wsOf('b', 60, 22, 22, 0)));
check('contested wave has no truncation', contested.truncation === null, JSON.stringify(contested.truncation));
check('contested wave spawns every bot on schedule', contested.actors.every(a => a.spawned));

const sane = runWave(waveOf(wsOf('a', 10, 5, 5, 2)));
check('normal run has no truncation', sane.truncation === null);
check('normal run created every actor', sane.actors.length === 10, String(sane.actors.length));

const supportWs = `\t\tWaveSpawn
\t\t{
\t\t\tName\tsup
\t\t\tTotalCount\t20
\t\t\tMaxActive\t4
\t\t\tSpawnCount\t1
\t\t\tWaitBetweenSpawns\t8
\t\t\tSupport\t1
\t\t\tWhere\tspawnbot
\t\t\tTFBot
\t\t\t{
\t\t\t\tClass\tScout
\t\t\t\tSkill\tEasy
\t\t\t}
\t\t}
`;
const supported = runWave(waveOf(wsOf('a', 10, 5, 5, 2) + supportWs));
check('endless support does not read as truncation', supported.truncation === null, JSON.stringify(supported.truncation));

const spyWs = wsOf('lurkers', 22, 22, 22, 0).replace('Class\tScout', 'Class\tSpy');
const spyWave = runWave(waveOf(spyWs + wsOf('main', 40, 22, 22, 0)));
check('lurking spies do not deadlock the wave', spyWave.actors.every(a => a.spawned), String(spyWave.actors.filter(a => !a.spawned).length) + ' unspawned');
check('spies die on their scheduled lifetime in hatch model', spyWave.actors.filter(a => a.bot && a.bot.cls === 'spy').every(a => !a.alive));
check('spy wave ends without truncation', spyWave.truncation === null, JSON.stringify(spyWave.truncation));

const slow = runWave(waveOf(wsOf('a', 100, 2, 1, 60)));
check('slow drip reports truncation', !!slow.truncation);
check('slow drip did not hit the cap', slow.truncation && slow.truncation.capHit === false);
check('slow drip skipped nothing at creation', slow.truncation && slow.truncation.skipped === 0);
check('slow drip ends on the step limit', slow.truncation && slow.truncation.endedEarly === 'step-limit', slow.truncation && String(slow.truncation.endedEarly));
check('slow drip counts never-spawned bots', slow.truncation && slow.truncation.unspawned > 0, slow.truncation && String(slow.truncation.unspawned));
check('slow drip endT sits at the step-limit horizon', slow.truncation && slow.truncation.endT > 1400 && slow.truncation.endT < 1500, slow.truncation && String(slow.truncation.endT));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
