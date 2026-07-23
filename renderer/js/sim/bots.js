export const CLASS_BASE_SPEED = { scout: 400, soldier: 240, pyro: 300, demoman: 280, heavyweapons: 230, engineer: 300, medic: 320, sniper: 300, spy: 320, unknown: 300 };
export const TF_MAX_SPEED = 520;
export const STEP = 0.25;
export const HULL_HALF_XY = 24;
export const HULL_HEIGHT = 82;
export const MINIBOSS_SCALE = 1.75;
export const CARRIER_PENALTY = 0.5;

const SHIELD_RE = /targe|splendid screen|tide turner|shield/i;

export function botScale(bot) {
  if (!bot) return 1;
  if (Number.isFinite(bot.scale) && bot.scale > 0) return bot.scale;
  return bot.isGiant || bot.isBoss ? MINIBOSS_SCALE : 1;
}

// Vanilla items with a static move-speed attribute baked into their schema.
// In TF2 the game applies these automatically when the item is equipped, and any
// explicit CharacterAttributes "move speed" stacks on top — so we apply them
// unconditionally, multiplicatively, matching the game. Values from the TF2 wiki.
const ITEM_MOVE_SPEED = [
  [/gloves of running urgently/i, 1.3],   // GRU: +30% (heavy 230 -> 299)
  [/eviction notice/i, 1.15],             // +15%
  [/scotsman'?s skullcutter/i, 0.85],     // -15% while active
  [/\bpowerjack\b/i, 1.15]                // +15% while active
];

export function itemMoveSpeedMult(items) {
  let mult = 1;
  for (const item of items || []) {
    for (const [re, v] of ITEM_MOVE_SPEED) if (re.test(item)) mult *= v;
  }
  return mult;
}

export function hasDemoShield(bot) {
  if (!bot || bot.cls !== 'demoman') return false;
  if (bot.chargeRechargeMult !== 1 || bot.chargeTimeMult !== 1) return true;
  if ((bot.items || []).some(i => SHIELD_RE.test(i))) return true;
  return /demoknight|samurai/i.test(bot.icon || '');
}

export function botMaxSpeed(bot, hasFlag, penalty = CARRIER_PENALTY, cap = TF_MAX_SPEED) {
  let s = CLASS_BASE_SPEED[bot.cls] ?? 300;
  s *= bot.moveSpeedMult || 1;
  if (hasFlag && !bot.isGiant) s *= penalty;
  return Math.min(s, cap);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dpsProfile(u) {
  if (u > 0.93) return 0;
  return Math.exp(-((u / 0.16) ** 2)) + 0.85 * Math.exp(-(((u - 0.8) / 0.2) ** 2)) + 0.08;
}
