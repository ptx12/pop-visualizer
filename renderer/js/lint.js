import { getNumber, getValue, findAll, findFirst } from './kv.js';
import { SPAWNER_KEYS, isWaveScheduleRoot } from './popmodel.js';

const KNOWN_SKILLS = new Set(['easy', 'normal', 'hard', 'expert']);
const KNOWN_OBJECTIVES = new Set(['destroysentries', 'sniper', 'spy', 'engineer', 'seekanddestroy']);
const KNOWN_RESTRICTIONS = new Set(['meleeonly', 'primaryonly', 'secondaryonly']);
const KNOWN_ATTRIBUTES = new Set([
  'removeondeath', 'aggressive', 'suppressfire', 'disabledodge', 'becomespectatorondeath',
  'retainbuildings', 'spawnwithfullcharge', 'alwayscrit', 'ignoreenemies', 'holdfireuntilfullreload',
  'alwaysfireweapon', 'teleporttohint', 'miniboss', 'usebosshealthbar', 'ignoreflag', 'autojump',
  'airchargeonly', 'vaccinatorbullets', 'vaccinatorblast', 'vaccinatorfire', 'bulletimmune',
  'blastimmune', 'fireimmune', 'parachute', 'projectileshield'
]);
const WS_SINGLETON_KEYS = ['Name', 'TotalCount', 'MaxActive', 'SpawnCount', 'WaitBeforeStarting', 'WaitBetweenSpawns', 'WaitBetweenSpawnsAfterDeath', 'TotalCurrency', 'Support', 'WaitForAllSpawned', 'WaitForAllDead', 'Template', 'RandomSpawn'];
const WS_NUMERIC_KEYS = ['TotalCount', 'MaxActive', 'SpawnCount', 'WaitBeforeStarting', 'WaitBetweenSpawns', 'WaitBetweenSpawnsAfterDeath', 'TotalCurrency'];
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function checkNumericText(node, keys, add, sev, ctx, loc) {
  for (const key of keys) {
    const kv = findFirst(node, key);
    if (kv && kv.type === 'kv' && kv.value !== '' && !NUM_RE.test(kv.value.trim())) {
      add(sev, `${ctx}: ${key} "${kv.value}" is not a number (the game reads it as 0)`, loc);
    }
  }
}

function checkSingletons(node, keys, add, ctx, loc) {
  for (const key of keys) {
    const matches = findAll(node, key).filter(c => c.type === 'kv');
    if (matches.length > 1) add('warn', `${ctx}: ${key} appears ${matches.length} times — only the first is used`, loc);
  }
}

export function lintModel(model, simFor) {
  const out = [];
  const add = (severity, msg, loc) => out.push({ severity, msg, ...loc });

  if (!model.root) {
    add('error', 'No WaveSchedule block found in file', {});
    return out;
  }
  const rootCandidates = model.doc.children.filter(n => n.type === 'block' && isWaveScheduleRoot(n));
  if (rootCandidates.length > 1) add('warn', `${rootCandidates.length} top-level blocks look like a WaveSchedule — only "${model.root.key}" is used`, {});
  else if (!isWaveScheduleRoot(model.root)) add('info', `Root block "${model.root.key}" has no Wave, Mission or Templates entries`, {});
  if (!model.waves.length) add('warn', 'Mission has no waves', {});

  for (const tblock of findAll(model.root, 'Templates')) {
    const seen = new Map();
    for (const t of tblock.children) {
      if (t.type !== 'block') continue;
      const k = t.key.toLowerCase();
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n > 1) add('warn', `Template "${k}" is defined ${n} times in this file — the last definition wins`, {});
    }
  }

  const robotLimit = getNumber(model.root, 'RobotLimit', 22);

  model.waves.forEach((wave, wi) => {
    const sim = simFor(wave);
    if (!wave.wavespawns.length) add('warn', `Wave ${wi + 1} has no wavespawns`, { wave: wi });
    const names = new Set(wave.wavespawns.filter(w => w.name).map(w => w.name.toLowerCase()));

    const nameCounts = new Map();
    for (const w of wave.wavespawns) {
      if (!w.name) continue;
      const k = w.name.toLowerCase();
      nameCounts.set(k, (nameCounts.get(k) || []).concat(w));
    }
    const referenced = new Set(wave.wavespawns.flatMap(w => [w.waitForAllSpawned, w.waitForAllDead].filter(Boolean).map(s => s.toLowerCase())));
    for (const [k, list] of nameCounts) {
      if (list.length < 2) continue;
      const extra = referenced.has(k) ? ' — WaitForAll treats them as one group' : '';
      add('info', `Wave ${wi + 1}: ${list.length} wavespawns share the name "${list[0].name}"${extra}`, { wave: wi, node: list[1].node });
    }

    for (const iss of sim.issues) {
      if (iss.type === 'missing-ref') add('error', `Wave ${wi + 1} "${wsLabel(iss.ws)}": ${iss.kind} references "${iss.ref}" which no wavespawn in this wave is named`, { wave: wi, node: iss.ws.node });
      if (iss.type === 'dependency-cycle') add('error', `Wave ${wi + 1} "${wsLabel(iss.ws)}": circular WaitForAllSpawned/Dead dependency`, { wave: wi, node: iss.ws.node });
    }

    wave.wavespawns.forEach(ws => {
      const loc = { wave: wi, node: ws.node };
      const label = wsLabel(ws);
      if (!ws.spawner && !ws.isLogic) add('warn', `Wave ${wi + 1} "${label}": no spawner (TFBot/Tank/Squad/...) defined`, loc);
      if (ws.totalCount <= 0 && ws.support !== 'unlimited' && !ws.isLogic) add('warn', `Wave ${wi + 1} "${label}": TotalCount is ${ws.totalCount}, nothing will spawn`, loc);
      if (ws.spawnCount > ws.maxActive) add('error', `Wave ${wi + 1} "${label}": SpawnCount ${ws.spawnCount} exceeds MaxActive ${ws.maxActive}, spawns will stall`, loc);
      if (ws.squadSize > 1 && ws.squadSize > ws.maxActive) add('error', `Wave ${wi + 1} "${label}": squad of ${ws.squadSize} exceeds MaxActive ${ws.maxActive}`, loc);
      if (ws.squadSize > 1 && ws.spawnCount % ws.squadSize !== 0) add('info', `Wave ${wi + 1} "${label}": SpawnCount ${ws.spawnCount} is not a multiple of squad size ${ws.squadSize}`, loc);
      if (ws.totalCount > 0 && ws.totalCount % Math.max(1, ws.spawnCount) !== 0 && ws.squadSize <= 1) add('info', `Wave ${wi + 1} "${label}": TotalCount ${ws.totalCount} not divisible by SpawnCount ${ws.spawnCount}, last group is partial`, loc);
      if (ws.where.length === 0 && !ws.isTank && !ws.isLogic && ws.spawner && ws.spawner.kind !== 'sentry' && !ws.templateName) add('warn', `Wave ${wi + 1} "${label}": no Where specified`, loc);
      if (ws.maxActive > robotLimit && !ws.isTank) add('info', `Wave ${wi + 1} "${label}": MaxActive ${ws.maxActive} exceeds robot limit ${robotLimit}`, loc);
      if (ws.totalCurrency < 0) add('info', `Wave ${wi + 1} "${label}": negative TotalCurrency (${ws.totalCurrency})`, loc);
      if (ws.totalCount < 0) add('error', `Wave ${wi + 1} "${label}": negative TotalCount (${ws.totalCount})`, loc);
      if (ws.maxActive < 0 || ws.spawnCount < 0) add('error', `Wave ${wi + 1} "${label}": negative MaxActive/SpawnCount`, loc);
      if (ws.waitBeforeStarting < 0 || ws.waitBetweenSpawns < 0) add('error', `Wave ${wi + 1} "${label}": negative wait time`, loc);
      if (ws.support === 'unlimited' && ws.totalCurrency > 0) add('info', `Wave ${wi + 1} "${label}": unlimited support carries $${ws.totalCurrency}; players may miss late drops`, loc);
      if (ws.waitForAllSpawned && names.has(ws.waitForAllSpawned.toLowerCase()) && ws.name && ws.waitForAllSpawned.toLowerCase() === ws.name.toLowerCase()) add('error', `Wave ${wi + 1} "${label}": waits for itself`, loc);
      for (const b of ws.bots) {
        if (b.bot && b.bot.missingTemplates.length) add('warn', `Wave ${wi + 1} "${label}": unresolved template ${b.bot.missingTemplates.join(', ')} (missing #base?)`, loc);
        if (b.bot && b.bot.templateCycle) add('error', `Wave ${wi + 1} "${label}": template inheritance cycle`, loc);
        if (b.bot && b.bot.cls === 'unknown' && b.bot.clsRaw) add('error', `Wave ${wi + 1} "${label}": unknown class "${b.bot.clsRaw}"`, loc);
        if (b.bot && b.bot.skill && !KNOWN_SKILLS.has(b.bot.skill.toLowerCase())) add('warn', `Wave ${wi + 1} "${label}": unknown skill "${b.bot.skill}"`, loc);
        if (b.bot && b.bot.restriction && !KNOWN_RESTRICTIONS.has(b.bot.restriction.toLowerCase().replace(/[^a-z]/g, ''))) add('info', `Wave ${wi + 1} "${label}": unknown WeaponRestrictions "${b.bot.restriction}"`, loc);
        if (b.bot) {
          for (const a of b.bot.attrs) {
            if (!KNOWN_ATTRIBUTES.has(String(a).toLowerCase().replace(/[^a-z]/g, ''))) add('info', `Wave ${wi + 1} "${label}": attribute "${a}" is not a stock TF2 bot attribute`, loc);
          }
        }
      }

      const spawnerBlocks = ws.node.children.filter(c => c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase()));
      if (spawnerBlocks.length > 1) add('warn', `Wave ${wi + 1} "${label}": ${spawnerBlocks.length} spawner blocks — only the first (${spawnerBlocks[0].key}) is used`, loc);

      const wsTmpl = findFirst(ws.node, 'Template');
      if (wsTmpl && wsTmpl.type === 'kv' && wsTmpl.value && !ws.templateName) {
        add('error', `Wave ${wi + 1} "${label}": Template "${wsTmpl.value}" does not match any WaveSpawn template`, loc);
      }

      for (const o of ws.outputs) {
        if (!o.target || o.target === '?') add('warn', `Wave ${wi + 1} "${label}": ${o.when} has no Target`, loc);
        const blk = findAll(ws.node, o.when).find(c => c.type === 'block');
        if (blk && !getValue(blk, 'Action', null)) add('warn', `Wave ${wi + 1} "${label}": ${o.when} has no Action`, loc);
      }

      checkSingletons(ws.node, WS_SINGLETON_KEYS, add, `Wave ${wi + 1} "${label}"`, loc);
      checkNumericText(ws.node, WS_NUMERIC_KEYS, add, 'warn', `Wave ${wi + 1} "${label}"`, loc);
      for (const sb of spawnerBlocks.slice(0, 1)) {
        if (sb.key.toLowerCase() === 'tfbot') checkNumericText(sb, ['Health', 'Scale'], add, 'warn', `Wave ${wi + 1} "${label}" TFBot`, loc);
        if (sb.key.toLowerCase() === 'tank') checkNumericText(sb, ['Health', 'Speed'], add, 'warn', `Wave ${wi + 1} "${label}" Tank`, loc);
      }

      const r = sim.results.get(ws);
      if (r && r.blocked && ws.support !== 'unlimited') add('info', `Wave ${wi + 1} "${label}": spawn pacing is throttled by MaxActive (see timeline)`, loc);
    });

    for (const key of ['StartWaveOutput', 'DoneOutput', 'InitWaveOutput']) {
      for (const o of findAll(wave.node, key)) {
        if (o.type !== 'block') continue;
        if (!getValue(o, 'Target', null)) add('warn', `Wave ${wi + 1}: ${key} has no Target`, { wave: wi });
        if (!getValue(o, 'Action', null)) add('warn', `Wave ${wi + 1}: ${key} has no Action`, { wave: wi });
      }
    }
  });

  model.missions.forEach(m => {
    const loc = { mission: true, node: m.node };
    if (m.objective && !KNOWN_OBJECTIVES.has(m.objective.toLowerCase().replace(/[^a-z]/g, ''))) add('warn', `Mission "${m.objective}": unknown Objective`, loc);
    if (m.beginAtWave > model.waves.length) add('warn', `Mission "${m.objective}": BeginAtWave ${m.beginAtWave} is beyond last wave (${model.waves.length})`, loc);
    if (!m.spawner) add('warn', `Mission "${m.objective}": no TFBot defined`, loc);
    if (m.cooldownTime <= 0) add('warn', `Mission "${m.objective}": CooldownTime should be positive`, loc);
    checkNumericText(m.node, ['InitialCooldown', 'CooldownTime', 'DesiredCount', 'BeginAtWave', 'RunForThisManyWaves'], add, 'warn', `Mission "${m.objective}"`, loc);
    for (const b of (m.spawner ? [m.spawner] : [])) {
      if (b.bot && b.bot.missingTemplates.length) add('warn', `Mission "${m.objective}": unresolved template ${b.bot.missingTemplates.join(', ')}`, loc);
    }
  });

  const busterWaves = new Set();
  for (const m of model.missions) {
    if (/destroysentries/i.test(m.objective)) {
      for (let w = m.beginAtWave; w < m.beginAtWave + Math.max(1, m.runForThisManyWaves); w++) busterWaves.add(w);
    }
  }
  if (model.missions.length && model.waves.length && busterWaves.size === 0) add('info', 'No sentry buster mission defined', {});

  for (const b of model.doc.bases) {
    if (b.missing) add('warn', `#base file not found: ${b.path}`, {});
  }
  return out;
}

function wsLabel(ws) {
  if (ws.name) return ws.name;
  const first = ws.bots.find(b => b.bot);
  if (first) return (first.bot.name || first.bot.cls || 'wavespawn');
  if (ws.isTank) return 'tank';
  return 'wavespawn';
}
