import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { readGameFile, gameSearchPath, listGameDir, normalizeGamePath, flushGameFS } from '../shared/gamefs.js';
import { readStaticProps, pakEntries, readPakEntry } from '../shared/bsp.js';
import { indexVPK } from '../shared/vpk.js';

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];
const tfPath = TF_CANDIDATES.find(p => p && existsSync(join(p, 'tf2_misc_dir.vpk')));
if (!tfPath) {
  console.log('skip gamefs: no Team Fortress 2 install found (set TF_PATH to run these)');
  process.exit(0);
}

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const bspFor = m => {
  for (const d of [join(tfPath, 'maps'), join(tfPath, 'download', 'maps')]) {
    const p = join(d, m + '.bsp');
    if (existsSync(p)) return p;
  }
  return null;
};

const kindOf = s => s.kind + ':' + s.path;
const sp = gameSearchPath(tfPath, 'C:/somewhere/mvm_x.bsp');
check('map pakfile is first on the search path', sp[0].kind === 'pak', kindOf(sp[0]));
check('tf/download is searched last', sp[sp.length - 1].kind === 'dir' && /[\\/]download$/i.test(sp[sp.length - 1].path), kindOf(sp[sp.length - 1]));

const idx = k => sp.findIndex(s => s.kind === k.kind && s.path === k.path);
const tfMisc = idx({ kind: 'vpk', path: join(tfPath, 'tf2_misc_dir.vpk') });
const hl2Misc = idx({ kind: 'vpk', path: join(dirname(tfPath), 'hl2', 'hl2_misc_dir.vpk') });
const tfLoose = idx({ kind: 'dir', path: tfPath });
const hl2Loose = idx({ kind: 'dir', path: join(dirname(tfPath), 'hl2') });
check('tf VPKs precede hl2 VPKs', tfMisc >= 0 && hl2Misc > tfMisc, tfMisc + ' vs ' + hl2Misc);
check('VPKs precede loose game folders', hl2Misc >= 0 && tfLoose > hl2Misc, hl2Misc + ' vs ' + tfLoose);
check('loose tf precedes loose hl2', tfLoose >= 0 && hl2Loose > tfLoose, tfLoose + ' vs ' + hl2Loose);

const customIdx = sp.findIndex(s => /[\\/]custom[\\/]/i.test(s.path));
if (customIdx >= 0) check('tf/custom precedes the stock VPKs', customIdx < tfMisc, customIdx + ' vs ' + tfMisc);
else console.log('ok   tf/custom precedes the stock VPKs (no custom mounts installed)');

const noPak = gameSearchPath(tfPath, null);
check('omitting the map yields the same path without the pak entry', noPak.length === sp.length - 1 && noPak.every((s, i) => kindOf(s) === kindOf(sp[i + 1])));

check('paths are normalized and lowercased', normalizeGamePath('\\Models\\Props\\\\Foo.MDL') === 'models/props/foo.mdl', normalizeGamePath('\\Models\\Props\\\\Foo.MDL'));
check('directory traversal is rejected', (await readGameFile('../../secret.txt', tfPath)) === null);

const stock = await readGameFile('models/props_gameplay/resupply_locker.mdl', tfPath);
check('stock model resolves from a tf VPK', !!stock && stock.length > 0);
const stockVtx = await readGameFile('models/props_gameplay/resupply_locker.dx90.vtx', tfPath);
check('dotted .dx90.vtx resolves from a tf VPK', !!stockVtx && stockVtx.length > 0);

const hl2Model = await readGameFile('models/props_c17/utilityconnecter005.mdl', tfPath);
const hl2Idx = indexVPK(join(dirname(tfPath), 'hl2', 'hl2_misc_dir.vpk'), x => x === 'mdl');
if (hl2Idx.has('models/props_c17/utilityconnecter005.mdl')) {
  check('hl2-only model resolves (tf VPKs alone are not enough)', !!hl2Model && hl2Model.length > 0);
} else {
  console.log('skip hl2-only model: not present in this install');
}

const particles = await listGameDir('particles', 'pcf', tfPath);
check('listGameDir enumerates pcf files inside VPKs', particles.length > 10 && particles.every(p => p.startsWith('particles/') && p.endsWith('.pcf')), particles.length + ' found');
check('listGameDir does not descend into subdirectories', particles.every(p => p.indexOf('/', 'particles/'.length) < 0));

const PAK_MAPS = ['mvm_havana_rc4', 'mvm_gravelpass_b6', 'mvm_spybase_rc16'];
let ranPak = false;
for (const map of PAK_MAPS) {
  const bsp = bspFor(map);
  if (!bsp) continue;
  flushGameFS();

  const packed = new Set();
  for (const e of pakEntries(bsp)) if (e.name.endsWith('.mdl')) packed.add(e.name);
  if (!packed.size) continue;
  ranPak = true;

  const used = new Set();
  for (const p of readStaticProps(bsp)) {
    if (!p.model) continue;
    const rel = String(p.model).toLowerCase().replace(/\.mdl$/, '') + '.mdl';
    if (packed.has(rel)) used.add(rel);
  }
  check(map + ': map packs prop models the stock VPKs do not have', used.size > 0, packed.size + ' packed, ' + used.size + ' referenced by static props');

  let ok = 0;
  const bad = [];
  for (const rel of used) {
    const buf = await readGameFile(rel, tfPath, bsp);
    if (buf && buf.length > 0) ok++; else bad.push(rel);
  }
  check(map + ': every pak-packed prop model loads', bad.length === 0, bad.slice(0, 3).join(', '));

  let stockOnly = 0;
  for (const rel of used) if (!(await readGameFile(rel, tfPath, null))) stockOnly++;
  check(map + ': pak-packed models are unreachable without the map', stockOnly > 0, 'every packed model also exists in stock content, so the pak adds nothing measurable here');
}
if (!ranPak) console.log('skip pak-packed prop checks: none of ' + PAK_MAPS.join(', ') + ' installed');

let ranOverride = false;
for (const map of PAK_MAPS) {
  const bsp = bspFor(map);
  if (!bsp) continue;
  flushGameFS();
  for (const e of pakEntries(bsp)) {
    if (!/\.(vmt|vtf|mdl)$/.test(e.name)) continue;
    if (!(await readGameFile(e.name, tfPath, null))) continue;
    let packedBytes = null;
    try { packedBytes = readPakEntry(bsp, e); } catch {}
    if (!packedBytes) continue;
    const withPak = await readGameFile(e.name, tfPath, bsp);
    check(map + ': ' + e.name + ' also ships with the game, and the packed copy wins',
      !!withPak && withPak.equals(packedBytes));
    ranOverride = true;
    break;
  }
  if (ranOverride) break;
}
if (!ranOverride) console.log('skip pak-override check: no installed map packs a file that also ships with the game');

const gameinfo = join(tfPath, 'gameinfo.txt');
if (existsSync(gameinfo)) {
  const text = readFileSync(gameinfo, 'latin1');
  const block = (text.match(/SearchPaths\s*\{([\s\S]*?)\n\s*\}/i) || [])[1] || '';
  const order = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.replace(/\/\/.*$/, '').match(/^\s*(\S+)\s+(\S+)\s*$/);
    if (!m) continue;
    const ids = m[1].toLowerCase().split('+');
    if (!ids.some(i => i === 'game' || i === 'mod' || i.startsWith('game_') || i.startsWith('custom_'))) continue;
    order.push(m[2].toLowerCase());
  }
  check('gameinfo.txt still lists custom first and download last',
    order.length > 4 && order[0].includes('custom') && order[order.length - 1].includes('download'),
    order.join(' | '));
}

console.log(failures ? failures + ' failure(s)' : 'all gamefs checks passed');
process.exit(failures ? 1 : 0);
