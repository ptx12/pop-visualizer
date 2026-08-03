import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateBotAI } from '../renderer/js/botai.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const WIDE = 900;
const N = 40;
const AT = i => [i * 400 + 200, WIDE / 2, 0];
const areas = [];
for (let i = 0; i < N; i++) {
  const connect = [];
  if (i > 0) connect.push(i - 1);
  if (i < N - 1) connect.push(i + 1);
  areas.push({ id: i, nw: [i * 400, 0, 0], se: [(i + 1) * 400, WIDE, 0], neZ: 0, swZ: 0, connect, tfAttributes: 0 });
}
const mapData = {
  map: 'test_bomb', nav: { areas }, spawns: [{ name: 'spawnbot', origin: AT(0) }], redSpawns: [],
  flags: [AT(0)], capzones: [AT(N - 1)], tracks: [], hints: [],
  navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: [], breakables: []
};
const pop = `WaveSchedule
{
	Wave
	{
		WaveSpawn
		{
			Name	w
			TotalCount	12
			MaxActive	3
			SpawnCount	1
			WaitBetweenSpawns	4
			Where	spawnbot
			TFBot { Class Scout	Skill Normal }
		}
	}
}
`;

function runAt(teamDPS) {
  const model = buildModel(parse(pop), []);
  const wave = model.waves[0];
  const sim = simulateWave(wave, { robotLimit: 99 });
  return simulateBotAI(wave, sim, mapData, { deathModel: 'damage', teamDPS, robotLimit: 99 }).bomb.log;
}

const calm = runAt(90);
let ooo = 0, prev = -Infinity;
for (const e of calm) { if (e.t < prev - 1e-9) ooo++; prev = e.t; }
check('the bomb log stays in time order so the HUD scan can stop at the first later entry', ooo === 0, ooo + ' out of order');

const charges = calm.filter(e => e.kind === 'charge');
const upgrades = calm.filter(e => e.kind === 'upgrade');
check('a carrier that survives reaches all three upgrade levels',
  upgrades.map(u => u.level).join(',') === '1,2,3', upgrades.map(u => u.level).join(','));
check('every upgrade below the cap is preceded by a charge window the HUD can fill',
  charges.length === 3, charges.length + ' charge windows');

const windows = charges.map(c => +(c.at - c.from).toFixed(2));
check('charge windows match the game intervals 5 / 15 / 15 and exclude the taunt',
  windows.join(',') === '5,15,15', windows.join(','));

for (const u of upgrades.slice(0, 2)) {
  const next = charges.find(c => c.from >= u.t);
  check('the level ' + u.level + ' charge window starts only once the taunt is over',
    !!next && Math.abs(next.from - u.tauntUntil) < 1e-6,
    next ? 'from ' + next.from.toFixed(2) + ' taunt ends ' + u.tauntUntil.toFixed(2) : 'no window');
}

const churn = runAt(260);
const pickups = churn.filter(e => e.kind === 'pickup');
check('carrier turnover happens in the churn run so the next check is meaningful', pickups.length > 1, pickups.length + ' pickups');
const uncharged = pickups.filter(p => !churn.some(c => c.kind === 'charge' && c.from >= p.t && c.from < p.t + 1));
check('every carrier gets a charge window, not just the first',
  uncharged.length === 0, uncharged.length + ' of ' + pickups.length + ' pickups never charged');

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
