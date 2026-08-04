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

if (!existsSync(new URL('../wasm/simcore/build/ents.wasm', import.meta.url))) {
  console.log('skip multi bomb tests: ents.wasm not built');
  process.exit(0);
}
if (!existsSync(`${TF_DIR}/maps/${MAP}.bsp`)) {
  console.log(`skip multi bomb tests: ${MAP} not available`);
  process.exit(0);
}

const base = {
  bspPath: `${TF_DIR}/maps/${MAP}.bsp`, mapName: MAP, popShortName: MAP,
  popPath: join(repo, 'vanilla', `${MAP}.pop`), popDir: join(repo, 'vanilla'),
  waveIndex: 0, seconds: 60, tfPath: TF_DIR
};

const single = await simulateWave(base);
check('the stock map carries exactly one bomb', (single.bombs || []).length === 1,
  `${(single.bombs || []).length} bombs`);
if (!single.bombs || single.bombs.length !== 1) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const first = single.bombs[0];
const walker = single.actors.find(a => a.kind === 'bot' && a.track.length > 20);
check('a robot walked far enough to site a second bomb on its route', !!walker);
if (!walker) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const spot = walker.track[Math.floor(walker.track.length * 0.35)];
const secondHome = [spot[1], spot[2], spot[3] + 40];

const twin = await simulateWave({
  ...base,
  extraEntities: [{
    classname: 'item_teamflag',
    targetname: 'intel_twin',
    origin: secondHome.join(' '),
    angles: '0 90 0',
    TeamNum: 3,
    GameType: 1,
    NeutralType: 1,
    ScoringType: 0,
    ReturnTime: 60000,
    ReturnBetweenWaves: 1,
    StartDisabled: 0,
    trail_effect: 1,
    flag_model: 'models/props_td/atom_bomb.mdl',
    flag_icon: '../hud/objectives_flagpanel_carried',
    flag_trail: 'flagtrail',
    flag_paper: 'player_intel_papertrail'
  }]
});

const bombs = twin.bombs || [];
console.log('\n2.1 independent per bomb state');
check('the second bomb entity is live alongside the map\'s own', bombs.length === 2,
  `${bombs.length} bombs`);
if (bombs.length !== 2) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

check('each bomb has its own entity index', bombs[0].entindex !== bombs[1].entindex,
  bombs.map(b => b.entindex).join(' / '));

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
check('each bomb anchors at its own authored position rather than a shared one',
  dist(bombs[0].home, bombs[1].home) > 100,
  `${dist(bombs[0].home, bombs[1].home).toFixed(0)} units apart`);
check('the map\'s own bomb kept its original anchor when a second was added',
  dist(bombs.find(b => b.entindex === first.entindex)?.home ?? [1e9, 0, 0], first.home) < 1,
  `moved ${dist(bombs.find(b => b.entindex === first.entindex)?.home ?? [1e9, 0, 0], first.home).toFixed(2)} units`);
check('the added bomb resolved to a legal spot near where it was placed',
  bombs.some(b => b.entindex !== first.entindex && dist(b.home, secondHome) < 600),
  bombs.map(b => `${b.entindex}@${dist(b.home, secondHome).toFixed(0)}`).join(' '));

console.log('\n2.2 follower balancing');
const followers = bombs.map(b => b.followersMax);
check('robots pick up both bombs as fetch targets rather than piling on one',
  followers.every(f => f > 0), followers.join(' / '));
check('the follower counts stay balanced within one of each other',
  Math.abs(followers[0] - followers[1]) <= 1, followers.join(' / '));

console.log('\n2.3 exclusive carriage');
const shared = bombs[0].carriers.filter(c => bombs[1].carriers.includes(c));
check('no single robot ever carried both bombs', shared.length === 0,
  shared.length ? `entities ${shared.join(', ')} carried both` : '');
check('the run is meaningful because at least one bomb was actually carried',
  bombs.some(b => b.states.includes(2)) || bombs.some(b => b.carriers.length > 0),
  bombs.map(b => `slot ${b.slot} states [${b.states.join(',')}]`).join('; '));

console.log('\nsingle bomb behaviour is unchanged');
check('adding a bomb did not change how many robots the wave spawns',
  Math.abs(twin.actors.length - single.actors.length) <= 2,
  `${single.actors.length} -> ${twin.actors.length}`);

console.log(`  bombs at [${bombs.map(b => b.home.map(v => v.toFixed(0)).join(',')).join('] [')}], followers ${followers.join('/')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
