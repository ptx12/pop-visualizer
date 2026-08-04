import { readFileSync, existsSync } from 'node:fs';
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

const SDK_ROOT = 'C:/Users/jakub/Desktop/source-sdk-2013/src';
const DELIVER_FLAG = `${SDK_ROOT}/game/server/tf/bot/behavior/scenario/capture_the_flag/tf_bot_deliver_flag.cpp`;

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip bomb tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`)) {
  console.log(`skip bomb tests: ${MAP} not available`);
  process.exit(0);
}

function valveInterval(name) {
  if (!existsSync(DELIVER_FLAG)) return null;
  const src = readFileSync(DELIVER_FLAG, 'utf8');
  const m = src.match(new RegExp(`ConVar\\s+${name}\\s*\\(\\s*"${name}"\\s*,\\s*"([0-9.]+)"`));
  return m ? parseFloat(m[1]) : null;
}

const run = await simulateWave({
  bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: MAP,
  popPath: join(repo, 'vanilla', `${MAP}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds: 150, tfPath: TF_DIR
});

check('the wave produces a bomb log', !!(run.bomb && run.bomb.log && run.bomb.log.length),
  run.bomb ? `${run.bomb.log.length} entries` : 'no bomb data');
if (!run.bomb) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const log = run.bomb.log;
const carried = log.filter(e => e.kind === 'carry');
check('a robot picks the bomb up', carried.length > 0, `${carried.length} carry entries`);

const levels = carried.map(e => e.level);
check('the carrier upgrade level only ever climbs',
  levels.every((v, i) => i === 0 || v >= levels[i - 1]), `levels [${levels}]`);
check('the carrier reaches every upgrade level Valve defines',
  Math.max(...levels) >= 3, `peak level ${Math.max(...levels)}`);

const firstAt = lvl => { const e = carried.find(x => x.level === lvl); return e ? e.t : null; };
const t1 = firstAt(1), t2 = firstAt(2), t3 = firstAt(3);

const second = valveInterval('tf_mvm_bot_flag_carrier_interval_to_2nd_upgrade');
const third = valveInterval('tf_mvm_bot_flag_carrier_interval_to_3rd_upgrade');
check('the SDK still declares the upgrade intervals', second !== null && third !== null,
  `2nd ${second}, 3rd ${third}`);

if (second !== null && t1 !== null && t2 !== null) {
  check("the gap to the second upgrade matches Valve's cvar",
    Math.abs((t2 - t1) - second) < 0.75, `${(t2 - t1).toFixed(2)}s vs ${second}s`);
}
if (third !== null && t2 !== null && t3 !== null) {
  check("the gap to the third upgrade matches Valve's cvar",
    Math.abs((t3 - t2) - third) < 0.75, `${(t3 - t2).toFixed(2)}s vs ${third}s`);
}

console.log(`  bomb picked up at ${carried[0].t.toFixed(2)}s, levels at ${[t1, t2, t3].map(v => v === null ? '-' : v.toFixed(1) + 's').join(' / ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
