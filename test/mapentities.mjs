import { extractMapEntities, entityOutputs, resolveToggles, rerollSources } from '../main/mapentities.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
