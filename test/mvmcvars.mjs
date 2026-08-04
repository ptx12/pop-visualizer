import { existsSync, readFileSync } from 'node:fs';
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
const SDK = join(repo, 'wasm', 'simcore', 'sdk', 'game');
const MAP = 'mvm_decoy';

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip cvar tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`)) {
  console.log(`skip cvar tests: ${MAP} not available`);
  process.exit(0);
}

function valveDefault(file, name) {
  const p = join(SDK, file);
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8')
    .match(new RegExp(`ConVar\\s+${name}\\s*\\(\\s*"${name}"\\s*,\\s*"([0-9.]+)`));
  return m ? parseFloat(m[1]) : null;
}

const PENALTY = 'tf_mvm_bot_flag_carrier_movement_penalty';
const DEPLOY = 'tf_deploying_bomb_time';
const penaltyDefault = valveDefault('shared/tf/tf_player_shared.cpp', PENALTY)
  ?? valveDefault('server/tf/tf_player.cpp', PENALTY)
  ?? valveDefault('shared/tf/tf_gamerules.cpp', PENALTY);
const deployDefault = valveDefault('server/tf/tf_player.cpp', DEPLOY);

check('the SDK still declares the carrier movement penalty', penaltyDefault !== null, `${penaltyDefault}`);
check('the movement penalty still defaults to a half', penaltyDefault === 0.5, `${penaltyDefault}`);

const base = {
  bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: MAP,
  popPath: join(repo, 'vanilla', `${MAP}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds: 120, tfPath: TF_DIR
};

const slow = await simulateWave(base);
check('a default run reports no cvar overrides', Object.keys(slow.cvars || {}).length === 0,
  JSON.stringify(slow.cvars));

const fast = await simulateWave({ ...base, cvars: { [PENALTY]: 1.0 } });
check('the override is accepted by the real console variable',
  fast.cvars && fast.cvars[PENALTY] === '1', JSON.stringify(fast.cvars));

const slowCarry = (slow.bomb && slow.bomb.log || []).filter(e => e.kind === 'carry');
const fastCarry = (fast.bomb && fast.bomb.log || []).filter(e => e.kind === 'carry');
check('both runs actually had the bomb picked up', slowCarry.length > 0 && fastCarry.length > 0,
  `${slowCarry.length} / ${fastCarry.length} carry entries`);

const carrySpeed = run => {
  const carriers = run.actors.filter(a => a.carrySpeed > 0 && a.carryTime > 1);
  return carriers.length ? Math.max(...carriers.map(a => a.carrySpeed)) : null;
};
const slowTravel = carrySpeed(slow);
const fastTravel = carrySpeed(fast);
check('both runs measured a carrier long enough to time', slowTravel !== null && fastTravel !== null,
  `${slowTravel} / ${fastTravel}`);
check('lifting the carrier penalty roughly doubles how fast the bomb moves',
  slowTravel !== null && fastTravel !== null && fastTravel > slowTravel * 1.5,
  `${(slowTravel || 0).toFixed(0)} -> ${(fastTravel || 0).toFixed(0)} units per second`);

const deploySet = await simulateWave({ ...base, seconds: 30, cvars: { [DEPLOY]: 3.5 } });
check('the deploy animation length is settable through Valve\'s own cvar',
  deploySet.cvars && deploySet.cvars[DEPLOY] === '3.5', JSON.stringify(deploySet.cvars));
check('the SDK still declares the deploy time', deployDefault !== null, `${deployDefault}`);

const rejected = await simulateWave({ ...base, seconds: 15, cvars: { definitely_not_a_cvar: 7 } });
check('an unknown cvar name is reported as not applied rather than silently accepted',
  !(rejected.cvars && 'definitely_not_a_cvar' in rejected.cvars), JSON.stringify(rejected.cvars));

console.log(`  carrier speed ${(slowTravel || 0).toFixed(0)} -> ${(fastTravel || 0).toFixed(0)} u/s with the penalty lifted`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
