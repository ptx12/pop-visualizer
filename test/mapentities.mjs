import { extractMapEntities, entityOutputs, resolveToggles, rerollSources } from '../main/mapentities.js';
import { objectiveCandidates, buildTrackChains } from '../renderer/js/botai.js';

let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  check(name, a === b, 'got ' + a + ' want ' + b);
}

const ESC = String.fromCharCode(27);
const out = (key, target, input, param = '') => ({ key, value: [target, input, param].join(ESC) });

const models = [
  null,
  { mins: [-10, -10, 0], maxs: [10, 10, 20], origin: [100, 200, 0] },
  { mins: [-5, -5, -5], maxs: [5, 5, 5], origin: [0, 0, 0] },
  { mins: [0, 0, 0], maxs: [64, 64, 128], origin: [-300, 40, 8] }
];

const ents = [
  { classname: 'info_player_teamspawn', targetname: 'spawnbot', origin: '10 20 30', teamnum: '3' },
  { classname: 'info_player_teamspawn', targetname: 'spawnbot_off', origin: '11 21 31', teamnum: '3', startdisabled: '1' },
  { classname: 'info_player_teamspawn', origin: '12 22 32', teamnum: '2' },
  { classname: 'info_player_teamspawn', targetname: 'red_named', origin: '13 23 33', teamnum: '2' },
  { classname: 'info_player_teamspawn', targetname: 'bad_origin', origin: 'nan nan nan', teamnum: '3' },
  { classname: 'item_teamflag', origin: '1 2 3' },
  { classname: 'func_capturezone', model: '*1' },
  { classname: 'func_capturezone', model: '*2' },
  { classname: 'func_capturezone', model: '*99' },
  { classname: 'path_track', targetname: 'Boss_Path_A1', origin: '5 5 5', target: 'Boss_Path_A2' },
  { classname: 'path_track', origin: '6 6 6', target: 'x' },
  { classname: 'func_nav_avoid', targetname: 'bombpath_left_nav_avoid', model: '*3', tags: 'Bomb_Carrier Common', team: '3' },
  { classname: 'func_nav_prefer', targetname: 'prefer_flank', model: '*1', start_disabled: '1' },
  { classname: 'func_nav_avoid', targetname: 'no_model', model: '*99' },
  { classname: 'func_respawnroom', model: '*1', teamnum: '3' },
  { classname: 'func_respawnroom', model: '*2', teamnum: '2' },
  { classname: 'prop_dynamic', targetname: 'bombpath_hologram_left', origin: '7 8 9', angles: '0 90 0' },
  { classname: 'prop_dynamic', targetname: 'unrelated_prop', origin: '1 1 1' },
  { classname: 'bot_hint_sniper_spot', origin: '2 3 4', teamnum: '3' },
  { classname: 'bot_hint_engineer_nest', origin: '3 4 5' },
  { classname: 'logic_case', targetname: 'bombpath_choose_1_case', outputs: [
    out('OnCase01', 'bombpath_left_relay', 'Trigger'),
    out('OnCase02', 'bombpath_right_relay', 'Trigger'),
    out('OnCase03', 'null', 'Trigger')
  ] },
  { classname: 'logic_relay', targetname: 'bombpath_left_relay', outputs: [
    out('OnTrigger', 'bombpath_left_nav_avoid', 'Disable'),
    out('OnTrigger', 'prefer_flank', 'Enable')
  ] },
  { classname: 'logic_relay', targetname: 'bombpath_right_relay', outputs: [
    out('OnTrigger', 'bombpath_left_nav_avoid', 'Enable')
  ] },
  { classname: 'logic_relay', targetname: 'wave_finished_relay', outputs: [
    out('OnTrigger', 'bombpath_choose_relay', 'Trigger')
  ] },
  { classname: 'logic_relay', targetname: 'bombpath_choose_relay', outputs: [
    out('OnTrigger', 'bombpath_choose_1_case', 'PickRandom')
  ] },
  { classname: 'logic_auto', outputs: [out('OnMapSpawn', 'bombpath_choose_relay', 'Trigger')] }
];

const r = extractMapEntities(ents, models);

eq('spawns keeps only named entries with a valid origin',
  r.spawns.map(s => s.name), ['spawnbot', 'spawnbot_off', 'red_named']);
eq('startdisabled maps to disabled', r.spawns.map(s => s.disabled), [false, true, false]);
eq('redSpawns takes every team-2 spawn, named or not', r.redSpawns, [[12, 22, 32], [13, 23, 33]]);
eq('flags collected', r.flags, [[1, 2, 3]]);
eq('capzone centre is brush midpoint plus model origin', r.capzones, [[100, 200, 10]]);
check('capzone at the world origin is dropped', r.capzones.length === 1);
eq('tracks are lowercased and need a targetname',
  r.tracks, [{ name: 'boss_path_a1', origin: [5, 5, 5], target: 'boss_path_a2' }]);
eq('nav volume kinds', r.navVolumes.map(v => v.kind), ['avoid', 'prefer']);
eq('nav volume tags lowercased and split', r.navVolumes[0].tags, ['bomb_carrier', 'common']);
eq('nav volume bounds are model-relative', r.navVolumes[0].mins, [-300, 40, 8]);
eq('nav volume start_disabled honoured', r.navVolumes.map(v => v.startDisabled), [false, true]);
check('nav volume without a brush model is skipped', r.navVolumes.length === 2);
eq('only BLU respawn rooms', r.spawnRooms, [{ mins: [90, 190, 0], maxs: [110, 210, 20] }]);
eq('path props filtered by name', r.pathProps.map(p => p.name), ['bombpath_hologram_left']);
eq('path prop angles parsed', r.pathProps[0].angles, [0, 90, 0]);
eq('hints collected with class', r.hints.map(h => h.kind), ['bot_hint_sniper_spot', 'bot_hint_engineer_nest']);

eq('bomb paths keyed off the relay name', r.bombPaths.map(p => p.key), ['left', 'right']);
check('a null case target is ignored', !r.bombPaths.some(p => p.relay === 'null'));
eq('left path enables prefer and disables its avoid',
  [r.bombPaths[0].enable, r.bombPaths[0].disable], [['prefer_flank'], ['bombpath_left_nav_avoid']]);
eq('reroll sources walk back through Trigger chains',
  r.bombPaths[0].rerollBy.sort(), ['bombpath_choose_relay', 'wave_finished_relay']);

const graph = entityOutputs(ents);
check('entityOutputs keeps every repeated output',
  (graph.get('bombpath_left_relay') || []).length === 2);
eq('resolveToggles follows a trigger chain',
  resolveToggles(graph, 'wave_finished_relay', new Set(['bombpath_left_nav_avoid'])).enable, []);
eq('rerollSources is empty without a chooser', rerollSources(graph, ''), []);

const commaEnts = [
  { classname: 'func_nav_avoid', targetname: 'vol_a', model: '*2' },
  { classname: 'logic_case', targetname: 'c', outputs: [{ key: 'OnCase01', value: 'relay_a,Trigger,' }] },
  { classname: 'logic_relay', targetname: 'relay_a', outputs: [{ key: 'OnTrigger', value: 'vol_a,Enable,' }] }
];
eq('comma-separated outputs parse like escape-separated ones',
  extractMapEntities(commaEnts, models).bombPaths.map(p => p.enable), [['vol_a']]);

eq('no entities yields empty collections',
  extractMapEntities([], models).bombPaths, []);

const relayOnlyEnts = [
  { classname: 'func_nav_avoid', targetname: 'avoid_a', model: '*2' },
  { classname: 'func_nav_avoid', targetname: 'avoid_b', model: '*3', start_disabled: '1' },
  { classname: 'logic_relay', targetname: 'route_a_relay', outputs: [
    out('OnTrigger', 'avoid_a', 'Enable'), out('OnTrigger', 'avoid_b', 'Disable')
  ] },
  { classname: 'logic_relay', targetname: 'route_b_relay', outputs: [
    out('OnTrigger', 'avoid_b', 'Enable'), out('OnTrigger', 'avoid_a', 'Disable')
  ] },
  { classname: 'logic_relay', targetname: 'clearall_relay', outputs: [
    out('OnTrigger', 'avoid_a', 'Disable'), out('OnTrigger', 'avoid_b', 'Disable')
  ] },
  { classname: 'logic_case', targetname: 'subway_random', outputs: [
    out('OnCase01', 'subway_car_relay', 'Trigger')
  ] }
];
const relayOnly = extractMapEntities(relayOnlyEnts, models);
eq('routes switched by complementary relays are found without a logic_case',
  relayOnly.bombPaths.map(p => p.key), ['route_a', 'route_b']);
eq('each relay route carries its own enable and disable set',
  relayOnly.bombPaths.map(p => [p.enable, p.disable]),
  [[['avoid_a'], ['avoid_b']], [['avoid_b'], ['avoid_a']]]);
check('a reset relay that only disables is not a route',
  !relayOnly.bombPaths.some(p => p.key === 'clearall'));
check('a logic_case unrelated to nav volumes is not a route',
  !relayOnly.bombPaths.some(p => p.key === 'subway_random'));

const gateEnts = [
  { classname: 'info_player_teamspawn', targetname: 'spawnbot_main1', origin: '1 2 3', teamnum: '3' },
  { classname: 'info_player_teamspawn', targetname: 'spawnbot_main2', origin: '4 5 6', teamnum: '3' },
  { classname: 'team_control_point', targetname: 'gate1_point_a', origin: '10 20 30', point_index: '1', point_printname: 'Loading Gate A', team_previouspoint_3_0: 'gate1_point_a' },
  { classname: 'team_control_point', targetname: 'gate2_point_b', origin: '40 50 60', point_index: '3', point_printname: 'Loading Gate B', team_previouspoint_3_0: 'gate1_point_a' },
  { classname: 'logic_relay', targetname: 'gate1_relay', outputs: [out('OnTrigger', 'spawnbot_main1', 'Enable'), out('OnTrigger', 'pop_interface', 'PauseBotSpawning'), { key: 'OnTrigger', value: ['pop_interface', 'UnpauseBotSpawning', '', '22'].join(ESC) }] },
  { classname: 'logic_relay', targetname: 'gate2_relay', outputs: [out('OnTrigger', 'spawnbot_main2', 'Enable')] },
  { classname: 'trigger_timer_door', targetname: 'gate1_door_trigger', model: '*1', area_cap_point: 'gate1_point_a', area_time_to_cap: '10', team_numcap_3: '1', startdisabled: '0', outputs: [out('OnCapTeam2', 'gate1_relay', 'Trigger')] },
  { classname: 'trigger_timer_door', targetname: 'gate2_door_trigger', area_cap_point: 'gate2_point_b', area_time_to_cap: '12', team_numcap_3: '1', startdisabled: '1', outputs: [out('OnCapTeam2', 'gate2_relay', 'Trigger')] },
  { classname: 'trigger_timer_door', targetname: 'orphan_trigger', area_cap_point: 'nosuch', area_time_to_cap: '5' }
];
const gr = extractMapEntities(gateEnts, models);
eq('gates come from trigger_timer_door paired with its capture point', gr.gates.map(g => g.point), ['gate1_point_a', 'gate2_point_b']);
eq('gates are ordered by point index', gr.gates.map(g => g.index), [1, 3]);
eq('gate capture time and count come from the trigger', [gr.gates[0].capTime, gr.gates[0].capCount], [10, 1]);
eq('gate labels come from the control point print name', gr.gates.map(g => g.label), ['Loading Gate A', 'Loading Gate B']);
eq('a gate locked at round start is flagged', gr.gates.map(g => g.startsLocked), [false, true]);
eq('the relay fired on capture is recorded', gr.gates.map(g => g.relay), ['gate1_relay', 'gate2_relay']);
check('a control point that is its own previous point has no prerequisite', gr.gates[0].previous === null, String(gr.gates[0].previous));
eq('a later gate keeps its prerequisite', gr.gates[1].previous, 'gate1_point_a');
eq('the gate capture volume comes from the trigger brush', gr.gates[0].bounds.mins, [90, 190, 0]);
check('a gate whose trigger has no brush has no volume', gr.gates[1].bounds === null, JSON.stringify(gr.gates[1].bounds));
check('a trigger with no matching capture point is ignored', !gr.gates.some(g => g.trigger === 'orphan_trigger'));
check('a relay output naming a non-spawn entity is not a spawn move', gr.gates[1].effects.spawnsOff.length === 0, JSON.stringify(gr.gates[1].effects.spawnsOff));
check('gate capture effects record the spawn pause window', gr.gates[0].effects.pauseFor === 22, String(gr.gates[0].effects.pauseFor));
eq('gate capture effects list the spawn points that switch on', gr.gates[0].effects.spawnsOn.map(x => x.name), ['spawnbot_main1']);
eq('a gate with no relay has no effects', gr.gates.filter(g => !g.relay).map(g => g.effects), []);
eq('a map with no gates yields none', extractMapEntities([], models).gates, []);

const oneRelayEnts = [
  { classname: 'func_nav_avoid', targetname: 'avoid_a', model: '*2' },
  { classname: 'logic_relay', targetname: 'lone_relay', outputs: [
    out('OnTrigger', 'avoid_a', 'Enable'), out('OnTrigger', 'avoid_a', 'Disable')
  ] }
];
eq('a single toggling relay is not treated as a route set',
  extractMapEntities(oneRelayEnts, models).bombPaths, []);

const originedEnts = [
  { classname: 'func_capturezone', model: '*2', origin: '0 -2368 48', teamnum: '3' },
  { classname: 'func_capturezone', model: '*2', origin: '0 -2368 48', teamnum: '2' },
  { classname: 'func_respawnroom', model: '*2', teamnum: '3', origin: '500 600 0' }
];
const ro = extractMapEntities(originedEnts, models);
eq('a brush entity origin offsets its model bounds into world space', ro.capzones, [[0, -2368, 48]]);
eq('a RED capturezone is never a bot objective', ro.capzones.length, 1);
eq('respawnroom bounds honour the entity origin',
  ro.spawnRooms, [{ mins: [495, 595, -5], maxs: [505, 605, 5] }]);

const objBase = { spawns: [], redSpawns: [], hints: [], navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: [], nav: null };
const objMap = o => ({ ...objBase, flags: [], capzones: [], tracks: [], ...o });
const objTracks = [
  { name: 'p1', origin: [0, 0, 0], target: 'p2' },
  { name: 'p2', origin: [4000, 0, 0], target: '' }
];
const candsOf = m => objectiveCandidates(m, buildTrackChains(m));
check('a capturezone outranks flags and track ends as the hatch',
  candsOf(objMap({ capzones: [[900, 900, 0]], flags: [[10, 10, 0]], tracks: objTracks }))[0].label === 'hatch');
const noCap = candsOf(objMap({ flags: [[10, 10, 0]], tracks: objTracks }));
check('without a capturezone the track end outranks the flag — the flag is the bomb start, not the goal',
  noCap[0].label === 'end of p1' && noCap[0].pos[0] === 4000,
  JSON.stringify(noCap[0]));
check('the flag is only a last-resort objective',
  candsOf(objMap({ flags: [[10, 10, 0]] }))[0].label === 'bomb');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
