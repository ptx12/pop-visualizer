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
  { id: 'model', key: 'model', apply(info, value) { if (value) info.model = String(value).replace(/\\/g, '/'); } },
  { id: 'tag', key: 'tag', apply(info, value) { if (value) info.tags.push(String(value).toLowerCase()); } },
  { id: 'weaponrestrictions', key: 'weaponrestrictions', apply(info, value) { info.restriction = value; } },

  { id: 'interruptaction', block: 'interruptaction', apply(info, node, api) { info.interrupts.push(api.parseInterruptBlock(node)); } },
  { id: 'eventchangeattributes', block: 'eventchangeattributes', apply(info, node, api) {
    for (const ev of node.children || []) {
      if (ev.type !== 'block') continue;
      const state = { event: ev.key, node: ev, fireInputs: [], interrupts: [], onDoneChangeAttributes: [] };
      for (const c of ev.children || []) {
        if (c.type !== 'block') continue;
        const ck = c.key.toLowerCase();
        if (ck === 'fireinput') state.fireInputs.push(api.parseActionBlock(c));
        else if (ck === 'interruptaction') {
          const ia = api.parseInterruptBlock(c);
          state.interrupts.push(ia);
          const next = api.getValue(c, 'OnDoneChangeAttributes', null);
          if (next) state.onDoneChangeAttributes.push(next);
        }
      }
      info.eventAttributes.push(state);
    }
  } },

  {
    id: 'move-speed',
    attribute: /^(major move speed bonus|card: move speed bonus|move speed bonus|move speed penalty|mult_player_movespeed(_active)?)$/i,
    apply(info, value) { const v = positive(value); if (v) info.moveSpeedMult *= v; }
  },
  {
    id: 'uber-rate',
    attribute: /^ubercharge rate bonus$/i,
    apply(info, value) { const v = positive(value); if (v) info.uberRateMult *= v; }
  },
  {
    id: 'uber-duration',
    attribute: /^uber duration bonus$/i,
    apply(info, value) { const v = parseFloat(value); if (Number.isFinite(v)) info.uberDurationAdd += v; }
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

  { id: 'miniboss', flag: 'miniboss', apply(info) { info.isGiant = true; info.isMiniBoss = true; } },
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
  'alwaysfireweapon', 'isnpc',
  'prefervaccinatorbullets', 'prefervaccinatorblast', 'prefervaccinatorfire',
  'vaccinatorbullets', 'vaccinatorblast', 'vaccinatorfire'
];
registerTraits(KNOWN_FLAGS.map(f => ({ id: 'flag-' + f, flag: f, apply(info) { info.knownFlags.add(f); } })));

const LOADOUT_KEYS = [
  'dropweapon', 'usehumananimations',
  'deathsound', 'additionalstepsound', 'customeyeglowcolor', 'alwaysglow',
  'noglow', 'rocketcustomparticle', 'forceromevision', 'voicepitchscale',
  'skin', 'bodypartscalespeed', 'rocketcustommodel', 'painsound', 'firesound'
];
const COMBAT_KEYS = [
  'maxvisionrange', 'usemeleethreatprioritization', 'aimtrackinginterval', 'aimleadprojectilespeed',
  'aimat', 'aimoffset', 'usebestweapon', 'fastupdate', 'ringoffire', 'rocketjump',
  'autojumpmin', 'autojumpmax', 'nocrouchbuttonrelease', 'scale',
  'desiredattackrange', 'movebehindenemy', 'followcrosshair', 'aimtime', 'mindotproduct'
];

const RECOGNIZED_BLOCKS = [
  'damageappliescond', 'fireweapon', 'homingrockets', 'itemcolor', 'itemmodel', 'message',
  'customweaponmodel', 'shoottemplate', 'spell', 'taunt', 'voicecommand', 'weaponresist',
  'weaponswitch', 'sequence', 'clientcommand', 'add-', 'removeattribute', 'addattribute'
];
registerTraits([
  ...LOADOUT_KEYS.map(k => ({ id: 'loadout-' + k, key: k, apply(info, value) { info.loadout[k] = value; } })),
  ...COMBAT_KEYS.filter(k => k !== 'scale').map(k => ({ id: 'combat-' + k, key: k, apply(info, value) { info.combat[k] = value; } })),
  ...RECOGNIZED_BLOCKS.map(k => ({ id: 'block-' + k, block: k, apply(info, node) { (info.blocks[k] || (info.blocks[k] = [])).push(node); } })),
  { id: 'behaviormodifiers', key: 'behaviormodifiers', apply(info, value) {
    const v = String(value || '').trim().toLowerCase();
    info.behaviorModifiers.push(v);
    if (v === 'push') info.aggressive = true;
    if (v === 'mobber') info.mobber = true;
  } },
  { id: 'action', key: 'action', apply(info, value) {
    info.action = String(value || '').trim();
    if (/^mobber$/i.test(info.action)) info.mobber = true;
  } },
  { id: 'teleportwhere', key: 'teleportwhere', apply(info, value) { if (value) info.teleportWhere.push(String(value)); } },
  { id: 'nobombupgrades', key: 'nobombupgrades', apply(info, value) { info.noBombUpgrades = String(value) !== '0'; } },
  { id: 'nopushaway', key: 'nopushaway', apply(info, value) { info.noPushAway = String(value) !== '0'; } },
  { id: 'extattr', key: 'extattr', apply(info, value) { info.extAttrs.push(String(value).trim()); } },
  { id: 'spawntemplate', key: 'spawntemplate', apply(info, value) { info.spawnTemplates.push(value); } },
  { id: 'stripitem', key: 'stripitem', apply(info, value) { info.stripItems.push(value); } },
  { id: 'suppresstimedfetchflag', key: 'suppresstimedfetchflag', apply(info, value) { info.suppressFetch = String(value) !== '0'; } },
  { id: 'neutral', key: 'neutral', apply(info, value) { info.neutral = String(value) !== '0'; } },
  { id: 'addcond', block: 'addcond', apply(info, node, api) {
    info.addConds.push({
      index: api.getValue(node, 'Index', null),
      name: api.getValue(node, 'Name', null),
      duration: parseFloat(api.getValue(node, 'Duration', '-1')),
      delay: parseFloat(api.getValue(node, 'Delay', '0')) || 0
    });
  } },
  { id: 'changeattributes', block: 'changeattributes', apply(info, node) { info.changeAttributes.push({ name: node.key, node }); } },
  { id: 'itemname-attr', attribute: /^itemname$/i, apply(info, value) { info.itemNames.push(value); } },
  { id: 'cannot-pick-up-intel', attribute: /^cannot pick up intelligence$/i, apply(info) { info.ignoreFlag = true; } },
  { id: 'health-from-healers', attribute: /^health from healers (reduced|increased)$/i, apply(info, value) {
    const v = parseFloat(value);
    if (Number.isFinite(v) && v >= 0) info.healRateMult *= v;
  } },
  { id: 'health-regen-attr', attribute: /^health regen$/i, apply(info, value) {
    const v = parseFloat(value);
    if (Number.isFinite(v)) info.healthRegen += v;
  } },
  { id: 'usecustommodel', key: 'usecustommodel', apply(info, value) { if (value) info.model = String(value).replace(/\\/g, '/').trim(); } },
  { id: 'usehumanmodel', key: 'usehumanmodel', apply(info, value) { info.useHumanModel = String(value) !== '0'; } },
  { id: 'usebustermodel', key: 'usebustermodel', apply(info, value) { info.useBusterModel = String(value) !== '0'; } },
  { id: 'customweaponmodel', block: 'customweaponmodel', apply(info, node, api) {
    const m = api.getValue(node, 'Model', null);
    if (m) info.customWeapons.push({ slot: parseInt(api.getValue(node, 'Slot', '0'), 10) || 0, model: String(m).replace(/\\/g, '/').trim() });
  } },
  { id: 'stripitemslot', key: 'stripitemslot', apply(info, value) { const s = parseInt(value, 10); if (Number.isFinite(s)) info.stripSlots.push(s); } }
]);
