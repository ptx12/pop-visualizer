import { parse } from '../renderer/js/kv.js';
import { buildModel, SPAWNER_KEYS, parseSpawner } from '../renderer/js/popmodel.js';
import { spawners } from '../renderer/js/sim/spawners.js';
import { simulateBotAI, actorPosAt } from '../renderer/js/botai.js';
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

const withProps = run(`\t\t\tTotalCount 1\n\t\t\tMaxActive 1\n\t\t\tSpawnCount 1\n\t\t\tWhere spawnbot
			SentryGun { TeamNum 2 Level 3 }`);
const sentry = withProps.actors.find(a => a.kind === 'prop');
check('a SentryGun becomes a prop actor in the sim', !!sentry, 'kinds ' + withProps.actors.map(a => a.kind).join(','));
check('the sentry carries its team and icon', sentry && sentry.prop.team === 2 && sentry.prop.icon === 'sentry_3',
  sentry && JSON.stringify([sentry.prop.team, sentry.prop.icon]));
check('the sentry holds position for its whole life', sentry &&
  sentry.track.length >= 4 && sentry.track[0] === sentry.track[sentry.track.length - 2] &&
  sentry.track[1] === sentry.track[sentry.track.length - 1]);
check('a sentry is not a robot and never counts against the limit', (() => {
  const many = run(`\t\t\tTotalCount 30\n\t\t\tMaxActive 30\n\t\t\tSpawnCount 1\n\t\t\tWhere spawnbot\n\t\t\tSentryGun { TeamNum 2 Level 1 }`);
  return many.actors.filter(a => a.kind === 'prop').length === 30;
})());

const bossPop = `WaveSchedule { Wave { WaveSpawn { Name b TotalCount 1 MaxActive 1 SpawnCount 1 HalloweenBoss { BossType HHH ClassIcon horsemann_lite Health 25000 Origin "300 450 0" } } } }`;
const bossModel = buildModel(parse(bossPop), []);
const bossWave = bossModel.waves[0];
const bossAi = simulateBotAI(bossWave, simulateWave(bossWave, { robotLimit: 22 }), mapData, { deathModel: 'hatch', robotLimit: 22 });
const boss = bossAi.actors.find(a => a.kind === 'prop');
check('a HalloweenBoss becomes a prop actor', !!boss);
check('the boss spawns at its Origin, not a spawn point', boss &&
  Math.abs(boss.track[0] - 300) < 1 && Math.abs(boss.track[1] - 450) < 1,
  boss && [boss.track[0], boss.track[1]].join(','));
check('the boss keeps its parsed health', boss && boss.prop.health === 25000, boss && String(boss.prop.health));
check('the boss contributes its HP to the wavespawn total',
  bossWave.wavespawns[0].bots[0].other.health === 25000);

const runPop = (pop, opts = {}) => {
  const model = buildModel(parse(pop), []);
  const wave = model.waves[0];
  return { model, ai: simulateBotAI(wave, simulateWave(wave, { robotLimit: 22 }), mapData, {
    deathModel: 'hatch', robotLimit: 22,
    extraSpawnPoints: model.extraSpawnPoints, extraTankPaths: model.extraTankPaths, ...opts
  }) };
};

const esp = runPop(`WaveSchedule { ExtraSpawnPoint { Name custom_pt TeamNum 3 X 1600 Y 700 Z 0 }
  Wave { WaveSpawn { Name w TotalCount 1 MaxActive 1 SpawnCount 1 Where custom_pt TFBot { Class Heavyweapons Attributes IgnoreFlag } } } }`);
check('ExtraSpawnPoint parses its origin', esp.model.extraSpawnPoints.length === 1 && esp.model.extraSpawnPoints[0].origin[0] === 1600);
const espBot = esp.ai.actors[0];
check('a bot with Where <ExtraSpawnPoint> spawns at that popfile point',
  espBot && Math.abs(espBot.track[0] - 1600) < 80 && Math.abs(espBot.track[1] - 700) < 80,
  espBot && [espBot.track[0], espBot.track[1]].map(Math.round).join(','));

const imm = runPop(`WaveSchedule { Wave { WaveSpawn { Name t TotalCount 1 MaxActive 1 SpawnCount 1
  Tank { Health 40000 Speed 90 StartingPathTrackNode nonexistent Immobile 1 } } } }`, { deathModel: 'lifetime' });
const immTank = imm.ai.actors[0];
check('an Immobile tank is parsed', imm.model.waves[0].wavespawns[0].bots[0].tank.immobile === true);
check('an Immobile tank does not move', immTank &&
  Math.hypot(immTank.track[immTank.track.length - 2] - immTank.track[0], immTank.track[immTank.track.length - 1] - immTank.track[1]) < 5);

const etp = runPop(`WaveSchedule { ExtraTankPath { Name route Node "200 450 0" Node "1000 450 0" Node "1800 450 0" }
  Wave { WaveSpawn { Name t TotalCount 1 MaxActive 1 SpawnCount 1 Tank { Health 40000 Speed 120 StartingPathTrackNode route } } } }`);
check('ExtraTankPath parses its nodes', etp.model.extraTankPaths.length === 1 && etp.model.extraTankPaths[0].nodes.length === 3);
const etpTank = etp.ai.actors[0];
check('a tank on an ExtraTankPath follows the popfile route',
  etpTank && etpTank.track[etpTank.track.length - 2] > etpTank.track[0] + 500,
  etpTank && [etpTank.track[0], etpTank.track[etpTank.track.length - 2]].map(Math.round).join('->'));

const wide = { ...mapData, spawns: [{ name: 'spawnbot', origin: [200, 450, 0] }] };
const runRoot = root => {
  const model = buildModel(parse(`WaveSchedule { ${root} Wave { WaveSpawn { Name w TotalCount 10 MaxActive 10 SpawnCount 10 Where spawnbot TFBot { Class Heavyweapons Attributes IgnoreFlag } } } }`), []);
  const w = model.waves[0];
  return { model, ai: simulateBotAI(w, simulateWave(w, { robotLimit: 99 }), wide, { deathModel: 'hatch', robotLimit: 99, botPushaway: model.botPushaway, flagCarrierPenalty: model.flagCarrierPenalty, maxSpeedLimit: model.maxSpeedLimit }) };
};
const meanNN = ai => {
  const p = ai.actors.map(a => actorPosAt(a, 4)).filter(Boolean);
  let s = 0, n = 0;
  for (let i = 0; i < p.length; i++) { let nn = Infinity; for (let j = 0; j < p.length; j++) if (i !== j) nn = Math.min(nn, Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1])); if (nn < Infinity) { s += nn; n++; } }
  return n ? s / n : 0;
};
check('BotPushaway defaults to on', runRoot('').model.botPushaway === true);
check('BotPushaway 0 is parsed off', runRoot('BotPushaway 0').model.botPushaway === false);
check('BotPushaway 0 disables separation (bots stack)', meanNN(runRoot('BotPushaway 0').ai) < meanNN(runRoot('').ai) / 2);
check('FlagCarrierMovementPenalty overrides the carrier penalty', runRoot('FlagCarrierMovementPenalty 0.9').model.flagCarrierPenalty === 0.9);
check('FlagCarrierMovementPenalty defaults to 0.5', runRoot('').model.flagCarrierPenalty === 0.5);
check('MaxSpeedLimit overrides the speed cap', runRoot('MaxSpeedLimit 800').model.maxSpeedLimit === 800);
check('MaxSpeedLimit defaults to 520', runRoot('').model.maxSpeedLimit === 520);


const runDamage = body => {
  const model = buildModel(parse(wrap(body)), []);
  const wave = model.waves[0];
  return simulateBotAI(wave, simulateWave(wave, { robotLimit: 99 }), mapData, { deathModel: 'damage', robotLimit: 99, teamDPS: 400 });
};
const uberAI = runDamage('TotalCount 2 SpawnCount 2 MaxActive 2 Squad { TFBot { Class Heavyweapons } TFBot { Class Medic Attributes SpawnWithFullCharge } }');
check('a medic with a full charge ubers its patient when it is hurt', uberAI.actors.some(a => a.uberUntil > 0));
const plainAI = runDamage('TotalCount 2 SpawnCount 2 MaxActive 2 Squad { TFBot { Class Heavyweapons } TFBot { Class Scout } }');
check('a squad with no medic never ubers', !plainAI.actors.some(a => a.uberUntil > 0));



const runSlow = body => {
  const model = buildModel(parse(wrap(body)), []);
  const wave = model.waves[0];
  return simulateBotAI(wave, simulateWave(wave, { robotLimit: 99, teamDPS: 20 }), mapData, { deathModel: 'hatch', robotLimit: 99 });
};
const teleAI = runSlow('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Engineer TeleportWhere spawnbot ' + IGNORE + ' }');
check('an engineer with TeleportWhere builds a teleporter', (teleAI.teleporters || []).length === 1, String((teleAI.teleporters || []).length));
check('a teleporter is tagged with the spawn it serves', (teleAI.teleporters[0] || { where: new Set() }).where.has('spawnbot'));
const noTele = runSlow('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Engineer ' + IGNORE + ' }');
check('an engineer without TeleportWhere builds none', (noTele.teleporters || []).length === 0);

const busterPop = [
  'WaveSchedule', '{',
  ' Mission', ' {',
  '  Objective DestroySentries', '  InitialCooldown 1', '  CooldownTime 30',
  '  DesiredCount 1', '  BeginAtWave 1', '  RunForThisManyWaves 1', '  Where spawnbot',
  '  TFBot { Class Demoman }', ' }',
  ' Wave', ' {',
  '  WaveSpawn { Name a TotalCount 4 SpawnCount 1 MaxActive 4 WaitBetweenSpawns 3 TFBot { Class Scout } }',
  ' }', '}'
].join('\n');
const busterModel = buildModel(parse(busterPop), []);
const busterWave = busterModel.waves[0];
const nestMap = { ...mapData, hints: [{ kind: 'bot_hint_engineer_nest', origin: AT(N - 2) }] };
const busterAI = simulateBotAI(
  busterWave,
  simulateWave(busterWave, { robotLimit: 99, teamDPS: 20, missions: busterModel.missions }),
  nestMap,
  { deathModel: 'hatch', robotLimit: 99 });
const busters = busterAI.actors.filter(a => a.ws && a.ws.isMission);
check('sentry busters exist as map actors', busters.length > 0, String(busters.length));
check('a sentry buster goes for the sentry nest, not the hatch',
  busters.some(a => a.state === 'busterToSentry' || a.reachedSentry), busters.map(a => a.state).join(','));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
