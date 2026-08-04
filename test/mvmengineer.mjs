import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateWave } from '../main/wavesim.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const TF_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';
const MAP = 'mvm_decoy';
const OBJ_DISPENSER = 0, OBJ_TELEPORTER = 1, OBJ_SENTRYGUN = 2;

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip engineer tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`)) {
  console.log(`skip engineer tests: ${MAP} not available`);
  process.exit(0);
}

const base = {
  bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: MAP,
  popPath: join(repo, 'vanilla', `${MAP}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds: 90, tfPath: TF_DIR
};

const plain = await simulateWave(base);
check('the map carries engineer nest hints for the bot to choose from',
  plain.engineers && plain.engineers.nests > 0, `${plain.engineers ? plain.engineers.nests : 0} nests`);
check('a wave with no engineer probe builds nothing on the invader team',
  (plain.buildings || []).filter(b => b.team === 3).length === 0,
  `${(plain.buildings || []).length} objects`);

const walker = plain.actors.find(a => a.kind === 'bot' && a.track.length > 20);
check('a robot path is available to site the probe on', !!walker);
if (!walker) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const spot = walker.track[Math.floor(walker.track.length * 0.25)];
const run = await simulateWave({ ...base, engineers: [[spot[1], spot[2], spot[3] + 8]] });

console.log('\nthe probe reaches the ported simulation');
check('the engineer probe was accepted and spawned',
  run.engineers && run.engineers.requested === 1 && run.engineers.spawned === 1,
  JSON.stringify(run.engineers));

const engineers = run.actors.filter(a => a.kind === 'bot' && a.cls === 'engineer');
check('the engineer appears in the sampled actors', engineers.length >= 1,
  `${engineers.length} engineers of ${run.actors.length} actors`);

const eng = engineers[0];
if (eng) {
  const moved = eng.track.length > 1
    ? Math.hypot(eng.track[eng.track.length - 1][1] - eng.track[0][1],
                 eng.track[eng.track.length - 1][2] - eng.track[0][2])
    : 0;
  check('the engineer walks off toward a nest instead of standing still', moved > 100,
    `travelled ${moved.toFixed(0)} units`);
}

console.log('\nit builds what an MvM engineer builds');
const built = (run.buildings || []).filter(b => b.team === 3);
check('the engineer put buildings on the invader team', built.length > 0,
  `${built.length} invader objects`);

const sentries = built.filter(b => b.type === OBJ_SENTRYGUN);
const teleporters = built.filter(b => b.type === OBJ_TELEPORTER);
check('a sentry gun was placed', sentries.length > 0, `${sentries.length} sentries`);
check('a teleporter exit was placed', teleporters.length > 0, `${teleporters.length} teleporters`);
check('the sentry finished building rather than staying a blueprint',
  sentries.some(s => s.builtT !== null), sentries.map(s => s.builtT).join(', '));
check('the sentry reached the level Valve gives an MvM engineer nest',
  sentries.some(s => s.level >= 2), sentries.map(s => `lvl${s.level}`).join(' '));

console.log('\nthe rest of the wave is undisturbed');
check('adding an engineer did not change the robots the wave spawns',
  Math.abs(run.actors.filter(a => a.cls !== 'engineer').length - plain.actors.length) <= 2,
  `${plain.actors.length} -> ${run.actors.filter(a => a.cls !== 'engineer').length}`);

if (built.length) {
  console.log(`  built ${built.map(b => `${['dispenser', 'teleporter', 'sentry'][b.type] || b.type}@lvl${b.level}`).join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
