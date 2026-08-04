import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const GATED = 'mvm_mannhattan';
const PLAIN = 'mvm_decoy';
const TF_TEAM_PVE_DEFENDERS = 2;

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip gate tests: ents.wasm not built');
  process.exit(0);
}

const run = async (map, seconds) => simulateWave({
  bspPath: `${TF_DIR}/maps/${map}.bsp`, mapName: map, popShortName: map,
  popPath: join(repo, 'vanilla', `${map}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds, tfPath: TF_DIR
});

console.log('the capture machinery is compiled');
const triggers = readFileSync(join(SDK, 'server/tf/tf_triggers.cpp'), 'utf8');
check('trigger_timer_door is linked to the gate trigger class',
  /LINK_ENTITY_TO_CLASS\( trigger_timer_door, CTriggerTimerDoor \)/.test(triggers));
check('the gate trigger derives from the area capture trigger',
  /class CTriggerTimerDoor : public CTriggerAreaCapture/.test(triggers));

console.log('\nthe SDK has no gatebot behaviour to drive a capture');
const hits = [];
for (const rel of ['server/tf', 'shared/tf']) {
  const walk = dir => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.(cpp|h)$/.test(name.name)) {
        const text = readFileSync(full, 'utf8');
        if (/gatebot/i.test(text)) hits.push(full.slice(SDK.length + 1).replace(/\\/g, '/'));
      }
    }
  };
  walk(join(SDK, rel));
}
check('gatebots are mentioned in exactly the two places Valve shipped', hits.length === 2,
  hits.join(', '));
check('neither mention is behaviour, only an achievement and a popfile filter',
  hits.every(h => /tf_player\.cpp|tf_population_manager\.cpp/.test(h)), hits.join(', '));

if (!existsSync(`${TF_DIR}/maps/${GATED}.bsp`)) {
  console.log(`\nskip the live checks: ${GATED} not available`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

console.log('\nthe gates are present and reported');
const gated = await run(GATED, 150);
check('the gated map reports its control points', (gated.gates || []).length === 2,
  `${(gated.gates || []).length} points`);
check('every control point starts owned by the defenders',
  (gated.gates || []).every(g => g.startOwner === TF_TEAM_PVE_DEFENDERS),
  (gated.gates || []).map(g => g.startOwner).join(', '));

console.log('\nno robot captures a gate, and that is reported honestly');
check('no control point is captured during the wave',
  (gated.gates || []).every(g => g.capturedAt === null),
  (gated.gates || []).map(g => g.capturedAt).join(', '));
check('no control point even accrues capture progress',
  (gated.gates || []).every(g => g.maxProgress === 0),
  (gated.gates || []).map(g => g.maxProgress).join(', '));

if (existsSync(`${TF_DIR}/maps/${PLAIN}.bsp`)) {
  const plain = await run(PLAIN, 30);
  check('a map without gates reports no control points', (plain.gates || []).length === 0,
    `${(plain.gates || []).length} points`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
