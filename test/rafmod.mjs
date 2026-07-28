import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, serialize } from '../renderer/js/kv.js';
import { buildModel, ACTION_BLOCK_KEYS } from '../renderer/js/popmodel.js';
import { knownBotKeys, traitForBlock } from '../renderer/js/sim/traits.js';
import { extractTemplateEntities, collectTemplates, collectSpawnTemplateRefs } from '../renderer/js/sim/pointtemplates.js';

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

function readScopes(file) {
  const out = new Map();
  let cur = null;
  for (const raw of readFileSync(join(here, file), 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^\[([a-z]+)\]$/);
    if (m) { cur = m[1]; out.set(cur, []); continue; }
    if (cur) out.get(cur).push(line);
  }
  return out;
}

const scopes = readScopes('fixtures_rafmod_keys.txt');
const botKeys = readFileSync(join(here, 'fixtures_sigmod_tfbot_keys.txt'), 'utf8').trim().split(/\r?\n/).filter(Boolean);

const botKnown = new Set(knownBotKeys());
const botRecognised = k => {
  const lk = k.toLowerCase();
  return botKnown.has(lk) || !!traitForBlock(lk) || ACTION_BLOCK_KEYS.has(lk);
};
const unrecognised = botKeys.filter(k => !botRecognised(k));
check('every RafMod top-level TFBot key is recognised (' + botKeys.length + ')',
  unrecognised.length === 0, unrecognised.join(', '));

const WRAP = {
  waveschedule: k => `WaveSchedule { ${k} 1 }`,
  wave: k => `WaveSchedule { Wave { ${k} 1 } }`,
  wavespawn: k => `WaveSchedule { Wave { WaveSpawn { ${k} 1 } } }`,
  tank: k => `WaveSchedule { Wave { WaveSpawn { Tank { ${k} 1 } } } }`,
  pointtemplate: k => `WaveSchedule { PointTemplates { T { ent { ${k} 1 } } } }`,
  extattr: k => `WaveSchedule { Wave { WaveSpawn { TFBot { ExtAttr ${k} } } } }`
};

for (const [scope, keys] of scopes) {
  const wrap = WRAP[scope];
  if (!wrap || !keys.length) continue;
  const broke = [];
  const mangled = [];
  for (const k of keys) {
    const text = wrap(k);
    try {
      const doc = parse(text);
      buildModel(doc, []);
      if (!serialize(doc).includes(k)) mangled.push(k);
    } catch (e) { broke.push(k + ' (' + e.message + ')'); }
  }
  check('every RafMod ' + scope + ' key parses (' + keys.length + ')', broke.length === 0, broke.slice(0, 4).join('; '));
  check('every RafMod ' + scope + ' key survives a round trip', mangled.length === 0, mangled.slice(0, 6).join(', '));
}

const extAttrs = scopes.get('extattr') || [];
const extBot = buildModel(parse('WaveSchedule { Wave { WaveSpawn { TFBot { ' +
  extAttrs.map(e => 'ExtAttr ' + e).join(' ') + ' } } } }'), []).waves[0].wavespawns[0].bots[0].bot;
check('every RafMod ExtAttr value is captured on the bot (' + extAttrs.length + ')',
  (extBot.extAttrs || []).length === extAttrs.length, JSON.stringify(extBot.extAttrs));

const TPL = 'PointTemplates { Camp { info_player_teamspawn { "targetname" "custom_spawn" "origin" "100 200 0" } func_capturezone { "origin" "50 50 0" } } }';

const doc = parse('WaveSchedule { ' + TPL + ' SpawnTemplate { Name "Camp" Origin "1000 0 0" Angles "0 90 0" Delay 2 } }');
const refs = collectSpawnTemplateRefs(doc);
check('SpawnTemplate reference is found with all its fields',
  refs.length === 1 && refs[0].name === 'camp' && refs[0].origin[0] === 1000 && refs[0].angles[1] === 90 && refs[0].delay === 2,
  JSON.stringify(refs));
check('the template body is collected', collectTemplates(doc).has('camp'));

const inst = extractTemplateEntities(doc);
check('a spawned template moves its spawn point by the SpawnTemplate Origin',
  inst.spawns.length === 1 && inst.spawns[0].origin.join(',') === '1100,200,0', JSON.stringify(inst.spawns));
check('a spawned template moves its capture zone too',
  inst.capzones.length === 1 && inst.capzones[0].join(',') === '1050,50,0', JSON.stringify(inst.capzones));

const model = buildModel(doc, []);
check('the template spawn name is offered as a Where candidate', model.spawnPoints.has('custom_spawn'));

const nested = extractTemplateEntities(parse(
  'WaveSchedule { ' + TPL + ' Wave { WaveSpawn { TFBot { SpawnTemplate { Name "Camp" Origin "0 700 0" } } } } }'));
check('a TFBot SpawnTemplate is instantiated at its offset',
  nested.spawns.length === 1 && nested.spawns[0].origin.join(',') === '100,900,0', JSON.stringify(nested.spawns));

const ORIGIN_POP = `WaveSchedule { Wave { WaveSpawn { TFBot {
 FireInput { Target "!self" Action "$SetOrigin" Param "1500 250 64" Delay 3 }
 FireInput { Target "!self" Action "$TeleportToEntity" Param "spawnbot" Delay 5 }
} } } }`;
const oBot = buildModel(parse(ORIGIN_POP), []).waves[0].wavespawns[0].bots[0].bot;
check('$SetOrigin is read as a teleport to a point',
  oBot.teleports.length === 2 && oBot.teleports[0].teleport.kind === 'point' &&
  oBot.teleports[0].teleport.point.join(',') === '1500,250,64', JSON.stringify(oBot.teleports[0]));
check('$TeleportToEntity is read as a teleport to a named entity',
  oBot.teleports[1].teleport.kind === 'entity' && oBot.teleports[1].teleport.entity === 'spawnbot');
check('teleport delays are preserved', oBot.teleports[0].delay === 3 && oBot.teleports[1].delay === 5);

const IA_POP = `WaveSchedule { Wave { WaveSpawn { TFBot {
 InterruptAction { Target "100 100 0" Duration 5 Delay 1 }
 InterruptAction { Target "900 100 0" Duration 5 Delay 2 }
 InterruptAction { Target "controlpoint" AimTarget "x" Action "Taunt" WaitUntilDone 1 KillAimTarget 1 AlwaysLook 1 }
} } } }`;
const iaBot = buildModel(parse(IA_POP), []).waves[0].wavespawns[0].bots[0].bot;
check('all three InterruptActions parse', iaBot.interrupts.length === 3, String(iaBot.interrupts.length));
check('a named InterruptAction target stays a name, not a point',
  iaBot.interrupts[2].point === null && iaBot.interrupts[2].target === 'controlpoint');
check('InterruptAction flag fields are read',
  iaBot.interrupts[2].waitUntilDone === true && iaBot.interrupts[2].killAimTarget === true && iaBot.interrupts[2].alwaysLook === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
