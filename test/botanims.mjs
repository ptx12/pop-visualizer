import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseMDL } from '../shared/mdl.js';
import { resolveActivities, includeBases } from '../shared/modelanims.js';
import { indexVPK, readVPKEntry } from '../shared/vpk.js';
import { parseVDF, vdfGet } from '../shared/vdf.js';
import { decodeICE } from '../shared/ice.js';
import { weaponRole } from '../shared/weaponscripts.js';
import { activityForRole, normalizeRole } from '../shared/weaponrole.js';

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];
const tfPath = TF_CANDIDATES.find(p => p && existsSync(join(p, 'tf2_misc_dir.vpk')));
if (!tfPath) {
  console.log('skip botanims: no Team Fortress 2 install found (set TF_PATH to run these)');
  process.exit(0);
}

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const VPK = join(tfPath, 'tf2_misc_dir.vpk');
const mdlIndex = indexVPK(VPK, (x, d) => x === 'mdl' && d.startsWith('models'));
const ctxIndex = indexVPK(VPK, (x, d) => (x === 'ctx' || x === 'txt') && d.startsWith('scripts'));

const loadMDL = base => {
  const e = mdlIndex.get(base.toLowerCase() + '.mdl');
  if (!e) return null;
  try { return parseMDL(readVPKEntry(VPK, e)); } catch { return null; }
};

function activityMap(base, activities) {
  const mdl = loadMDL(base);
  if (!mdl) return null;
  const out = {};
  const seen = new Set([base.toLowerCase()]);
  const queue = includeBases(mdl, base);
  const sources = [mdl];
  let guard = 0;
  while (queue.length && guard++ < 12) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    const comp = loadMDL(next);
    if (!comp) continue;
    for (const nested of (comp.includemodels || [])) queue.push(nested.replace(/\.mdl$/i, '').toLowerCase());
    sources.push(comp);
  }
  for (const s of sources) {
    for (const [act, name] of resolveActivities(s, activities.filter(a => !out[a]))) out[act] = name;
  }
  return out;
}

const CTX_KEY = 'E2NcUkG2';
let decrypted = 0, garbage = 0;
const scriptNames = [];
for (const [name, entry] of ctxIndex) {
  if (!/tf_weapon.*\.ctx$/.test(name)) continue;
  scriptNames.push(name.replace(/^scripts\//, '').replace(/\.ctx$/, ''));
  const text = Buffer.from(decodeICE(readVPKEntry(VPK, entry), CTX_KEY)).toString('latin1');
  if (/WeaponData/i.test(text)) decrypted++;
  else garbage++;
}
check('every encrypted weapon script decrypts to readable WeaponData text', garbage === 0 && decrypted > 50, decrypted + ' ok, ' + garbage + ' garbage');

const roleless = [];
for (const n of scriptNames) if (!(await weaponRole(n, tfPath))) roleless.push(n);
check('every weapon script yields a weapon role', roleless.length === 0, roleless.slice(0, 5).join(' '));

const ROLE_CASES = [
  ['tf_weapon_scattergun', null, 'PRIMARY'],
  ['tf_weapon_medigun', null, 'SECONDARY'],
  ['tf_weapon_bat', null, 'MELEE'],
  ['tf_weapon_minigun', null, 'PRIMARY'],
  ['tf_weapon_pda_engineer_build', null, 'PDA'],
  ['tf_weapon_builder', null, 'BUILDING'],
  ['tf_weapon_lunchbox', null, 'ITEM1'],
  ['tf_weapon_sword', 'item1', 'ITEM1'],
  ['tf_weapon_compound_bow', 'item2', 'ITEM2']
];
const roleBad = [];
for (const [cls, animSlot, want] of ROLE_CASES) {
  const role = normalizeRole(animSlot) || await weaponRole(cls, tfPath);
  const got = activityForRole(role);
  if (got !== want) roleBad.push(cls + ' -> ' + got + ' (want ' + want + ')');
}
check('weapon scripts and anim_slot map to the TF2 activity set', roleBad.length === 0, roleBad.join('; '));

const raw = await readFile(join(tfPath, 'scripts/items/items_game.txt'), 'latin1');
const ig = vdfGet(parseVDF(raw), 'items_game');
const items = vdfGet(ig, 'items') || {};
const prefabs = vdfGet(ig, 'prefabs') || {};
const field = (node, key, depth = 0) => {
  if (!node || depth > 8) return null;
  const v = vdfGet(node, key);
  if (v) return v;
  const pf = vdfGet(node, 'prefab');
  if (!pf) return null;
  for (const nm of String(pf).split(/\s+/)) { const r = field(prefabs[nm], key, depth + 1); if (r) return r; }
  return null;
};
let overrides = 0;
for (const [k, it] of Object.entries(items)) {
  if (k === 'default' || typeof it !== 'object') continue;
  const ic = String(field(it, 'item_class') || '');
  if (/wearable/.test(ic) || !ic) continue;
  const anim = normalizeRole(field(it, 'anim_slot'));
  if (!anim) continue;
  const base = await weaponRole(ic, tfPath);
  if (base && anim !== base) overrides++;
}
check('items_game anim_slot really overrides the weapon script for some items', overrides > 0, overrides + ' overrides found');

const BOTS = {
  scout: 'models/bots/scout/bot_scout',
  soldier: 'models/bots/soldier/bot_soldier',
  demoman: 'models/bots/demo/bot_demo',
  heavyweapons: 'models/bots/heavy/bot_heavy',
  engineer: 'models/bots/engineer/bot_engineer',
  medic: 'models/bots/medic/bot_medic',
  sniper: 'models/bots/sniper/bot_sniper',
  pyro: 'models/bots/pyro/bot_pyro',
  spy: 'models/bots/spy/bot_spy'
};
const ACTS = ['PRIMARY', 'SECONDARY', 'MELEE', 'MELEE_ALLCLASS', 'ITEM1', 'ITEM2', 'BUILDING', 'PDA'];
const wanted = [];
for (const a of ACTS) { wanted.push('ACT_MP_RUN_' + a, 'ACT_MP_STAND_' + a); }

const CLASS_DEFAULT = {
  scout: 'tf_weapon_scattergun', soldier: 'tf_weapon_rocketlauncher', pyro: 'tf_weapon_flamethrower',
  demoman: 'tf_weapon_grenadelauncher', heavyweapons: 'tf_weapon_minigun', engineer: 'tf_weapon_shotgun_primary',
  medic: 'tf_weapon_medigun', sniper: 'tf_weapon_sniperrifle', spy: 'tf_weapon_revolver'
};

const noDefault = [];
const notDistinct = [];
const notForward = [];
for (const [cls, base] of Object.entries(BOTS)) {
  const map = activityMap(base, wanted);
  if (!map) { noDefault.push(cls + ' (model missing)'); continue; }
  const act = activityForRole(await weaponRole(CLASS_DEFAULT[cls], tfPath));
  if (!map['ACT_MP_RUN_' + act] || !map['ACT_MP_STAND_' + act]) noDefault.push(cls + ' wants ' + act);
  const runs = new Set(), stands = new Set();
  for (const a of ACTS) {
    if (map['ACT_MP_RUN_' + a]) runs.add(map['ACT_MP_RUN_' + a]);
    if (map['ACT_MP_STAND_' + a]) stands.add(map['ACT_MP_STAND_' + a]);
  }
  if (runs.size < 3 || stands.size < 3) notDistinct.push(cls + ' run=' + runs.size + ' stand=' + stands.size);
  for (const n of runs) if (/_?run_?(s|e|w|se|sw|ne|nw)(?![a-z])/i.test(n)) notForward.push(cls + ' ' + n);
}
check('every bot class resolves run and stand for its default weapon', noDefault.length === 0, noDefault.join('; '));
check('each bot class gets at least 3 distinct run and stand animations', notDistinct.length === 0, notDistinct.join('; '));
check('run animations are the forward blend cell, never a strafe cell', notForward.length === 0, notForward.slice(0, 4).join('; '));

const engineer = activityMap(BOTS.engineer, wanted);
check('engineer follows its second $includemodel for primary animations',
  !!(engineer && engineer['ACT_MP_RUN_PRIMARY'] && engineer['ACT_MP_RUN_BUILDING']),
  JSON.stringify({ primary: engineer && engineer['ACT_MP_RUN_PRIMARY'], building: engineer && engineer['ACT_MP_RUN_BUILDING'] }));

const heavy = activityMap(BOTS.heavyweapons, wanted);
check('a Sandvich heavy animates differently from a minigun heavy',
  !!(heavy && heavy['ACT_MP_RUN_ITEM1'] && heavy['ACT_MP_RUN_PRIMARY'] && heavy['ACT_MP_RUN_ITEM1'] !== heavy['ACT_MP_RUN_PRIMARY']),
  JSON.stringify({ item1: heavy && heavy['ACT_MP_RUN_ITEM1'], primary: heavy && heavy['ACT_MP_RUN_PRIMARY'] }));

const scoutBase = loadMDL(BOTS.scout);
check('player hitboxes parse off the bot model', !!scoutBase && scoutBase.hitboxes.length >= 10,
  scoutBase ? scoutBase.hitboxes.length + ' hitboxes' : 'no model');
const badBox = scoutBase ? scoutBase.hitboxes.filter(h => !(h.bone >= 0 && h.bone < scoutBase.bones.length) || !h.max.every((v, i) => v >= h.min[i])) : [];
check('every hitbox names a real bone and has a non-inverted extent', badBox.length === 0, badBox.length + ' bad');

console.log('');
console.log(failures === 0 ? 'all bot animation checks passed' : failures + ' failed');
process.exit(failures === 0 ? 0 : 1);
