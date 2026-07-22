import { parse } from '../renderer/js/kv.js';
import { buildModel, SPAWNER_KEYS, parseSpawner } from '../renderer/js/popmodel.js';
import { spawners } from '../renderer/js/sim/spawners.js';
import { simulateBotAI } from '../renderer/js/botai.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const WIDE = 900, N = 6;
const corridor = n => {
  const a = [];
  for (let i = 0; i < n; i++) {
    const c = [];
    if (i > 0) c.push(i - 1);
    if (i < n - 1) c.push(i + 1);
    a.push({ id: i, nw: [i * 400, 0, 0], se: [(i + 1) * 400, WIDE, 0], neZ: 0, swZ: 0, connect: c, tfAttributes: 0 });
  }
  return a;
};
const AT = i => [i * 400 + 200, WIDE / 2, 0];
const mapData = {
  map: 'test_spawners', nav: { areas: corridor(N) },
  spawns: [{ name: 'spawnbot', origin: AT(0) }], redSpawns: [], flags: [],
  capzones: [AT(N - 1)], tracks: [], hints: [], navVolumes: [], pathProps: [],
  spawnRooms: [], bombPaths: []
};

const wrap = body => `WaveSchedule\n{\n\tWave\n\t{\n\t\tWaveSpawn\n\t\t{\n\t\t\tName w\n${body}\n\t\t}\n\t}\n}\n`;
const run = body => {
  const model = buildModel(parse(wrap(body)), []);
  const wave = model.waves[0];
  return simulateBotAI(wave, simulateWave(wave, { robotLimit: 99 }), mapData, { deathModel: 'hatch', robotLimit: 99 });
};
const IGNORE = 'Attributes IgnoreFlag';

check('every registered spawner id is in SPAWNER_KEYS',
  spawners.ids().every(id => SPAWNER_KEYS.has(id)) && SPAWNER_KEYS.size === spawners.size(),
  spawners.ids().join(',') + ' vs ' + [...SPAWNER_KEYS].join(','));
check('the registry covers the RafMod spawner kinds',
  ['botnpc', 'pointtemplate', 'halloweenboss'].every(id => spawners.has(id)));
check('an unknown block still parses as other',
  parseSpawner(parse('Mystery { Foo 1 }').children[0], new Map()).kind === 'other');
check('every entry declares a parse hook', spawners.ordered().every(e => typeof e.parse === 'function'));

const choice = run(`\t\t\tTotalCount 24\n\t\t\tMaxActive 24\n\t\t\tSpawnCount 1\n\t\t\tWhere spawnbot
			RandomChoice
			{
				TFBot { Class Scout ${IGNORE} }
				TFBot { Class Soldier ${IGNORE} }
				TFBot { Class Pyro ${IGNORE} }
			}`);
const order = choice.actors.map(a => a.bot.cls);
check('RandomChoice spawns the requested count', order.length === 24, 'got ' + order.length);
check('RandomChoice uses every option', new Set(order).size === 3, [...new Set(order)].join(','));

let cycles = 0;
for (let i = 3; i < order.length; i++) if (order[i] === order[i - 3]) cycles++;
check('RandomChoice does not round-robin its options', cycles < order.length - 3,
  cycles + '/' + (order.length - 3) + ' spawns repeat the option from 3 ago');

const repeats = order.filter((c, i) => i > 0 && c === order[i - 1]).length;
check('RandomChoice can pick the same option twice in a row', repeats > 0,
  'never repeated — that is a cycle, not a random pick');

const squad = run(`\t\t\tTotalCount 6\n\t\t\tMaxActive 6\n\t\t\tSpawnCount 2\n\t\t\tWhere spawnbot
			Squad
			{
				TFBot { Class Soldier ${IGNORE} }
				TFBot { Class Medic ${IGNORE} }
			}`);
const squadIds = new Set(squad.actors.map(a => a.squadId));
check('Squad spawns every member', squad.actors.length === 6, 'got ' + squad.actors.length);
check('Squad members are grouped into squads', squadIds.size === 3 && !squadIds.has(null),
  [...squadIds].join(','));
check('each squad is spawned with one leader and one follower',
  [...squadIds].every(id => {
    const members = squad.actors.filter(a => a.squadId === id);
    return members.length === 2 && members.filter(a => a.memberIdx === 0).length === 1;
  }));

const nested = run(`\t\t\tTotalCount 8\n\t\t\tMaxActive 8\n\t\t\tSpawnCount 1\n\t\t\tWhere spawnbot
			Squad
			{
				RandomChoice
				{
					TFBot { Class Scout ${IGNORE} }
					TFBot { Class Pyro ${IGNORE} }
				}
				TFBot { Class Medic ${IGNORE} }
			}`);
const perSquad = new Map();
for (const a of nested.actors) {
  if (!perSquad.has(a.squadId)) perSquad.set(a.squadId, []);
  perSquad.get(a.squadId).push(a.bot.cls);
}
check('a RandomChoice inside a Squad yields one pick per squad',
  [...perSquad.values()].every(m => m.length === 2 && m.includes('medic')),
  [...perSquad.values()].map(m => m.join('+')).join(' '));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
