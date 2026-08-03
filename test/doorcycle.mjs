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
const N = 30;
const AT = i => [i * 400 + 200, WIDE / 2, 0];
const areas = [];
for (let i = 0; i < N; i++) {
  const connect = [];
  if (i > 0) connect.push(i - 1);
  if (i < N - 1) connect.push(i + 1);
  areas.push({ id: i, nw: [i * 400, 0, 0], se: [(i + 1) * 400, WIDE, 0], neZ: 0, swZ: 0, connect, tfAttributes: 0 });
}

const DOOR_TRAVEL = 128;
const DOOR_SPEED = 64;
const GATE_X = 4000;

function mapWith(extra) {
  return {
    map: 'test_door', nav: { areas }, spawns: [{ name: 'spawnbot', origin: AT(0) }], redSpawns: [],
    flags: [AT(0)], capzones: [AT(N - 1)], tracks: [], hints: [],
    navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: [], breakables: [],
    doors: [], blockers: [], doorTriggers: [], doorOutputs: {},
    doorsAtMapSpawn: [], doorsAtWaveStart: [], blockersAtMapSpawn: [], blockersAtWaveStart: [],
    triggersAtWaveStart: [], pathGates: [], gates: [], filters: {}, prerequisites: [],
    ...extra
  };
}

const door = {
  model: 1, name: 'gate_door', cls: 'func_door', kind: 'linear',
  dir: [0, 0, 1], travel: DOOR_TRAVEL, speed: DOOR_SPEED, duration: DOOR_TRAVEL / DOOR_SPEED,
  wait: -1, autoReturn: false, touchOpens: false, solid: true, spawnFrac: 0,
  bounds: { mins: [GATE_X, 0, 0], maxs: [GATE_X + 32, WIDE, 200] }
};

const pop = `WaveSchedule
{
	Wave
	{
		WaveSpawn
		{
			Name	w
			TotalCount	4
			MaxActive	4
			SpawnCount	1
			WaitBetweenSpawns	2
			Where	spawnbot
			TFBot { Class Scout	Skill Normal }
		}
	}
}
`;

function runWith(mapData) {
  const wave = buildModel(parse(pop), []).waves[0];
  const sim = simulateWave(wave, { robotLimit: 22 });
  return simulateBotAI(wave, sim, mapData, { deathModel: 'hatch', teamDPS: 1, robotLimit: 22 });
}

{
  const ai = runWith(mapWith({
    doors: [door],
    doorsAtWaveStart: [{ door: 'gate_door', input: 'open', at: 5 }]
  }));
  const keys = ai.doors[0].keys;
  check('a door opened by the wave logic leaves a keyframe at the trigger time',
    keys.length >= 3 && Math.abs(keys[1].t - 5) < 0.26, JSON.stringify(keys));
  const arrive = keys[keys.length - 1];
  check('the door takes travel over speed to reach fully open',
    Math.abs(arrive.t - (keys[1].t + DOOR_TRAVEL / DOOR_SPEED)) < 1e-6 && arrive.frac === 1,
    JSON.stringify(arrive));
}

{
  const ai = runWith(mapWith({
    doors: [{ ...door, spawnFrac: 1 }],
    doorsAtWaveStart: [{ door: 'gate_door', input: 'close', at: 4 }]
  }));
  const keys = ai.doors[0].keys;
  check('a door that starts open closes back to zero when told to',
    keys[keys.length - 1].frac === 0 && keys[0].frac === 1, JSON.stringify(keys));
}

{
  const ai = runWith(mapWith({
    doors: [{ ...door, wait: 3, autoReturn: true }],
    doorsAtWaveStart: [{ door: 'gate_door', input: 'open', at: 2 }]
  }));
  const keys = ai.doors[0].keys;
  const open = keys.find(k => k.frac === 1);
  const shut = keys.slice(keys.indexOf(open) + 1).find(k => k.frac === 0);
  check('a door with a wait closes itself again once the wait elapses',
    !!open && !!shut && Math.abs(shut.t - (open.t + 3 + DOOR_TRAVEL / DOOR_SPEED)) < 0.3,
    JSON.stringify(keys));
}

{
  const ai = runWith(mapWith({
    doors: [door],
    doorsAtWaveStart: [{ door: 'gate_door', input: 'open', at: 3 }],
    doorOutputs: {
      gate_door: {
        onOpen: { props: [{ target: 'siren', effect: 'show', param: '', delay: 0 }], doors: [], blockers: [] },
        onFullyOpen: { props: [{ target: 'gate_prop', effect: 'kill', param: '', delay: 0 }], doors: [], blockers: [] }
      }
    }
  }));
  const fired = ai.propEvents.filter(e => e.name === 'gate_prop' || e.name === 'siren');
  const onOpen = fired.find(e => e.name === 'siren');
  const fully = fired.find(e => e.name === 'gate_prop');
  check('OnOpen fires the moment the door starts moving', !!onOpen && Math.abs(onOpen.at - 3) < 0.26,
    JSON.stringify(onOpen));
  check('OnFullyOpen fires only once the door has finished travelling',
    !!fully && fully.at > onOpen.at + DOOR_TRAVEL / DOOR_SPEED - 0.3, JSON.stringify(fully));
  check('a door that never reopens does not fire OnFullyOpen twice',
    fired.filter(e => e.name === 'gate_prop').length === 1);
}

{
  const blocked = runWith(mapWith({
    blockers: [{ name: 'wall', cls: 'func_brush', team: null, alwaysSolid: false, startDisabled: false,
      bounds: { mins: [GATE_X, -100, -100], maxs: [GATE_X + 16, WIDE + 100, 200] } }],
    blockersAtWaveStart: [{ blocker: 'wall', on: true, at: 0 }]
  }));
  const open = runWith(mapWith({
    blockers: [{ name: 'wall', cls: 'func_brush', team: null, alwaysSolid: false, startDisabled: false,
      bounds: { mins: [GATE_X, -100, -100], maxs: [GATE_X + 16, WIDE + 100, 200] } }],
    blockersAtWaveStart: [{ blocker: 'wall', on: false, at: 0 }]
  }));
  const past = ai => ai.actors.some(a => {
    if (!a.track) return false;
    for (let i = 0; i < a.track.length; i += 2) if (a.track[i] > GATE_X + 64) return true;
    return false;
  });
  check('an armed blocker stops robots crossing it', !past(blocked));
  check('the same blocker disabled lets them through', past(open));
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
