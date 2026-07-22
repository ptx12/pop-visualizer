import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateBotAI, actorPosAt, actorZAt, STEP } from '../renderer/js/botai.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const WIDE = 900;
const HULL = 48;

function corridor(n, z, idBase) {
  const areas = [];
  for (let i = 0; i < n; i++) {
    const connect = [];
    if (i > 0) connect.push(idBase + i - 1);
    if (i < n - 1) connect.push(idBase + i + 1);
    areas.push({
      id: idBase + i,
      nw: [i * 400, 0, z],
      se: [(i + 1) * 400, WIDE, z],
      neZ: z, swZ: z,
      connect, tfAttributes: 0
    });
  }
  return areas;
}

const N = 8;
const AT = (i, z) => [i * 400 + 200, WIDE / 2, z];

function mapWith(areas, spawns) {
  return {
    map: 'test_sep', nav: { areas }, spawns, redSpawns: [],
    flags: [], capzones: [AT(N - 1, 0)], tracks: [], hints: [],
    navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: []
  };
}

const bot = 'TFBot { Class Heavyweapons	Skill Normal	Attributes IgnoreFlag }';
const spawnBlock = (name, where, count) => `
		WaveSpawn
		{
			Name	${name}
			TotalCount	${count}
			MaxActive	${count}
			SpawnCount	${count}
			Where	${where}
			${bot}
		}`;
const popOf = (...blocks) => `WaveSchedule\n{\n\tWave\n\t{${blocks.join('')}\n\t}\n}\n`;

function run(mapData, pop) {
  const model = buildModel(parse(pop), []);
  const wave = model.waves[0];
  const sim = simulateWave(wave, { robotLimit: 99 });
  return simulateBotAI(wave, sim, mapData, { deathModel: 'hatch', robotLimit: 99 });
}

function spacing(ai, t) {
  const pts = [];
  for (const a of ai.actors) {
    if (a.kind !== 'bot' || t < a.spawnT || t > a.dieT) continue;
    const p = actorPosAt(a, t);
    if (p) pts.push(p);
  }
  let sum = 0, n = 0, tight = 0;
  for (let i = 0; i < pts.length; i++) {
    let nn = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      nn = Math.min(nn, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
    if (nn === Infinity) continue;
    sum += nn; n++;
    if (nn < HULL / 2) tight++;
  }
  return { mean: n ? sum / n : 0, tight: n ? tight / n : 0, count: pts.length };
}

const flat = mapWith(corridor(N, 0, 0), [{ name: 'spawnbot', origin: AT(0, 0) }]);
const crowd = run(flat, popOf(spawnBlock('w', 'spawnbot', 12)));

check('every bot spawned', crowd.actors.length === 12, 'got ' + crowd.actors.length);

const early = spacing(crowd, 4);
check('12 bots spawned on one point are all alive early', early.count === 12, 'alive ' + early.count);
check('a crowd from one spawn point fans out past half a hull width',
  early.mean > HULL / 2, 'mean nearest-neighbour ' + early.mean.toFixed(1) + 'u');
const piled = spacing(crowd, 0.5);
check('they start out piled on the spawn point', piled.mean < HULL / 4,
  'mean nearest-neighbour ' + piled.mean.toFixed(1) + 'u at t=0.5');
check('the pile measurably disperses', early.tight < piled.tight * 0.75,
  (piled.tight * 100).toFixed(0) + '% within half a hull at t=0.5 vs ' + (early.tight * 100).toFixed(0) + '% at t=4');

const mid = spacing(crowd, 10);
check('the spacing holds while the crowd walks', mid.mean > HULL / 2,
  'mean nearest-neighbour ' + mid.mean.toFixed(1) + 'u at t=10');

const solo = run(flat, popOf(spawnBlock('w', 'spawnbot', 1)));
const lone = solo.actors[0];
let strayed = 0;
for (let i = 2; i < lone.track.length; i += 2) {
  if (Math.abs(lone.track[i + 1] - lone.track[1]) > 40) strayed++;
}
check('a lone bot is not pushed sideways by nobody', strayed === 0, strayed + ' samples off its lane');

const holds = (ar, x, y) => x >= ar.nw[0] - 0.01 && x <= ar.se[0] + 0.01 && y >= ar.nw[1] - 0.01 && y <= ar.se[1] + 0.01;
let offMesh = 0;
for (const a of crowd.actors) {
  for (let i = 0; i < a.track.length; i += 2) {
    if (!flat.nav.areas.some(ar => holds(ar, a.track[i], a.track[i + 1]))) offMesh++;
  }
}
check('separation never pushes a bot off the mesh', offMesh === 0, offMesh + ' off-mesh samples');

check('actor height is recorded per step',
  crowd.actors.every(a => a.ztrack && a.ztrack.length === a.track.length / 2), 'ztrack length mismatch');

const twoFloors = mapWith(
  [...corridor(N, 0, 0), ...corridor(N, 600, 100)],
  [{ name: 'spawnbot', origin: AT(0, 0) }, { name: 'spawnbot_upper', origin: AT(0, 600) }]
);
const gap = (ai, t) => {
  const p = ai.actors.map(a => actorPosAt(a, t)).filter(Boolean);
  return p.length === 2 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : NaN;
};

const sameFloor = run(twoFloors, popOf(spawnBlock('a', 'spawnbot', 2)));
const crossFloor = run(twoFloors, popOf(spawnBlock('a', 'spawnbot', 1), spawnBlock('b', 'spawnbot_upper', 1)));

check('the same-floor pair both spawned', sameFloor.actors.length === 2);
check('the cross-floor pair both spawned', crossFloor.actors.length === 2);
const zs = crossFloor.actors.map(a => actorZAt(a, a.spawnT + 1));
check('the cross-floor pair really is on two floors', Math.abs(zs[0] - zs[1]) > 400,
  'z ' + zs.map(z => Math.round(z)).join(' / '));

const sameGap = gap(sameFloor, 1);
const crossGap = gap(crossFloor, 1);
check('two bots on one floor shove each other apart', sameGap > 30,
  'they are ' + sameGap.toFixed(1) + 'u apart after a second');
check('two bots on different floors pass straight through each other', crossGap < sameGap / 2,
  'cross-floor gap ' + crossGap.toFixed(1) + 'u vs same-floor ' + sameGap.toFixed(1) + 'u — the z gate is not doing anything');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
