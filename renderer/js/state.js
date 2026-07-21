import { parse, serialize } from './kv.js';
import { buildModel } from './popmodel.js';
import { simulateWave, DEFAULT_SIM_OPTS } from './sim.js';
import { lintModel } from './lint.js';
import { native } from './native.js';
import { collectIconNames, ensureIcons, getTFPath } from './icons.js';
import { buildTriggerGraph, analyzeWave, isGated } from './gating.js';

let fileSeq = 1;

export const state = {
  files: [],
  activeId: null,
  view: { mode: 'welcome', wave: 0 },
  search: '',
  simOpts: loadSimOpts(),
  showLint: false,
  diffOtherId: null,
  dock: null,
  zen: false,
  listeners: new Set()
};

const TANK_PATH_TIMES = {
  bigrock: 75, coaltown: 60, decoy: 62, mannworks: 62,
  rottenburg: 48, mannhattan: 68, ghost: 60, ghosttown: 60
};

export function mapKeyOf(file) {
  const m = file.name.toLowerCase().match(/^mvm_([a-z0-9]+)/);
  return m ? m[1] : null;
}

export function defaultTankTime(file) {
  const k = mapKeyOf(file);
  return k && TANK_PATH_TIMES[k] ? TANK_PATH_TIMES[k] : null;
}

export function rawTankOverride(file) {
  const raw = localStorage.getItem('popvis.tanktime.' + file.name.toLowerCase());
  if (raw === null) return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function tankTimeFor(file) {
  const o = rawTankOverride(file);
  if (o !== null) return o;
  const d = defaultTankTime(file);
  return d !== null ? d : state.simOpts.tankLifetime;
}

export function setTankTime(file, v) {
  const key = 'popvis.tanktime.' + file.name.toLowerCase();
  if (v === null || !Number.isFinite(v) || v <= 0) localStorage.removeItem(key);
  else localStorage.setItem(key, String(v));
}

function loadSimOpts() {
  try {
    const raw = localStorage.getItem('popvis.simOpts');
    if (raw) return { ...DEFAULT_SIM_OPTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SIM_OPTS };
}

export function saveSimOpts() {
  localStorage.setItem('popvis.simOpts', JSON.stringify(state.simOpts));
}

export function onChange(fn) {
  state.listeners.add(fn);
}

export function emit(what = 'all') {
  for (const fn of state.listeners) fn(what);
}

export function activeFile() {
  return state.files.find(f => f.id === state.activeId) || null;
}

function restoreViewFor(next) {
  if (!next) { state.view = { mode: 'welcome', wave: 0 }; return; }
  let v = next.viewState || { mode: next.model.waves.length ? 'overview' : 'settings', wave: 0 };
  if (v.mode === 'wave' || v.mode === 'map') {
    if (!next.model.waves.length) v = { mode: 'overview', wave: 0 };
    else v = { mode: v.mode, wave: Math.min(v.wave, next.model.waves.length - 1) };
  }
  state.view = { ...v };
}

function saveCurrentView() {
  const cur = activeFile();
  if (cur && state.view.mode !== 'models' && state.view.mode !== 'welcome') cur.viewState = { ...state.view };
}

export function activateFile(id) {
  if (state.activeId === id) return;
  saveCurrentView();
  state.activeId = id;
  restoreViewFor(activeFile());
}

export async function resolveBases(doc, dirPath) {
  const out = [];
  const paths = await native.paths();
  const queue = doc.bases.map(b => ({ ref: b, path: b.path }));
  const seen = new Set();
  while (queue.length) {
    const { ref, path: rel } = queue.shift();
    const key = rel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidates = [];
    if (dirPath) candidates.push(native.join(dirPath, rel));
    candidates.push(native.join(paths.base, rel));
    candidates.push(native.join(paths.vanilla, rel));
    let text = null;
    let found = null;
    for (const cand of candidates) {
      try {
        if (await native.exists(cand)) { text = await native.readFile(cand); found = cand; break; }
      } catch {}
    }
    if (text === null) {
      if (ref) ref.missing = true;
      continue;
    }
    if (ref) ref.missing = false;
    try {
      const bdoc = parse(text);
      out.push({ name: rel, path: found, doc: bdoc });
      for (const b of bdoc.bases) queue.push({ ref: null, path: b.path });
    } catch {}
  }
  return out;
}

const baseWatchRefs = new Map();

function updateBaseWatches(file) {
  if (!native.isElectron || !window.popnative.watchAdd) return;
  const next = new Map();
  for (const b of file.baseDocs || []) {
    if (b.path) next.set(b.path.toLowerCase(), b.path);
  }
  const prev = file.baseWatchPaths || new Map();
  for (const [k, p] of next) {
    if (prev.has(k)) continue;
    const c = baseWatchRefs.get(k) || 0;
    baseWatchRefs.set(k, c + 1);
    if (!c) window.popnative.watchAdd(p);
  }
  for (const [k, p] of prev) {
    if (next.has(k)) continue;
    const c = (baseWatchRefs.get(k) || 1) - 1;
    if (c <= 0) {
      baseWatchRefs.delete(k);
      if (!state.files.some(f => f.path && f.path.toLowerCase() === k)) window.popnative.watchRemove(p);
    } else baseWatchRefs.set(k, c);
  }
  file.baseWatchPaths = next;
}

export async function refreshBases(file) {
  file.baseDocs = await resolveBases(file.doc, native.dirname(file.path));
  updateBaseWatches(file);
  rebuild(file);
  emit();
}

function parseDiagLint(file) {
  const diags = (file.doc && file.doc.diagnostics) || [];
  return diags.map(d => ({ severity: d.severity || 'error', msg: `Parse: ${d.msg} (line ${d.line})`, line: d.line }));
}

function computeLint(file) {
  file.lint = [...parseDiagLint(file), ...lintModel(file.model, w => simFor(file, w))];
  file.lintStale = false;
}

const lintTimers = new Map();

function scheduleLint(file) {
  file.lintStale = true;
  clearTimeout(lintTimers.get(file.id));
  lintTimers.set(file.id, setTimeout(() => {
    lintTimers.delete(file.id);
    if (!state.files.includes(file)) return;
    computeLint(file);
    emit('lint');
  }, 200));
}

export function rebuild(file, opts = {}) {
  file.model = buildModel(file.doc, file.baseDocs);
  file.simCache = new Map();
  file.gateCache = new Map();
  file.triggerGraph = null;
  if (!file.lint) file.lint = [];
  if (opts.lazyLint) scheduleLint(file);
  else computeLint(file);
  loadIconsFor(file);
  loadTankPathsFor(file);
}

function loadTankPathsFor(file) {
  if (!native.isElectron || !window.popnative.tankPath) return;
  const starts = new Set();
  for (const w of file.model.waves) {
    for (const ws of w.wavespawns) {
      for (const b of ws.bots) {
        if (b.tank && b.tank.startNode) starts.add(b.tank.startNode.toLowerCase());
      }
    }
  }
  if (!starts.size) { file.tankPaths = null; file.tankPathsKey = null; return; }
  const key = [...starts].sort().join('|');
  if (file.tankPathsKey === key) return;
  file.tankPathsKey = key;
  const reqName = file.name;
  (async () => {
    try {
      const tfPath = await getTFPath();
      const res = await window.popnative.tankPath(file.name, tfPath, [...starts]);
      if (file.tankPathsKey !== key || file.name !== reqName) return;
      file.tankPaths = res;
      if (res && res.results && Object.keys(res.results).length) {
        file.simCache = new Map();
        file.lint = lintModel(file.model, w => simFor(file, w));
        emit('tanks');
      }
    } catch {}
  })();
}

function loadIconsFor(file) {
  const names = collectIconNames(file.model);
  const dir = native.dirname(file.path);
  const fileDirs = [dir, native.join(dir, 'materials', 'hud')];
  ensureIcons(names, fileDirs).then(changed => {
    if (changed) emit('icons');
  }).catch(() => {});
}

export function deathModel() {
  const v = localStorage.getItem('popvis.deathmodel');
  return v === 'lifetime' || v === 'damage' ? v : 'hatch';
}

export function setDeathModel(v) {
  localStorage.setItem('popvis.deathmodel', v === 'lifetime' || v === 'damage' ? v : 'hatch');
}

export function measuredTankTime(file, ws) {
  if (!file.tankPaths || !file.tankPaths.results) return null;
  const t = ws.bots.find(b => b.tank);
  if (!t || !t.tank.startNode) return null;
  const r = file.tankPaths.results[t.tank.startNode.toLowerCase()];
  if (!r) return null;
  return r.distance / Math.max(1, t.tank.speed);
}

export function simFor(file, wave) {
  if (!file.simCache) file.simCache = new Map();
  if (!file.simCache.has(wave)) {
    const override = rawTankOverride(file);
    const gates = gatingFor(file, wave);
    file.simCache.set(wave, simulateWave(wave, {
      ...state.simOpts,
      robotLimit: file.model.robotLimit || 22,
      tankLifetime: tankTimeFor(file),
      tankTimeFor: ws => override !== null ? override : measuredTankTime(file, ws),
      gateStateFor: ws => {
        const g = gates.get(ws);
        if (!isGated(g)) return null;
        return { gated: true, triggerAt: wsTriggerTime(file, wave, ws) };
      }
    }));
  }
  return file.simCache.get(wave);
}

export function gatingFor(file, wave) {
  if (!file.gateCache) file.gateCache = new Map();
  if (!file.gateCache.has(wave)) {
    try {
      if (!file.triggerGraph) file.triggerGraph = buildTriggerGraph(file.doc);
      file.gateCache.set(wave, analyzeWave(wave, file.triggerGraph));
    } catch {
      file.gateCache.set(wave, new Map());
    }
  }
  return file.gateCache.get(wave);
}

function triggerKey(file, wave, ws) {
  const idx = wave.wavespawns.indexOf(ws);
  return `popvis.wstrigger.${(file.name || '').toLowerCase()}.${wave.index}.${(ws.name || '').toLowerCase()}#${idx}`;
}

export function wsTriggerTime(file, wave, ws) {
  try {
    const v = localStorage.getItem(triggerKey(file, wave, ws));
    if (v === null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export function setWsTriggerTime(file, wave, ws, seconds) {
  const k = triggerKey(file, wave, ws);
  try {
    if (seconds === null || !Number.isFinite(seconds)) localStorage.removeItem(k);
    else localStorage.setItem(k, String(Math.max(0, seconds)));
  } catch {}
  if (file.simCache) file.simCache.delete(wave);
}

export function invalidateSims() {
  for (const f of state.files) {
    f.simCache = new Map();
    f.lint = lintModel(f.model, w => simFor(f, w));
  }
}

const openingPaths = new Map();

function activateExisting(existing) {
  activateFile(existing.id);
  emit();
  return existing;
}

export async function openFile(path, text = null) {
  const existing = state.files.find(f => f.path === path);
  if (existing) return activateExisting(existing);
  if (openingPaths.has(path)) return openingPaths.get(path);
  const p = (async () => {
    if (text === null) text = await native.readFile(path);
    const doc = parse(text);
    const dir = native.dirname(path);
    const baseDocs = await resolveBases(doc, dir);
    const already = state.files.find(f => f.path === path);
    if (already) return activateExisting(already);
    const file = {
      id: fileSeq++,
      path,
      name: native.basename(path),
      doc,
      baseDocs,
      dirty: false,
      conflict: false,
      savedText: serialize(doc),
      rev: 0,
      undo: [],
      redo: [],
      selection: null,
      simCache: new Map()
    };
    try {
      const bak = localStorage.getItem('popvis.backup.' + path.toLowerCase());
      if (bak && bak !== file.savedText) file.recoveryPending = bak;
      else if (bak) localStorage.removeItem('popvis.backup.' + path.toLowerCase());
    } catch {}
    rebuild(file);
    state.files.push(file);
    saveCurrentView();
    state.activeId = file.id;
    state.view = { mode: file.model.waves.length ? 'overview' : 'settings', wave: 0 };
    addRecent(path);
    if (native.isElectron && window.popnative.watchAdd) window.popnative.watchAdd(path);
    updateBaseWatches(file);
    emit();
    return file;
  })();
  openingPaths.set(path, p);
  try { return await p; } finally { openingPaths.delete(path); }
}

let untitledSeq = 1;

export function newFile(kind = 'empty') {
  const emptyWave = '\tWave\r\n\t{\r\n\t\tStartWaveOutput\r\n\t\t{\r\n\t\t\tTarget\twave_start_relay\r\n\t\t\tAction\tTrigger\r\n\t\t}\r\n\t\tDoneOutput\r\n\t\t{\r\n\t\t\tTarget\twave_finished_relay\r\n\t\t\tAction\tTrigger\r\n\t\t}\r\n';
  const minimalSpawn = '\t\tWaveSpawn\r\n\t\t{\r\n\t\t\tName\twave01a\r\n\t\t\tWhere\tspawnbot\r\n\t\t\tTotalCount\t10\r\n\t\t\tMaxActive\t5\r\n\t\t\tSpawnCount\t2\r\n\t\t\tWaitBeforeStarting\t0\r\n\t\t\tWaitBetweenSpawns\t6\r\n\t\t\tTotalCurrency\t100\r\n\t\t\tTFBot\r\n\t\t\t{\r\n\t\t\t\tClass\tScout\r\n\t\t\t\tSkill\tNormal\r\n\t\t\t}\r\n\t\t}\r\n';
  const mission = '\tMission\r\n\t{\r\n\t\tObjective\tDestroySentries\r\n\t\tInitialCooldown\t30\r\n\t\tWhere\tspawnbot\r\n\t\tBeginAtWave\t1\r\n\t\tRunForThisManyWaves\t1\r\n\t\tCooldownTime\t35\r\n\t\tTFBot\r\n\t\t{\r\n\t\t\tTemplate\tT_TFBot_SentryBuster\r\n\t\t}\r\n\t}\r\n';
  const head = '#base robot_giant.pop\r\n#base robot_standard.pop\r\n\r\nWaveSchedule\r\n{\r\n\tStartingCurrency\t400\r\n\tRespawnWaveTime\t6\r\n\tCanBotsAttackWhileInSpawnRoom\tno\r\n';
  const text = kind === 'minimal'
    ? head + mission + emptyWave + minimalSpawn + '\t}\r\n}\r\n'
    : head + emptyWave + '\t}\r\n}\r\n';
  const name = 'untitled-' + untitledSeq++ + '.pop';
  const doc = parse(text);
  const file = {
    id: fileSeq++,
    path: name,
    name,
    virtual: true,
    doc,
    baseDocs: [],
    dirty: true,
    conflict: false,
    savedText: '',
    rev: 0,
    undo: [],
    redo: [],
    selection: null,
    simCache: new Map()
  };
  (async () => {
    file.baseDocs = await resolveBases(doc, null);
    rebuild(file);
    emit();
  })();
  rebuild(file);
  state.files.push(file);
  saveCurrentView();
  state.activeId = file.id;
  state.view = kind === 'minimal' ? { mode: 'wave', wave: 0 } : { mode: 'settings', wave: 0 };
  emit();
  return file;
}

export async function reloadFromDisk(file, opts = {}) {
  const text = await native.readFile(file.path);
  if (opts.preserveUndo) pushCapped(file.undo, serialize(file.doc));
  else { file.undo = []; file.redo = []; }
  file.doc = parse(text);
  file.baseDocs = await resolveBases(file.doc, native.dirname(file.path));
  updateBaseWatches(file);
  file.savedText = serialize(file.doc);
  file.dirty = false;
  file.conflict = false;
  file.recoveryPending = null;
  file.rev = (file.rev || 0) + 1;
  file.selection = null;
  if (file.multi) file.multi.clear();
  file.tankPathsKey = null;
  rebuild(file);
  if (state.view.mode === 'wave') state.view.wave = Math.min(state.view.wave, Math.max(0, file.model.waves.length - 1));
  emit();
}

export function closeFile(id) {
  const idx = state.files.findIndex(f => f.id === id);
  if (idx < 0) return;
  const closing = state.files[idx];
  state.files.splice(idx, 1);
  if (native.isElectron && window.popnative.watchRemove && closing && !closing.virtual) {
    if (!state.files.some(f => f.path && f.path.toLowerCase() === closing.path.toLowerCase())) window.popnative.watchRemove(closing.path);
  }
  if (closing) {
    closing.baseDocs = [];
    updateBaseWatches(closing);
    if (!closing.dirty && !closing.virtual) {
      try { localStorage.removeItem('popvis.backup.' + closing.path.toLowerCase()); } catch {}
    }
  }
  if (state.diffOtherId === id) state.diffOtherId = null;
  if (state.activeId === id) {
    const next = state.files[Math.min(idx, state.files.length - 1)];
    state.activeId = next ? next.id : null;
    restoreViewFor(next || null);
  }
  emit();
}

const UNDO_MAX_ENTRIES = 120;
const UNDO_MAX_BYTES = 48 * 1024 * 1024;

function pushCapped(arr, text) {
  arr.push(text);
  while (arr.length > UNDO_MAX_ENTRIES) arr.shift();
  let bytes = 0;
  for (const t of arr) bytes += t.length;
  while (bytes > UNDO_MAX_BYTES && arr.length > 8) bytes -= arr.shift().length;
}

export function beginEdit(file) {
  pushCapped(file.undo, serialize(file.doc));
}

export function commitEdit(file, opts = {}) {
  const text = serialize(file.doc);
  if (text === file.undo[file.undo.length - 1]) {
    file.undo.pop();
    rebuild(file);
    emit(opts.emit || 'all');
    return false;
  }
  file.redo.length = 0;
  file.dirty = text !== file.savedText;
  file.rev = (file.rev || 0) + 1;
  rebuild(file, { lazyLint: true });
  emit(opts.emit || 'all');
  return true;
}

export function cancelEdit(file) {
  if (!file || !file.undo.length) return;
  const text = file.undo.pop();
  file.doc = parse(text);
  file.selection = null;
  rebuild(file);
  emit();
}

export function undo(file) {
  if (!file || !file.undo.length) return;
  pushCapped(file.redo, serialize(file.doc));
  const text = file.undo.pop();
  file.doc = parse(text);
  file.selection = null;
  file.dirty = text !== file.savedText;
  file.rev = (file.rev || 0) + 1;
  rebuild(file, { lazyLint: true });
  emit();
}

export function redo(file) {
  if (!file || !file.redo.length) return;
  pushCapped(file.undo, serialize(file.doc));
  const text = file.redo.pop();
  file.doc = parse(text);
  file.selection = null;
  file.dirty = text !== file.savedText;
  file.rev = (file.rev || 0) + 1;
  rebuild(file, { lazyLint: true });
  emit();
}

export function nonLatinReport(text) {
  const bad = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) line++;
    else if (c > 255) {
      const ch = text[i];
      const last = bad[bad.length - 1];
      if (last && last.line === line && last.ch === ch) last.count++;
      else bad.push({ line, ch, count: 1 });
    }
  }
  return bad;
}

export async function saveFile(file, as = false) {
  if (file.saving) return null;
  const text = serialize(file.doc);
  const bad = nonLatinReport(text);
  if (bad.length) return { blocked: 'encoding', bad };
  if (file.conflict && !as) return { blocked: 'conflict' };
  let target = file.path;
  const isVirtual = !native.isElectron || file.virtual;
  if (as || isVirtual) {
    const suggested = file.name;
    const chosen = await native.saveDialog(suggested);
    if (!chosen && native.isElectron) return null;
    if (chosen) target = chosen;
  }
  const rev = file.rev || 0;
  file.saving = true;
  try {
    await native.writeFile(target, text);
  } finally {
    file.saving = false;
  }
  if (native.isElectron) {
    const renamed = target !== file.path;
    if (renamed) {
      if (file.path && !isVirtual && window.popnative.watchRemove) window.popnative.watchRemove(file.path);
      if (window.popnative.watchAdd) window.popnative.watchAdd(target);
    }
    try { localStorage.removeItem('popvis.backup.' + file.path.toLowerCase()); } catch {}
    file.path = target;
    file.name = native.basename(target);
    file.savedText = text;
    if ((file.rev || 0) === rev) file.dirty = false;
    else file.dirty = serialize(file.doc) !== text;
    file.conflict = false;
    file.virtual = false;
    addRecent(target);
    if (renamed) {
      file.tankPaths = null;
      file.tankPathsKey = null;
      file.mapData = undefined;
      file.mapGeo = undefined;
      file.mapTexture = undefined;
      file.mapDataReq = null;
      file.baseDocs = await resolveBases(file.doc, native.dirname(target));
      updateBaseWatches(file);
      rebuild(file);
    }
  }
  emit();
  return { ok: true };
}

export function getRecent() {
  try { return JSON.parse(localStorage.getItem('popvis.recent') || '[]'); } catch { return []; }
}

export function addRecent(path) {
  let list = getRecent().filter(p => p !== path);
  list.unshift(path);
  list = list.slice(0, 12);
  localStorage.setItem('popvis.recent', JSON.stringify(list));
}

export function findWaveIndexOfNode(model, node) {
  for (const w of model.waves) {
    if (w.node === node) return w.index;
    for (const ws of w.wavespawns) {
      if (ws.node === node) return w.index;
    }
  }
  return null;
}

export function matchesSearch(ws, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (ws.name && ws.name.toLowerCase().includes(needle)) return true;
  if (ws.where.some(w => w.toLowerCase().includes(needle))) return true;
  for (const b of ws.bots) {
    if (b.bot) {
      const bt = b.bot;
      if (bt.cls && bt.cls.includes(needle)) return true;
      if (bt.name && bt.name.toLowerCase().includes(needle)) return true;
      if (bt.icon && bt.icon.toLowerCase().includes(needle)) return true;
      if (bt.templateChain.some(t => t.toLowerCase().includes(needle))) return true;
      if (bt.items.some(t => t.toLowerCase().includes(needle))) return true;
    }
    if (b.tank && 'tank'.includes(needle)) return true;
  }
  return false;
}
