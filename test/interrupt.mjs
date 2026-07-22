import { parse } from '../renderer/js/kv.js';
import { buildModel, parsePoint } from '../renderer/js/popmodel.js';
import { buildTriggerGraph, analyzeWave, eventGate, isGated } from '../renderer/js/gating.js';
import { simulateBotAI, actorPosAt } from '../renderer/js/botai.js';
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
  tracks: [{ name: 'detour_node', origin: AT(9), target: '' }],
  hints: [], navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: []
};

function modelFor(text) {
  return buildModel(parse(text), []);
}

function runWave(model, opts = {}) {
  const wave = model.waves[0];
  const sim = simulateWave(wave, { robotLimit: model.robotLimit });
  return simulateBotAI(wave, sim, mapData, { deathModel: 'hatch', ...opts });
}

const POP_INTERRUPT = `WaveSchedule
{
	Wave
	{
		WaveSpawn
		{
			Name	w
			TotalCount	1
			MaxActive	1
			SpawnCount	1
			Where	spawnbot
			TotalCurrency	100
			TFBot
			{
				Class	Scout
				Skill	Easy
				InterruptAction
				{
					Target	"1100 150 40"
					Duration	30
					Delay	1
					Cooldown	5
					Repeats	1
					Distance	50
					WaitUntilDone	1
				}
			}
		}
	}
}
`;

const POP_PLAIN = POP_INTERRUPT.replace(/InterruptAction[\s\S]*?\n\t\t\t\t\}\n/, '');

// --- parsing ---
const mi = modelFor(POP_INTERRUPT);
const bot = mi.waves[0].wavespawns[0].bots[0].bot;
check('InterruptAction parsed', bot.interrupts.length === 1);
const ia = bot.interrupts[0];
check('coordinate Target becomes a point', JSON.stringify(ia.point) === '[1100,150,40]', JSON.stringify(ia.point));
check('Duration/Cooldown/Repeats/Distance read', ia.duration === 30 && ia.cooldown === 5 && ia.repeats === 1 && ia.distance === 50);
check('WaitUntilDone read as boolean', ia.waitUntilDone === true);
check('Delay defaults to 10 when absent', modelFor(POP_INTERRUPT.replace('Delay\t1\n', '')).waves[0].wavespawns[0].bots[0].bot.interrupts[0].delay === 10);
check('parsePoint rejects non-coordinates', parsePoint('controlpanel_baseboss') === null);
check('parsePoint accepts quoted triples', JSON.stringify(parsePoint('"750 -538 573"')) === '[750,-538,573]');

// --- the bot actually diverts ---
const withIA = runWave(mi);
const plain = runWave(modelFor(POP_PLAIN));
check('no InterruptAction parsed on the control popfile',
  modelFor(POP_PLAIN).waves[0].wavespawns[0].bots[0].bot.interrupts.length === 0);

const aIA = withIA.actors.find(a => a.kind === 'bot');
const aPlain = plain.actors.find(a => a.kind === 'bot');
check('both runs produced a bot', !!aIA && !!aPlain);

function nearestApproach(a, target) {
  let best = Infinity;
  for (let i = 0; i + 1 < a.track.length; i += 2) {
    const d = Math.hypot(a.track[i] - target[0], a.track[i + 1] - target[1]);
    if (d < best) best = d;
  }
  return best;
}
function dwellNear(a, target, radius) {
  let n = 0;
  for (let i = 0; i + 1 < a.track.length; i += 2) {
    if (Math.hypot(a.track[i] - target[0], a.track[i + 1] - target[1]) <= radius) n++;
  }
  return n;
}

const T = [1100, 150];
const dwellIA = dwellNear(aIA, T, 120);
const dwellPlain = dwellNear(aPlain, T, 120);
check('interrupted bot lingers at the target, the control does not',
  dwellIA > dwellPlain * 3 && dwellIA > 20, `interrupted ${dwellIA} steps vs control ${dwellPlain}`);
check('interrupted bot reaches within Distance of the target',
  nearestApproach(aIA, T) <= 60, 'closest ' + nearestApproach(aIA, T).toFixed(1));

const OBJ = [mapData.capzones[0][0], mapData.capzones[0][1]];
const plainReach = nearestApproach(aPlain, OBJ);
const iaReach = nearestApproach(aIA, OBJ);
check('the control bot still runs the objective', plainReach < 260, 'closest ' + plainReach.toFixed(1));
check('the interrupted bot resumes and reaches the objective too', iaReach < 260, 'closest ' + iaReach.toFixed(1));
check('actorPosAt works on the interrupted track', !!actorPosAt(aIA, aIA.spawnT + 5));

// --- teleport ---
const POP_TP = POP_PLAIN.replace('Skill\tEasy', `Skill\tEasy
				FireInput
				{
					Target	"!activator"
					Action	"$SetLocalOrigin"
					Param	"1900 150 72"
					Delay	2
				}`);
const mt = modelFor(POP_TP);
const tbot = mt.waves[0].wavespawns[0].bots[0].bot;
check('teleport action parsed', tbot.teleports.length === 1 && tbot.teleports[0].teleport.kind === 'point');
check('teleport point read', JSON.stringify(tbot.teleports[0].teleport.point) === '[1900,150,72]');
const tp = runWave(mt);
const aTP = tp.actors.find(a => a.kind === 'bot');
let jumped = false;
for (let i = 2; i + 1 < aTP.track.length; i += 2) {
  if (Math.hypot(aTP.track[i] - aTP.track[i - 2], aTP.track[i + 1] - aTP.track[i - 1]) > 400) jumped = true;
}
check('teleport moves the bot in one step', jumped);

const POP_TP_ENT = POP_TP.replace('"$SetLocalOrigin"', '"$TeleportToEntity"').replace('"1900 150 72"', '"detour_node"');
const ment = modelFor(POP_TP_ENT);
check('entity teleport parsed as entity',
  ment.waves[0].wavespawns[0].bots[0].bot.teleports[0].teleport.entity === 'detour_node');

// --- event-driven gating ---
const POP_EVENT = `WaveSchedule
{
	Wave
	{
		WaveSpawn
		{
			Name	killer
			TotalCount	1
			MaxActive	1
			SpawnCount	1
			Where	spawnbot
			TotalCurrency	100
			TFBot
			{
				Class	Soldier
				OnKilledOutput
				{
					Target	"gate_relay"
					Action	"Trigger"
				}
			}
		}
		WaveSpawn
		{
			Name	late
			TotalCount	1
			MaxActive	1
			SpawnCount	1
			Where	spawnbot_late
			TotalCurrency	100
			TFBot
			{
				Class	Scout
			}
		}
	}
	Templates
	{
	}
	PointTemplates
	{
		gate
		{
			logic_relay
			{
				"targetname"	"gate_relay"
				"OnTrigger"	"spawnbot_late,Enable,,0,-1"
			}
			logic_auto
			{
				"targetname"	"boot"
				"OnMapSpawn"	"spawnbot_late,Disable,,0,-1"
			}
		}
	}
}
`;
const me = modelFor(POP_EVENT);
const tg = buildTriggerGraph(parse(POP_EVENT));
check('event outputs collected into the graph', tg.events.length === 1 && tg.events[0].event === 'onkilledoutput');
const g = analyzeWave(me.waves[0], tg);
const lateWs = me.waves[0].wavespawns.find(w => w.name === 'late');
const lateGate = g.get(lateWs);
check('spawn point disabled at boot is detected', !!lateGate.whereDisabled);
check('wavespawn is gated', isGated(lateGate));
const eg = eventGate(lateGate);
check('gate is attributed to the runtime event', !!eg && /bot dying/.test(eg.why || ''), JSON.stringify(eg));
check('the firing entity is named', !!eg && !!eg.by);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
