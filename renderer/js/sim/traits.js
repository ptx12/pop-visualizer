import { createRegistry } from './registry.js';

const SELECTORS = ['key', 'block', 'attribute', 'flag'];

export const traits = createRegistry('bot trait', {
  required: ['apply'],
  optional: [...SELECTORS, 'requires'],
  validate(entry) {
    const used = SELECTORS.filter(s => entry[s] !== undefined);
    if (used.length !== 1) {
      return 'must declare exactly one of ' + SELECTORS.join('/') + ' (got ' + (used.join('+') || 'none') + ')';
    }
    const sel = entry[used[0]];
    if (used[0] === 'attribute') {
      if (!(sel instanceof RegExp) && typeof sel !== 'string') return 'attribute must be a string or RegExp';
    } else if (typeof sel !== 'string' || !sel.trim()) {
      return used[0] + ' must be a non-empty string';
    }
    return null;
  }
});

let index = null;

function build() {
  if (index) return index;
  const byKey = new Map();
  const byBlock = new Map();
  const byFlag = new Map();
  const attributes = [];
  for (const e of traits.ordered()) {
    if (e.key !== undefined) byKey.set(e.key.toLowerCase(), e);
    else if (e.block !== undefined) byBlock.set(e.block.toLowerCase(), e);
    else if (e.flag !== undefined) byFlag.set(e.flag.toLowerCase(), e);
    else attributes.push(e);
  }
  index = { byKey, byBlock, byFlag, attributes };
  return index;
}

export function traitForKey(key) {
  return build().byKey.get(String(key).toLowerCase()) || null;
}

export function traitForBlock(key) {
  return build().byBlock.get(String(key).toLowerCase()) || null;
}

export function traitForFlag(name) {
  return build().byFlag.get(String(name).trim().toLowerCase()) || null;
}

export function traitsForAttribute(name) {
  const out = [];
  for (const e of build().attributes) {
    const sel = e.attribute;
    if (sel instanceof RegExp ? sel.test(name) : sel.toLowerCase() === String(name).toLowerCase()) out.push(e);
  }
  return out;
}

export function registerTraits(list) {
  const ids = traits.registerAll(list);
  index = null;
  return ids;
}

export function knownBotKeys() {
  return [...build().byKey.keys()];
}

export function knownBotFlags() {
  return [...build().byFlag.keys()];
}

const positive = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

registerTraits([
  { id: 'class', key: 'class', apply(info, value, api) { info.cls = api.normalizeClass(value) || 'unknown'; info.clsRaw = value; } },
  { id: 'name', key: 'name', apply(info, value) { info.name = value; } },
  { id: 'health', key: 'health', apply(info, value) { info.health = parseFloat(value) || info.health; } },
  { id: 'scale', key: 'scale', apply(info, value) { info.scale = parseFloat(value); } },
  { id: 'skill', key: 'skill', apply(info, value) { info.skill = value; } },
  { id: 'classicon', key: 'classicon', apply(info, value) { info.icon = value; } },
  { id: 'attributes', key: 'attributes', apply(info, value) { info.attrs.push(value); } },
  { id: 'item', key: 'item', apply(info, value) { info.items.push(value); } },
  { id: 'tag', key: 'tag', apply(info, value) { if (value) info.tags.push(String(value).toLowerCase()); } },
  { id: 'weaponrestrictions', key: 'weaponrestrictions', apply(info, value) { info.restriction = value; } },

  { id: 'interruptaction', block: 'interruptaction', apply(info, node, api) { info.interrupts.push(api.parseInterruptBlock(node)); } },

  {
    id: 'move-speed',
    attribute: /^(move speed bonus|move speed penalty|card: move speed bonus)$/i,
    apply(info, value) { const v = positive(value); if (v) info.moveSpeedMult *= v; }
  },
  {
    id: 'charge-time',
    attribute: /^charge time increased$/i,
    apply(info, value) { const v = positive(value); if (v) info.chargeTimeMult *= v; }
  },
  {
    id: 'charge-recharge',
    attribute: /^charge recharge rate increased$/i,
    apply(info, value) { const v = positive(value); if (v) info.chargeRechargeMult *= v; }
  },

  { id: 'miniboss', flag: 'miniboss', apply(info) { info.isGiant = true; } },
  { id: 'usebosshealthbar', flag: 'usebosshealthbar', apply(info) { info.isBoss = true; } },
  { id: 'alwayscrit', flag: 'alwayscrit', apply(info) { info.alwaysCrit = true; } },
  { id: 'ignoreflag', flag: 'ignoreflag', apply(info) { info.ignoreFlag = true; } },
  { id: 'aggressive', flag: 'aggressive', apply(info) { info.aggressive = true; } },
  { id: 'teleporttohint', flag: 'teleporttohint', apply(info) { info.teleportToHint = true; } },
  { id: 'ignoreenemies', flag: 'ignoreenemies', apply(info) { info.ignoreEnemies = true; } },
  { id: 'autojump', flag: 'autojump', apply(info) { info.autoJump = true; } },
  { id: 'parachute', flag: 'parachute', apply(info) { info.parachute = true; } },
  { id: 'aircharegeonly', flag: 'airchargeonly', apply(info) { info.airChargeOnly = true; } },
  { id: 'bulletimmune', flag: 'bulletimmune', apply(info) { info.immune.add('bullet'); } },
  { id: 'blastimmune', flag: 'blastimmune', apply(info) { info.immune.add('blast'); } },
  { id: 'fireimmune', flag: 'fireimmune', apply(info) { info.immune.add('fire'); } },
  { id: 'projectileshield', flag: 'projectileshield', apply(info) { info.projectileShield = true; } }
]);

const KNOWN_FLAGS = [
  'removeondeath', 'suppressfire', 'disabledodge', 'becomespectatorondeath', 'quotamananged',
  'retainbuildings', 'spawnwithfullcharge', 'holdfireuntilfullreload', 'prioritizedefense',
  'alwaysfireweapon', 'prefervaccinatorbullets', 'prefervaccinatorblast', 'prefervaccinatorfire', 'isnpc'
];
registerTraits(KNOWN_FLAGS.map(f => ({ id: 'flag-' + f, flag: f, apply(info) { info.knownFlags.add(f); } })));

const LOADOUT_KEYS = [
  'stripitemslot', 'dropweapon', 'usecustommodel', 'usehumanmodel', 'usehumananimations',
  'usebustermodel', 'deathsound', 'additionalstepsound', 'customeyeglowcolor', 'alwaysglow',
  'noglow', 'rocketcustomparticle', 'forceromevision', 'voicepitchscale'
];
const COMBAT_KEYS = [
  'maxvisionrange', 'usemeleethreatprioritization', 'aimtrackinginterval', 'aimleadprojectilespeed',
  'aimat', 'aimoffset', 'usebestweapon', 'fastupdate', 'ringoffire', 'rocketjump',
  'autojumpmin', 'autojumpmax', 'nocrouchbuttonrelease', 'scale'
];
registerTraits([
  ...LOADOUT_KEYS.map(k => ({ id: 'loadout-' + k, key: k, apply(info, value) { info.loadout[k] = value; } })),
  ...COMBAT_KEYS.filter(k => k !== 'scale').map(k => ({ id: 'combat-' + k, key: k, apply(info, value) { info.combat[k] = value; } })),
  { id: 'behaviormodifiers', key: 'behaviormodifiers', apply(info, value) {
    const v = String(value || '').trim().toLowerCase();
    info.behaviorModifiers.push(v);
    if (v === 'push') info.aggressive = true;
    if (v === 'mobber') info.mobber = true;
  } },
  { id: 'action', key: 'action', apply(info, value) { info.action = String(value || '').trim(); } },
  { id: 'teleportwhere', key: 'teleportwhere', apply(info, value) { info.teleportWhere = value; } },
  { id: 'nobombupgrades', key: 'nobombupgrades', apply(info, value) { info.noBombUpgrades = String(value) !== '0'; } },
  { id: 'nopushaway', key: 'nopushaway', apply(info, value) { info.noPushAway = String(value) !== '0'; } },
  { id: 'extattr', key: 'extattr', apply(info, value) { info.extAttrs.push(String(value).trim()); } },
  { id: 'spawntemplate', key: 'spawntemplate', apply(info, value) { info.spawnTemplates.push(value); } },
  { id: 'itemname-attr', attribute: /^itemname$/i, apply(info, value) { info.itemNames.push(value); } },
  { id: 'cannot-pick-up-intel', attribute: /^cannot pick up intelligence$/i, apply(info) { info.ignoreFlag = true; } },
  { id: 'health-from-healers', attribute: /^health from healers (reduced|increased)$/i, apply(info, value) {
    const v = parseFloat(value);
    if (Number.isFinite(v) && v >= 0) info.healRateMult *= v;
  } },
  { id: 'health-regen-attr', attribute: /^health regen$/i, apply(info, value) {
    const v = parseFloat(value);
    if (Number.isFinite(v)) info.healthRegen += v;
  } }
]);
