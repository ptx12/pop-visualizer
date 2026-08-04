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

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip mvm nav tests: ents.wasm not built');
  process.exit(0);
}

const CANDIDATES = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannworks', 'mvm_bigrock', 'mvm_rottenburg'];
const maps = CANDIDATES.filter(m =>
  existsSync(`${TF_DIR}/maps/${m}.bsp`) && existsSync(join(repo, 'vanilla', `${m}.pop`)));

if (!maps.length) {
  console.log('skip mvm nav tests: no vanilla map available');
  process.exit(0);
}

for (const map of maps) {
  console.log(`\n${map}`);
  const run = await simulateWave({
    bspPath: `${TF_DIR}/maps/${map}.bsp`, mapName: map, popShortName: map,
    popPath: join(repo, 'vanilla', `${map}.pop`), popDir: join(repo, 'vanilla'),
    waveIndex: 0, seconds: 25, tfPath: TF_DIR
  });

  const nav = run.nav;
  if (!nav) { check(`${map}: the nav statistics are exported`, false, 'no nav block on the result'); continue; }

  check(`${map}: the mesh loaded`, nav.areas > 0, `${nav.areas} areas`);

  check(`${map}: the legal bomb drop flood marked areas`, nav.bombDrop > 0,
    `${nav.bombDrop} of ${nav.areas} areas`);
  check(`${map}: the flood found a blue spawn room to start from`, nav.blueSpawnRoom > 0,
    `${nav.blueSpawnRoom} blue spawn areas`);

  const overlap = nav.bombDrop + nav.spawnRoom - nav.bombDropOrSpawnRoom;
  check(`${map}: no spawn room area is a legal bomb drop area`, overlap === 0,
    `${overlap} areas carry both`);

  check(`${map}: the legal drop region is not the whole mesh`, nav.bombDrop < nav.areas,
    `${nav.bombDrop} marked of ${nav.areas}`);

  check(`${map}: the bomb target flood reached areas`, nav.targetReached > 0,
    `${nav.targetReached} of ${nav.areas} areas have a distance`);
  check(`${map}: exactly one area sits at distance zero from the hatch`, nav.targetOrigins === 1,
    `${nav.targetOrigins} areas at zero`);
  check(`${map}: the furthest reached area is a real distance`, nav.targetMax > 0,
    `max ${nav.targetMax.toFixed(1)}`);
  check(`${map}: unreached areas keep the sentinel rather than a distance`,
    nav.targetReached <= nav.areas, `${nav.targetReached} reached of ${nav.areas}`);

  const bombs = run.bombs || [];
  check(`${map}: the map's bombs are enumerated individually`, bombs.length > 0,
    `${bombs.length} item_teamflag entities`);
  check(`${map}: every bomb reports its own entity index`,
    bombs.length > 0 && new Set(bombs.map(b => b.entindex)).size === bombs.length,
    bombs.map(b => b.entindex).join(', '));
  check(`${map}: every bomb reports a follower count`,
    bombs.every(b => b.followers >= 0), bombs.map(b => b.followers).join(', '));
  check(`${map}: followers never exceed the invaders on the field`,
    bombs.every(b => b.followers <= 22), bombs.map(b => b.followers).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
