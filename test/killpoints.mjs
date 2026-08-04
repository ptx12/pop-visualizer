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
const MAP = 'mvm_coaltown';

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip kill point tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`) || !existsSync(join(repo, 'vanilla', `${MAP}.pop`))) {
  console.log(`skip kill point tests: ${MAP} not available`);
  process.exit(0);
}

const base = {
  bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: MAP,
  popPath: join(repo, 'vanilla', `${MAP}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds: 110, tfPath: TF_DIR
};

const before = await simulateWave(base);
const wsBefore = new Set(before.actors.map(a => a.wsIndex));
check('without kill points nothing dies', before.killed === 0 && before.actors.every(a => !Number.isFinite(a.dieT)),
  `killed ${before.killed}, ${before.actors.filter(a => Number.isFinite(a.dieT)).length} deaths`);

const walker = before.actors.find(a => a.kind === 'bot' && a.track.length > 20);
check('a robot walked far enough to place a kill point on its route', !!walker,
  walker ? '' : 'no robot with a long track');
if (!walker) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const pt = walker.track[Math.floor(walker.track.length * 0.5)];
const after = await simulateWave({ ...base, killPoints: [[pt[1], pt[2], 250]] });
const wsAfter = new Set(after.actors.map(a => a.wsIndex));
const deaths = after.actors.filter(a => Number.isFinite(a.dieT));

check('robots die when they walk into a kill point', after.killed > 0, `killed ${after.killed}`);
check('the deaths are recorded on the actors', deaths.length > 0, `${deaths.length} of ${after.actors.length} actors died`);
check('every recorded death happens after the robot spawned',
  deaths.every(a => a.dieT > a.spawnT), deaths.map(a => `${a.spawnT.toFixed(1)}->${a.dieT.toFixed(1)}`).slice(0, 4).join(', '));

const opened = [...wsAfter].filter(i => !wsBefore.has(i));
check('deaths release wavespawns that were waiting on them', opened.length > 0,
  `before [${[...wsBefore].sort((a, b) => a - b)}] after [${[...wsAfter].sort((a, b) => a - b)}]`);

console.log(`  kill point at [${pt[1].toFixed(0)}, ${pt[2].toFixed(0)}]: ${after.killed} kills, wavespawns ${[...wsBefore].sort().join('/')} -> ${[...wsAfter].sort().join('/')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
