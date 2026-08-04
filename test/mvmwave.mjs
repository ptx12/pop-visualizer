import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { simulateWave } from '../main/wavesim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const TF_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';
const MAP = 'mvm_decoy';

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip mvm wave tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`)) {
  console.log(`skip mvm wave tests: ${MAP} not available`);
  process.exit(0);
}

const workDir = join(tmpdir(), 'popvis-mvmwave');
mkdirSync(workDir, { recursive: true });

const SCOUT = `TFBot
			{
				Class Scout
				Skill Easy
				Attributes IgnoreEnemies
			}`;

function popfile(name, waveBody) {
  const text = `WaveSchedule
{
	StartingCurrency 400
	RespawnWaveTime 5
	Wave
	{
${waveBody}
	}
}
`;
  const p = join(workDir, name + '.pop');
  writeFileSync(p, text);
  return p;
}

function wavespawn(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `\t\t\t${k} ${v}`).join('\n');
  return `\t\tWaveSpawn\n\t\t{\n${lines}\n\t\t\t${SCOUT}\n\t\t}`;
}

async function run(popPath, seconds) {
  return simulateWave({
    bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: null,
    popPath, popDir: workDir, waveIndex: 0, seconds, tfPath: TF_DIR
  });
}

const liveAt = (actors, t) =>
  actors.filter(a => a.kind === 'bot' && a.spawnT <= t && (!Number.isFinite(a.dieT) || a.dieT > t)).length;

const firstSpawn = (actors, wsIndex) => {
  const times = actors.filter(a => a.wsIndex === wsIndex).map(a => a.spawnT);
  return times.length ? Math.min(...times) : null;
};

console.log('9.3 wavespawn dependencies');
const missingName = popfile('missingname', [
  wavespawn({ Name: 'first', TotalCount: 2, SpawnCount: 1, MaxActive: 2, WaitBeforeStarting: 20, Where: 'spawnbot', TotalCurrency: 100 }),
  wavespawn({ Name: 'second', TotalCount: 2, SpawnCount: 1, MaxActive: 2, WaitForAllSpawned: 'nobody_by_this_name', Where: 'spawnbot', TotalCurrency: 100 })
].join('\n'));
const missingRun = await run(missingName, 40);
const gatedStart = firstSpawn(missingRun.actors, 0);
const ungatedStart = firstSpawn(missingRun.actors, 1);
check('a wavespawn waiting on a name that does not exist is not blocked', ungatedStart !== null && ungatedStart < 10,
  ungatedStart === null ? 'it never spawned' : `first spawn at ${ungatedStart.toFixed(2)}s`);
check('the sibling that really does wait still waits', gatedStart !== null && gatedStart >= 19,
  gatedStart === null ? 'it never spawned' : `first spawn at ${gatedStart.toFixed(2)}s`);

const realName = popfile('realname', [
  wavespawn({ Name: 'leader', TotalCount: 2, SpawnCount: 1, MaxActive: 2, WaitBeforeStarting: 20, Where: 'spawnbot', TotalCurrency: 100 }),
  wavespawn({ Name: 'follower', TotalCount: 2, SpawnCount: 1, MaxActive: 2, WaitForAllSpawned: 'leader', Where: 'spawnbot', TotalCurrency: 100 })
].join('\n'));
const realRun = await run(realName, 60);
const leaderStart = firstSpawn(realRun.actors, 0);
const followerStart = firstSpawn(realRun.actors, 1);
check('a wavespawn waiting on a name that does exist is held until that sibling finishes spawning',
  leaderStart !== null && followerStart !== null && followerStart > leaderStart,
  `leader ${leaderStart === null ? '-' : leaderStart.toFixed(2)}s, follower ${followerStart === null ? '-' : followerStart.toFixed(2)}s`);

console.log('\n9.4 reservation, max active and the invader cap');
const flood = popfile('flood', wavespawn({
  Name: 'flood', TotalCount: 80, SpawnCount: 5, MaxActive: 999,
  WaitBeforeStarting: 0, WaitBetweenSpawns: 0, Where: 'spawnbot', TotalCurrency: 400
}));
const floodRun = await run(flood, 90);
let peak = 0;
for (let t = 0; t <= floodRun.end; t += 0.5) peak = Math.max(peak, liveAt(floodRun.actors, t));
check('an unbounded wavespawn never puts more than 22 invaders on the field', peak > 0 && peak <= 22,
  `peak ${peak} live invaders across ${floodRun.actors.length} spawns`);
check('the invader cap is actually being pressed against', peak >= 15, `peak ${peak}`);

const capped = popfile('capped', wavespawn({
  Name: 'capped', TotalCount: 40, SpawnCount: 2, MaxActive: 4,
  WaitBeforeStarting: 0, WaitBetweenSpawns: 0, Where: 'spawnbot', TotalCurrency: 400
}));
const cappedRun = await run(capped, 60);
let cappedPeak = 0;
for (let t = 0; t <= cappedRun.end; t += 0.5) cappedPeak = Math.max(cappedPeak, liveAt(cappedRun.actors, t));
check('max active bounds the live count of a single wavespawn', cappedPeak > 0 && cappedPeak <= 4,
  `peak ${cappedPeak} live`);

const batched = popfile('batched', wavespawn({
  Name: 'batched', TotalCount: 12, SpawnCount: 4, MaxActive: 12,
  WaitBeforeStarting: 0, WaitBetweenSpawns: 10, Where: 'spawnbot', TotalCurrency: 400
}));
const batchedRun = await run(batched, 60);
const batchTimes = batchedRun.actors.filter(a => a.kind === 'bot').map(a => a.spawnT).sort((a, b) => a - b);
const batches = [];
for (const t of batchTimes) {
  const last = batches[batches.length - 1];
  if (last && t - last[0] < 1) last.push(t); else batches.push([t]);
}
check('a spawn count of four arrives as batches of four', batches.length > 1 && batches.every(b => b.length === 4),
  batches.map(b => b.length).join('+'));
check('the wait between spawns separates those batches by about ten seconds',
  batches.length > 1 && Math.abs((batches[1][0] - batches[0][0]) - 10) < 1.5,
  batches.length > 1 ? `${(batches[1][0] - batches[0][0]).toFixed(2)}s` : 'only one batch');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
