import { extractMapEntities, entityOutputs, resolveToggles, rerollSources, buildDoors, buildBlockers, buildDoorTriggers, doorEvents, blockerEvents, enableEvents, buildDoorOutputs } from '../main/mapentities.js';
import { doorRecord, doorPoseXform, applyBrushXform } from '../shared/bsp.js';
import { objectiveCandidates, buildTrackChains, chainPointAt } from '../renderer/js/botai.js';

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
const out = (key, target, input, param = '', delay = 0) => ({ key, value: [target, input, param, delay].join(ESC) });

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
  { classname: 'team_control_point', targetname: 'gate1_point_a', origin: '10 20 30', point_index: '1', point_printname: 'Loading Gate A', team_previouspoint_3_0: 'gate1_point_a', team_icon_2: 'sprites/obj_icons/icon_obj_red', team_icon_3: 'materials/sprites/obj_icons/Icon_Obj_Blu_Custom.vmt', team_overlay_3: 'sprites\\obj_icons\\icon_obj_a' },
  { classname: 'team_control_point', targetname: 'gate2_point_b', origin: '40 50 60', point_index: '3', point_printname: 'Loading Gate B', team_previouspoint_3_0: 'gate1_point_a' },
  { classname: 'logic_relay', targetname: 'gate1_relay', outputs: [out('OnTrigger', 'spawnbot_main1', 'Enable'), out('OnTrigger', 'pop_interface', 'PauseBotSpawning'), { key: 'OnTrigger', value: ['pop_interface', 'UnpauseBotSpawning', '', '22'].join(ESC) }, out('OnTrigger', 'gate2_door_trigger', 'Enable', '', 22)] },
  { classname: 'logic_relay', targetname: 'gate2_relay', outputs: [out('OnTrigger', 'spawnbot_main2', 'Enable')] },
  { classname: 'trigger_timer_door', targetname: 'gate1_door_trigger', model: '*1', area_cap_point: 'gate1_point_a', area_time_to_cap: '10', team_numcap_3: '1', startdisabled: '0', outputs: [out('OnCapTeam2', 'gate1_relay', 'Trigger')] },
  { classname: 'trigger_timer_door', targetname: 'gate2_door_trigger', area_cap_point: 'gate2_point_b', area_time_to_cap: '12', team_numcap_3: '1', startdisabled: '1', outputs: [out('OnCapTeam2', 'gate2_relay', 'Trigger')] },
  { classname: 'trigger_timer_door', targetname: 'orphan_trigger', area_cap_point: 'nosuch', area_time_to_cap: '5' },
  { classname: 'bot_hint_engineer_nest', targetname: 'nest_early', origin: '1 1 1', startdisabled: '1' },
  { classname: 'bot_hint_engineer_nest', targetname: 'nest_late', origin: '2 2 2', startdisabled: '1' },
  { classname: 'bot_hint_engineer_nest', targetname: 'nest_always', origin: '3 3 3' },
  { classname: 'logic_relay', targetname: 'wave_start_relay', outputs: [out('OnTrigger', 'nest_early_on', 'Trigger')] },
  { classname: 'logic_relay', targetname: 'nest_early_on', outputs: [out('OnTrigger', 'nest_early', 'Enable')] },
  { classname: 'logic_relay', targetname: 'nest_swap', outputs: [
    out('OnTrigger', 'nest_early', 'Disable'), out('OnTrigger', 'nest_late', 'Enable')
  ] }
];
gateEnts.find(e => e.targetname === 'gate1_relay').outputs.push(out('OnTrigger', 'nest_swap', 'Trigger'));
const gr = extractMapEntities(gateEnts, models);
eq('gates come from trigger_timer_door paired with its capture point', gr.gates.map(g => g.point), ['gate1_point_a', 'gate2_point_b']);
eq('gates are ordered by point index', gr.gates.map(g => g.index), [1, 3]);
eq('gate capture time and count come from the trigger', [gr.gates[0].capTime, gr.gates[0].capCount], [10, 1]);
eq('gate labels come from the control point print name', gr.gates.map(g => g.label), ['Loading Gate A', 'Loading Gate B']);
eq('a gate locked at round start is flagged', gr.gates.map(g => g.startsLocked), [false, true]);
eq('gate HUD icons come from the control point, normalised for lookup',
  gr.gates[0].icons, { held: 'sprites/obj_icons/icon_obj_red', taken: 'sprites/obj_icons/icon_obj_blu_custom', overlay: 'sprites/obj_icons/icon_obj_a' });
eq('the relay fired on capture is recorded', gr.gates.map(g => g.relay), ['gate1_relay', 'gate2_relay']);
eq('the next gate trigger and the delay before it is enabled come from the capture relay',
  gr.gates[0].effects.gatesOn, [{ trigger: 'gate2_door_trigger', delay: 22 }]);
eq('a gate whose relay enables no further gate records none', gr.gates[1].effects.gatesOn, []);
eq('a hint disabled at round start is flagged so bots do not use it',
  gr.hints.map(h => h.name + ':' + h.startDisabled).sort(),
  ['nest_always:false', 'nest_early:true', 'nest_late:true']);
eq('hints switched on by the wave start relay are resolved through the relay chain',
  gr.hintsAtWaveStart.enable, ['nest_early']);
eq('a gate capture relay records the hints it switches on and off',
  [gr.gates[0].effects.hintsOn, gr.gates[0].effects.hintsOff], [['nest_late'], ['nest_early']]);
eq('every relay that reaches a hint is listed so any firing source can drive it',
  Object.keys(gr.hintToggles).sort(),
  ['gate1_door_trigger', 'gate1_relay', 'nest_early_on', 'nest_swap', 'wave_start_relay']);
eq('a popfile-fired relay resolves to the hints it toggles',
  gr.hintToggles.nest_swap, { enable: ['nest_late'], disable: ['nest_early'] });

const filterEnts = [
  { classname: 'filter_tf_bot_has_tag', targetname: 'f_gate', tags: 'bot_gatebot', require_all_tags: '1', negated: 'Allow entities that match criteria' },
  { classname: 'filter_tf_bot_has_tag', targetname: 'f_no_giant', tags: 'bot_giant', require_all_tags: '1', negated: '1' },
  { classname: 'filter_tf_bot_has_tag', targetname: 'f_any', tags: 'a b', require_all_tags: '0', negated: '0' },
  { classname: 'filter_activator_tfteam', targetname: 'f_blu', teamnum: '3', negated: '0' },
  { classname: 'filter_multi', targetname: 'f_all', filtertype: '0', filter01: 'f_gate', filter02: 'f_no_giant', negated: '0' },
  { classname: 'filter_multi', targetname: 'f_either', filtertype: '1', filter01: 'f_gate', filter02: 'f_blu', negated: '0' },
  { classname: 'func_nav_prerequisite', targetname: 'pre_gate', model: '*1', task: '2', entity: 'gate_spot', filtername: 'f_gate' },
  { classname: 'func_nav_prerequisite', targetname: 'pre_wait', model: '*2', task: '3', entity: 'wait_spot', filtername: 'f_no_giant', value: '4', startdisabled: '1' },
  { classname: 'func_nav_prerequisite', targetname: 'pre_bad', model: '*1', task: '9', entity: 'x' }
];
const fr = extractMapEntities(filterEnts, models);
eq('a Hammer "Allow entities that match criteria" negated value is not treated as negated',
  fr.filters.f_gate, { kind: 'tag', negated: false, tags: ['bot_gatebot'], requireAll: true });
eq('an explicitly negated tag filter is inverted', fr.filters.f_no_giant.negated, true);
eq('require_all_tags 0 means any tag matches', fr.filters.f_any.requireAll, false);
eq('filtertype 0 is an all-of filter and 1 is an any-of filter',
  [fr.filters.f_all.any, fr.filters.f_either.any], [false, true]);
eq('a filter_multi keeps its sub-filters in order', fr.filters.f_all.filters, ['f_gate', 'f_no_giant']);
eq('nav prerequisites are read with their task, destination and filter',
  fr.prerequisites.map(p => p.name + ':' + p.task + ':' + p.entity + ':' + p.filter + ':' + p.startDisabled),
  ['pre_gate:moveto:gate_spot:f_gate:false', 'pre_wait:wait:wait_spot:f_no_giant:true']);
check('a prerequisite with an unknown task is skipped', !fr.prerequisites.some(p => p.name === 'pre_bad'));
eq('a WAIT prerequisite keeps its duration', fr.prerequisites[1].value, 4);

const timedEnts = [
  { classname: 'func_nav_prerequisite', targetname: 'pre_a', model: '*1', task: '2', entity: 'x' },
  { classname: 'func_nav_prerequisite', targetname: 'pre_b', model: '*1', task: '2', entity: 'y' },
  { classname: 'team_control_point', targetname: 'cp', origin: '0 0 0', point_index: '1' },
  { classname: 'trigger_timer_door', targetname: 'door', model: '*1', area_cap_point: 'cp', area_time_to_cap: '5',
    outputs: [out('OnCapTeam2', 'r', 'Trigger')] },
  { classname: 'logic_relay', targetname: 'r', outputs: [
    out('OnTrigger', 'pre_a', 'Enable'),
    out('OnTrigger', 'pre_a', 'Disable', '', 22),
    out('OnTrigger', 'pre_b', 'Enable', '', 22)
  ] }
];
const tr = extractMapEntities(timedEnts, models);
eq('a relay that enables then disables the same prerequisite keeps both, in order',
  tr.gates[0].effects.prereqEvents.map(e => (e.on ? '+' : '-') + e.name + '@' + e.at),
  ['+pre_a@0', '+pre_b@22', '-pre_a@22']);
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

const breakEnts = [
  { classname: 'path_track', targetname: 'tank_path_20', origin: '0 0 0', target: 'tank_path_30', outputs: [out('OnPass', 'bust_relay', 'Trigger')] },
  { classname: 'path_track', targetname: 'tank_path_30', origin: '100 0 0', target: '' },
  {
    classname: 'logic_relay', targetname: 'bust_relay', origin: '0 0 0',
    outputs: [
      out('OnTrigger', 'wall_intact', 'Kill'),
      out('OnTrigger', 'wall_particle', 'Start'),
      out('OnTrigger', 'wall_particle', 'Stop', '', 7),
      out('OnTrigger', 'wall_rubble', 'Enable')
    ]
  },
  { classname: 'prop_dynamic', targetname: 'wall_intact', origin: '0 0 0' },
  { classname: 'prop_dynamic', targetname: 'wall_rubble', origin: '0 0 0', startdisabled: '1' },
  { classname: 'info_particle_system', targetname: 'wall_particle', origin: '10 20 30', effect_name: 'MVM_wood_boards_destroy' }
];
const broke = extractMapEntities(breakEnts, models);
eq('a map particle system fired by a break relay is recorded with its effect and origin',
  broke.particles, [{ name: 'wall_particle', origin: [10, 20, 30], effect: 'mvm_wood_boards_destroy' }]);
eq('the break chain yields the prop swap and the particle burst with the map author delays',
  broke.breakables.map(b => b.target + ':' + b.effect + '@' + b.delay).sort(),
  ['wall_intact:kill@0', 'wall_particle:burst@0', 'wall_particle:burstoff@7', 'wall_rubble:show@0']);

const slope = buildTrackChains({
  tracks: [
    { name: 's1', origin: [0, 0, 100], target: 's2' },
    { name: 's2', origin: [300, 0, 400], target: 's3' },
    { name: 's3', origin: [600, 0, 400], target: '' }
  ],
  pathProps: []
}).chainFor('s1');
eq('a tank path measures node distance in 2D, as CTFTankBoss::Spawn does', slope.cum, [0, 300, 600]);
eq('a tank rides the height of its path nodes rather than the ground under it',
  chainPointAt(slope, 150).map(v => Math.round(v)), [150, 0, 250]);

const doorModels = [
  null,
  { mins: [0, 0, 0], maxs: [64, 8, 128], origin: [0, 0, 0] },
  { mins: [0, 0, 0], maxs: [96, 8, 120], origin: [0, 0, 0] }
];
const doorEnts = [
  { classname: 'func_door', targetname: 'gate_up', model: '*1', movedir: '-90 0 0', lip: '-16', speed: '50', spawnflags: '32', wait: '-1', origin: '100 200 0' },
  { classname: 'func_door', targetname: 'tunnel_door', model: '*2', movedir: '0 270 0', lip: '0', speed: '50', spawnflags: '1024', wait: '2', origin: '0 0 0' },
  { classname: 'func_door', targetname: 'starts_open', model: '*1', movedir: '-90 0 0', lip: '0', speed: '100', spawnpos: '1', spawnflags: '32', wait: '-1', origin: '0 0 0' },
  { classname: 'func_door', targetname: 'ghost_door', model: '*1', movedir: '-90 0 0', lip: '0', speed: '100', spawnflags: '8', wait: '-1', origin: '0 0 0' },
  { classname: 'func_movelinear', targetname: 'lift', model: '*1', movedir: '0 0 0', movedistance: '250', speed: '25', startposition: '0.5', origin: '0 0 0' },
  { classname: 'func_door_rotating', targetname: 'swing', model: '*2', speed: '90', distance: '120', spawnflags: '2', wait: '-1', origin: '10 20 30' },
  { classname: 'func_brush', targetname: 'bot_blocker', model: '*1', solidity: '0', origin: '0 0 0' },
  { classname: 'func_brush', targetname: 'decor', model: '*2', solidity: '1', origin: '0 0 0' },
  { classname: 'trigger_multiple', targetname: 'door_sensor', model: '*2', filtername: 'filter_blue', origin: '0 0 0', outputs: [
    out('OnStartTouch', 'tunnel_door', 'Open'),
    out('OnEndTouchAll', 'tunnel_door', 'Close')
  ] },
  { classname: 'trigger_timer_door', targetname: 'cap_sensor', model: '*2', door_name: 'gate_up', origin: '0 0 0', outputs: [] },
  { classname: 'logic_relay', targetname: 'wave_start_relay', outputs: [
    out('OnTrigger', 'reset_relay', 'Trigger'),
    out('OnTrigger', 'door_sensor', 'Enable')
  ] },
  { classname: 'logic_relay', targetname: 'reset_relay', outputs: [
    out('OnTrigger', 'gate_up', 'Open', '', 0.1),
    out('OnTrigger', 'bot_blocker', 'Enable', '', 0.1)
  ] }
];
const doors = buildDoors(doorEnts, doorModels);
const doorBy = n => doors.find(d => d.name === n);

eq('a pitch of -90 in movedir points a door straight up, as AngleVectors gives',
  doorBy('gate_up').dir.map(v => Math.round(v)), [0, 0, 1]);
eq('a yaw of 270 in movedir points a door along -Y',
  doorBy('tunnel_door').dir.map(v => Math.round(v)), [0, -1, 0]);
check('door travel is the brush extent along movedir less the lip',
  doorBy('gate_up').travel === 128 + 16, doorBy('gate_up').travel);
check('travel divided by speed gives the door duration',
  Math.abs(doorBy('gate_up').duration - 144 / 50) < 1e-9, doorBy('gate_up').duration);
check('spawnpos 1 opens a door at spawn', doorBy('starts_open').spawnFrac === 1);
check('a door without spawnpos or the start-open flag begins closed', doorBy('gate_up').spawnFrac === 0);
check('the passable flag makes a door non-solid', doorBy('ghost_door').solid === false);
check('a plain door is solid', doorBy('gate_up').solid === true);
check('only the touch-opens flag lets a robot push a door open',
  doorBy('tunnel_door').touchOpens === true && doorBy('gate_up').touchOpens === false);
check('a door with the toggle flag never returns on its own', doorBy('gate_up').autoReturn === false);
check('a door with a wait and no toggle flag closes itself again', doorBy('tunnel_door').autoReturn === true);
check('func_movelinear travels its move distance, not the brush size',
  doorBy('lift').travel === 250 && doorBy('lift').spawnFrac === 0.5);
check('func_movelinear never auto-returns', doorBy('lift').autoReturn === false);
check('a rotating door turns by its distance, reversed by the backwards flag',
  doorBy('swing').kind === 'rotate' && doorBy('swing').degrees === -120, doorBy('swing').degrees);
eq('a rotating door turns about Z unless an axis flag says otherwise', doorBy('swing').axis, [0, 0, 1]);
check('rotate duration is degrees over speed',
  Math.abs(doorBy('swing').duration - 120 / 90) < 1e-9, doorBy('swing').duration);

const upPose = doorPoseXform(doorBy('gate_up'), 0.5);
eq('a half-open sliding door is offset half its travel along movedir',
  applyBrushXform(upPose, [0, 0, 0]).map(v => Math.round(v)), [0, 0, 72]);
check('a fully closed door needs no transform at all', doorPoseXform(doorBy('gate_up'), 0) === null);
const swingPose = doorPoseXform(doorBy('swing'), 1);
eq('a rotating door turns about its own origin, leaving the hinge fixed',
  applyBrushXform(swingPose, [10, 20, 30]).map(v => Math.round(v)), [10, 20, 30]);

check('a brush model with no door keys is not a door',
  doorRecord({ classname: 'func_brush', model: '*1' }, doorModels[1], 1) === null);

const doorNames = new Set(doors.map(d => d.name));
const doorGraph = entityOutputs(doorEnts);
eq('a wave start relay chain reaches the doors it opens, carrying the chain delay',
  doorEvents(doorGraph, 'wave_start_relay', doorNames), [{ door: 'gate_up', input: 'open', at: 0.1 }]);
eq('enabling a trigger does not fire the outputs of that trigger',
  doorEvents(doorGraph, 'wave_start_relay', new Set(['tunnel_door'])), []);

const boxOf = en => {
  const m = doorModels[parseInt(String(en.model || '').slice(1), 10)];
  return m ? { mins: m.mins.slice(), maxs: m.maxs.slice() } : null;
};
const blockers = buildBlockers(doorEnts, boxOf);
eq('a never-solid func_brush is not a blocker', blockers.map(b => b.name), ['bot_blocker']);
eq('a wave start relay chain reaches the blockers it arms',
  blockerEvents(doorGraph, 'wave_start_relay', new Set(['bot_blocker'])),
  [{ blocker: 'bot_blocker', on: true, at: 0.1 }]);

const doorTriggers = buildDoorTriggers(doorEnts, boxOf, doorNames);
eq('a touch trigger records the door it opens on entry and closes on exit',
  doorTriggers.map(t => t.name + ':' + t.onEnter.map(e => e.input) + '/' + t.onLeave.map(e => e.input)),
  ['door_sensor:open/close', 'cap_sensor:open/close']);
check('a door trigger keeps its filter so only matching robots open the door',
  doorTriggers[0].filter === 'filter_blue');

const cycleEnts = [
  { classname: 'func_door', targetname: 'entrance_door', model: '*1', movedir: '-90 0 0', lip: '0', speed: '64', spawnflags: '32', spawnpos: '1', wait: '-1', origin: '0 0 0', outputs: [
    out('OnFullyOpen', 'entrance_gate', 'Disable'),
    out('OnClose', 'siren', 'Enable'),
    out('OnFullyClosed', 'way_blocker', 'Enable', '', 0.5)
  ] },
  { classname: 'prop_dynamic', targetname: 'entrance_gate', origin: '0 0 0', startdisabled: '1' },
  { classname: 'prop_dynamic', targetname: 'siren', origin: '0 0 0' },
  { classname: 'func_brush', targetname: 'way_blocker', model: '*2', solidity: '0', origin: '0 0 0' },
  { classname: 'trigger_multiple', targetname: 'detect_bot', model: '*2', startdisabled: '1', origin: '0 0 0', outputs: [
    out('OnNotTouching', 'entrance_door', 'Close')
  ] },
  { classname: 'logic_relay', targetname: 'wave_start_relay', outputs: [
    out('OnTrigger', 'detect_bot', 'Enable', '', 3)
  ] }
];
const cycleGraph = entityOutputs(cycleEnts);
const cycleDoorNames = new Set(['entrance_door']);
const cycleBlockerNames = new Set(['way_blocker']);
const cycleClassOf = new Map(cycleEnts.map(e => [(e.targetname || '').toLowerCase(), e.classname]));
const outs = buildDoorOutputs(cycleGraph, cycleDoorNames, cycleBlockerNames, cycleClassOf);

check('a door reports the prop it hides once it finishes opening',
  JSON.stringify(outs.entrance_door.onFullyOpen.props) === JSON.stringify([{ target: 'entrance_gate', effect: 'kill', param: '', delay: 0 }]),
  JSON.stringify(outs.entrance_door.onFullyOpen));
check('a door reports what it fires the moment it starts closing',
  JSON.stringify(outs.entrance_door.onClose.props) === JSON.stringify([{ target: 'siren', effect: 'show', param: '', delay: 0 }]),
  JSON.stringify(outs.entrance_door.onClose));
check('a door reports the blocker it arms once fully closed, with the output delay',
  JSON.stringify(outs.entrance_door.onFullyClosed.blockers) === JSON.stringify([{ blocker: 'way_blocker', on: true, at: 0.5 }]),
  JSON.stringify(outs.entrance_door.onFullyClosed));
check('a door with no OnOpen output reports none', !outs.entrance_door.onOpen);

eq('a relay chain reaches the triggers it enables, so a disabled sensor can come online later',
  enableEvents(cycleGraph, 'wave_start_relay', new Set(['detect_bot'])),
  [{ name: 'detect_bot', on: true, at: 3 }]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
