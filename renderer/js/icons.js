import { native } from './native.js';

const cache = new Map();
let browserManifest = null;

export function getIconDirs() {
  try { return JSON.parse(localStorage.getItem('popvis.icondirs') || '[]'); } catch { return []; }
}

export function setIconDirs(dirs) {
  localStorage.setItem('popvis.icondirs', JSON.stringify(dirs));
}

export function getTFOverride() {
  return localStorage.getItem('popvis.tfpath') || null;
}

export function setTFOverride(p) {
  if (p) localStorage.setItem('popvis.tfpath', p);
  else localStorage.removeItem('popvis.tfpath');
}

let tfDetectPromise = null;

export async function getTFPath() {
  const override = getTFOverride();
  if (override) return override;
  if (!native.isElectron) return null;
  if (!tfDetectPromise) tfDetectPromise = window.popnative.tfDetect();
  return tfDetectPromise;
}

const CLASS_ICON_MAP = { scout: 'scout', soldier: 'soldier', pyro: 'pyro', demoman: 'demo', heavyweapons: 'heavy', engineer: 'engineer', medic: 'medic', sniper: 'sniper', spy: 'spy' };

export function iconNameFor(bot) {
  if (bot.icon) return 'leaderboard_class_' + bot.icon.toLowerCase();
  return classIconName(bot.cls);
}

export function classIconName(cls) {
  if (cls && CLASS_ICON_MAP[cls]) return 'leaderboard_class_' + CLASS_ICON_MAP[cls];
  return null;
}

export function tankIconName(tank) {
  return tank && tank.icon ? 'leaderboard_class_' + tank.icon.toLowerCase() : 'leaderboard_class_tank';
}

export function iconURL(name) {
  if (!name) return null;
  const hit = cache.get(name.toLowerCase());
  return hit || null;
}

export function collectIconNames(model) {
  const names = new Set(['leaderboard_class_tank', 'leaderboard_class_sentry_buster']);
  const addBot = bot => {
    const n = iconNameFor(bot);
    if (n) names.add(n);
    const d = classIconName(bot.cls);
    if (d) names.add(d);
  };
  for (const wave of model.waves) {
    for (const ws of wave.wavespawns) {
      for (const b of ws.bots) {
        if (b.bot) addBot(b.bot);
        else if (b.tank) names.add(tankIconName(b.tank));
      }
    }
  }
  for (const m of model.missions) {
    if (m.spawner && m.spawner.kind === 'bot') addBot(m.spawner.bot);
  }
  for (const t of model.templates.values()) {
    const icon = t.node.children.find(c => c.type === 'kv' && c.key.toLowerCase() === 'classicon');
    if (icon) names.add('leaderboard_class_' + icon.value.toLowerCase());
  }
  return names;
}

function candidatesFor(name) {
  const out = [name];
  let cur = name;
  for (;;) {
    const next = cur.replace(/_(giant|g|armored|fixed|nys|v2)$/, '');
    if (next === cur || next === 'leaderboard_class') break;
    cur = next;
    out.push(cur);
  }
  return out;
}

export async function ensureIcons(names, fileDirs = []) {
  const missing = [...names].map(n => n.toLowerCase()).filter(n => !cache.has(n));
  if (!missing.length) return false;

  if (native.isElectron) {
    const dirs = [...new Set([...fileDirs, ...getIconDirs()])];
    const allCandidates = [...new Set(missing.flatMap(candidatesFor))];
    const tfPath = await getTFPath();
    const result = await window.popnative.resolveIcons(allCandidates, dirs, tfPath);
    for (const name of missing) {
      let url = null;
      for (const c of candidatesFor(name)) {
        if (result[c]) { url = result[c]; break; }
      }
      cache.set(name, url);
    }
    return true;
  }

  await loadManifest();
  for (const name of missing) {
    let url = null;
    for (const c of candidatesFor(name)) {
      if (browserManifest.has(c)) { url = '../icons/' + c + '.png'; break; }
    }
    cache.set(name, url);
  }
  return true;
}

async function loadManifest() {
  if (!browserManifest) {
    try {
      const res = await fetch('../icons/manifest.json');
      browserManifest = new Set(await res.json());
    } catch { browserManifest = new Set(); }
  }
  return browserManifest;
}

export async function listAllIcons(fileDirs = []) {
  if (native.isElectron) {
    const dirs = [...new Set([...fileDirs, ...getIconDirs()])];
    const tfPath = await getTFPath();
    return window.popnative.listIcons(dirs, tfPath);
  }
  const manifest = await loadManifest();
  return [...manifest].sort().map(name => ({ name, source: 'bundled' }));
}

export async function refreshIcons() {
  cache.clear();
  browserManifest = null;
  if (native.isElectron) await window.popnative.refreshIcons();
}
