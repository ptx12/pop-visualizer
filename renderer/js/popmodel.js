import { findAll, findFirst, getValue, getNumber } from './kv.js';

export const CLASS_INFO = {
  scout: { label: 'Scout', short: 'SCT', color: '#f2c94c', health: 125 },
  soldier: { label: 'Soldier', short: 'SOL', color: '#8fae5a', health: 200 },
  pyro: { label: 'Pyro', short: 'PYR', color: '#e8823a', health: 175 },
  demoman: { label: 'Demo', short: 'DEM', color: '#b07a4f', health: 175 },
  heavyweapons: { label: 'Heavy', short: 'HVY', color: '#d1605f', health: 300 },
  engineer: { label: 'Engie', short: 'ENG', color: '#e5b84e', health: 125 },
  medic: { label: 'Medic', short: 'MED', color: '#6fb3d9', health: 150 },
  sniper: { label: 'Sniper', short: 'SNP', color: '#b9b978', health: 125 },
  spy: { label: 'Spy', short: 'SPY', color: '#9b8ec4', health: 125 },
  tank: { label: 'Tank', short: 'TNK', color: '#8b95a0', health: 50000 },
  sentrygun: { label: 'Sentry', short: 'SGN', color: '#c0c8d0', health: 216 },
  unknown: { label: '?', short: '???', color: '#777f88', health: 0 }
};

const CLASS_ALIASES = {
  scout: 'scout', soldier: 'soldier', pyro: 'pyro',
  demoman: 'demoman', demo: 'demoman',
  heavyweapons: 'heavyweapons', heavy: 'heavyweapons', heavyweaponsguy: 'heavyweapons',
  engineer: 'engineer', engie: 'engineer',
  medic: 'medic', sniper: 'sniper', spy: 'spy'
};

export function normalizeClass(name) {
  if (!name) return null;
  return CLASS_ALIASES[String(name).toLowerCase().replace(/[^a-z]/g, '')] || null;
}

export const SPAWNER_KEYS = new Set(['tfbot', 'tank', 'squad', 'randomchoice', 'mob', 'sentrygun', 'randomplacement', 'halloweenboss', 'botnpc', 'pointtemplate']);
const WS_OUTPUT_KEYS = ['firstspawnoutput', 'lastspawnoutput', 'doneoutput', 'startwaveoutput'];
const WS_SOUND_KEYS = ['firstspawnwarningsound', 'lastspawnwarningsound', 'donewarningsound', 'startwavewarningsound', 'sound'];
const WAVE_NONSPAWN_BLOCKS = new Set(['startwaveoutput', 'doneoutput', 'initwaveoutput', 'explanation', 'soundloop']);
const ROOT_STRUCT_KEYS = new Set(['wave', 'mission', 'templates']);

export function isWaveScheduleRoot(block) {
  if (block.type !== 'block') return false;
  return block.children.some(c => ROOT_STRUCT_KEYS.has(c.key.toLowerCase()));
}

export function findRoot(doc) {
  for (const node of doc.children) {
    if (isWaveScheduleRoot(node)) return node;
  }
  return doc.children.find(n => n.type === 'block') || null;
}

export function collectTemplates(doc, baseDocs) {
  const templates = new Map();
  for (const { name, doc: bdoc } of baseDocs) {
    const broot = findRoot(bdoc);
    if (!broot) continue;
    for (const tblock of findAll(broot, 'Templates')) {
      for (const t of tblock.children) {
        if (t.type === 'block') templates.set(t.key.toLowerCase(), { name: t.key, node: t, source: name });
      }
    }
  }
  const root = findRoot(doc);
  if (root) {
    for (const tblock of findAll(root, 'Templates')) {
      for (const t of tblock.children) {
        if (t.type === 'block') templates.set(t.key.toLowerCase(), { name: t.key, node: t, source: 'this file' });
      }
    }
  }
  return templates;
}

export function resolveBot(node, templates, stack = []) {
  const info = {
    cls: null, clsRaw: null, name: null, health: null, scale: null, skill: null,
    icon: null, attrs: [], items: [], restriction: null, templateChain: [],
    missingTemplates: [], moveSpeedMult: 1, node
  };
  applyBotBlock(node, info, templates, stack);
  if (!info.cls) info.cls = 'unknown';
  if (info.health == null) {
    const base = CLASS_INFO[info.cls] ? CLASS_INFO[info.cls].health : 0;
    info.health = base;
    info.healthIsDefault = true;
  }
  info.isGiant = info.attrs.some(a => /^miniboss$/i.test(a)) || (info.scale != null && info.scale >= 1.6);
  info.isBoss = info.attrs.some(a => /^usebosshealthbar$/i.test(a));
  info.alwaysCrit = info.attrs.some(a => /^alwayscrit$/i.test(a));
  info.ignoreFlag = info.attrs.some(a => /^ignoreflag$/i.test(a));
  return info;
}

function applyBotBlock(node, info, templates, stack) {
  const tmplKV = findFirst(node, 'Template');
  if (tmplKV && tmplKV.type === 'kv' && tmplKV.value) {
    const key = tmplKV.value.toLowerCase();
    if (stack.includes(key)) {
      info.templateCycle = true;
    } else if (templates.has(key)) {
      info.templateChain.push(templates.get(key).name);
      applyBotBlock(templates.get(key).node, info, templates, stack.concat(key));
    } else {
      info.missingTemplates.push(tmplKV.value);
    }
  }
  for (const c of node.children) {
    if (c.type === 'block') {
      const bk = c.key.toLowerCase();
      if (bk === 'characterattributes' || bk === 'itemattributes') {
        for (const a of c.children) {
          if (a.type !== 'kv') continue;
          if (/^(move speed bonus|move speed penalty|card: move speed bonus)$/i.test(a.key)) {
            const v = parseFloat(a.value);
            if (Number.isFinite(v) && v > 0) info.moveSpeedMult *= v;
          }
        }
      }
      continue;
    }
    if (c.type !== 'kv') continue;
    const k = c.key.toLowerCase();
    if (k === 'class') { info.cls = normalizeClass(c.value) || 'unknown'; info.clsRaw = c.value; }
    else if (k === 'name') info.name = c.value;
    else if (k === 'health') info.health = parseFloat(c.value) || info.health;
    else if (k === 'scale') info.scale = parseFloat(c.value);
    else if (k === 'skill') info.skill = c.value;
    else if (k === 'classicon') info.icon = c.value;
    else if (k === 'attributes') info.attrs.push(c.value);
    else if (k === 'item') info.items.push(c.value);
    else if (k === 'weaponrestrictions') info.restriction = c.value;
  }
}

export function parseSpawner(node, templates) {
  const key = node.key.toLowerCase();
  if (key === 'tfbot') {
    const bot = resolveBot(node, templates);
    return { kind: 'bot', node, bot, count: 1 };
  }
  if (key === 'tank') {
    return {
      kind: 'tank', node, count: 1,
      health: getNumber(node, 'Health', 50000),
      speed: getNumber(node, 'Speed', 75),
      name: getValue(node, 'Name', 'tankboss'),
      startNode: getValue(node, 'StartingPathTrackNode', null)
    };
  }
  if (key === 'squad') {
    const children = node.children.filter(c => c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase())).map(c => parseSpawner(c, templates));
    return { kind: 'squad', node, children, count: children.reduce((s, c) => s + c.count, 0) };
  }
  if (key === 'randomchoice' || key === 'randomplacement') {
    const children = node.children.filter(c => c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase())).map(c => parseSpawner(c, templates));
    const cnt = key === 'randomplacement' ? Math.max(1, getNumber(node, 'Count', children.length)) : 1;
    return { kind: 'random', node, children, count: cnt, placement: key === 'randomplacement' };
  }
  if (key === 'mob') {
    const inner = node.children.filter(c => c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase())).map(c => parseSpawner(c, templates));
    return { kind: 'mob', node, children: inner, count: Math.max(1, getNumber(node, 'Count', 1)) };
  }
  if (key === 'sentrygun') {
    return { kind: 'sentry', node, count: 1, level: getNumber(node, 'Level', 1) };
  }
  if (key === 'botnpc') {
    return { kind: 'other', node, label: getValue(node, 'Name', 'BotNpc'), health: getNumber(node, 'Health', 0), count: 1 };
  }
  if (key === 'halloweenboss') {
    return { kind: 'other', node, label: getValue(node, 'BossType', 'HalloweenBoss'), count: 1 };
  }
  if (key === 'pointtemplate') {
    return { kind: 'other', node, label: getValue(node, 'Name', 'PointTemplate'), count: 1 };
  }
  return { kind: 'other', node, label: node.key, count: 1 };
}

export function flattenBots(spawner, out = [], mult = 1) {
  if (!spawner) return out;
  if (spawner.kind === 'bot') out.push({ bot: spawner.bot, mult, random: false });
  else if (spawner.kind === 'tank') out.push({ tank: spawner, mult, random: false });
  else if (spawner.kind === 'sentry') out.push({ sentry: spawner, mult, random: false });
  else if (spawner.kind === 'other') out.push({ other: spawner, mult, random: false });
  else if (spawner.kind === 'squad' || spawner.kind === 'mob') {
    for (const c of spawner.children) flattenBots(c, out, mult * (spawner.kind === 'mob' ? spawner.count : 1));
  } else if (spawner.kind === 'random') {
    const start = out.length;
    for (const c of spawner.children) flattenBots(c, out, mult);
    for (let i = start; i < out.length; i++) out[i].random = true;
  }
  return out;
}

export function parseWaveSpawn(node, templates, wsTemplates) {
  const ws = {
    node,
    name: getValue(node, 'Name', ''),
    where: findAll(node, 'Where').filter(n => n.type === 'kv').map(n => n.value),
    totalCount: getNumber(node, 'TotalCount', 0),
    maxActive: getNumber(node, 'MaxActive', 999),
    spawnCount: Math.max(1, getNumber(node, 'SpawnCount', 1)),
    waitBeforeStarting: getNumber(node, 'WaitBeforeStarting', 0),
    waitBetweenSpawns: getNumber(node, 'WaitBetweenSpawns', 0),
    waitBetweenSpawnsAfterDeath: getNumber(node, 'WaitBetweenSpawnsAfterDeath', 0),
    totalCurrency: getNumber(node, 'TotalCurrency', 0),
    waitForAllSpawned: getValue(node, 'WaitForAllSpawned', null),
    waitForAllDead: getValue(node, 'WaitForAllDead', null),
    randomSpawn: getNumber(node, 'RandomSpawn', 0) !== 0,
    support: null,
    spawner: null,
    templateName: null
  };
  const sup = findFirst(node, 'Support');
  if (sup && sup.type === 'kv') ws.support = /^limited$/i.test(sup.value) ? 'limited' : 'unlimited';
  const tmpl = findFirst(node, 'Template');
  if (tmpl && tmpl.type === 'kv' && wsTemplates && wsTemplates.has(tmpl.value.toLowerCase())) {
    ws.templateName = tmpl.value;
    const tnode = wsTemplates.get(tmpl.value.toLowerCase()).node;
    const overlay = parseWaveSpawn(tnode, templates, null);
    for (const k of ['totalCount', 'maxActive', 'spawnCount', 'waitBeforeStarting', 'waitBetweenSpawns', 'waitBetweenSpawnsAfterDeath', 'totalCurrency']) {
      if (findFirst(node, k) === null && findFirst(tnode, k)) ws[k] = overlay[k];
    }
    if (!findFirst(node, 'Support') && overlay.support) ws.support = overlay.support;
    if (ws.where.length === 0) ws.where = overlay.where;
    if (!ws.spawner) ws.spawner = overlay.spawner;
  }
  for (const c of node.children) {
    if (c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase())) {
      ws.spawner = parseSpawner(c, templates);
      break;
    }
  }
  ws.bots = flattenBots(ws.spawner);
  ws.squadSize = ws.spawner && (ws.spawner.kind === 'squad') ? Math.max(1, ws.spawner.count) : 1;
  ws.isTank = ws.bots.some(b => b.tank);
  ws.hasBoss = ws.bots.some(b => b.bot && b.bot.isBoss);
  ws.hasGiant = ws.bots.some(b => b.bot && b.bot.isGiant);
  ws.outputs = node.children
    .filter(c => c.type === 'block' && WS_OUTPUT_KEYS.includes(c.key.toLowerCase()))
    .map(c => ({ when: c.key, target: getValue(c, 'Target', '?'), action: getValue(c, 'Action', 'Trigger'), param: getValue(c, 'Param', null) }));
  ws.sounds = node.children
    .filter(c => c.type === 'kv' && WS_SOUND_KEYS.includes(c.key.toLowerCase()))
    .map(c => ({ when: c.key, value: c.value }));
  return ws;
}

function wsEffectiveHP(ws) {
  if (!ws.bots.length || ws.totalCount <= 0) return 0;
  let weighted = 0, mults = 0;
  for (const e of ws.bots) {
    const hp = e.bot ? e.bot.health : e.tank ? e.tank.health : e.other && e.other.health ? e.other.health : 0;
    weighted += hp * e.mult;
    mults += e.mult;
  }
  if (!mults) return 0;
  return Math.round((weighted / mults) * ws.totalCount);
}

export function parseWave(node, index, templates, wsTemplates) {
  const wave = {
    node, index,
    waitWhenDone: getNumber(node, 'WaitWhenDone', 0),
    checkpoint: getValue(node, 'Checkpoint', null),
    description: getValue(node, 'Description', null),
    sound: getValue(node, 'Sound', null),
    wavespawns: findAll(node, 'WaveSpawn').filter(n => n.type === 'block').map(n => parseWaveSpawn(n, templates, wsTemplates))
  };
  const referenced = new Set();
  for (const w of wave.wavespawns) {
    if (w.waitForAllSpawned) referenced.add(w.waitForAllSpawned.toLowerCase());
    if (w.waitForAllDead) referenced.add(w.waitForAllDead.toLowerCase());
  }
  for (const w of wave.wavespawns) {
    w.isLogic = w.bots.length === 0 && (
      w.outputs.length > 0 || w.sounds.length > 0 ||
      w.waitForAllSpawned !== null || w.waitForAllDead !== null ||
      (w.name && referenced.has(w.name.toLowerCase()))
    );
  }
  wave.totalCurrency = wave.wavespawns.reduce((s, w) => s + (w.totalCurrency > 0 ? w.totalCurrency : 0), 0);
  wave.totalBots = wave.wavespawns.reduce((s, w) => s + (w.support || w.isLogic ? 0 : Math.max(0, w.totalCount)), 0);
  wave.supportBots = wave.wavespawns.reduce((s, w) => s + (w.support === 'limited' ? Math.max(0, w.totalCount) : 0), 0);
  wave.tankCount = wave.wavespawns.reduce((s, w) => s + (w.isTank && !w.support ? Math.max(1, w.totalCount) : 0), 0);
  wave.totalHP = wave.wavespawns.reduce((s, w) => s + (w.support || w.isLogic ? 0 : wsEffectiveHP(w)), 0);
  return wave;
}

export function parseMission(node, templates) {
  const spawnerNode = node.children.find(c => c.type === 'block' && SPAWNER_KEYS.has(c.key.toLowerCase()));
  return {
    node,
    objective: getValue(node, 'Objective', ''),
    initialCooldown: getNumber(node, 'InitialCooldown', 0),
    cooldownTime: getNumber(node, 'CooldownTime', 0),
    desiredCount: getNumber(node, 'DesiredCount', 1),
    beginAtWave: getNumber(node, 'BeginAtWave', 1),
    runForThisManyWaves: getNumber(node, 'RunForThisManyWaves', 1),
    where: getValue(node, 'Where', ''),
    spawner: spawnerNode ? parseSpawner(spawnerNode, templates) : null
  };
}

export function collectWaveSpawnTemplates(doc, baseDocs) {
  const map = new Map();
  const scan = (d, src) => {
    const root = findRoot(d);
    if (!root) return;
    for (const tblock of findAll(root, 'Templates')) {
      for (const t of tblock.children) {
        if (t.type !== 'block') continue;
        const looksWS = t.children.some(c => c.type === 'kv' && ['totalcount', 'spawncount', 'maxactive', 'waitbeforestarting', 'waitbetweenspawns', 'totalcurrency', 'where', 'support', 'waitforallspawned', 'waitforalldead'].includes(c.key.toLowerCase()));
        if (looksWS) map.set(t.key.toLowerCase(), { name: t.key, node: t, source: src });
      }
    }
  };
  for (const { name, doc: bdoc } of baseDocs) scan(bdoc, name);
  scan(doc, 'this file');
  return map;
}

export function buildModel(doc, baseDocs) {
  const root = findRoot(doc);
  const templates = collectTemplates(doc, baseDocs);
  const wsTemplates = collectWaveSpawnTemplates(doc, baseDocs);
  const model = {
    doc, root, templates, wsTemplates, baseDocs,
    waves: [], missions: [], settings: [], otherBlocks: [], spawnPoints: new Set()
  };
  if (!root) return model;
  let wi = 0;
  for (const c of root.children) {
    const k = c.key.toLowerCase();
    if (c.type === 'block' && k === 'wave') model.waves.push(parseWave(c, wi++, templates, wsTemplates));
    else if (c.type === 'block' && k === 'mission') model.missions.push(parseMission(c, templates));
    else if (c.type === 'kv') model.settings.push(c);
    else if (c.type === 'block' && k !== 'templates') model.otherBlocks.push(c);
  }
  for (const w of model.waves) {
    for (const ws of w.wavespawns) {
      for (const loc of ws.where) if (loc) model.spawnPoints.add(loc);
    }
  }
  for (const m of model.missions) if (m.where) model.spawnPoints.add(m.where);
  for (const b of model.otherBlocks) {
    if (b.key.toLowerCase() === 'extraspawnpoint') {
      const n = getValue(b, 'Name', null);
      if (n) model.spawnPoints.add(n);
    }
  }
  model.startingCurrency = root ? getNumber(root, 'StartingCurrency', 0) : 0;
  model.robotLimit = root ? getNumber(root, 'RobotLimit', 22) : 22;
  model.totalDropped = model.waves.reduce((s, w) => s + w.totalCurrency, 0);
  model.totalWithBonus = model.totalDropped + Math.max(0, model.waves.length - 1) * 100;
  return model;
}

export function botDisplayName(bot) {
  if (bot.name) return bot.name;
  if (bot.templateChain.length) return bot.templateChain[bot.templateChain.length - 1].replace(/^T_TFBot_/i, '').replace(/_/g, ' ');
  const ci = CLASS_INFO[bot.cls];
  return ci ? ci.label : '?';
}

export function describeSpawner(spawner) {
  if (!spawner) return 'empty';
  if (spawner.kind === 'bot') return botDisplayName(spawner.bot);
  if (spawner.kind === 'tank') return `Tank ${spawner.health}`;
  if (spawner.kind === 'squad') return 'Squad: ' + spawner.children.map(describeSpawner).join(' + ');
  if (spawner.kind === 'random') return 'Random: ' + spawner.children.map(describeSpawner).join(' / ');
  if (spawner.kind === 'mob') return `Mob x${spawner.count}`;
  if (spawner.kind === 'sentry') return `Sentry L${spawner.level}`;
  return spawner.label || '?';
}
