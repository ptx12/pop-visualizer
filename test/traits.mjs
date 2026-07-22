import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { traits, registerTraits, knownBotKeys, knownBotFlags } from '../renderer/js/sim/traits.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const throws = fn => { try { fn(); return null; } catch (e) { return e.message; } };

const botOf = body => {
  const pop = `WaveSchedule { Wave { WaveSpawn { Name w TotalCount 1 MaxActive 1 SpawnCount 1 Where spawnbot TFBot { ${body} } } } }`;
  return buildModel(parse(pop), []).waves[0].wavespawns[0].bots[0].bot;
};

const STOCK_KEYS = ['class', 'name', 'health', 'scale', 'skill', 'classicon', 'attributes', 'item', 'tag', 'weaponrestrictions'];
check('every stock TFBot key is registered', STOCK_KEYS.every(k => knownBotKeys().includes(k)),
  knownBotKeys().join(','));
check('every stock Attributes flag is registered',
  ['miniboss', 'usebosshealthbar', 'alwayscrit', 'ignoreflag'].every(f => knownBotFlags().includes(f)),
  knownBotFlags().join(','));

const stock = botOf('Class Soldier Name Bob Health 900 Skill Hard ClassIcon soldier_giant Attributes MiniBoss Attributes AlwaysCrit Item "rocket" Tag t1 WeaponRestrictions PrimaryOnly');
check('stock keys still resolve', stock.cls === 'soldier' && stock.name === 'Bob' && stock.health === 900 &&
  stock.skill === 'Hard' && stock.icon === 'soldier_giant' && stock.items[0] === 'rocket' &&
  stock.tags[0] === 't1' && stock.restriction === 'PrimaryOnly', JSON.stringify(stock.cls));
check('stock flags still resolve', stock.isGiant && stock.alwaysCrit && !stock.isBoss && !stock.ignoreFlag);
check('Scale still implies giant', botOf('Class Pyro Scale 1.8').isGiant);
check('a small Scale does not imply giant', !botOf('Class Pyro Scale 1.2').isGiant);
check('CharacterAttributes still multiply move speed', botOf('Class Pyro CharacterAttributes { "move speed bonus" 0.5 }').moveSpeedMult === 0.5);

check('an unknown key is ignored rather than throwing', botOf('Class Pyro RafmodFutureKey 12').cls === 'pyro');

registerTraits([
  { id: 'test-shield-hp', key: 'shieldhealth', apply(info, value) { info.shieldHealth = parseFloat(value) || 0; } },
  { id: 'test-flag', flag: 'phaseshift', apply(info) { info.canPhase = true; } },
  { id: 'test-attribute', attribute: /^rafmod damage bonus$/i, apply(info, value) { info.rafmodDamage = parseFloat(value); } },
  { id: 'test-block', block: 'rafmodextras', apply(info, node) { info.extras = node.children.filter(c => c.type === 'kv').length; } }
]);

const custom = botOf('Class Demoman ShieldHealth 300 Attributes PhaseShift ItemAttributes { "rafmod damage bonus" 2.5 } RafmodExtras { A 1 B 2 C 3 }');
check('a newly registered key reaches the bot', custom.shieldHealth === 300, String(custom.shieldHealth));
check('a newly registered flag reaches the bot', custom.canPhase === true, String(custom.canPhase));
check('a newly registered item attribute reaches the bot', custom.rafmodDamage === 2.5, String(custom.rafmodDamage));
check('a newly registered block reaches the bot', custom.extras === 3, String(custom.extras));
check('registering new traits does not disturb the stock ones', custom.cls === 'demoman');

check('a trait with no selector is rejected',
  (throws(() => traits.register({ id: 'bad-none', apply() {} })) || '').includes('exactly one'));
check('a trait with two selectors is rejected',
  (throws(() => traits.register({ id: 'bad-two', key: 'a', flag: 'b', apply() {} })) || '').includes('exactly one'));
check('a trait with no apply hook is rejected',
  (throws(() => traits.register({ id: 'bad-apply', key: 'x' })) || '').includes('apply()'));
check('a duplicate trait id is rejected',
  (throws(() => traits.register({ id: 'health', key: 'health', apply() {} })) || '').includes('already registered'));
check('an attribute selector may be a plain string', (() => {
  registerTraits([{ id: 'test-str-attr', attribute: 'rafmod flat bonus', apply(info, v) { info.flatBonus = parseFloat(v); } }]);
  return botOf('Class Pyro ItemAttributes { "rafmod flat bonus" 7 }').flatBonus === 7;
})());

const STOCK_FLAGS = ['removeondeath', 'aggressive', 'isnpc', 'suppressfire', 'disabledodge',
  'becomespectatorondeath', 'quotamananged', 'retainbuildings', 'spawnwithfullcharge', 'alwayscrit',
  'ignoreenemies', 'holdfireuntilfullreload', 'prioritizedefense', 'alwaysfireweapon', 'teleporttohint',
  'miniboss', 'usebosshealthbar', 'ignoreflag', 'autojump', 'airchargeonly', 'prefervaccinatorbullets',
  'prefervaccinatorblast', 'prefervaccinatorfire', 'bulletimmune', 'blastimmune', 'fireimmune',
  'parachute', 'projectileshield'];
check('every attribute in the TF2 AttributeType enum is registered',
  STOCK_FLAGS.every(f => knownBotFlags().includes(f)),
  STOCK_FLAGS.filter(f => !knownBotFlags().includes(f)).join(','));
check('the popfile spelling of the vaccinator attributes is registered',
  ['vaccinatorbullets', 'vaccinatorblast', 'vaccinatorfire'].every(f => knownBotFlags().includes(f)));

const raf = botOf('Class Soldier NoPushAway 1 NoBombUpgrades 1 BehaviorModifiers push MaxVisionRange 900 Attributes BulletImmune Attributes BlastImmune ItemAttributes { "cannot pick up intelligence" 1 } CharacterAttributes { "health from healers reduced" 0.25  "health regen" -1 }');
check('NoPushAway is read', raf.noPushAway === true);
check('NoBombUpgrades is read', raf.noBombUpgrades === true);
check('BehaviorModifiers push marks the bot aggressive', raf.aggressive === true);
check('BehaviorModifiers is recorded verbatim too', raf.behaviorModifiers.join(',') === 'push', raf.behaviorModifiers.join(','));
check('MaxVisionRange lands in the combat bag', raf.combat.maxvisionrange === '900', JSON.stringify(raf.combat));
check('immunities collect into a set', raf.immune.has('bullet') && raf.immune.has('blast'));
check('"cannot pick up intelligence" implies IgnoreFlag', raf.ignoreFlag === true);
check('"health from healers reduced" scales the heal rate', raf.healRateMult === 0.25, String(raf.healRateMult));
check('negative "health regen" is kept as a drain', raf.healthRegen === -1, String(raf.healthRegen));
check('a mobber modifier is distinct from push', botOf('Class Soldier BehaviorModifiers mobber').mobber === true);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
