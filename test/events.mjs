import { createEventBus, seedWaveEvents } from '../renderer/js/sim/events.js';
import { waveStartOutputs, wavespawnOutputs } from '../renderer/js/gating.js';
import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateWave } from '../renderer/js/sim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const bus = createEventBus();
const seen = [];
bus.on('Trigger', e => seen.push('trigger:' + e.target));
bus.on('enable', e => seen.push('enable:' + e.target));
bus.on('*', e => seen.push('any:' + e.input));

bus.schedule(10, { target: 'late', input: 'Trigger' });
bus.schedule(2, { target: 'early', input: 'Trigger' });
bus.schedule(5, { target: 'vol', input: 'Enable' });

check('nothing fires before its time', bus.drain(1) === 0 && seen.length === 0);
check('pending counts the queue', bus.pending() === 3, String(bus.pending()));

bus.drain(2);
check('an event fires at its scheduled time', seen.includes('trigger:early'), seen.join(','));
check('the wildcard listener also sees it', seen.includes('any:Trigger'));

bus.drain(6);
check('input matching is case-insensitive', seen.includes('enable:vol'), seen.join(','));
check('later events stay queued', bus.pending() === 1, String(bus.pending()));

bus.drain(100);
check('draining past the end fires the rest', bus.pending() === 0 && seen.includes('trigger:late'));
check('fired() counts every delivery', bus.fired() === 3, String(bus.fired()));

const ordered = createEventBus();
const order = [];
ordered.on('*', e => order.push(e.target));
ordered.schedule(5, { target: 'b', input: 'Trigger' });
ordered.schedule(5, { target: 'a', input: 'Trigger' });
ordered.schedule(1, { target: 'first', input: 'Trigger' });
ordered.drain(10);
check('events fire in time order, ties by insertion', order.join(',') === 'first,b,a', order.join(','));

const off = createEventBus();
let hits = 0;
const unsub = off.on('Trigger', () => hits++);
off.schedule(1, { target: 'x', input: 'Trigger' });
off.drain(1);
unsub();
off.schedule(2, { target: 'y', input: 'Trigger' });
off.drain(2);
check('unsubscribing stops delivery', hits === 1, String(hits));

const emitted = createEventBus();
let direct = null;
emitted.on('Kill', e => { direct = e.target; });
emitted.emit({ target: 'now', input: 'Kill' });
check('emit() delivers immediately', direct === 'now');

check('a malformed schedule is ignored', (() => {
  const b = createEventBus();
  return b.schedule(NaN, { target: 'x', input: 'Trigger' }) === null && b.pending() === 0;
})());

const POP = `WaveSchedule
{
	Wave
	{
		StartWaveOutput { Target wave_start_relay  Action Trigger }
		WaveSpawn
		{
			Name early
			TotalCount 2
			MaxActive 2
			SpawnCount 1
			WaitBetweenSpawns 5
			Where spawnbot
			FirstSpawnOutput { Target siren  Action Trigger }
			DoneOutput { Target cleanup  Action Trigger  Delay 3 }
			TFBot { Class Heavyweapons }
		}
	}
}`;
const model = buildModel(parse(POP), []);
const wave = model.waves[0];
const sim = simulateWave(wave, { robotLimit: 22 });
const seeded = createEventBus();
const count = seedWaveEvents(seeded, wave, sim, { waveStartOutputs, wavespawnOutputs });
const up = seeded.upcoming();
check('wave and wavespawn outputs are all scheduled', count === 3, String(count));
check('StartWaveOutput is scheduled at wave start',
  up.some(e => e.target === 'wave_start_relay' && e.t === 0), JSON.stringify(up.map(e => [e.target, e.t])));
check('FirstSpawnOutput uses the first spawn time', (() => {
  const e = up.find(x => x.target === 'siren');
  const r = sim.results.get(wave.wavespawns[0]);
  return e && e.t === r.firstSpawn;
})());
check('DoneOutput adds its own Delay to the finish time', (() => {
  const e = up.find(x => x.target === 'cleanup');
  const r = sim.results.get(wave.wavespawns[0]);
  return e && Math.abs(e.t - (r.deathEnd + 3)) < 1e-9;
})());
check('scheduled events name the wavespawn that fired them',
  up.filter(e => e.target !== 'wave_start_relay').every(e => e.source === 'early'),
  up.map(e => e.source).join(','));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
