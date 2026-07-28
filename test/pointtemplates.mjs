import { parse } from '../renderer/js/kv.js';
import { buildModel } from '../renderer/js/popmodel.js';
import { extractTemplateEntities } from '../renderer/js/sim/pointtemplates.js';
import { simulateWave } from '../renderer/js/sim.js';
import { simulateBotAI, actorPosAt } from '../renderer/js/botai.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const N = 6, WIDE = 900;
const corridor = n => {
  const a = [];
  for (let i = 0; i < n; i++) {
    const c = [];
    if (i > 0) c.push(i - 1);
    if (i < n - 1) c.push(i + 1);
    a.push({ id: i, nw: [i * 400, 0, 0], se: [(i + 1) * 400, WIDE, 0], neZ: 0, swZ: 0, connect: c, tfAttributes: 0 });
  }
  return a;
};
const emptyMap = { map: 't', nav: { areas: corridor(N) }, spawns: [], redSpawns: [], flags: [], capzones: [], tracks: [], hints: [], navVolumes: [], pathProps: [], spawnRooms: [], bombPaths: [] };

const GEO = `WaveSchedule
{
  PointTemplates
  {
    MapGeo
    {
      info_player_teamspawn { "targetname" "spawnbot_custom" "teamnum" "3" "origin" "200 450 0" }
      func_capturezone { "targetname" "cap" "origin" "2200 450 0" }
      item_teamflag { "targetname" "flag" "origin" "200 450 0" }
      path_track { "targetname" "tpath1" "origin" "200 450 0" "target" "tpath2" }
      path_track { "targetname" "tpath2" "origin" "1800 450 0" }
      logic_relay { "targetname" "some_relay" }
      prop_dynamic { "targetname" "deco" "origin" "500 500 0" }
    }
  }
  Wave { WaveSpawn { Name w TotalCount 1 MaxActive 1 SpawnCount 1 Where spawnbot_custom TFBot { Class Heavyweapons } } }
}`;

const model = buildModel(parse(GEO), []);
const te = model.templateEntities;
check('extracts info_player_teamspawn as a spawn', te.spawns.length === 1 && te.spawns[0].name === 'spawnbot_custom');
check('the spawn keeps its origin', te.spawns[0].origin[0] === 200 && te.spawns[0].origin[1] === 450);
check('extracts func_capturezone', te.capzones.length === 1 && te.capzones[0][0] === 2200);
check('extracts item_teamflag', te.flags.length === 1);
check('extracts path_track nodes', te.tracks.length === 2 && te.tracks[0].target === 'tpath2');
check('ignores cosmetic prop_dynamic and logic_relay', !te.spawns.some(s => /deco/.test(s.name)));
check('registers the spawn name so Where resolves', model.spawnPoints.has('spawnbot_custom'));

const ai = simulateBotAI(model.waves[0], simulateWave(model.waves[0], { robotLimit: 22 }), emptyMap, { deathModel: 'hatch', robotLimit: 22, templateEntities: te });
const a = ai.actors[0];
check('a bot spawns at the popfile PointTemplate spawn point (BSP has none)',
  a && Math.abs(a.track[0] - 200) < 60 && Math.abs(a.track[1] - 450) < 60,
  a && [a.track[0], a.track[1]].map(Math.round).join(','));
check('the objective comes from the popfile capturezone',
  Math.abs(ai.objective[0] - 2200) < 1, ai.objective.slice(0, 2).map(Math.round).join(','));
check('the bot walks the popfile geometry to the objective', ai.bomb.deliveredAt !== null);

const withBsp = { ...emptyMap, spawns: [{ name: 'spawnbot_custom', origin: [3000, 100, 0] }], capzones: [[100, 100, 0]] };
const ai2 = simulateBotAI(model.waves[0], simulateWave(model.waves[0], { robotLimit: 22 }), withBsp, { deathModel: 'hatch', robotLimit: 22, templateEntities: te });
check('a BSP spawn of the same name still works (both are candidates)',
  ai2.actors[0] && ai2.actors[0].track.length > 0);
check('a BSP capturezone takes priority over a popfile one',
  Math.abs(ai2.objective[0] - 100) < 1, ai2.objective.slice(0, 2).map(Math.round).join(','));

const NAV = `WaveSchedule { PointTemplates { G {
  func_nav_avoid { "targetname" "blockmid" "origin" "1050 450 0" "mins" "-300 -150 -100" "maxs" "300 150 100" "team" "3" }
  func_nav_prefer { "targetname" "flank" "origin" "500 500 0" "mins" "-100 -100 -50" "maxs" "100 100 50" }
} } Wave { } }`;
const nav = buildModel(parse(NAV), []).templateEntities.navVolumes;
check('extracts func_nav_avoid and func_nav_prefer', nav.length === 2 && nav[0].kind === 'avoid' && nav[1].kind === 'prefer');
check('nav volume bounds are converted to world space (origin + mins/maxs)',
  nav[0].mins[0] === 750 && nav[0].maxs[0] === 1350 && nav[0].mins[1] === 300 && nav[0].maxs[1] === 600,
  JSON.stringify([nav[0].mins, nav[0].maxs]));
check('nav volume keeps its name and team so relays can toggle it',
  nav[0].name === 'blockmid' && nav[0].team === '3');

const DIS = `WaveSchedule
{
  PointTemplates { G { info_player_teamspawn { "targetname" "spawnbot_pulse" "startdisabled" "1" "origin" "1500 700 0" } } }
  Wave { WaveSpawn { Name w TotalCount 3 MaxActive 3 SpawnCount 3 Where spawnbot_pulse TFBot { Class Heavyweapons } } }
}`;
const disModel = buildModel(parse(DIS), []);
check('a start-disabled PointTemplate spawn is captured as disabled',
  disModel.templateEntities.spawns[0].disabled === true);
const disAi = simulateBotAI(disModel.waves[0], simulateWave(disModel.waves[0], { robotLimit: 22 }),
  { ...emptyMap, spawns: [{ name: 'spawnbot', origin: [0, 0, 0] }] },
  { deathModel: 'hatch', robotLimit: 22, templateEntities: disModel.templateEntities });
check('an explicit Where honours a start-disabled spawn instead of falling back to (0,0)',
  disAi.actors.every(a => Math.hypot(a.track[0] - 1500, a.track[1] - 700) < 200 && Math.hypot(a.track[0], a.track[1]) > 500),
  disAi.actors.map(a => [a.track[0], a.track[1]].map(Math.round).join(',')).join(' '));

check('no PointTemplates yields empty extraction',
  (() => { const t = extractTemplateEntities(parse('WaveSchedule { Wave { } }')); return !t.spawns.length && !t.capzones.length && !t.flags.length && !t.tracks.length && !t.navVolumes.length; })());

const ADVERSARIAL = [
  'WaveSchedule { PointTemplates { T { info_player_teamspawn { "targetname" "s" } } } }',
  'WaveSchedule { PointTemplates { T { func_capturezone { "origin" "foo bar baz" } } } }',
  'WaveSchedule { PointTemplates { T { item_teamflag { "origin" "1, 2, 3" } } } }',
  'WaveSchedule { PointTemplates { T { func_nav_avoid { "origin" "1 2 3" } } } }',
  'WaveSchedule { PointTemplates { A { B { C { info_player_teamspawn { "targetname" "d" "origin" "1 2 3" } } } } } }',
  'WaveSchedule { PointTemplates { } }',
  'WaveSchedule { PointTemplates { T { func_capturezone { "origin" "5" } } } }',
  'WaveSchedule { PointTemplates { T { info_player_teamspawn { } } } }'
];
let robust = true;
for (const pop of ADVERSARIAL) { try { extractTemplateEntities(parse(pop)); } catch { robust = false; } }
check('malformed PointTemplate entities never throw', robust);
check('comma-separated origins parse', extractTemplateEntities(parse('WaveSchedule { PointTemplates { T { item_teamflag { "origin" "1, 2, 3" } } } }')).flags.length === 1);
check('non-numeric / missing origins are skipped, not zero-filled',
  extractTemplateEntities(parse('WaveSchedule { PointTemplates { T { func_capturezone { "origin" "foo bar baz" } } } }')).capzones.length === 0);
check('duplicate track names are de-duplicated',
  extractTemplateEntities(parse('WaveSchedule { PointTemplates { T { path_track { "targetname" "p" "origin" "1 2 3" } path_track { "targetname" "p" "origin" "4 5 6" } } } }')).tracks.length === 1);
check('nested templates are walked to any depth',
  extractTemplateEntities(parse('WaveSchedule { PointTemplates { A { B { C { info_player_teamspawn { "targetname" "d" "origin" "1 2 3" } } } } } }')).spawns.length === 1);

const TPL = 'PointTemplates { T { info_player_teamspawn { "targetname" "s" "origin" "100 200 0" } } }';

const offset = extractTemplateEntities(parse(
  'WaveSchedule { ' + TPL + ' SpawnTemplate { Name "T" Origin "1000 500 25" } }'));
check('SpawnTemplate Origin translates the template entities',
  offset.spawns.length === 1 && offset.spawns[0].origin.join(',') === '1100,700,25',
  JSON.stringify(offset.spawns));

const plain = extractTemplateEntities(parse('WaveSchedule { ' + TPL + ' SpawnTemplate "T" }'));
check('the string form of SpawnTemplate spawns the template unmoved',
  plain.spawns.length === 1 && plain.spawns[0].origin.join(',') === '100,200,0',
  JSON.stringify(plain.spawns));

const twice = extractTemplateEntities(parse(
  'WaveSchedule { ' + TPL + ' SpawnTemplate { Name "T" Origin "1000 0 0" } SpawnTemplate { Name "T" Origin "0 1000 0" } }'));
check('a template spawned twice yields two instances',
  twice.spawns.length === 2 && twice.spawns.map(s => s.origin[0]).sort((a, b) => a - b).join(',') === '100,1100',
  JSON.stringify(twice.spawns));

const declaredOnly = extractTemplateEntities(parse('WaveSchedule { ' + TPL + ' }'));
check('a declared but never spawned template still contributes its Where candidate',
  declaredOnly.spawns.length === 1 && declaredOnly.spawns[0].origin.join(',') === '100,200,0');

for (const [where, pop] of [
  ['a Wave', 'WaveSchedule { ' + TPL + ' Wave { SpawnTemplate { Name "T" Origin "300 0 0" } } }'],
  ['a WaveSpawn', 'WaveSchedule { ' + TPL + ' Wave { WaveSpawn { SpawnTemplate { Name "T" Origin "300 0 0" } } } }'],
  ['a TFBot', 'WaveSchedule { ' + TPL + ' Wave { WaveSpawn { TFBot { SpawnTemplate { Name "T" Origin "300 0 0" } } } } }'],
  ['a Tank', 'WaveSchedule { ' + TPL + ' Wave { WaveSpawn { Tank { SpawnTemplate { Name "T" Origin "300 0 0" } } } } }']
]) {
  const r = extractTemplateEntities(parse(pop));
  check('SpawnTemplate inside ' + where + ' is honoured', r.spawns.length === 1 && r.spawns[0].origin[0] === 400,
    JSON.stringify(r.spawns));
}

const unknownRef = extractTemplateEntities(parse('WaveSchedule { ' + TPL + ' SpawnTemplate { Name "Missing" Origin "9 9 9" } }'));
check('a SpawnTemplate naming an undeclared template is ignored',
  unknownRef.spawns.length === 1 && unknownRef.spawns[0].origin.join(',') === '100,200,0');

const caseRef = extractTemplateEntities(parse('WaveSchedule { ' + TPL + ' SpawnTemplate { Name "t" Origin "10 0 0" } }'));
check('template names match case-insensitively', caseRef.spawns.length === 1 && caseRef.spawns[0].origin[0] === 110);

const navOff = extractTemplateEntities(parse(
  'WaveSchedule { PointTemplates { T { func_nav_avoid { "targetname" "v" "origin" "0 0 0" "mins" "-10 -10 -10" "maxs" "10 10 10" } } } SpawnTemplate { Name "T" Origin "500 0 0" } }'));
check('a translated nav volume keeps its extent and moves with the instance',
  navOff.navVolumes.length === 1 && navOff.navVolumes[0].mins[0] === 490 && navOff.navVolumes[0].maxs[0] === 510,
  JSON.stringify(navOff.navVolumes));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
