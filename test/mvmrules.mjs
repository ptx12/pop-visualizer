import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const SDK = join(repo, 'wasm', 'simcore', 'sdk');
const BUILD = join(repo, 'wasm', 'simcore', 'build.sh');

if (!existsSync(SDK) || !existsSync(BUILD)) {
  console.log('skip mvm rule audit: vendored sdk not present');
  process.exit(0);
}

const buildText = readFileSync(BUILD, 'utf8');
const cache = new Map();
function src(rel) {
  if (!cache.has(rel)) {
    const p = join(SDK, rel);
    cache.set(rel, existsSync(p) ? readFileSync(p, 'utf8') : null);
  }
  return cache.get(rel);
}

const compiled = new Set();
function rule(section, name, rel, re) {
  const text = src(rel);
  if (text === null) { check(`${section} ${name}`, false, `${rel} missing from the vendored sdk`); return; }
  if (rel.endsWith('.cpp')) compiled.add(rel);
  check(`${section} ${name}`, re.test(text), `no match for ${re} in ${rel}`);
}
function absent(section, name, rel, re) {
  const text = src(rel);
  if (text === null) { check(`${section} ${name}`, false, `${rel} missing from the vendored sdk`); return; }
  check(`${section} ${name}`, !re.test(text), `unexpected match for ${re} in ${rel}`);
}

const FLAG = 'game/shared/tf/entity_capture_flag.cpp';
const NAVMESH = 'game/server/tf/nav_mesh/tf_nav_mesh.cpp';
const NAVAREA = 'game/server/tf/nav_mesh/tf_nav_area.h';
const POPULATORS = 'game/server/tf/player_vs_environment/tf_populators.cpp';
const SPAWNERS = 'game/server/tf/player_vs_environment/tf_populator_spawners.cpp';
const SPAWNERS_H = 'game/server/tf/player_vs_environment/tf_populator_spawners.h';
const POPMGR = 'game/server/tf/player_vs_environment/tf_population_manager.cpp';
const MVMLOGIC = 'game/server/tf/player_vs_environment/tf_mann_vs_machine_logic.cpp';
const DELIVER = 'game/server/tf/bot/behavior/scenario/capture_the_flag/tf_bot_deliver_flag.cpp';
const DEPLOY = 'game/server/tf/bot/behavior/tf_bot_mvm_deploy_bomb.cpp';
const BUSTER = 'game/server/tf/bot/behavior/missions/tf_bot_mission_suicide_bomber.cpp';
const TANK = 'game/server/tf/player_vs_environment/tf_tank_boss.cpp';
const CURRENCY = 'game/server/tf/entity_currencypack.cpp';
const ENGIDLE = 'game/server/tf/bot/behavior/engineer/mvm_engineer/tf_bot_mvm_engineer_idle.cpp';
const ENGTELE = 'game/server/tf/bot/behavior/engineer/mvm_engineer/tf_bot_mvm_engineer_build_teleporter.cpp';
const ENGSENTRY = 'game/server/tf/bot/behavior/engineer/mvm_engineer/tf_bot_mvm_engineer_build_sentry.cpp';
const GAMERULES = 'game/shared/tf/tf_gamerules.cpp';
const PLAYER = 'game/server/tf/tf_player.cpp';
const PLAYERSHARED = 'game/shared/tf/tf_player_shared.cpp';
const BOT_H = 'game/server/tf/bot/tf_bot.h';
const BOT = 'game/server/tf/bot/tf_bot.cpp';
const LOCOMOTION = 'game/server/tf/bot/tf_bot_locomotion.cpp';

console.log('core constants');
rule('const', 'the invader cap is a cvar defaulting to 22', GAMERULES,
  /tf_mvm_max_invaders\(\s*"tf_mvm_max_invaders",\s*"22"/);
rule('const', 'the mvm logic thinks every 0.05 seconds', MVMLOGIC,
  /SetNextThink\(\s*gpGlobals->curtime\s*\+\s*0\.05f\s*\)/);
rule('const', 'the relative spawn buffer is 3000 units', POPMGR,
  /tf_populator_active_buffer_range\(\s*"tf_populator_active_buffer_range",\s*"3000"/);
rule('const', 'the bot death drop height is 1000', LOCOMOTION,
  /GetDeathDropHeight\([^)]*\)\s*const\s*\{?\s*[\s\S]{0,80}return\s+1000\.0f;/);
rule('const', 'buyback grants 3 charges per wave', GAMERULES,
  /tf_mvm_buybacks_per_wave\(\s*"tf_mvm_buybacks_per_wave",\s*"3"/);
rule('const', 'the sentry buster damage threshold defaults to 3000', POPMGR,
  /tf_mvm_default_sentry_buster_damage_dealt_threshold\(\s*"[^"]+",\s*"3000"/);
rule('const', 'the sentry buster kill threshold defaults to 15', POPMGR,
  /tf_mvm_default_sentry_buster_kill_threshold\(\s*"[^"]+",\s*"15"/);

console.log('\n1. bomb entity, drop, return and alarm');
rule('1.5', 'the drop test compares the area absolute z against half human height', FLAG,
  /float height = bombArea->GetZ\( bombPos \);[\s\S]{0,120}if \( height > HalfHumanHeight \)/);
rule('1.5', 'a failed drop searches a 500 unit extent for a legal area', FLAG,
  /BOMB_CAN_DROP_HERE[\s\S]{0,600}closest/i);
rule('1.9', 'the alarm scan is throttled to 0.1 seconds', MVMLOGIC,
  /m_flNextAlarmCheck\s*=\s*gpGlobals->curtime\s*\+\s*0\.1;/);
rule('1.9', 'the alarm fires the event only on the false to true edge', MVMLOGIC,
  /GetMannVsMachineAlarmStatus\(\) == false[\s\S]{0,260}mvm_bomb_alarm_triggered/);
rule('1.9', 'the alarm scan returns as soon as one stolen bomb matches', MVMLOGIC,
  /SetMannVsMachineAlarmStatus\( true \);\s*return;/);

console.log('\n2. multiple bombs');
rule('2.1', 'any bomb resetting stomps the one global upgrade display to level zero', FLAG,
  /SetFlagCarrierUpgradeLevel\( 0 \);\s*TFObjectiveResource\(\)->SetBaseMvMBombUpgradeTime\( -1 \);\s*TFObjectiveResource\(\)->SetNextMvMBombUpgradeTime\( -1 \);/);
rule('2.1', 'the endless reset latch is a single consumable flag on the population manager', POPMGR,
  /bool CPopulationManager::EndlessShouldResetFlag \(\)\s*\{\s*return m_bShouldResetFlag;/);
rule('2.1', 'a bomb consuming the endless latch clears it for every other bomb', FLAG,
  /IsInEndlessWaves\(\) && g_pPopulationManager->EndlessShouldResetFlag\(\)/);
rule('2.1', 'each bomb keeps its own stored reset transform', FLAG,
  /m_vecResetPos\b/);
rule('2.2', 'an invader engineer never fetches a bomb', BOT,
  /GetTeamNumber\(\) == TF_TEAM_PVE_INVADERS && IsPlayerClass\( TF_CLASS_ENGINEER \)\s*\)\s*\{\s*return NULL;/);
rule('2.2', 'a bot carrying the ignore flag attribute never fetches a bomb', BOT,
  /HasAttribute\( CTFBot::IGNORE_FLAG \)\s*\)\s*\{\s*return NULL;/);
rule('2.2', 'an existing explicit flag target short circuits the whole selection', BOT,
  /IsMannVsMachineMode\(\) && HasFlagTaget\(\)\s*\)\s*\{\s*return GetFlagTarget\(\);/);
rule('2.2', 'a lower follower count discards every candidate found so far', BOT,
  /pFlag->GetNumFollowers\(\) < nMinFollower \)\s*\{\s*nMinFollower = pFlag->GetNumFollowers\(\);\s*pClosestFlag = NULL;/);
rule('2.2', 'proximity is only compared inside the minimum follower group', BOT,
  /if \( pFlag->GetNumFollowers\(\) == nMinFollower \)\s*\{[\s\S]{0,200}flDist < flClosestFlagDist/);
rule('2.2', 'the uncarried preference applies only within that same group', BOT,
  /nCarriedFlags < flagsVector\.Count\(\) && !pFlag->IsStolen\(\)/);

console.log('\n3. carrier upgrades and deployment');
rule('3.2', 'the first upgrade interval is 5 seconds', DELIVER,
  /tf_mvm_bot_flag_carrier_interval_to_1st_upgrade\(\s*"[^"]+",\s*"5"/);
rule('3.2', 'the second upgrade interval is 15 seconds', DELIVER,
  /tf_mvm_bot_flag_carrier_interval_to_2nd_upgrade\(\s*"[^"]+",\s*"15"/);
rule('3.2', 'the third upgrade interval is 15 seconds', DELIVER,
  /tf_mvm_bot_flag_carrier_interval_to_3rd_upgrade\(\s*"[^"]+",\s*"15"/);
rule('3.2', 'level 2 adds the health regen attribute at 45', DELIVER,
  /tf_mvm_bot_flag_carrier_health_regen\(\s*"[^"]+",\s*"45/);
rule('3.2', 'level 3 adds a permanent crit boost', DELIVER,
  /AddCond\(\s*TF_COND_CRITBOOSTED\s*\)/);
rule('3.2', 'the defense buff radius is 450 units', DELIVER,
  /const float buffRadius = 450\.0f;/);
rule('3.2', 'the defense buff lasts 1.2 seconds', DELIVER,
  /AddCond\(\s*TF_COND_DEFENSEBUFF_NO_CRIT_BLOCK,\s*1\.2f\s*\)/);
rule('3.2', 'the buff radius test is strictly less than', DELIVER,
  /IsRangeLessThan\(\s*playerVector\[\s*i\s*\],\s*buffRadius\s*\)/);
rule('3.1', 'the carrier is allowed to fight by default', DELIVER,
  /tf_mvm_bot_allow_flag_carrier_to_fight\(\s*"[^"]+",\s*"1"/);
rule('3.6', 'deploy aborts past 20 units of anchor drift', DEPLOY,
  /const float movedRange = 20\.0f;/);
rule('3.6', 'deploy holds the hidden invulnerable state for 2 seconds', DEPLOY,
  /m_timer\.Start\(\s*2\.0f\s*\);[\s\S]{0,200}m_takedamage = DAMAGE_NO;[\s\S]{0,80}AddEffects\( EF_NODRAW \)/);
rule('3.6', 'the carrier crushes itself for 99999.9 after the hold', DEPLOY,
  /99999\.9f,\s*DMG_CRUSH/);
rule('3.4', 'a repath that grows the route by over 2000 units is read as a push back', DELIVER,
  /flOldTravelDistance != -1\.0f && m_flTotalTravelDistance - flOldTravelDistance > 2000\.0f/);
rule('3.4', 'the recognised push back pays the pushers 100 bonus points', DELIVER,
  /Event_PlayerAwardBonusPoints\( pPlayer, me, 100 \)/);
absent('3.4', 'the push back recognition never moves or resets the bomb', DELIVER,
  /2000\.0f[\s\S]{0,900}(ResetFlag|SetAbsOrigin)\(/);

console.log('\n4. nav attribute bits');
const navBits = [
  ['BLOCKED', '0x00000001'], ['SPAWN_ROOM_RED', '0x00000002'], ['SPAWN_ROOM_BLUE', '0x00000004'],
  ['SPAWN_ROOM_EXIT', '0x00000008'], ['HAS_AMMO', '0x00000010'], ['HAS_HEALTH', '0x00000020'],
  ['CONTROL_POINT', '0x00000040'], ['BLUE_SENTRY_DANGER', '0x00000080'], ['RED_SENTRY_DANGER', '0x00000100'],
  ['BLUE_SETUP_GATE', '0x00000800'], ['RED_SETUP_GATE', '0x00001000'],
  ['BLOCKED_AFTER_POINT_CAPTURE', '0x00002000'], ['BLOCKED_UNTIL_POINT_CAPTURE', '0x00004000'],
  ['BLUE_ONE_WAY_DOOR', '0x00008000'], ['RED_ONE_WAY_DOOR', '0x00010000'],
  ['WITH_SECOND_POINT', '0x00020000'], ['WITH_THIRD_POINT', '0x00040000'],
  ['WITH_FOURTH_POINT', '0x00080000'], ['WITH_FIFTH_POINT', '0x00100000'],
  ['SNIPER_SPOT', '0x00200000'], ['SENTRY_SPOT', '0x00400000'],
  ['ESCAPE_ROUTE', '0x00800000'], ['ESCAPE_ROUTE_VISIBLE', '0x01000000'],
  ['NO_SPAWNING', '0x02000000'], ['RESCUE_CLOSET', '0x04000000'], ['BOMB_CAN_DROP_HERE', '0x08000000'],
  ['DOOR_NEVER_BLOCKS', '0x10000000'], ['DOOR_ALWAYS_BLOCKS', '0x20000000'], ['UNBLOCKABLE', '0x40000000']
];
const navText = src(NAVAREA) || '';
const navWrong = navBits.filter(([n, v]) => !new RegExp(`TF_NAV_${n}\\s*=\\s*${v}\\s*,`).test(navText));
check(`4 all ${navBits.length} nav attribute bits hold their documented values`, navWrong.length === 0,
  navWrong.map(([n, v]) => `${n} != ${v}`).join(', '));

console.log('\n5. nav recomputation and floods');
rule('5.1', 'the recompute order runs decorate, block, incursion, invasion, drop, target', NAVMESH,
  /RemoveAllMeshDecoration\(\);\s*DecorateMesh\(\);\s*ComputeBlockedAreas\(\);[\s\S]{0,80}ComputeIncursionDistances\(\);\s*ComputeInvasionAreas\(\);\s*ComputeLegalBombDropAreas\(\);\s*ComputeBombTargetDistance\(\)/);
rule('5.7', 'the legal drop flood root is the last blue spawn area iterated', NAVMESH,
  /if \( area->HasAttributeTF\( TF_NAV_SPAWN_ROOM_BLUE \) \)\s*\{\s*startArea = area;\s*\}/);
rule('5.7', 'the legal drop flood rejects edges above step height', NAVMESH,
  /ComputeAdjacentConnectionHeightChange\( adjArea \) > StepHeight/);
rule('5.7', 'the legal drop flood skips tagging both spawn rooms but still expands through them', NAVMESH,
  /if \( !adjArea->HasAttributeTF\( TF_NAV_SPAWN_ROOM_BLUE \| TF_NAV_SPAWN_ROOM_RED \) \)\s*\{[\s\S]{0,140}SetAttributeTF\( TF_NAV_BOMB_CAN_DROP_HERE \);\s*\}\s*adjArea->Mark\(\)/);
rule('5.8', 'the bomb target flood assigns the zone before testing its team', NAVMESH,
  /zone = static_cast< CCaptureZone\* >\( ICaptureZoneAutoList::AutoList\(\)\[i\] \);\s*if \( zone->GetTeamNumber\(\) == TF_TEAM_PVE_INVADERS \)/);
rule('5.8', 'the bomb target flood only reports no zone when the list is empty', NAVMESH,
  /if \( zone == NULL \)\s*\{\s*Warning\( "Can't find bomb delivery zone\." \);/);
rule('5.8', 'the bomb target flood searches within 500 units with ground checking', NAVMESH,
  /GetNearestNavArea\( zone->WorldSpaceCenter\(\), false, 500\.0f, true \)/);
rule('5.8', 'the bomb target flood rejects edges above jump height', NAVMESH,
  /ComputeAdjacentConnectionHeightChange\( adjArea \) > TF_PLAYER_JUMP_HEIGHT/);
rule('5.8', 'the bomb target flood relaxes with a 0.001 tolerance', NAVMESH,
  /float flTol = \.001f;/);
rule('5.3', 'unblockable areas short circuit the blocked test', NAVAREA.replace('.h', '.cpp'),
  /TF_NAV_UNBLOCKABLE[\s\S]{0,120}return false;/);

console.log('\n6. bot path cost');
rule('6', 'the first area in a path costs nothing', BOT_H,
  /if \( fromArea == NULL \)\s*\{[\s\S]{0,80}return 0\.0f;/);
rule('6', 'a jumpable rise doubles the segment', BOT_H,
  /const float jumpPenalty = 2\.0f;\s*dist \*= jumpPenalty;/);
rule('6', 'the default route preference term is the documented cosine', BOT_H,
  /preference = 1\.0f \+ 50\.0f \* \( 1\.0f \+ FastCos\( \(float\)\( m_me->GetEntity\(\)->entindex\(\) \* area->GetID\(\) \* timeMod \) \) \)/);
rule('6', 'the route epoch changes every ten seconds', BOT_H,
  /int timeMod = \(int\)\( gpGlobals->curtime \/ 10\.0f \) \+ 1;/);
rule('6', 'the safest route costs combat areas four times intensity', BOT_H,
  /const float combatDangerCost = 4\.0f;\s*dist \*= combatDangerCost \* area->GetCombatIntensity\(\)/);
rule('6', 'the safest route costs sentry danger five times', BOT_H,
  /const float sentryDangerCost = 5\.0f;/);

console.log('\n7. population spawn location');
rule('7.3', 'ahead and behind draw from the skewed value', POPULATORS,
  /case AHEAD:[\s\S]{0,160}SkewedRandomValue\(\) \* theaterAreaVector\.Count\(\);[\s\S]{0,200}case BEHIND:[\s\S]{0,200}\( 1\.0f - SkewedRandomValue\(\) \) \* theaterAreaVector\.Count\(\)/);
rule('7.3', 'the skewed value is the larger of two uniforms', SPAWNERS_H,
  /inline float SkewedRandomValue\( void \)\s*\{\s*float x = RandomFloat\( 0, 1\.0f \);\s*float y = RandomFloat\( 0, 1\.0f \);\s*return x < y \? y : x;/);
rule('7.3', 'anywhere draws uniformly', POPULATORS,
  /case ANYWHERE:[\s\S]{0,120}RandomFloat\( 0\.0f, 1\.0f \) \* theaterAreaVector\.Count\(\)/);
rule('7.3', 'npc invaders are excluded from the theater scan', POPULATORS,
  /bot->HasAttribute\( CTFBot::IS_NPC \)\s*\)?\s*\n?\s*continue;/);
rule('7.3', 'candidate areas must be valid for a wandering population', POPULATORS,
  /!area->IsValidForWanderingPopulation\(\)\s*\)?\s*\n?\s*continue;/);
rule('7.2', 'teleporter spawns grant invulnerability and its wearing off condition', POPULATORS,
  /AddCond\( TF_COND_INVULNERABLE, flUberTime \);\s*bot->m_Shared\.AddCond\( TF_COND_INVULNERABLE_WEARINGOFF, flUberTime \)/);
rule('7.2', 'a spy teleporting in gets neither the effect nor the invulnerability', POPULATORS,
  /if \( !bot->IsPlayerClass\( TF_CLASS_SPY \) \)[\s\S]{0,260}AddCond\( TF_COND_INVULNERABLE, flUberTime \)/);

console.log('\n9. wave and wavespawn state machines');
rule('9.4', 'the reserved invader slot count is shared across every wavespawn', POPULATORS,
  /int CWaveSpawnPopulator::m_reservedPlayerSlotCount = 0;/);
rule('9.4', 'entering pending resets the shared reservation', POPULATORS,
  /m_reservedPlayerSlotCount = 0;/);
rule('9.4', 'reservation respects the combined invader cap', POPULATORS,
  /currentEnemyCount \+ m_spawnCount \+ m_reservedPlayerSlotCount > tf_mvm_max_invaders\.GetInt\(\)/);
rule('9.4', 'a wavespawn reserves its whole spawn count', POPULATORS,
  /m_reservedPlayerSlotCount \+= m_spawnCount;\s*m_myReservedSlotCount = m_spawnCount;/);
rule('9.4', 'reservation is released by the number actually spawned', POPULATORS,
  /slotsToReleaseCount = \( justSpawnedCount <= m_myReservedSlotCount \) \? justSpawnedCount : m_myReservedSlotCount;/);
rule('9.5', 'currency per death is integer division of what is left', POPULATORS,
  /nCurrency = m_unallocatedCurrency \/ m_remainingCount;\s*m_unallocatedCurrency -= nCurrency;\s*m_remainingCount--;/);
rule('9.5', 'support respawn allocation resets the remaining count to the active handles', POPULATORS,
  /m_remainingCount = m_activeVector\.Count\(\);/);
rule('9.2', 'the unallocated currency and remaining count are seeded from the parsed totals', POPULATORS,
  /m_unallocatedCurrency = m_totalCurrency;\s*m_remainingCount = m_totalCount;/);

console.log('\n10. spawners and bot attributes');
rule('10.1', 'the vertical clearance loop retests the same step height offset', SPAWNERS,
  /for\( z = 0\.0f; z<StepHeight; z \+= 4\.0f \)\s*\{\s*here\.z = rawHere\.z \+ StepHeight;/);
rule('10.2', 'an existing item attribute is stomped and still appended', SPAWNERS,
  /m_value = newStaticAttrib\.m_value;[\s\S]{0,220}\}\s*\/\/ couldn't find\? add new attribute entry\s*botItemAttrs\.m_attributes\.AddToTail\( newStaticAttrib \);/);
rule('10.2', 'skill names map easy through expert', SPAWNERS,
  /"Easy"[\s\S]{0,400}"Expert"/);
rule('10.3', 'a sentry gun spawner builds one level above the requested level', SPAWNERS,
  /sentry->m_nDefaultUpgradeLevel = m_level\+1;/);

console.log('\n11. missions and sentry busters');
rule('11.1', 'seek and destroy parses to the destroy sentries mission', POPULATORS,
  /"SeekAndDestroy"[\s\S]{0,120}MISSION_DESTROY_SENTRIES/);
rule('11.2', 'danger scans recur every five to ten seconds', POPULATORS,
  /m_checkForDangerousSentriesTimer\.Start\( RandomFloat\( 5\.0f, 10\.0f \) \)/);
rule('11.3', 'the buster blast radius defaults to 300', BUSTER,
  /tf_bot_suicide_bomb_range\(\s*"tf_bot_suicide_bomb_range",\s*"300"/);
rule('11.3', 'the buster starts detonating at a third of its radius', BUSTER,
  /const float detonateRange = tf_bot_suicide_bomb_range\.GetFloat\(\) \/ 3\.0f;/);
rule('11.3', 'the detonation windup is 2 seconds', BUSTER,
  /m_detonateTimer\.Start\(\s*2\.0f\s*\)/);
rule('11.3', 'the blast deals four times the larger of max and current health', BUSTER,
  /int damage = MAX\( victim->GetMaxHealth\(\), victim->GetHealth\(\) \);\s*CTakeDamageInfo info\( me, me, 4 \* damage, DMG_BLAST/);
rule('11.3', 'the blast requires a clear line of fire', BUSTER,
  /me->IsLineOfFireClear\( victim \)/);
rule('11.3', 'friendly fire is forced on by default', BUSTER,
  /tf_bot_suicide_bomb_friendly_fire\(\s*"[^"]+",\s*"1"/);
rule('11.3', 'dropping to one health starts the detonation', BUSTER,
  /if \( me->GetHealth\(\) == 1 \)/);
rule('11.3', 'the windup holds the buster alive at one health and refuses damage', BUSTER,
  /me->m_lifeState = LIFE_ALIVE;\s*me->SetHealth\( 1 \);[\s\S]{0,200}me->m_takedamage = DAMAGE_NO;/);
rule('11.3', 'a buster killed during the windup is revived at one health instead', BUSTER,
  /else if \( m_detonateTimer\.IsElapsed\(\) \)\s*\{\s*Detonate\( me \);\s*\}\s*else\s*\{[\s\S]{0,200}me->m_lifeState = LIFE_ALIVE;\s*me->SetHealth\( 1 \);/);

console.log('\n12. tanks');
rule('12.1', 'a path node counts as reached inside 20 units', TANK,
  /if \( range < 20\.0f \)/);
rule('12.2', 'destroy at capture point crushes for 9999999.9', TANK,
  /9999999\.9f, DMG_CRUSH/);
rule('12.3', 'minigun damage to a tank is quartered', TANK,
  /const float minigunFactor = 0\.25f;/);
rule('12.3', 'the rumble timer repeats every quarter second', TANK,
  /m_rumbleTimer\.Start\( 0\.25f \)/);

console.log('\n13. currency');
rule('13.1', 'a pack blinks for its last five seconds', CURRENCY,
  /#define TF_CURRENCYPACK_BLINK_PERIOD\s+5\.0f/);
rule('13.1', 'each blink lasts a quarter second', CURRENCY,
  /#define TF_CURRENCYPACK_BLINK_DURATION\s+0\.25f/);
rule('13.1', 'blinking toggles alpha between 25 and 255', CURRENCY,
  /SetRenderColorA\( 25 \)[\s\S]{0,120}SetRenderColorA\( 255 \)/);
rule('13.2', 'scouts collect at 288 units and everyone else at 72', PLAYERSHARED,
  /const int nRadiusSqr = bScout \? 288 \* 288 : 72 \* 72;/);
rule('13.2', 'scouts rescan every 0.15 seconds and others every 0.25', PLAYERSHARED,
  /bScout \? gpGlobals->curtime \+ 0\.15f : gpGlobals->curtime \+ 0\.25f/);
rule('13.3', 'a scout below max health heals 50 and otherwise 25', CURRENCY,
  /int nHealth = nCurHealth < nMaxHealth \? 50 : 25;/);
rule('13.2', 'a scout claims a pack so nobody else can take it', PLAYERSHARED,
  /pCurrencyPack->SetClaimed\(\);/);
rule('13.2', 'the claimed pack carries a forced touch deadline one second out', PLAYERSHARED,
  /packinfo\.flTime = gpGlobals->curtime \+ 1\.f;/);
rule('13.2', 'the deadline forces the touch', PLAYERSHARED,
  /if \( m_CurrencyPacks\[i\]\.flTime <= gpGlobals->curtime \)\s*\{\s*m_CurrencyPacks\[i\]\.hPack->Touch\( m_pOuter \);/);
rule('13.2', 'everyone other than a scout touches the pack immediately', PLAYERSHARED,
  /\}\s*else\s*\{\s*pCurrencyPack->Touch\( m_pOuter \);\s*\}/);

console.log('\n15. engineer nests');
rule('15.1', 'the sentry hint forward range defaults to 0', ENGIDLE,
  /tf_bot_engineer_mvm_sentry_hint_bomb_forward_range\(\s*"[^"]+",\s*"0"/);
rule('15.1', 'the sentry hint backward range defaults to 3000', ENGIDLE,
  /tf_bot_engineer_mvm_sentry_hint_bomb_backward_range\(\s*"[^"]+",\s*"3000"/);
rule('15.1', 'a free hint must sit at least 1300 units from the bomb', ENGIDLE,
  /tf_bot_engineer_mvm_hint_min_distance_from_bomb\(\s*"[^"]+",\s*"1300"/);
rule('15.1', 'the battlefront takes the bomb closest to the target', ENGIDLE,
  /if \( flagDistanceToTarget < battlefront && flagDistanceToTarget >= 0\.0f \)\s*\{\s*battlefront = flagDistanceToTarget;/);
rule('15.3', 'the engineer waits 0.1 seconds then pushes defenders away with 400 and 500', ENGSENTRY,
  /m_delayBuildTime\.Start\( 0\.1f \);\s*TFGameRules\(\)->PushAllPlayersAway\([\s\S]*?,\s*400,\s*500,\s*TF_TEAM_RED\s*\)/);
rule('15.3', 'the teleporter exit scales its level max health by the building multiplier', ENGTELE,
  /GetMaxHealthForCurrentLevel\(\) \* tf_bot_engineer_mvm_building_health_multiplier\.GetFloat\(\);\s*myTeleporter->SetMaxHealth\( iHealth \);\s*myTeleporter->SetHealth\( iHealth \);/);
rule('15.1', 'the building health multiplier defaults to 2 under a console name missing its mvm infix', ENGTELE,
  /ConVar tf_bot_engineer_mvm_building_health_multiplier\(\s*"tf_bot_engineer_building_health_multiplier",\s*"2"/);
rule('15.3', 'the teleporter exit inherits the engineer teleport where list', ENGTELE,
  /myTeleporter->SetTeleportWhere\( me->GetTeleportWhere\(\) \);/);

console.log('\n16. direct mvm exceptions');
rule('16', 'invader velocity is clamped to 1000', PLAYER,
  /const float velocityLimit = 1000\.0f;/);

console.log('\ncompiled coverage');
const notBuilt = [...compiled].filter(rel => !buildText.includes('$SDK/' + rel));
check(`every audited translation unit is in the wasm build (${compiled.size} files)`, notBuilt.length === 0,
  notBuilt.join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
