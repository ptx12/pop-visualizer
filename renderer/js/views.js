import { el, clear, fmtTime, fmtNum, fmtCompact, compositionChips, botVisual, toast } from './ui.js';
import { state, simFor, emit, beginEdit, commitEdit, getRecent, openFile, rebuild } from './state.js';
import { getValue, setValue, findAll, makeBlock, makeKV, removeNode, serialize, parse } from './kv.js';
import { resolveBot, botDisplayName, CLASS_INFO, buildModel } from './popmodel.js';
import { native } from './native.js';
import { rawEditModal } from './inspector.js';
import { getIconDirs, setIconDirs, refreshIcons, getTFPath, getTFOverride, setTFOverride } from './icons.js';
import { iconBrowserModal } from './iconbrowser.js';
import { diffModels } from './diff.js';

export function renderOverview(container, file) {
  clear(container);
  const m = file.model;
  const wrap = el('div', { class: 'view-pad' });

  const maxCash = m.startingCurrency + m.totalWithBonus;
  const tankCount = m.waves.reduce((s, w) => s + w.tankCount, 0);
  const stat = (v, label, cls) => el('span', { class: 'stat' + (cls ? ' ' + cls : '') },
    el('b', { text: String(v) }), ' ' + label);
  const dot = () => el('span', { class: 'stat-dot', text: '·' });
  wrap.append(el('div', { class: 'stat-strip' },
    stat(m.waves.length, m.waves.length === 1 ? 'wave' : 'waves'),
    dot(),
    stat(m.waves.reduce((s, w) => s + w.totalBots, 0), 'robots'),
    tankCount ? dot() : null,
    tankCount ? stat(tankCount, tankCount === 1 ? 'tank' : 'tanks') : null,
    dot(),
    stat('≈' + fmtCompact(m.waves.reduce((s, w) => s + (w.totalHP || 0), 0)), 'HP'),
    dot(),
    stat(m.robotLimit, 'robot limit'),
    dot(),
    stat('$' + m.startingCurrency, 'start', 'stat-cash'),
    stat('+ $' + m.totalDropped, 'dropped', 'stat-cash'),
    stat('$' + maxCash, 'max', 'stat-cash')
  ));

  if (m.waves.length) {
    wrap.append(el('div', { class: 'panel-title', text: 'Currency per wave' }));
    wrap.append(currencyChart(m));
    wrap.append(el('div', { class: 'panel-title', text: 'Waves' }));
    wrap.append(waveTable(file));
  }

  container.append(wrap);
}

function currencyChart(m) {
  const wrap = el('div', { class: 'cchart' });
  const max = Math.max(...m.waves.map(w => w.totalCurrency), 1);
  let cum = m.startingCurrency;
  for (const w of m.waves) {
    cum += w.totalCurrency;
    const h = Math.max(3, (w.totalCurrency / max) * 120);
    wrap.append(el('div', {
      class: 'cbar-holder',
      title: `Wave ${w.index + 1}: $${w.totalCurrency}\nCumulative (no bonus): $${cum}`,
      onclick: () => { state.view = { mode: 'wave', wave: w.index }; emit(); }
    },
      el('div', { class: 'cbar-val', text: '$' + w.totalCurrency }),
      el('div', { class: 'cbar', style: `height:${h}px` }),
      el('div', { class: 'cbar-label', text: 'W' + (w.index + 1) })));
  }
  return wrap;
}

function waveTable(file) {
  const m = file.model;
  const table = el('table', { class: 'wtable' });
  table.append(el('thead', {}, el('tr', {},
    ...['Wave', 'Robots', 'Support', 'Tanks', 'Currency', 'HP', 'Est. length', 'Composition'].map(h => el('th', { text: h })))));
  const tbody = el('tbody');
  for (const w of m.waves) {
    const sim = simFor(file, w);
    const pseudoWs = { bots: w.wavespawns.flatMap(ws => ws.bots) };
    const row = el('tr', { onclick: () => { state.view = { mode: 'wave', wave: w.index }; emit(); } },
      el('td', { text: 'Wave ' + (w.index + 1) }),
      el('td', { text: w.totalBots }),
      el('td', {}, w.supportBots
        ? el('span', { text: w.supportBots + ' limited' })
        : (w.wavespawns.some(x => x.support === 'unlimited')
          ? el('span', { class: 'inf-mark', title: 'Endless support — spawns until the wave ends', text: '∞' })
          : el('span', { class: 'none-mark', text: 'none' }))),
      el('td', { text: w.tankCount || '—' }),
      el('td', { class: 'cash', text: '$' + w.totalCurrency }),
      el('td', { text: w.totalHP ? '≈' + fmtCompact(w.totalHP) : '—' }),
      el('td', { text: '~' + fmtTime(sim.waveEnd) }),
      el('td', {}, compositionChips(pseudoWs, 10))
    );
    tbody.append(row);
  }
  table.append(tbody);
  return table;
}

export function renderMissions(container, file) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  wrap.append(el('div', { class: 'panel-title-row' },
    el('div', { class: 'panel-title', text: 'Support missions' }),
    el('button', { class: 'btn primary', text: '+ Add mission', onclick: () => addMission(file) })));
  if (!file.model.missions.length) {
    wrap.append(el('div', { class: 'empty-note', text: 'No support missions yet.' }));
  } else {
    wrap.append(missionGrid(file, false));
  }
  container.append(wrap);
}

function missionGrid(file, compact) {
  const m = file.model;
  const nWaves = Math.max(m.waves.length, 1);
  const table = el('table', { class: 'mgrid' });
  const headRow = el('tr', {}, el('th', { text: 'Mission' }), el('th', { text: 'Bot' }), el('th', { text: 'Cooldown' }), el('th', { text: 'Count' }));
  for (let i = 1; i <= nWaves; i++) headRow.append(el('th', { class: 'mgrid-w', text: 'W' + i }));
  table.append(el('thead', {}, headRow));
  const tbody = el('tbody');
  for (const mission of m.missions) {
    const bot = mission.spawner && mission.spawner.kind === 'bot' ? mission.spawner.bot : null;
    const from = mission.beginAtWave;
    const to = mission.beginAtWave + Math.max(1, mission.runForThisManyWaves) - 1;
    const row = el('tr', {
      onclick: () => {
        file.selection = { type: 'mission', nodeId: mission.node.id };
        emit('selection');
      }
    },
      el('td', { text: mission.objective || '?' }),
      el('td', {}, bot ? el('span', { class: 'cellbot' }, botVisual(bot), ' ', botDisplayName(bot)) : '—'),
      el('td', { text: `${fmtNum(mission.initialCooldown)}s / ${fmtNum(mission.cooldownTime)}s` }),
      el('td', { text: mission.desiredCount })
    );
    for (let i = 1; i <= nWaves; i++) {
      const active = i >= from && i <= to;
      row.append(el('td', { class: 'mgrid-cell' + (active ? ' on' : ''), title: active ? `active in wave ${i}` : '' }));
    }
    tbody.append(row);
  }
  table.append(tbody);
  return table;
}

function addMission(file) {
  beginEdit(file);
  const node = makeBlock('Mission', [
    makeKV('Objective', 'DestroySentries'),
    makeKV('InitialCooldown', 30),
    makeKV('Where', [...file.model.spawnPoints][0] || 'spawnbot'),
    makeKV('BeginAtWave', 1),
    makeKV('RunForThisManyWaves', Math.max(1, file.model.waves.length)),
    makeKV('CooldownTime', 35),
    makeBlock('TFBot', [makeKV('Template', 'T_TFBot_SentryBuster')])
  ]);
  const root = file.model.root;
  const firstWave = findAll(root, 'Wave')[0];
  const idx = firstWave ? root.children.indexOf(firstWave) : root.children.length;
  root.children.splice(idx, 0, node);
  file.selection = { type: 'mission', nodeId: node.id };
  commitEdit(file);
}

export function renderTemplates(container, file) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  const list = [...file.model.templates.values()];
  const local = list.filter(t => t.source === 'this file');
  const inherited = list.filter(t => t.source !== 'this file');

  const search = el('input', { class: 'inp tpl-search', placeholder: `Filter ${list.length} templates…`, type: 'search' });
  const grid = el('div', { class: 'tpl-grid' });

  const renderGrid = () => {
    clear(grid);
    const q = search.value.toLowerCase();
    const show = (arr, tag) => {
      for (const t of arr) {
        if (q && !t.name.toLowerCase().includes(q)) continue;
        const bot = resolveBot(t.node, file.model.templates);
        grid.append(el('div', {
          class: 'tpl-card',
          onclick: () => { file.selection = { type: 'template', nodeId: t.node.id }; emit('selection'); }
        },
          el('div', { class: 'tpl-head' }, botVisual(bot), el('span', { class: 'tpl-name', text: t.name })),
          el('div', { class: 'tpl-meta', text: `${CLASS_INFO[bot.cls] ? CLASS_INFO[bot.cls].label : '—'} · ${bot.health} HP${bot.isGiant ? ' · Giant' : ''}` }),
          el('div', { class: 'tpl-src ' + tag, text: t.source })));
      }
    };
    show(local, 'local');
    show(inherited, 'base');
    if (!grid.children.length) grid.append(el('div', { class: 'empty-note', text: 'No templates match' }));
  };
  search.addEventListener('input', renderGrid);
  renderGrid();

  wrap.append(el('div', { class: 'panel-title-row' },
    el('div', { class: 'panel-title', text: `Templates (${local.length} local, ${inherited.length} from #base)` }), search));
  wrap.append(grid);
  container.append(wrap);
}

const KNOWN_SETTINGS = ['StartingCurrency', 'RespawnWaveTime', 'FixedRespawnWaveTime', 'CanBotsAttackWhileInSpawnRoom', 'Advanced', 'EventPopfile', 'AddSentryBusterWhenDamageDealtExceeds', 'AddSentryBusterWhenKillCountExceeds', 'RobotLimit', 'AllowBotExtraSlots', 'MaxRedPlayers', 'RespecLimit', 'RespecEnabled', 'BonusRatioHalf', 'BonusRatioFull', 'FastWholeMapTriggers', 'ImprovedAirblast', 'SniperAllowHeadshots', 'SendBotsToSpectatorImmediately', 'SentryBusterFriendlyFire', 'BotPushaway', 'NoRomevisionCosmetics', 'HumansMustJoinTeam', 'ForceHoliday', 'TextPrintTime', 'NoMissionInfo', 'BluHumanFlagCapture', 'BluHumanFlagPickup', 'BluHumanInfiniteCloak', 'BluHumanInfiniteAmmo', 'BotsUsePlayerTeleporters', 'MaxSpectators', 'BusterDamageDealt', 'StealthDamageReduction', 'MaxEntitySpeed', 'UpgradeStationKeepWeapons', 'DisableUpgradeStations', 'AllowFlagCarrierToFight', 'AllowMultipleSappers', 'FlagResetTime', 'MaxActiveZombies'];

export function renderSettings(container, file) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  wrap.append(el('div', { class: 'set-group', text: 'This mission — saved in the popfile' }));
  wrap.append(el('div', { class: 'panel-title', text: 'Mission settings' }));

  const table = el('table', { class: 'settings-table' });
  for (const kv of file.model.settings) {
    const valInput = el('input', { class: 'inp', value: kv.value });
    valInput.addEventListener('change', () => {
      beginEdit(file);
      kv.value = valInput.value;
      commitEdit(file);
    });
    table.append(el('tr', {},
      el('td', { class: 'set-key', text: kv.key }),
      el('td', {}, valInput),
      el('td', {}, el('button', { class: 'icon-btn sm danger', text: '×', title: 'Remove setting', onclick: () => { beginEdit(file); removeNode(file.model.root, kv); commitEdit(file); } }))));
  }
  wrap.append(table);

  const keyInput = el('input', { class: 'inp', placeholder: 'Setting name…', list: 'dl-settings' });
  const valInput = el('input', { class: 'inp', placeholder: 'value' });
  let dl = document.getElementById('dl-settings');
  if (!dl) {
    dl = el('datalist', { id: 'dl-settings' });
    document.body.append(dl);
  }
  clear(dl);
  KNOWN_SETTINGS.forEach(s => dl.append(el('option', { value: s })));
  wrap.append(el('div', { class: 'btn-row set-add' },
    keyInput, valInput,
    el('button', { class: 'btn primary', text: 'Add', onclick: () => {
      if (!keyInput.value.trim()) return;
      beginEdit(file);
      file.model.root.children.unshift(makeKV(keyInput.value.trim(), valInput.value.trim() || '1'));
      commitEdit(file);
    } })));

  if (file.model.otherBlocks.length) {
    wrap.append(el('div', { class: 'panel-title', text: 'Additional blocks' }));
    for (const b of file.model.otherBlocks) {
      wrap.append(el('div', { class: 'other-block' },
        el('span', { class: 'ob-key', text: b.key }),
        el('span', { class: 'muted', text: summarizeBlock(b) }),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn sm', text: 'Edit raw', onclick: () => rawEditModal(file, file.model.root, b, b.key) }),
        el('button', { class: 'icon-btn sm danger', text: '×', title: 'Remove block', onclick: () => { beginEdit(file); removeNode(file.model.root, b); commitEdit(file); } })));
    }
  }

  const tblocks = findAll(file.model.root || { children: [] }, 'Templates');
  if (!tblocks.length) {
    wrap.append(el('div', { class: 'btn-row' }, el('button', { class: 'btn', text: '+ Add Templates block', onclick: () => {
      beginEdit(file);
      file.model.root.children.unshift(makeBlock('Templates'));
      commitEdit(file);
    } })));
  }

  wrap.append(el('div', { class: 'set-group', text: 'Application preferences — stored on this computer' }));
  wrap.append(el('div', { class: 'panel-title', text: 'Robot icons' }));
  const tfRow = el('div', { class: 'other-block' },
    el('span', { class: 'ob-key', text: 'TF folder' }),
    el('span', { class: 'muted', text: getTFOverride() || 'detecting…' }),
    el('span', { class: 'grow' }),
    native.isElectron ? el('button', { class: 'btn sm', text: 'Browse…', onclick: async () => {
      const dir = await native.dirDialog('Pick your Team Fortress 2 tf folder');
      if (!dir) return;
      setTFOverride(dir);
      await refreshIcons();
      for (const f of state.files) rebuild(f);
      emit();
    } }) : null,
    getTFOverride() ? el('button', { class: 'btn sm', text: 'Auto', title: 'Reset to auto-detected Steam install', onclick: async () => {
      setTFOverride(null);
      await refreshIcons();
      for (const f of state.files) rebuild(f);
      emit();
    } }) : null);
  wrap.append(tfRow);
  if (!getTFOverride()) {
    getTFPath().then(p => {
      const span = tfRow.querySelector('.muted');
      if (span) span.textContent = p || 'not found — set it with Browse';
    });
  }
  wrap.append(el('div', { class: 'panel-title', text: 'Extra icon folders' }));
  const dirs = getIconDirs();
  for (const d of dirs) {
    wrap.append(el('div', { class: 'other-block' },
      el('span', { class: 'muted', text: d }),
      el('span', { class: 'grow' }),
      el('button', { class: 'icon-btn sm danger', text: '×', title: 'Remove folder', onclick: async () => {
        setIconDirs(dirs.filter(x => x !== d));
        await refreshIcons();
        emit();
      } })));
  }
  const iconBtns = el('div', { class: 'btn-row' },
    el('button', { class: 'btn', text: 'Browse icon library…', title: 'Every icon found across all sources — click one to copy its ClassIcon value', onclick: () => iconBrowserModal(file) }));
  if (native.isElectron) {
    iconBtns.append(
      el('button', { class: 'btn', text: '+ Add icon folder…', onclick: async () => {
        const dir = await native.dirDialog('Add icon folder');
        if (!dir) return;
        if (!dirs.includes(dir)) setIconDirs([...dirs, dir]);
        await refreshIcons();
        for (const f of state.files) rebuild(f);
        emit('icons');
      } }),
      el('button', { class: 'btn', text: 'Rescan icons', onclick: async () => {
        await refreshIcons();
        for (const f of state.files) rebuild(f);
        emit('icons');
      } }));
  }
  wrap.append(iconBtns);

  if (native.isElectron) {
    wrap.append(el('div', { class: 'panel-title', text: 'Model viewer' }));
    const hlmvInput = el('input', { class: 'inp', value: localStorage.getItem('popvis.hlmv') || '', placeholder: 'auto (searches the TF2 bin folder)' });
    hlmvInput.addEventListener('change', () => {
      const v = hlmvInput.value.trim();
      if (v) localStorage.setItem('popvis.hlmv', v);
      else localStorage.removeItem('popvis.hlmv');
      toast('HLMV path ' + (v ? 'set' : 'reset to auto'));
    });
    wrap.append(el('div', { class: 'other-block' },
      el('span', { class: 'ob-key', text: 'HLMV path' }),
      hlmvInput,
      el('span', { class: 'muted', text: 'Used when double-clicking a model' })));
  }
  container.append(wrap);
}

function summarizeBlock(b) {
  const name = getValue(b, 'Name', null);
  if (name) return name;
  return b.children.length + ' entries';
}

export function renderRelays(container, file) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  wrap.append(el('div', { class: 'panel-title', text: 'Relays fired by this mission' }));

  const relays = new Map();
  const addFire = (target, desc, nav) => {
    if (!target || target === '?') return;
    const k = target.toLowerCase();
    if (!relays.has(k)) relays.set(k, { target, firers: [] });
    relays.get(k).firers.push({ desc, nav });
  };
  for (const w of file.model.waves) {
    for (const key of ['StartWaveOutput', 'DoneOutput', 'InitWaveOutput']) {
      const node = findAll(w.node, key);
      for (const n of node) addFire(getValue(n, 'Target', null), `Wave ${w.index + 1} ${key}`, { wave: w.index });
    }
    for (const ws of w.wavespawns) {
      for (const o of ws.outputs) {
        addFire(o.target, `Wave ${w.index + 1} "${ws.name || 'unnamed'}" ${o.when}`, { wave: w.index, node: ws.node });
      }
    }
  }

  if (!relays.size) {
    wrap.append(el('div', { class: 'empty-note', text: 'No outputs found.' }));
  } else {
    const table = el('table', { class: 'wtable' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Relay target' }), el('th', { text: 'Fired by' }))));
    const tbody = el('tbody');
    const sorted = [...relays.values()].sort((a, b) => a.target.localeCompare(b.target));
    for (const r of sorted) {
      const firers = el('div', { class: 'relay-firers' });
      for (const f of r.firers) {
        firers.append(el('span', {
          class: 'relay-firer', text: f.desc,
          onclick: () => {
            state.view = { mode: 'wave', wave: f.nav.wave };
            if (f.nav.node) file.selection = { type: 'wavespawn', nodeId: f.nav.node.id };
            emit();
          }
        }));
      }
      tbody.append(el('tr', {}, el('td', { class: 'relay-name', text: r.target }), el('td', {}, firers)));
    }
    table.append(tbody);
    wrap.append(table);
  }
  container.append(wrap);
}

function kindClass(kind) {
  return kind === 'added' ? 'diff-add' : kind === 'removed' ? 'diff-del' : 'diff-chg';
}

export function renderDiff(container, file) {
  clear(container);
  const wrap = el('div', { class: 'view-pad' });
  const others = state.files.filter(f => f.id !== file.id);
  const diskMode = state.diffOtherId === '__disk';
  const other = diskMode ? null : state.files.find(f => f.id === state.diffOtherId && f.id !== file.id) || null;
  const canDisk = native.isElectron && !file.virtual;

  const picker = el('select', { class: 'inp diff-picker' });
  picker.append(el('option', { value: '', text: other || diskMode ? '(change comparison)' : 'Pick a version to compare against…', selected: !other && !diskMode }));
  if (canDisk) picker.append(el('option', { value: '__disk', text: 'Saved on disk (' + file.name + ')', selected: diskMode }));
  for (const f of others) picker.append(el('option', { value: f.id, text: f.name, selected: other && other.id === f.id }));
  picker.addEventListener('change', () => {
    state.diffOtherId = picker.value === '__disk' ? '__disk' : (picker.value ? parseInt(picker.value, 10) : null);
    emit();
  });

  wrap.append(el('div', { class: 'panel-title-row' },
    el('div', { class: 'panel-title', text: 'Compare versions' }),
    el('div', { class: 'btn-row' },
      picker,
      native.isElectron ? el('button', { class: 'btn', text: 'Browse…', onclick: async () => {
        const paths = await native.openDialog();
        if (!paths.length) return;
        const prevActive = state.activeId;
        const opened = await openFile(paths[0]);
        state.activeId = prevActive;
        state.diffOtherId = opened.id;
        state.view = { mode: 'diff', wave: 0 };
        emit();
      } }) : null)));

  if (diskMode) {
    container.append(wrap);
    const note = el('div', { class: 'empty-note', text: 'Reading the disk version…' });
    wrap.append(note);
    native.readFile(file.path).then(text => {
      if (!wrap.isConnected) return;
      note.remove();
      wrap.append(el('div', { class: 'tip', text: `saved on disk (old) → unsaved editor state (current)` }));
      const diskModel = buildModel(parse(text), file.baseDocs);
      appendDiffBody(wrap, file, diskModel);
    }).catch(e => {
      note.textContent = 'Could not read the disk version: ' + e.message;
    });
    return;
  }

  if (!other) {
    container.append(wrap);
    return;
  }

  wrap.append(el('div', { class: 'tip', text: `${other.name} (old) → ${file.name} (current)` }));
  appendDiffBody(wrap, file, other.model);
  container.append(wrap);
}

function appendDiffBody(wrap, file, oldModel) {
  const d = diffModels(oldModel, file.model);

  if (d.empty) {
    wrap.append(el('div', { class: 'empty-note', text: 'No differences found.' }));
    return;
  }

  const section = (title, rows) => {
    if (!rows.length) return;
    wrap.append(el('div', { class: 'panel-title', text: title }));
    for (const r of rows) wrap.append(r);
  };

  section('Settings', d.settings.map(s => el('div', { class: 'diff-row ' + kindClass(s.kind) },
    el('span', { class: 'diff-kind', text: s.kind }),
    el('span', { class: 'diff-label', text: s.label }),
    el('span', { class: 'diff-vals', text: s.kind === 'changed' ? `${s.from} -> ${s.to}` : s.kind === 'added' ? String(s.to) : String(s.from) }))));

  const waveRows = [];
  for (const w of d.waves) {
    const head = el('div', {
      class: 'diff-wave-head', text: `Wave ${w.index + 1}` + (w.kind !== 'changed' ? ` (${w.kind})` : ''),
      onclick: () => { state.view = { mode: 'wave', wave: Math.min(w.index, file.model.waves.length - 1) }; emit(); }
    });
    waveRows.push(head);
    for (const h of w.headline || []) {
      waveRows.push(el('div', { class: 'diff-row diff-chg' },
        el('span', { class: 'diff-kind', text: 'changed' }),
        el('span', { class: 'diff-label', text: h.label }),
        el('span', { class: 'diff-vals', text: `${h.from} -> ${h.to}` })));
    }
    for (const e of w.entries || []) {
      if (e.kind !== 'changed') {
        waveRows.push(el('div', { class: 'diff-row ' + kindClass(e.kind) },
          el('span', { class: 'diff-kind', text: e.kind }),
          el('span', { class: 'diff-label', text: e.label })));
        continue;
      }
      for (const c of e.changes) {
        waveRows.push(el('div', { class: 'diff-row diff-chg' },
          el('span', { class: 'diff-kind', text: 'changed' }),
          el('span', { class: 'diff-label', text: `${e.label}: ${c.label}` }),
          el('span', { class: 'diff-vals', text: c.detail ? c.detail : `${c.from} -> ${c.to}` })));
      }
    }
  }
  section('Waves', waveRows);

  section('Support missions', d.missions.map(m => el('div', { class: 'diff-row ' + kindClass(m.kind) },
    el('span', { class: 'diff-kind', text: m.kind }),
    el('span', { class: 'diff-label', text: m.label }),
    m.changes ? el('span', { class: 'diff-vals', text: m.changes.map(c => c.detail ? `${c.label} ${c.detail}` : `${c.label} ${c.from} -> ${c.to}`).join(', ') }) : null)));

  section('Templates', d.templates.map(t => el('div', { class: 'diff-row ' + kindClass(t.kind) },
    el('span', { class: 'diff-kind', text: t.kind }),
    el('span', { class: 'diff-label', text: t.label }))));
}

function removeRecent(p) {
  const list = getRecent().filter(x => x !== p);
  localStorage.setItem('popvis.recent', JSON.stringify(list));
}

export function renderWelcome(container) {
  clear(container);
  const wrap = el('div', { class: 'welcome' });
  const actions = el('div', { class: 'welcome-actions' });
  actions.append(el('button', { class: 'btn primary', text: 'Open popfile…', onclick: () => openViaDialog() }));
  actions.append(el('button', { class: 'btn', text: 'Vanilla missions', onclick: () => showVanillaBrowser() }));
  wrap.append(actions);
  wrap.append(el('div', { class: 'welcome-drop', text: 'Drop .pop files to open' }));

  const recent = getRecent();
  if (recent.length && native.isElectron) {
    const list = el('div', { class: 'recent-list' });
    for (const p of recent) {
      const item = el('div', { class: 'recent-item', role: 'button', tabindex: 0, 'data-kbd': true, onclick: async () => {
        try {
          await openFile(p);
        } catch (e) {
          toast('Could not open: ' + e.message, 'error');
          removeRecent(p);
          item.remove();
        }
      } },
        el('span', { class: 'recent-name', text: p.split(/[\\/]/).pop() }),
        el('span', { class: 'recent-path', text: p }),
        el('button', { class: 'icon-btn sm recent-x', text: '×', title: 'Remove from recent files', onclick: e => {
          e.stopPropagation();
          removeRecent(p);
          item.remove();
        } }));
      list.append(item);
      native.exists(p).then(ok => { if (!ok) { item.classList.add('missing'); item.title = 'File no longer exists'; } }).catch(() => {});
    }
    wrap.append(el('div', { class: 'panel-title-row' },
      el('div', { class: 'panel-title', text: 'Recent files' }),
      el('button', { class: 'btn sm', text: 'Clear list', onclick: () => {
        localStorage.setItem('popvis.recent', '[]');
        emit();
      } })), list);
  }
  container.append(wrap);
}

export async function openViaDialog() {
  const paths = await native.openDialog();
  for (const p of paths) {
    try {
      if (typeof p === 'string') await openFile(p);
      else await openFile(p.name, p.text);
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }
}

export async function showVanillaBrowser() {
  const { modal } = await import('./ui.js');
  const names = await native.listVanilla();
  const paths = await native.paths();
  const groups = new Map();
  for (const n of names) {
    const map = (n.match(/^mvm_([a-z_]+?)(_|\.pop)/) || [])[1] || 'other';
    if (!groups.has(map)) groups.set(map, []);
    groups.get(map).push(n);
  }
  const body = el('div', { class: 'vanilla-list' });
  for (const [map, files] of groups) {
    body.append(el('div', { class: 'vanilla-map', text: map.replace(/_/g, ' ') }));
    for (const f of files) {
      body.append(el('div', { class: 'vanilla-item', onclick: async () => {
        const { closeModal } = await import('./ui.js');
        closeModal();
        try { await openFile(native.join(paths.vanilla, f)); } catch (e) { toast('Failed: ' + e.message, 'error'); }
      }, text: f }));
    }
  }
  modal('Vanilla missions', body);
}
