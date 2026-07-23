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

// BSP geometry must take priority; popfile geometry is a fallback only.
const withBsp = { ...emptyMap, spawns: [{ name: 'spawnbot_custom', origin: [3000, 100, 0] }], capzones: [[100, 100, 0]] };
const ai2 = simulateBotAI(model.waves[0], simulateWave(model.waves[0], { robotLimit: 22 }), withBsp, { deathModel: 'hatch', robotLimit: 22, templateEntities: te });
check('a BSP spawn of the same name still works (both are candidates)',
  ai2.actors[0] && ai2.actors[0].track.length > 0);
check('a BSP capturezone takes priority over a popfile one',
  Math.abs(ai2.objective[0] - 100) < 1, ai2.objective.slice(0, 2).map(Math.round).join(','));

// func_nav_avoid / func_nav_prefer with origin-relative bounds.
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

check('no PointTemplates yields empty extraction',
  (() => { const t = extractTemplateEntities(parse('WaveSchedule { Wave { } }')); return !t.spawns.length && !t.capzones.length && !t.flags.length && !t.tracks.length && !t.navVolumes.length; })());

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
