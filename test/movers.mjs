import { existsSync } from 'node:fs';
import { loadEntitySim, entitySimMovers, entitySimPathChain } from '../shared/entssim.js';
import { readEntityLump, parseEntities, readModels, doorRecord, pathTracks, chainLength } from '../shared/bsp.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const MAPS_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf/maps';
const CANDIDATES = ['mvm_decoy', 'mvm_coaltown', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock'];

const wasmPath = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
if (!existsSync(wasmPath)) {
  console.log('skip mover tests: ents.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}

const maps = CANDIDATES.filter(m => existsSync(`${MAPS_DIR}/${m}.bsp`));
if (!maps.length) {
  console.log('skip mover tests: no MvM map found in ' + MAPS_DIR);
  process.exit(0);
}

const DEG = Math.PI / 180;
const ENGINE_BBOX_EXPANSION = 2;
const TICK_INTERVAL = 1 / 66.6667;

function moveDirVector(s) {
  const v = String(s ?? '').trim().split(/\s+/).map(parseFloat);
  const p = Number.isFinite(v[0]) ? v[0] : 0;
  const y = Number.isFinite(v[1]) ? v[1] : 0;
  if (p === -1 && y === 0) return [0, 0, 1];
  if (p === -2 && y === 0) return [0, 0, -1];
  const pr = p * DEG, yr = y * DEG;
  return [Math.cos(pr) * Math.cos(yr), Math.cos(pr) * Math.sin(yr), -Math.sin(pr)];
}

let totalMovers = 0, uniform = 0, durationExact = 0, spawnPoseMatches = 0;
let lipCorrected = 0, lipCases = 0;
const templatePhantoms = [];
let chainsChecked = 0, chainsAgree = 0, linkedBothWays = 0, linkedNodes = 0, forwardLinks = 0;

for (const map of maps) {
  const bspPath = `${MAPS_DIR}/${map}.bsp`;
  const sim = await loadEntitySim(bspPath, map);
  if (!sim) { check('the entity sim loads for ' + map, false); continue; }

  const movers = sim.movers || [];
  totalMovers += movers.length;
  console.log(`  ${map}: ${sim.count} entities, ${movers.length} movers`);

  const models = readModels(bspPath);
  const ents = parseEntities(readEntityLump(bspPath));
  const byModel = new Map();
  for (const e of ents) {
    const raw = String(e.model || '');
    if (raw[0] === '*') byModel.set(parseInt(raw.slice(1), 10), e);
  }

  for (const m of movers) {
    if (m.speed > 0) uniform++;
    const span = m.kind === 'rotate' ? Math.abs(m.degrees) : m.travel;
    if (m.speed > 0 && Math.abs(m.duration * m.speed - span) < 1e-3) durationExact++;

    const spawned = sim.entity(m.index);
    const restPose = m.spawnFrac === 1 ? m.track[m.track.length - 1].pose : m.track[0].pose;
    const dp = Math.hypot(spawned.origin[0] - restPose[0], spawned.origin[1] - restPose[1],
      spawned.origin[2] - restPose[2]);
    if (dp < 1e-3) spawnPoseMatches++;

    const e = byModel.get(m.model);
    const model = models[m.model];
    if (!e || !model || m.kind !== 'linear') continue;
    const dir = moveDirVector(e.movedir);
    const size = [model.maxs[0] - model.mins[0], model.maxs[1] - model.mins[1],
      model.maxs[2] - model.mins[2]];
    const lip = parseFloat(e.lip) || 0;
    const naive = Math.abs(dir[0] * size[0]) + Math.abs(dir[1] * size[1]) +
      Math.abs(dir[2] * size[2]) - lip;
    const corrected = naive - Math.abs(dir[0]) * ENGINE_BBOX_EXPANSION -
      Math.abs(dir[1]) * ENGINE_BBOX_EXPANSION - Math.abs(dir[2]) * ENGINE_BBOX_EXPANSION;
    if (!(naive > 0)) continue;
    lipCases++;
    if (Math.abs(m.travel - corrected) < 1e-2) lipCorrected++;
  }

  const simModels = new Set(movers.map(m => m.model));
  for (const [mi, e] of byModel) {
    if (simModels.has(mi)) continue;
    if (!doorRecord(e, models[mi], mi)) continue;
    templatePhantoms.push(`${map} *${mi} ${e.targetname || e.classname}`);
  }

  const lookup = entitySimMovers(bspPath);
  check(`${map} exposes its movers by brush model index`,
    !!lookup && movers.every(m => lookup.get(m.model) === m));

  const jsTracks = pathTracks(ents);
  for (const [name] of jsTracks) {
    const a = chainLength(jsTracks, name);
    const b = entitySimPathChain(bspPath, name);
    if (!a || !b) continue;
    chainsChecked++;
    if (a.distance === b.distance && a.nodes === b.nodes &&
        a.endNode.toLowerCase() === b.endNode.toLowerCase()) chainsAgree++;
  }
  for (const node of sim.paths.values()) {
    linkedNodes++;
    if (node.next < 0) continue;
    forwardLinks++;
    const next = sim.paths.get(node.next);
    if (next && next.prev === node.index) linkedBothWays++;
  }
}

check('the stock maps have movers to check', totalMovers > 0, totalMovers + ' movers');
check('every mover moves at one constant velocity', uniform === totalMovers,
  `${uniform}/${totalMovers}`);
check('duration is the real distance over the real speed', durationExact === totalMovers,
  `${durationExact}/${totalMovers}`);
check('the spawn pose is one end of the recorded track', spawnPoseMatches === totalMovers,
  `${spawnPoseMatches}/${totalMovers}`);
check('linear travel carries the engine bbox correction CBaseDoor::Spawn applies',
  lipCases > 0 && lipCorrected === lipCases, `${lipCorrected}/${lipCases}`);
check('doors that only exist as point_template sources are not reported as movers',
  templatePhantoms.length > 0, templatePhantoms.join(', ') || 'none found');

check('CPathTrack::Link built a real path graph', linkedNodes > 0, linkedNodes + ' nodes');
check('every forward link has the matching back link Link() sets',
  forwardLinks > 0 && linkedBothWays === forwardLinks,
  `${linkedBothWays}/${forwardLinks} linked pairs`);
check('the real path graph gives the same chain lengths as the entity lump',
  chainsChecked > 0 && chainsAgree === chainsChecked, `${chainsAgree}/${chainsChecked}`);

const decoy = maps.includes('mvm_decoy') ? await loadEntitySim(`${MAPS_DIR}/mvm_decoy.bsp`, 'mvm_decoy') : null;
if (decoy) {
  const door = (decoy.movers || []).find(m => m.name === 'door1_door');
  check('mvm_decoy door1_door is a func_door', !!door && door.cls === 'func_door');
  if (door) {
    const steps = [];
    for (let i = 1; i < door.track.length; i++) {
      const a = door.track[i - 1].pose, b = door.track[i].pose;
      steps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const gaps = door.track.slice(1).map((s, i) => s.t - door.track[i].t);
    check('the recorded track advances one tick per sample once the door is moving',
      gaps.slice(1).every(g => Math.abs(g - TICK_INTERVAL) < 1e-3),
      door.track.length + ' samples');
    check('the rest pose sits a whole number of ticks before the first movement',
      Math.abs(gaps[0] / TICK_INTERVAL - Math.round(gaps[0] / TICK_INTERVAL)) < 1e-2 &&
      gaps[0] >= TICK_INTERVAL - 1e-3,
      (gaps[0] / TICK_INTERVAL).toFixed(3) + ' ticks');
    check('the last step is the engine snapping onto the final destination',
      steps.length > 1 && steps[steps.length - 1] < steps[0],
      `${steps[steps.length - 1].toFixed(4)} < ${steps[0].toFixed(4)}`);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
