import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { simulateWave } from '../renderer/js/sim.js';

const dir = dirname(dirname(fileURLToPath(import.meta.url)));

function load(rel, baseRels = []) {
  const doc = parse(readFileSync(`${dir}/${rel}`, 'latin1'));
  const baseDocs = baseRels.map(b => ({ name: b, doc: parse(readFileSync(`${dir}/base/${b}`, 'latin1')) }));
  return buildModel(doc, baseDocs);
}

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.log(`FAIL ${label} ${detail}`); }
}

const m = load('vanilla/mvm_bigrock_advanced1.pop', ['robot_giant.pop', 'robot_standard.pop']);
check('bigrock adv1: 7 waves', m.waves.length === 7, `got ${m.waves.length}`);
check('bigrock adv1: wave1 has wavespawns', m.waves[0].wavespawns.length > 0, `got ${m.waves[0].wavespawns.length}`);
check('bigrock adv1: has missions', m.missions.length >= 4, `got ${m.missions.length}`);
check('bigrock adv1: wave currency > 0', m.waves[0].totalCurrency > 0, `got ${m.waves[0].totalCurrency}`);
check('bigrock adv1: templates resolved', [...m.templates.keys()].length > 50, `got ${m.templates.size}`);
const allBots = m.waves.flatMap(w => w.wavespawns.flatMap(ws => ws.bots));
check('bigrock adv1: bots resolve classes', allBots.filter(b => b.bot && b.bot.cls !== 'unknown').length > 20);
const tanks = m.waves.flatMap(w => w.wavespawns).filter(ws => ws.isTank);
check('bigrock adv1: has tank wavespawns', tanks.length >= 1, `got ${tanks.length}`);

for (const w of m.waves) {
  const sim = simulateWave(w, {});
  check(`bigrock adv1 wave ${w.index + 1}: sim ends (${Math.round(sim.waveEnd)}s, peak ${sim.peak.active})`, sim.waveEnd > 5 && sim.waveEnd < 3000);
}

const deps = m.waves.flatMap(w => w.wavespawns).filter(ws => ws.waitForAllSpawned || ws.waitForAllDead);
check('bigrock adv1: has dependency chains', deps.length > 3, `got ${deps.length}`);

const raf = load('samples_sigdemo.pop', ['robot_giant.pop', 'robot_standard.pop', 'robot_gatebot.pop']);
check('sigdemo: parses waves', raf.waves.length > 0, `got ${raf.waves.length}`);
check('sigdemo: settings present', raf.settings.length > 3, `got ${raf.settings.length}`);
check('sigdemo: other blocks preserved', raf.otherBlocks.length > 0, `got ${raf.otherBlocks.length}`);

const kellyPath = join(dir, '..', 'mvm_kelly_hoe20_hell_on_earth.pop');
if (existsSync(kellyPath)) {
  const kelly = parse(readFileSync(kellyPath, 'latin1'));
  const km = buildModel(kelly, []);
  check('kelly hoe: waves parse', km.waves.length > 0, `got ${km.waves.length}`);
  check('kelly hoe: wavespawns parse', km.waves.every(w => w.wavespawns.length > 0));
  const t0 = Date.now();
  for (const w of km.waves) simulateWave(w, {});
  check(`kelly hoe: all waves simulate fast (${Date.now() - t0}ms)`, Date.now() - t0 < 3000);
} else {
  console.log('skip kelly hoe perf reference (file not present)');
}

console.log(failures ? `\n${failures} FAILURES` : '\nall model checks passed');
process.exit(failures ? 1 : 0);
