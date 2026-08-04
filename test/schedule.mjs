import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateWave as scheduleWave } from '../renderer/js/sim.js';
import { simulateWave as runWave } from '../main/wavesim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const TF_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';
const MAPS = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannworks', 'mvm_rottenburg', 'mvm_bigrock'];
const SAMPLE_TOLERANCE = 0.25;

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip schedule tests: ents.wasm not built');
  process.exit(0);
}

const available = MAPS.filter(m => existsSync(`${TF_DIR}/maps/${m}.bsp`) && existsSync(join(repo, 'vanilla', `${m}.pop`)));
if (!available.length) {
  console.log('skip schedule tests: no MvM map plus shipped popfile available');
  process.exit(0);
}

let compared = 0;
for (const map of available) {
  const popPath = join(repo, 'vanilla', `${map}.pop`);
  const model = buildModel(parse(readFileSync(popPath, 'utf8')), []);
  const wave = model.waves[0];
  if (!wave || !wave.wavespawns.length) continue;

  const planned = scheduleWave(wave, { robotLimit: model.robotLimit || 22 });
  const actual = await runWave({
    bspPath: `${TF_DIR}/maps/${map}.bsp`, mapName: map, popShortName: map,
    popPath, popDir: join(repo, 'vanilla'), waveIndex: 0, seconds: 90, tfPath: TF_DIR
  });

  const firstSpawnByWs = new Map();
  for (const a of actual.actors || []) {
    if (a.wsIndex == null || a.wsIndex < 0) continue;
    const cur = firstSpawnByWs.get(a.wsIndex);
    if (cur == null || a.spawnT < cur) firstSpawnByWs.set(a.wsIndex, a.spawnT);
  }

  const worst = [];
  wave.wavespawns.forEach((ws, i) => {
    const observed = firstSpawnByWs.get(i);
    if (observed == null) return;
    const predicted = planned.results.get(ws).firstSpawn;
    const delta = Math.abs(observed - predicted);
    compared++;
    worst.push({ name: ws.name || `ws${i}`, predicted, observed, delta });
  });

  if (!worst.length) {
    console.log(`  ${map}: no wavespawn reached the simulated window`);
    continue;
  }
  const bad = worst.filter(w => w.delta > SAMPLE_TOLERANCE);
  check(`${map} wave 1 spawn times match Valve's population manager`,
    bad.length === 0,
    bad.map(b => `${b.name} predicted ${b.predicted.toFixed(2)} but the game spawned at ${b.observed.toFixed(2)}`).join('; '));
  const max = worst.reduce((a, b) => b.delta > a.delta ? b : a);
  console.log(`  ${map}: ${worst.length} wavespawns compared, worst drift ${max.delta.toFixed(3)}s on ${max.name}`);
}

check('the schedule was compared against a real run', compared > 0, `${compared} wavespawns compared`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
