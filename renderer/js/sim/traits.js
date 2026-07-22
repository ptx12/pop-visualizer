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
  { id: 'ignoreflag', flag: 'ignoreflag', apply(info) { info.ignoreFlag = true; } }
]);
