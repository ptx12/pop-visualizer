import { parse } from '../renderer/js/kv.js';
import { buildModel, SPAWNER_KEYS, parseSpawner, probeWaveSpawn } from '../renderer/js/popmodel.js';
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
  return simulateBotAI(wave, simulateWave(wave, { robotLimit: 99, teamDPS: 20 }), mapData, { deathModel: 'hatch', robotLimit: 99, teleporterBuildTime: 9.97 });
};
const teleAI = runSlow('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Engineer TeleportWhere spawnbot ' + IGNORE + ' }');
check('an engineer with TeleportWhere builds a teleporter', (teleAI.teleporters || []).length === 1, String((teleAI.teleporters || []).length));
check('a teleporter is tagged with the spawn it serves', (teleAI.teleporters[0] || { where: new Set() }).where.has('spawnbot'));
check('a teleporter is ready after the build time it was given, not a baked-in one',
  teleAI.teleporters.length === 1 && Math.abs(teleAI.teleporters[0].readyAt - (teleAI.teleporters[0].by.builtAtT ?? 0) - 9.97) < 1.01,
  String(teleAI.teleporters[0] && teleAI.teleporters[0].readyAt));
const noTele = runSlow('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Engineer ' + IGNORE + ' }');
check('an engineer without TeleportWhere builds none', (noTele.teleporters || []).length === 0);

const gatePop = [
  'WaveSchedule', '{', ' Wave', ' {',
  '  WaveSpawn { Name a TotalCount 4 SpawnCount 2 MaxActive 4 WaitBetweenSpawns 2 Where spawnbot',
  '   TFBot { Class Scout Tag bot_gatebot ' + IGNORE + ' } }',
  ' }', '}'
].join('\n');
const gateMapData = {
  ...mapData,
  spawns: [{ name: 'spawnbot', origin: AT(0) }, { name: 'spawnbot_fwd', origin: AT(N - 2), disabled: true }],
  gates: [{
    point: 'gate_a', label: 'Gate A', index: 1, origin: AT(2), capTime: 3, capCount: 1,
    startsLocked: false, previous: null, relay: 'gate1_relay',
    bounds: { mins: [AT(2)[0] - 200, 0, -64], maxs: [AT(2)[0] + 200, 900, 64] },
    effects: { pauseFor: 22, spawnsOn: [{ name: 'spawnbot_fwd', delay: 0 }], spawnsOff: [{ name: 'spawnbot', delay: 0 }] }
  }]
};
const gateModel = buildModel(parse(gatePop), []);
const gateAI = simulateBotAI(
  gateModel.waves[0],
  simulateWave(gateModel.waves[0], { robotLimit: 99, teamDPS: 20 }),
  gateMapData,
  { deathModel: 'hatch', robotLimit: 99 });
check('a gatebot heads for the gate', gateAI.actors.some(a => a.isGatebot && (a.gate || a.state === 'gatebotToGate')),
  gateAI.actors.map(a => a.state).join(','));
check('holding the gate for its capture time captures it', gateAI.gates[0].capturedAt !== null,
  'progress=' + gateAI.gates[0].progress.toFixed(1) + '/' + gateAI.gates[0].def.capTime);
const afterCap = gateAI.actors.filter(a => gateAI.gates[0].capturedAt !== null && a.spawnT > gateAI.gates[0].capturedAt);
check('robots spawning after the capture use the forward spawn',
  !afterCap.length || afterCap.every(a => Math.abs(a.spawnPos[0] - AT(N - 2)[0]) < 1),
  afterCap.map(a => Math.round(a.spawnPos[0])).join(','));

const gateRolePop = [
  'WaveSchedule', '{', ' Wave', ' {',
  '  WaveSpawn { Name a TotalCount 3 SpawnCount 3 MaxActive 3 Where spawnbot',
  '   Squad {',
  '    TFBot { Class Heavyweapons Tag bot_gatebot ' + IGNORE + ' }',
  '    TFBot { Class Medic Tag bot_gatebot ' + IGNORE + ' }',
  '    TFBot { Class Engineer Tag bot_gatebot ' + IGNORE + ' }',
  '   } }',
  ' }', '}'
].join('\n');
const gateRoleModel = buildModel(parse(gateRolePop), []);
const gateRoleAI = simulateBotAI(
  gateRoleModel.waves[0],
  simulateWave(gateRoleModel.waves[0], { robotLimit: 99, teamDPS: 20 }),
  gateMapData,
  { deathModel: 'hatch', robotLimit: 99 });
const roleOf = cls => (gateRoleAI.actors.find(a => a.bot && a.bot.cls === cls) || {}).state;
check('a gatebot medic still heals rather than running the gate', roleOf('medic') !== 'gatebotToGate', String(roleOf('medic')));
check('a gatebot engineer still builds rather than running the gate', roleOf('engineer') !== 'gatebotToGate', String(roleOf('engineer')));

check('capturing a gate pauses bot spawning for the relay window',
  Math.abs(gateAI.spawnPauseUntil - (gateAI.gates[0].capturedAt + 22)) < 1e-6,
  'pauseUntil=' + gateAI.spawnPauseUntil + ' cap=' + gateAI.gates[0].capturedAt);
check('no robot enters the map during the spawn pause',
  !gateAI.actors.some(a => a.spawnT > gateAI.gates[0].capturedAt && a.spawnT < gateAI.spawnPauseUntil - 1e-6),
  gateAI.actors.map(a => a.spawnT.toFixed(1)).join(','));

const deployAI = (() => {
  const model = buildModel(parse(wrap('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Scout }')), []);
  const wave = model.waves[0];
  const bombMap = { ...mapData, flags: [AT(0)] };
  return simulateBotAI(wave, simulateWave(wave, { robotLimit: 99, teamDPS: 20 }), bombMap,
    { deathModel: 'hatch', robotLimit: 99, deployBombTime: 4.5 });
})();
check('the bomb is delivered, not lost', deployAI.bomb.deliveredAt != null, String(deployAI.bomb.deliveredAt));
const deployEv = deployAI.actors.find(a => a.deployUntil != null);
check('the deploy hold uses the duration it was given, not a baked-in one',
  deployEv && Math.abs(deployAI.bomb.deliveredAt - deployEv.deployUntil) < 0.2,
  deployEv ? (deployEv.deployUntil + ' vs ' + deployAI.bomb.deliveredAt) : 'no deploy');

const tankKeys = body => buildModel(parse(wrap(body)), []).waves[0].wavespawns[0].bots.find(b => b.tank).tank;
const customTank = tankKeys('TotalCount 1 SpawnCount 1 MaxActive 1 Tank { Health 5000 Speed 75 Model "models/bots/boss_bot/boss_blimp.mdl" Skin 1 DisableSmokestack 1 Scale 1.5 }');
check('a Tank Model override is parsed', customTank.model === 'models/bots/boss_bot/boss_blimp.mdl', String(customTank.model));
check('a Tank Skin is parsed', customTank.skin === 1, String(customTank.skin));
check('DisableSmokestack is parsed', customTank.disableSmokestack === true, String(customTank.disableSmokestack));
check('a Tank Scale is parsed', customTank.scale === 1.5, String(customTank.scale));
const stockTank = tankKeys('TotalCount 1 SpawnCount 1 MaxActive 1 Tank { Health 5000 Speed 75 }');
check('a stock tank keeps its defaults', stockTank.model === null && stockTank.skin === 0 && stockTank.disableSmokestack === false,
  JSON.stringify([stockTank.model, stockTank.skin, stockTank.disableSmokestack]));

const sniperMap = { ...mapData, hints: [{ kind: 'bot_hint_sniper_spot', origin: AT(N - 3) }] };
const sniperAI = (() => {
  const model = buildModel(parse(wrap('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Sniper ' + IGNORE + ' }')), []);
  return simulateBotAI(model.waves[0], simulateWave(model.waves[0], { robotLimit: 99, teamDPS: 20 }), sniperMap, { deathModel: 'hatch', robotLimit: 99 });
})();
check('a sniper takes a sniper spot instead of the bomb route',
  sniperAI.actors.some(a => a.sniperSpot || a.state === 'sniperToSpot' || a.state === 'sniperLurk'),
  sniperAI.actors.map(a => a.state).join(','));
const noSpotAI = run('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Sniper ' + IGNORE + ' }');
check('a sniper on a map with no sniper spots falls back to normal behaviour',
  !noSpotAI.actors.some(a => a.state === 'sniperToSpot'), noSpotAI.actors.map(a => a.state).join(','));

const uberAttr = body => buildModel(parse(wrap(body)), []).waves[0].wavespawns[0].bots.find(b => b.bot && b.bot.cls === 'medic').bot;
const fastMed = uberAttr('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Medic ItemAttributes { ItemName "TF_WEAPON_MEDIGUN" "ubercharge rate bonus" 5 "uber duration bonus" -3 } }');
check('ubercharge rate bonus is read off the medigun', fastMed.uberRateMult === 5, String(fastMed.uberRateMult));
check('uber duration bonus is read off the medigun', fastMed.uberDurationAdd === -3, String(fastMed.uberDurationAdd));
const plainMed = uberAttr('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Medic }');
check('a medic with no uber attributes keeps stock values', plainMed.uberRateMult === 1 && plainMed.uberDurationAdd === 0);
const deadMed = uberAttr('TotalCount 1 SpawnCount 1 MaxActive 1 TFBot { Class Medic ItemAttributes { ItemName "TF_WEAPON_MEDIGUN" "ubercharge rate bonus" 0.01 } }');
check('a near-zero ubercharge rate is preserved, not clamped away', deadMed.uberRateMult === 0.01, String(deadMed.uberRateMult));

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

const engPop = [
  'WaveSchedule', '{', ' Wave', ' {',
  '  WaveSpawn { Name a TotalCount 2 SpawnCount 1 MaxActive 2 WaitBetweenSpawns 3 TFBot { Class Scout } }',
  ' }', '}'
].join('\n');
const engWave = buildModel(parse(engPop), []).waves[0];
const engProbe = probeWaveSpawn({ where: 'spawnbot', teleportWhere: ['spawnbot'] }, new Map());
const engMap = { ...mapData, hints: [{ kind: 'bot_hint_engineer_nest', origin: AT(N - 2) }] };
const engAI = simulateBotAI(
  engWave,
  simulateWave(engWave, { robotLimit: 99, teamDPS: 20, probes: [engProbe] }),
  engMap,
  { deathModel: 'hatch', robotLimit: 99 });
const eng = engAI.actors.find(a => a.ws && a.ws.isProbe);
check('a spawned test engineer becomes a map actor', !!eng, engAI.actors.map(a => a.state).join(','));
check('a spawned test engineer outlives the team damage model', eng && eng.dieT > eng.spawnT + 1, eng && String(eng.dieT));
check('an engineer walking to a nest hint reaches it and builds its teleporter',
  engAI.teleporters.length === 1, JSON.stringify(engAI.teleporters.map(t => t.pos)));
check('the built teleporter serves the spawn points it was given',
  engAI.teleporters.length === 1 && engAI.teleporters[0].where.has('spawnbot'));

const tpProbe = probeWaveSpawn({ where: 'spawnbot', teleportWhere: ['spawnbot'], attrs: ['TeleportToHint'] }, new Map());
const tpAI = simulateBotAI(
  engWave,
  simulateWave(engWave, { robotLimit: 99, teamDPS: 20, probes: [tpProbe] }),
  engMap,
  { deathModel: 'hatch', robotLimit: 99 });
const tpEng = tpAI.actors.find(a => a.ws && a.ws.isProbe);
check('a TeleportToHint engineer is spawned for the comparison', !!tpEng);
check('a TeleportToHint engineer waits instead of taking a nest ahead of the bomb',
  tpEng && !tpEng.nestHint && tpEng.nestWaiting === true,
  'nest=' + (tpEng && tpEng.nestHint ? tpEng.nestHint.name || 'unnamed' : 'none') + ' waiting=' + (tpEng && tpEng.nestWaiting));
check('a walking engineer is not blocked by that rule and still reaches a nest',
  eng && !eng.nestWaiting && engAI.teleporters.length === 1, 'waiting=' + (eng && eng.nestWaiting));
check('the waiting engineer keeps retrying on the 1-2s timer the game uses',
  tpEng && tpEng.nestRetryAt > 0 && tpEng.nestRetryAt <= tpEng.dieT + 2, String(tpEng && tpEng.nestRetryAt));

const noHintMap = { ...mapData, hints: [] };
const noHintAI = simulateBotAI(
  engWave,
  simulateWave(engWave, { robotLimit: 99, teamDPS: 20, probes: [engProbe] }),
  noHintMap,
  { deathModel: 'hatch', robotLimit: 99 });
check('an engineer on a map with no nest hints still builds rather than standing still',
  noHintAI.teleporters.length === 1, String(noHintAI.teleporters.length));

const noTeleProbe = probeWaveSpawn({ where: 'spawnbot', teleportWhere: [] }, new Map());
const noTeleAI = simulateBotAI(
  engWave,
  simulateWave(engWave, { robotLimit: 99, teamDPS: 20, probes: [noTeleProbe] }),
  engMap,
  { deathModel: 'hatch', robotLimit: 99 });
check('an engineer with no TeleportWhere builds nothing', noTeleAI.teleporters.length === 0,
  String(noTeleAI.teleporters.length));

const breakMap = {
  ...mapData,
  tracks: [
    { name: 'tpath_1', origin: [200, 450, 0], target: 'tpath_2' },
    { name: 'tpath_2', origin: [1000, 450, 0], target: 'tpath_3' },
    { name: 'tpath_3', origin: [1800, 450, 0], target: '' }
  ],
  breakables: [
    { node: 'tpath_2', target: 'barricade_intact', effect: 'kill', delay: 0 },
    { node: 'tpath_2', target: 'barricade_rubble', effect: 'show', delay: 0 },
    { node: 'tpath_2', target: 'barricade_rubble', effect: 'kill', delay: 7 },
    { node: 'never_passed', target: 'other_prop', effect: 'kill', delay: 0 }
  ]
};
const breakPop = `WaveSchedule { Wave { WaveSpawn { Name t TotalCount 1 MaxActive 1 SpawnCount 1 WaitBeforeStarting 3 Tank { Health 40000 Speed 100 StartingPathTrackNode tpath_1 } } } }`;
const breakWave = buildModel(parse(breakPop), []).waves[0];
const breakAI = simulateBotAI(breakWave, simulateWave(breakWave, {}), breakMap, { deathModel: 'hatch' });
const evs = breakAI.propEvents || [];
const broken = new Map(evs.filter(e => e.effect === 'kill').map(b => [b.name, b.at]));
check('a tank passing a path_track breaks what its outputs kill', broken.has('barricade_intact'), JSON.stringify(evs));
check('the break happens when the tank reaches that node, not at spawn',
  Math.abs(broken.get('barricade_intact') - (3 + 800 / 100)) < 0.6, String(broken.get('barricade_intact')));
check('an output delay pushes the break later', Math.abs(broken.get('barricade_rubble') - (broken.get('barricade_intact') + 7)) < 1e-6,
  String(broken.get('barricade_rubble')));
check('a node the tank never passes breaks nothing', !broken.has('other_prop'));

const noBreakAI = simulateBotAI(breakWave, simulateWave(breakWave, {}), { ...breakMap, breakables: [] }, { deathModel: 'hatch' });
check('a map with no breakable outputs reports none', (noBreakAI.propEvents || []).length === 0);
check('the rubble is shown the moment the intact prop dies',
  evs.some(e => e.effect === 'show' && e.name === 'barricade_rubble' && Math.abs(e.at - broken.get('barricade_intact')) < 1e-6),
  JSON.stringify(evs));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
