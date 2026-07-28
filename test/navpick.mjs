import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { rankNavCandidates, nearNavNames, sharedPrefixLen } from '../shared/navpick.js';
import { gameSearchPath, setExtraAssetRoots, getExtraAssetRoots, readGameFile } from '../shared/gamefs.js';
import { pakEntries, readPakEntry, flushLumpCache } from '../shared/bsp.js';
import { parseNav } from '../shared/nav.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const MAP = 'mvm_bogland_rc12';

check('a pak nav named after the map ranks highest',
  rankNavCandidates([{ name: MAP, kind: 'pak' }, { name: MAP, kind: 'file' }], MAP)[0].kind === 'pak');

const embedded = rankNavCandidates([
  { name: 'mvm_bigrock', kind: 'vpk' },
  { name: 'embed', kind: 'pak', size: 751592 }
], MAP);
check('a pak nav whose filename does not match the map is still accepted',
  embedded.length === 1 && embedded[0].name === 'embed' && embedded[0].kind === 'pak',
  JSON.stringify(embedded.map(c => c.name + ':' + c.kind)));

check('a loose nav with an unrelated name is rejected',
  rankNavCandidates([{ name: 'mvm_bigrock', kind: 'file' }], MAP).length === 0);

const mixed = rankNavCandidates([
  { name: 'embed', kind: 'pak', size: 10 },
  { name: MAP, kind: 'file' }
], MAP);
check('the map pakfile outranks an exactly-named loose file', mixed[0].kind === 'pak', mixed.map(c => c.kind).join(','));

const twoPak = rankNavCandidates([
  { name: 'embed', kind: 'pak', size: 100 },
  { name: 'leftover', kind: 'pak', size: 900000 }
], MAP);
check('among unnamed pak navs the larger one is tried first', twoPak[0].name === 'leftover', twoPak.map(c => c.name).join(','));

check('an approximate loose match still ranks, below exact',
  rankNavCandidates([{ name: 'mvm_bogland_rc11', kind: 'file' }], MAP).length === 1);

check('every candidate is returned in rank order so a bad one can be skipped',
  rankNavCandidates([
    { name: 'embed', kind: 'pak' },
    { name: MAP, kind: 'file' },
    { name: 'mvm_bogland_rc11', kind: 'file' }
  ], MAP).length === 3);

check('nearNavNames never advertises pak entries',
  nearNavNames([{ name: 'embed', kind: 'pak' }, { name: 'mvm_bogland_rc11', kind: 'file' }], MAP).join(',') === 'mvm_bogland_rc11');

check('sharedPrefixLen counts the common head', sharedPrefixLen('mvm_abc', 'mvm_abd') === 6);

const before = getExtraAssetRoots();
const root = join(tmpdir(), 'popvis-assetroot-' + process.pid);
const rel = 'maps/popvis_probe_only.nav';
mkdirSync(dirname(join(root, rel)), { recursive: true });
writeFileSync(join(root, rel), Buffer.from('probe'));
const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];
const tfPath = TF_CANDIDATES.find(p => p && existsSync(join(p, 'tf2_misc_dir.vpk')));

try {
  setExtraAssetRoots([root]);
  check('setExtraAssetRoots resolves and stores the folder', getExtraAssetRoots().length === 1);
  if (tfPath) {
    const sp = gameSearchPath(tfPath, 'C:/x/some_map.bsp');
    check('an asset root sits after the map pakfile', sp[0].kind === 'pak' && sp[1].kind === 'dir' && sp[1].path === getExtraAssetRoots()[0],
      sp.slice(0, 3).map(s => s.kind + ':' + s.path).join(' | '));
    const customAt = sp.findIndex(s => /[\\/]custom[\\/]/i.test(s.path));
    const vpkAt = sp.findIndex(s => s.kind === 'vpk');
    check('an asset root precedes tf/custom and the stock VPKs', 1 < vpkAt && (customAt < 0 || 1 < customAt));
    const got = await readGameFile(rel, tfPath);
    check('a file only present in the asset root is found', !!got && got.toString() === 'probe');
    setExtraAssetRoots([]);
    check('clearing the roots removes them from the search path',
      getExtraAssetRoots().length === 0 && !(await readGameFile(rel, tfPath)));
  } else {
    console.log('skip search-path placement checks: no Team Fortress 2 install found');
  }
} finally {
  setExtraAssetRoots(before);
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

if (tfPath) {
  const bspFor = m => {
    for (const d of [join(tfPath, 'maps'), join(tfPath, 'download', 'maps')]) {
      const p = join(d, m + '.bsp');
      if (existsSync(p)) return p;
    }
    return null;
  };
  let ran = false;
  for (const m of ['mvm_bogland_rc12', 'mvm_motherland_b37a', 'mvm_coastrock_rc3', 'mvm_underground_rc4']) {
    const bsp = bspFor(m);
    if (!bsp) continue;
    flushLumpCache();
    const cands = [];
    for (const p of pakEntries(bsp)) {
      if (p.name.endsWith('.nav')) cands.push({ name: p.name.split('/').pop().replace(/\.nav$/, ''), kind: 'pak', entry: p, size: p.uncompSize });
    }
    if (!cands.length || cands.some(c => c.name === m)) continue;
    ran = true;
    const picked = rankNavCandidates(cands, m)[0];
    check(m + ': packs its nav under a different filename (' + picked.name + '.nav) and it is picked', !!picked);
    let areas = 0;
    try { areas = parseNav(readPakEntry(bsp, picked.entry)).areas.length; } catch {}
    check(m + ': that packed nav parses with areas', areas > 0, areas + ' areas');
  }
  if (!ran) console.log('skip packed-nav checks: no installed map packs a differently-named nav');
}

console.log(failures ? failures + ' failure(s)' : 'all nav pick checks passed');
process.exit(failures ? 1 : 0);
