import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { traits, registerTraits, knownBotKeys, knownBotFlags } from '../renderer/js/sim/traits.js';
import { botModelBase } from '../renderer/js/botmodels.js';

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

const VIP = `Class Engineer Name "Giant Engineer" ClassIcon vip_blu Health 5000 Skill Expert
	Item "The Death Ranger" Item "Scrap Sentinel"
	Attributes MiniBoss Attributes UseBossHealthBar Scale 1.7
	TeleportWhere spawnbot_allies_l TeleportWhere spawnbot_carrier
	SpawnTemplate EngineerCapzone Tag "bot_vip" Tag "common"
	StripItem "Zombie Engineer" UseCustomModel "models/bots/engineer/bot_engineer.mdl" AimTrackingInterval 0.05
	FireInput { Target engie_hint_node_final Action ForceSpawn Delay 1 Repeats 1 }
	EventChangeAttributes {
		FINAL_NODE_REACHED {
			FireInput { Target node_final_reached Action Trigger Delay 1 Repeats 1 }
			InterruptAction { Target "2289 -2440 250" WaitUntilDone 1 OnDoneChangeAttributes "ENGY_DISSAPEAR" }
		}
		ENGY_DISSAPEAR { FireInput { Target !activator Action runscriptcode Param "self.Destroy()" } }
	}
	CharacterAttributes { "move speed bonus" 0.5  "health regen" 35  "dmg taken from fire reduced" 0.8 }`;
const vip = botOf(VIP);
check('VIP: giant engineer core is read', vip.cls === 'engineer' && vip.health === 5000 && vip.isGiant && vip.isBoss && vip.scale === 1.7, JSON.stringify([vip.cls, vip.health, vip.isGiant, vip.isBoss]));
check('VIP: both TeleportWhere values are kept', vip.teleportWhere.length === 2 && vip.teleportWhere[0] === 'spawnbot_allies_l', JSON.stringify(vip.teleportWhere));
check('VIP: StripItem is captured', vip.stripItems.join() === 'Zombie Engineer');
check('VIP: SpawnTemplate + custom model + aim interval', vip.spawnTemplates[0] === 'EngineerCapzone' && vip.model === 'models/bots/engineer/bot_engineer.mdl' && vip.combat.aimtrackinginterval === '0.05');
check('VIP: move speed 0.5 and health regen 35', vip.moveSpeedMult === 0.5 && vip.healthRegen === 35, JSON.stringify([vip.moveSpeedMult, vip.healthRegen]));
check('VIP: EventChangeAttributes states parsed', vip.eventAttributes.length === 2 && vip.eventAttributes.map(s => s.event).join() === 'FINAL_NODE_REACHED,ENGY_DISSAPEAR');
const finalNode = vip.eventAttributes[0];
check('VIP: the event state captures its FireInputs and interrupt', finalNode.fireInputs.length === 1 && finalNode.interrupts.length === 1);
check('VIP: the OnDoneChangeAttributes chain is captured', finalNode.onDoneChangeAttributes[0] === 'ENGY_DISSAPEAR');
check('VIP: the interrupt point is parsed', JSON.stringify(finalNode.interrupts[0].point) === '[2289,-2440,250]');
check('VIP: every relay the bot fires is surfaced', vip.firedTargets.join() === 'engie_hint_node_final,node_final_reached,!activator', JSON.stringify(vip.firedTargets));

import { readFileSync as rfs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { traitForBlock } from '../renderer/js/sim/traits.js';
import { ACTION_BLOCK_KEYS } from '../renderer/js/popmodel.js';
const here = dirname(fileURLToPath(import.meta.url));
const sigKeys = rfs(join(here, 'fixtures_sigmod_tfbot_keys.txt'), 'utf8').trim().split(/\r?\n/).filter(Boolean);
const knownK = new Set(knownBotKeys());
const unrec = sigKeys.filter(k => { const lk = k.toLowerCase(); return !knownK.has(lk) && !traitForBlock(lk) && !ACTION_BLOCK_KEYS.has(lk); });
check('every SigMod/RafMod top-level TFBot key is recognized (' + sigKeys.length + ' keys)',
  unrec.length === 0, 'unrecognized: ' + unrec.join(', '));

check('GRU grants +30% move speed from the item alone',
  Math.abs(botOf('Class Heavyweapons Item "Gloves of Running Urgently MvM"').moveSpeedMult - 1.3) < 1e-9,
  String(botOf('Class Heavyweapons Item "Gloves of Running Urgently MvM"').moveSpeedMult));
check('the Eviction Notice grants +15%',
  Math.abs(botOf('Class Heavyweapons Item "The Eviction Notice"').moveSpeedMult - 1.15) < 1e-9);
check("the Scotsman's Skullcutter applies -15%",
  Math.abs(botOf(`Class Demoman Item "The Scotsman's Skullcutter"`).moveSpeedMult - 0.85) < 1e-9);
check('the Powerjack grants +15%',
  Math.abs(botOf('Class Pyro Item "The Powerjack"').moveSpeedMult - 1.15) < 1e-9);
check('an item speed and an explicit move speed attribute stack (as in-game)',
  Math.abs(botOf('Class Heavyweapons Item "Gloves of Running Urgently" CharacterAttributes { "move speed bonus" 1.5 }').moveSpeedMult - 1.95) < 1e-9,
  String(botOf('Class Heavyweapons Item "Gloves of Running Urgently" CharacterAttributes { "move speed bonus" 1.5 }').moveSpeedMult));
check('a bot with no speed item is unaffected', botOf('Class Heavyweapons Item "Fists of Steel"').moveSpeedMult === 1);
check('"major move speed bonus" is a move-speed multiplier',
  botOf('Class Scout CharacterAttributes { "major move speed bonus" 1.5 }').moveSpeedMult === 1.5);
check('the raw mult_player_movespeed_active attribute is a move-speed multiplier',
  botOf('Class Scout CharacterAttributes { "mult_player_movespeed_active" 0.5 }').moveSpeedMult === 0.5);
check('CharacterAttributes move speed still multiplies (regression)',
  botOf('Class Pyro CharacterAttributes { "move speed bonus" 0.5 }').moveSpeedMult === 0.5);

check('RafMod UseCustomModel sets the model',
  botOf('Class Soldier UseCustomModel "models/bots/soldier/goliatron2022_v3.mdl"').model === 'models/bots/soldier/goliatron2022_v3.mdl');
check('RafMod UseHumanModel flag is captured',
  botOf('Class Scout UseHumanModel 1').useHumanModel === true);
check('RafMod CustomWeaponModel block captures slot + model',
  (b => b.customWeapons.length === 1 && b.customWeapons[0].slot === 2 && b.customWeapons[0].model === 'models/weapons/c_models/c_atom_launcher/c_atom_launcher.mdl')(
    botOf('Class Demoman CustomWeaponModel { Slot 2 Model "models/weapons/c_models/c_atom_launcher/c_atom_launcher.mdl" }')));
check('RafMod StripItemSlot is captured',
  botOf('Class Heavy StripItemSlot 0 StripItemSlot 1').stripSlots.join() === '0,1');

const gateBody = `Class Scout EventChangeAttributes {
  Default { Tag bot_gatebot Item "MvM GateBot Light Scout" WeaponRestrictions MeleeOnly Attributes IgnoreFlag }
  RevertGateBotsBehavior { Item "MvM GateBot Light Scout" }
}`;
const gateBot = botOf(gateBody);
check('the Default EventChangeAttributes state is applied at spawn, as the game does',
  gateBot.tags.includes('bot_gatebot'), JSON.stringify(gateBot.tags));
check('items inside the Default state reach the bot so gate hats render',
  gateBot.items.includes('MvM GateBot Light Scout'), JSON.stringify(gateBot.items));
check('WeaponRestrictions inside the Default state is honoured',
  String(gateBot.restriction).toLowerCase() === 'meleeonly', String(gateBot.restriction));
check('Attributes inside the Default state are honoured',
  gateBot.attrs.some(a => /ignoreflag/i.test(a)), JSON.stringify(gateBot.attrs));
check('non-default states are still recorded but not applied at spawn',
  gateBot.eventAttributes.map(s => s.event).join(',') === 'Default,RevertGateBotsBehavior',
  gateBot.eventAttributes.map(s => s.event).join(','));

const styleBot = botOf(`Class Scout EventChangeAttributes {
  Default { Item "MvM GateBot Light Scout" ItemAttributes { ItemName "TF_WEAPON_SCATTERGUN" "damage penalty" 0.5 } }
  RevertGateBotsBehavior {
    Item "MvM GateBot Light Scout"
    ItemAttributes { ItemName "MvM GateBot Light Scout" "item style override" 1 }
    ItemAttributes { ItemName "TF_WEAPON_SCATTERGUN" "damage penalty" 0.5 }
  }
}`);
check('a style override in a non-default state is kept separate from the spawn look',
  JSON.stringify(styleBot.itemStyles) === '{}'
  && styleBot.revertItemStyles['mvm gatebot light scout'] === 1,
  JSON.stringify(styleBot.itemStyles) + ' / ' + JSON.stringify(styleBot.revertItemStyles));
check('an ItemAttributes block with no style override adds no style entry',
  Object.keys(styleBot.revertItemStyles).length === 1, JSON.stringify(styleBot.revertItemStyles));

const spawnStyle = botOf('Class Scout Item "MvM GateBot Light Scout" ItemAttributes { ItemName "MvM GateBot Light Scout" "item style override" 1 }');
check('a style override applied at spawn lands on the spawn look',
  spawnStyle.itemStyles['mvm gatebot light scout'] === 1, JSON.stringify(spawnStyle.itemStyles));

const modelOf = body => botModelBase(botOf(body));
check('a MiniBoss gets the giant model CTFBotSpawner picks for it',
  modelOf('Class Soldier Attributes MiniBoss') === 'models/bots/soldier_boss/bot_soldier_boss',
  modelOf('Class Soldier Attributes MiniBoss'));
check('Scale at tf_mvm_miniboss_scale also gets the giant model',
  modelOf('Class Soldier Scale 1.75') === 'models/bots/soldier_boss/bot_soldier_boss',
  modelOf('Class Soldier Scale 1.75'));
check('Scale below tf_mvm_miniboss_scale keeps the normal model',
  modelOf('Class Soldier Scale 1.7') === 'models/bots/soldier/bot_soldier',
  modelOf('Class Soldier Scale 1.7'));
check('a class with no giant model in the game keeps its normal one',
  modelOf('Class Medic Attributes MiniBoss') === 'models/bots/medic/bot_medic',
  modelOf('Class Medic Attributes MiniBoss'));
check('an explicit Model still wins over the giant model',
  modelOf('Class Soldier Attributes MiniBoss Model "models/custom/thing.mdl"') === 'models/custom/thing',
  modelOf('Class Soldier Attributes MiniBoss Model "models/custom/thing.mdl"'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
