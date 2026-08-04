import { existsSync } from 'node:fs';
import { parseEntities, readEntityLump, readModels } from '../shared/bsp.js';
import {
  entityOutputs, resolveToggles, resolveTogglesTimed, buildBreakables,
  buildFilters, buildDoors, buildBlockers, buildGates, buildDoorTriggers,
  extractMapEntities
} from '../main/mapentities.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const ESC = String.fromCharCode(27);
const TF_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';

console.log('the entity output graph');
const graph = entityOutputs([
  { targetname: 'Relay_A', outputs: [{ key: 'OnTrigger', value: 'door_one,Open,,1.5,-1' }] },
  { targetname: 'relay_b', outputs: [{ key: 'OnTrigger', value: ['Door_Two', 'Close', 'param', '0', '-1'].join(ESC) }] },
  { targetname: 'no_outputs' },
  { outputs: [{ key: 'OnTrigger', value: 'ignored,Open,,0,-1' }] }
]);
check('entities are keyed by lowercased targetname', graph.has('relay_a') && graph.has('relay_b'),
  [...graph.keys()].join(', '));
check('an entity with no outputs contributes no edge', !graph.has('no_outputs'));
check('an entity with no targetname is skipped', graph.size === 2, `${graph.size} keys`);
check('comma separated outputs are parsed', graph.get('relay_a')[0].target === 'door_one'
  && graph.get('relay_a')[0].input === 'open');
check('the output delay is read as a number', graph.get('relay_a')[0].delay === 1.5,
  String(graph.get('relay_a')[0].delay));
check('escape separated outputs parse the same way', graph.get('relay_b')[0].target === 'door_two'
  && graph.get('relay_b')[0].input === 'close', JSON.stringify(graph.get('relay_b')[0]));
check('an output parameter survives parsing', graph.get('relay_b')[0].param === 'param');

const noDelay = entityOutputs([{ targetname: 'r', outputs: [{ key: 'OnTrigger', value: 'x,Enable,,,-1' }] }]);
check('a missing delay falls back to zero rather than NaN', noDelay.get('r')[0].delay === 0,
  String(noDelay.get('r')[0].delay));

console.log('\nfollowing relay chains to volume toggles');
const chain = entityOutputs([
  { targetname: 'start', outputs: [{ key: 'OnTrigger', value: 'mid,Trigger,,0,-1' }] },
  { targetname: 'mid', outputs: [
    { key: 'OnTrigger', value: 'vol_a,Enable,,0,-1' },
    { key: 'OnTrigger', value: 'vol_b,Disable,,0,-1' },
    { key: 'OnTrigger', value: 'deep,Trigger,,0,-1' }
  ] },
  { targetname: 'deep', outputs: [{ key: 'OnTrigger', value: 'vol_c,Enable,,0,-1' }] }
]);
const volumes = new Set(['vol_a', 'vol_b', 'vol_c']);
const toggles = resolveToggles(chain, 'start', volumes);
check('an enable reached through two relays is found',
  toggles.enable.includes('vol_a') && toggles.enable.includes('vol_c'), toggles.enable.join(', '));
check('a disable is kept separate from an enable',
  toggles.disable.length === 1 && toggles.disable[0] === 'vol_b', toggles.disable.join(', '));

const cyclic = entityOutputs([
  { targetname: 'a', outputs: [{ key: 'OnTrigger', value: 'b,Trigger,,0,-1' }] },
  { targetname: 'b', outputs: [
    { key: 'OnTrigger', value: 'a,Trigger,,0,-1' },
    { key: 'OnTrigger', value: 'vol_a,Enable,,0,-1' }
  ] }
]);
check('a relay cycle terminates instead of hanging',
  resolveToggles(cyclic, 'a', volumes).enable.join() === 'vol_a');

const deep = [];
for (let i = 0; i < 14; i++) {
  deep.push({ targetname: 'r' + i, outputs: [{ key: 'OnTrigger', value: `r${i + 1},Trigger,,0,-1` }] });
}
deep.push({ targetname: 'r14', outputs: [{ key: 'OnTrigger', value: 'vol_a,Enable,,0,-1' }] });
check('a chain longer than the depth limit is cut off rather than followed forever',
  resolveToggles(entityOutputs(deep), 'r0', volumes).enable.length === 0);

console.log('\ntimed toggles accumulate delay along the chain');
const timed = entityOutputs([
  { targetname: 'start', outputs: [{ key: 'OnTrigger', value: 'mid,Trigger,,2,-1' }] },
  { targetname: 'mid', outputs: [
    { key: 'OnTrigger', value: 'vol_b,Enable,,3,-1' },
    { key: 'OnTrigger', value: 'vol_a,Enable,,0.5,-1' }
  ] }
]);
const events = resolveTogglesTimed(timed, 'start', volumes);
check('each hop adds its own delay', events.length === 2 && events[0].at === 2.5 && events[1].at === 5,
  JSON.stringify(events));
check('events come back in time order', events[0].at <= events[1].at);
check('an enable is flagged as on', events.every(e => e.on === true));
check('inputs that are neither enable nor disable are ignored',
  resolveTogglesTimed(entityOutputs([
    { targetname: 's', outputs: [{ key: 'OnTrigger', value: 'vol_a,Kill,,0,-1' }] }
  ]), 's', volumes).length === 0);

console.log('\nwhat a tank breaks as it passes a path node');
const breakables = buildBreakables([
  { classname: 'path_track', targetname: 'node_1', outputs: [
    { key: 'onpass', value: 'wall,Break,,0.5,-1' },
    { key: 'onpass', value: 'relay_fx,Trigger,,1,-1' }
  ] },
  { classname: 'func_breakable', targetname: 'wall' },
  { classname: 'logic_relay', targetname: 'relay_fx', outputs: [
    { key: 'ontrigger', value: 'smoke,Start,,0.25,-1' }
  ] },
  { classname: 'info_particle_system', targetname: 'smoke' }
]);
check('a prop broken straight from the node is recorded',
  breakables.some(b => b.target === 'wall' && b.effect === 'kill' && b.delay === 0.5),
  JSON.stringify(breakables));
check('a particle started through a relay is followed and its delays summed',
  breakables.some(b => b.target === 'smoke' && b.effect === 'burst' && Math.abs(b.delay - 1.25) < 1e-9),
  JSON.stringify(breakables));
check('the breakable is attributed to the node that passes it',
  breakables.length > 0 && breakables.every(b => b.node === 'node_1'),
  breakables.map(b => b.node).join(', '));

const onlyOnPass = buildBreakables([
  { classname: 'path_track', targetname: 'n', outputs: [{ key: 'onuser1', value: 'wall,Break,,0,-1' }] },
  { classname: 'func_breakable', targetname: 'wall' }
]);
check('an output that is not OnPass is ignored', onlyOnPass.length === 0, JSON.stringify(onlyOnPass));

const wrongClass = buildBreakables([
  { classname: 'path_track', targetname: 'n', outputs: [{ key: 'onpass', value: 'thing,Break,,0,-1' }] },
  { classname: 'logic_relay', targetname: 'thing' }
]);
check('breaking something that is not a prop records nothing', wrongClass.length === 0,
  JSON.stringify(wrongClass));

console.log('\nentity filters');
const filters = buildFilters([
  { classname: 'filter_activator_tfteam', targetname: 'Blu_Only', teamnum: '3' },
  { classname: 'filter_tf_bot_has_tag', targetname: 'gatebots', tags: 'bot_gatebot Bot_Giant', require_all_tags: '1' },
  { classname: 'filter_multi', targetname: 'either', filter01: 'Blu_Only', filter02: 'gatebots', filtertype: '1' },
  { classname: 'logic_relay', targetname: 'not_a_filter' }
]);
check('filters come back keyed by lowercased name',
  'blu_only' in filters && 'gatebots' in filters && 'either' in filters, Object.keys(filters).join(', '));
check('a non-filter entity is not collected', !('not_a_filter' in filters));
check('a team filter keeps its team as the map wrote it',
  filters.blu_only.kind === 'team' && filters.blu_only.team === '3', JSON.stringify(filters.blu_only));
check('a tag filter lowercases and splits its tags',
  filters.gatebots.kind === 'tag' && filters.gatebots.tags.join(',') === 'bot_gatebot,bot_giant',
  JSON.stringify(filters.gatebots));
check('require all tags is carried through', filters.gatebots.requireAll === true);
check('a multi filter collects its numbered sub filters',
  filters.either.kind === 'multi' && filters.either.filters.length === 2,
  JSON.stringify(filters.either));
check('filter type 1 is read as any rather than all', filters.either.any === true);

const maps = ['mvm_decoy', 'mvm_mannhattan', 'mvm_rottenburg', 'mvm_bigrock']
  .filter(m => existsSync(`${TF_DIR}/maps/${m}.bsp`));

if (!maps.length) {
  console.log('\nskip the real map checks: no map available');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

console.log('\nagainst the real entity lumps');
for (const map of maps) {
  const bsp = `${TF_DIR}/maps/${map}.bsp`;
  const ents = parseEntities(readEntityLump(bsp));
  const models = readModels(bsp);
  check(`${map}: the lump parses into entities`, ents.length > 100, `${ents.length} entities`);

  const g = entityOutputs(ents);
  check(`${map}: the map wires up an output graph`, g.size > 0, `${g.size} named sources`);

  const named = new Set(ents.filter(e => e.targetname).map(e => e.targetname.toLowerCase()));
  const dangling = [...g.values()].flat().filter(o => o.target && !named.has(o.target) && o.target !== '!activator' && o.target !== '!self' && o.target !== '!player');
  check(`${map}: every output delay is a finite number`,
    [...g.values()].flat().every(o => Number.isFinite(o.delay)),
    `${dangling.length} outputs point at unnamed targets`);

  const doors = buildDoors(ents, models);
  const doorEnts = ents.filter(e => /^func_door/.test(e.classname || '')).length;
  check(`${map}: a door record is built for each func_door with a brush model`,
    doors.length > 0 && doors.length <= doorEnts,
    `${doors.length} built from ${doorEnts} func_door entities`);
  check(`${map}: every door carries world space bounds`,
    doors.every(d => d.bounds && d.bounds.mins.length === 3 && d.bounds.maxs.every(Number.isFinite)),
    `${doors.filter(d => !d.bounds).length} without bounds`);
  check(`${map}: door bounds are not inside out`,
    doors.every(d => d.bounds.maxs.every((v, i) => v >= d.bounds.mins[i])));

  const gates = buildGates(ents, [], null, new Set(), new Set(), new Set(), new Set(), new Set());
  const cps = ents.filter(e => e.classname === 'trigger_timer_door').length;
  check(`${map}: a gate is built for each gate trigger the map carries`, gates.length === cps,
    `${gates.length} gates from ${cps} trigger_timer_door entities`);
  if (gates.length) {
    check(`${map}: each gate names the control point it captures`,
      gates.every(x => x.point), gates.map(x => x.point).join(', '));
    check(`${map}: each gate carries a positive capture time`,
      gates.every(x => x.capTime > 0), gates.map(x => x.capTime).join(', '));
    check(`${map}: each gate needs at least one gatebot to capture`,
      gates.every(x => x.capCount >= 1), gates.map(x => x.capCount).join(', '));
  }

  const extracted = extractMapEntities(ents, models);
  check(`${map}: the full extraction returns every section the map view reads`,
    extracted && typeof extracted === 'object' && 'gates' in extracted && 'doors' in extracted,
    Object.keys(extracted || {}).join(', '));
  check(`${map}: extraction agrees with the standalone gate build`,
    (extracted.gates || []).length === gates.length,
    `${(extracted.gates || []).length} vs ${gates.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
