import { el, clear, field, numInput, textInput, selectInput, ensureDatalist, botVisual, tankVisual, sentryChip, modal, closeModal, toast, fmtNum, fmtTime, compositionChips } from './ui.js';
import { state, activeFile, beginEdit, commitEdit, emit, invalidateSims, saveSimOpts, tankTimeFor, setTankTime, defaultTankTime, rawTankOverride, deathModel, setDeathModel, simFor, gatingFor, wsTriggerTime, setWsTriggerTime } from './state.js';
import { scrollToTime } from './timeline.js';
import { isGated } from './gating.js';
import { setValue, getValue, findFirst, findAll, makeBlock, makeKV, removeNode, cloneNode, parse, serialize } from './kv.js';
import { CLASS_INFO, botDisplayName, describeSpawner, resolveBot } from './popmodel.js';
import { iconBrowserModal } from './iconbrowser.js';

const SKILLS = ['Easy', 'Normal', 'Hard', 'Expert'];
const RESTRICTIONS = ['', 'PrimaryOnly', 'SecondaryOnly', 'MeleeOnly'];
const COMMON_ATTRS = ['MiniBoss', 'UseBossHealthBar', 'AlwaysCrit', 'HoldFireUntilFullReload', 'SpawnWithFullCharge', 'AlwaysFireWeapon', 'TeleportToHint', 'IgnoreFlag', 'DisableDodge', 'BulletImmune', 'BlastImmune', 'FireImmune', 'Parachute', 'AutoJump'];

export function renderInspector(container, file) {
  clear(container);
  if (!file) return;
  const sel = file.selection;
  if (!sel) {
    if (state.view.mode === 'wave' && file.model.waves.length) container.append(waveAnalysis(file, state.view.wave));
    else container.append(fileSummary(file));
    return;
  }

  if (sel.type === 'wavespawn') {
    const found = findWS(file, sel.nodeId);
    if (!found) { file.selection = null; container.append(fileSummary(file)); return; }
    container.append(wsEditor(file, found.wave, found.ws, sel));
    return;
  }
  if (sel.type === 'wave') {
    const wave = file.model.waves.find(w => w.node.id === sel.nodeId);
    if (!wave) { file.selection = null; container.append(fileSummary(file)); return; }
    container.append(waveEditor(file, wave));
    return;
  }
  if (sel.type === 'mission') {
    const m = file.model.missions.find(m => m.node.id === sel.nodeId);
    if (!m) { file.selection = null; container.append(fileSummary(file)); return; }
    container.append(missionEditor(file, m));
    return;
  }
  if (sel.type === 'template') {
    const t = [...file.model.templates.values()].find(t => t.node.id === sel.nodeId);
    if (!t) { file.selection = null; container.append(fileSummary(file)); return; }
    container.append(templateViewer(file, t));
    return;
  }
  container.append(fileSummary(file));
}

function findWS(file, nodeId) {
  for (const wave of file.model.waves) {
    for (const ws of wave.wavespawns) {
      if (ws.node.id === nodeId) return { wave, ws };
    }
  }
  return null;
}

function head(title, subtitle) {
  return el('div', { class: 'insp-head' },
    el('div', { class: 'insp-title', text: title }),
    subtitle ? el('div', { class: 'insp-sub', text: subtitle }) : null);
}

function foldedSections() {
  try { return JSON.parse(localStorage.getItem('popvis.inspfold') || '{}') || {}; } catch { return {}; }
}

function section(title, ...children) {
  if (!title) return el('div', { class: 'insp-section' }, ...children);
  const isFolded = !!foldedSections()[title];
  const head = el('div', {
    class: 'insp-sectitle foldable', text: title,
    title: isFolded ? 'Expand section' : 'Collapse section',
    onclick: () => {
      const all = foldedSections();
      if (all[title]) delete all[title];
      else all[title] = 1;
      localStorage.setItem('popvis.inspfold', JSON.stringify(all));
      sec.classList.toggle('folded');
      head.title = sec.classList.contains('folded') ? 'Expand section' : 'Collapse section';
    }
  });
  const sec = el('div', { class: 'insp-section' + (isFolded ? ' folded' : ''), }, head, ...children);
  return sec;
}

function editNum(file, node, key, opts = {}) {
  return numInput(getValue(node, key, ''), v => {
    beginEdit(file);
    setValue(node, key, v === null ? null : v);
    commitEdit(file, { emit: 'fields' });
  }, opts);
}

function editText(file, node, key, opts = {}) {
  return textInput(getValue(node, key, ''), v => {
    beginEdit(file);
    setValue(node, key, v);
    commitEdit(file, { emit: 'fields' });
  }, opts);
}

function waveComposition(wave) {
  const map = new Map();
  for (const ws of wave.wavespawns) {
    if (ws.isLogic || !ws.bots.length) continue;
    const total = Math.max(0, ws.totalCount) || 0;
    const multSum = ws.bots.reduce((s, b) => s + (b.mult || 1), 0) || 1;
    for (const b of ws.bots) {
      const share = total > 0 ? ((b.mult || 1) / multSum) * total : (b.mult || 1);
      const key = b.bot
        ? `b:${b.bot.cls}:${botDisplayName(b.bot)}:${b.bot.isGiant}:${b.bot.isBoss}`
        : b.tank ? 't:' + b.tank.health : b.sentry ? 's:' + b.sentry.level : 'o';
      const g = map.get(key);
      if (g) g.mult += share;
      else map.set(key, { ...b, mult: share });
    }
  }
  const bots = [...map.values()]
    .map(e => ({ ...e, mult: Math.max(1, Math.round(e.mult)) }))
    .sort((a, b) => b.mult - a.mult);
  return { bots };
}

function deadAirGaps(sim, waveEnd) {
  const gaps = [];
  let start = null;
  let seen = false;
  for (const p of sim.curve) {
    if (p.t > waveEnd) break;
    if (p.active > 0) {
      seen = true;
      if (start !== null) { gaps.push([start, p.t]); start = null; }
    } else if (seen && start === null) start = p.t;
  }
  return gaps.filter(([a, b]) => b - a >= 4);
}

function spawnGates(wave) {
  const gates = new Map();
  for (const ws of wave.wavespawns) {
    if (ws.isLogic || !ws.bots.length) continue;
    const n = Math.max(0, ws.totalCount);
    for (const g of (ws.where.length ? ws.where : ['(unset)'])) {
      gates.set(g, (gates.get(g) || 0) + n);
    }
  }
  return [...gates.entries()].sort((a, b) => b[1] - a[1]);
}

function metric(k, v, cls) {
  return el('div', { class: 'wa-row' },
    el('span', { class: 'wa-k', text: k }),
    el('span', { class: 'wa-v' + (cls ? ' ' + cls : ''), text: v }));
}

function waveAnalysis(file, waveIndex) {
  const wave = file.model.waves[waveIndex];
  const wrap = el('div', { class: 'insp-analysis' });
  if (!wave) return fileSummary(file);
  const sim = simFor(file, wave);
  const waveEnd = sim.waveEnd;
  const limit = sim.robotLimit || file.model.robotLimit || 22;
  const gaps = deadAirGaps(sim, waveEnd);
  const idle = gaps.reduce((s, [a, b]) => s + (b - a), 0);

  wrap.append(head(`Wave ${waveIndex + 1}`,
    `$${wave.totalCurrency} · ${wave.totalBots} bots · ~${fmtTime(waveEnd)}`));

  const comp = waveComposition(wave);
  wrap.append(el('div', { class: 'insp-sectitle', text: 'COMPOSITION' }));
  wrap.append(comp.bots.length
    ? el('div', { class: 'wa-chips' }, compositionChips(comp, 40))
    : el('div', { class: 'wa-none', text: 'No robots in this wave' }));

  if (sim.peak.active >= limit) {
    wrap.append(el('div', { class: 'insp-sectitle', text: 'THROTTLED' }));
    wrap.append(metric('Peak hits limit', `${sim.peak.active} / ${limit}`, 'warn'));
  }

  if (gaps.length) {
    wrap.append(el('div', { class: 'insp-sectitle', text: `DEAD AIR — ${Math.round(idle)}s IDLE` }));
    for (const [a, b] of gaps.slice(0, 8)) {
      wrap.append(el('div', {
        class: 'wa-gap', role: 'button', tabindex: 0, 'data-kbd': true,
        title: 'Scroll the timeline here',
        onclick: () => scrollToTime(file, waveIndex, a)
      },
        el('span', { class: 'wa-gap-range', text: `${fmtTime(a)} – ${fmtTime(b)}` }),
        el('span', { class: 'wa-gap-len', text: Math.round(b - a) + 's' })));
    }
  }

  const gating = gatingFor(file, wave);
  const gatedList = wave.wavespawns.filter(ws => isGated(gating.get(ws)));
  if (gatedList.length) {
    wrap.append(el('div', { class: 'insp-sectitle', text: 'GATED — NEEDS MANUAL TRIGGER' }));
    const untriggered = gatedList.filter(ws => wsTriggerTime(file, wave, ws) === null).length;
    if (untriggered) {
      wrap.append(el('div', { class: 'wa-none', text: `${untriggered} of ${gatedList.length} will not spawn until you set a trigger time.` }));
    }
    for (const ws of gatedList) {
      const at = wsTriggerTime(file, wave, ws);
      const g = gating.get(ws);
      const by = (g.paused ? g.resumedBy : g.enabledBy).filter(Boolean);
      const input = numInput(at !== null ? Math.round(at) : '', v => {
        setWsTriggerTime(file, wave, ws, Number.isFinite(v) ? v : null);
        emit('timeline');
      }, { min: 0, step: 1, placeholder: 'never' });
      input.classList.add('sm');
      wrap.append(el('div', { class: 'wa-gaterow', title: by.length ? 'Re-enabled by: ' + by.join(', ') : 'No re-enable found in the popfile' },
        el('span', { class: 'wa-gate-name', text: ws.name || '(unnamed)' }),
        input));
    }
  }

  const gates = spawnGates(wave);
  if (gates.length > 1) {
    wrap.append(el('div', { class: 'insp-sectitle', text: 'SPAWN GATES' }));
    for (const [g, n] of gates) wrap.append(metric(g, String(n)));
  }
  return wrap;
}

function fileSummary(file) {
  const m = file.model;
  const wrap = el('div', {});
  wrap.append(head(file.name, file.path));
  const bases = file.doc.bases.map(b =>
    el('div', { class: 'base-row' + (b.missing ? ' missing' : '') , text: b.path + (b.missing ? '  (missing)' : ''),
      title: b.missing ? 'Not found next to the mission or in bundled base files' : 'Resolved' }));
  if (bases.length) wrap.append(section('#base files', ...bases));
  return wrap;
}

export function simOptsPanel(file) {
  const o = state.simOpts;
  const model = deathModel();
  const mk = (label, key, min, max, hint) => {
    const val = el('span', { class: 'slider-val', text: fmtNum(o[key]) + 's' });
    const input = el('input', { type: 'range', min, max, step: 1, value: o[key], title: hint || '' });
    input.addEventListener('input', () => { val.textContent = input.value + 's'; });
    input.addEventListener('change', () => {
      o[key] = parseFloat(input.value);
      saveSimOpts();
      invalidateSims();
      emit();
    });
    return el('div', { class: 'slider-row' }, el('span', { class: 'slider-label', text: label, title: hint || '' }), input, val);
  };
  const wrap = el('div', { class: 'sim-controls' });
  wrap.append(field('Death model', selectInput(model, [
    { value: 'hatch', label: 'Despawn at hatch' },
    { value: 'damage', label: 'Damage zones' },
    { value: 'lifetime', label: 'Fixed lifetimes' }
  ], v => {
    setDeathModel(v);
    invalidateSims();
    emit();
  })));
  if (model === 'lifetime') {
    wrap.append(
      mk('Common bot lifetime', 'botLifetime', 2, 60),
      mk('Giant lifetime', 'giantLifetime', 5, 120),
      mk('Tank lifetime', 'tankLifetime', 15, 240, 'Ignored when the map has a measured tank path.')
    );
  }
  return wrap;
}

function statRow(label, value) {
  return el('div', { class: 'stat-row' }, el('span', { text: label }), el('span', { class: 'stat-val', text: String(value) }));
}

function wsEditor(file, wave, ws, sel) {
  const wrap = el('div', {});
  wrap.append(head('WaveSpawn', `Wave ${wave.index + 1}`));
  if (file.multi && file.multi.size > 1 && file.multi.has(ws.node.id)) {
    wrap.append(el('div', { class: 'multi-banner', text: `${file.multi.size} wavespawns selected — bar drags and arrow keys move them together, Delete removes all. Esc clears.` }));
  }

  const nameList = ensureDatalist('dl-names', [...new Set(wave.wavespawns.filter(w => w.name && w !== ws).map(w => w.name))]);
  const whereList = ensureDatalist('dl-where', [...file.model.spawnPoints]);

  wrap.append(section('Identity',
    field('Name', editText(file, ws.node, 'Name')),
    field('Where', editText(file, ws.node, 'Where', { list: whereList })),
    field('RandomSpawn', checkbox(file, ws.node, 'RandomSpawn'))
  ));

  wrap.append(section('Counts',
    el('div', { class: 'field-grid' },
      field('TotalCount', editNum(file, ws.node, 'TotalCount', { min: 0, step: 1 })),
      field('MaxActive', editNum(file, ws.node, 'MaxActive', { min: 0, step: 1 })),
      field('SpawnCount', editNum(file, ws.node, 'SpawnCount', { min: 1, step: 1 })),
      field('TotalCurrency', editNum(file, ws.node, 'TotalCurrency', { step: 1 }))
    ),
    ws.totalCount > 0 && ws.totalCurrency > 0 ? el('div', { class: 'tip', text: `≈ $${fmtNum(ws.totalCurrency / ws.totalCount, 2)} per robot` }) : null
  ));

  wrap.append(section('Timing',
    el('div', { class: 'field-grid' },
      field('WaitBeforeStarting', editNum(file, ws.node, 'WaitBeforeStarting', { min: 0 })),
      field('WaitBetweenSpawns', editNum(file, ws.node, 'WaitBetweenSpawns', { min: 0 })),
      field('…AfterDeath', editNum(file, ws.node, 'WaitBetweenSpawnsAfterDeath', { min: 0 }), 'WaitBetweenSpawnsAfterDeath')
    )
  ));

  const supportSel = selectInput(ws.support === 'unlimited' ? '1' : ws.support === 'limited' ? 'limited' : '',
    [{ value: '', label: 'No (counts toward wave)' }, { value: '1', label: 'Support (endless)' }, { value: 'limited', label: 'Support Limited' }],
    v => {
      beginEdit(file);
      setValue(ws.node, 'Support', v || null);
      commitEdit(file);
    });
  wrap.append(section('Flow',
    field('Support', supportSel),
    field('WaitForAllSpawned', editText(file, ws.node, 'WaitForAllSpawned', { list: nameList })),
    field('WaitForAllDead', editText(file, ws.node, 'WaitForAllDead', { list: nameList }))
  ));

  wrap.append(section('Contents', spawnerTree(file, ws.node, ws.spawner, sel)));

  wrap.append(section('',
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', text: 'Edit raw', onclick: () => rawEditModal(file, wave.node, ws.node, 'WaveSpawn') }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: () => { beginEdit(file); removeNode(wave.node, ws.node); file.selection = null; commitEdit(file); } })
    )));
  return wrap;
}

function checkbox(file, node, key) {
  const cur = getValue(node, key, null);
  const cb = el('input', { type: 'checkbox', checked: cur !== null && cur !== '0' });
  cb.addEventListener('change', () => {
    beginEdit(file);
    setValue(node, key, cb.checked ? '1' : null);
    commitEdit(file);
  });
  return cb;
}

const SPAWNER_KINDS = ['tfbot', 'tank', 'squad', 'randomchoice', 'mob', 'sentrygun', 'randomplacement'];

function spawnerTree(file, wsNode, spawner, sel) {
  const wrap = el('div', { class: 'spawner-tree' });
  if (!spawner) {
    wrap.append(el('div', { class: 'tip', text: 'No spawner yet.' }), addSpawnerButtons(file, wsNode));
    return wrap;
  }
  wrap.append(spawnerNodeRow(file, wsNode, spawner, sel, 0));
  return wrap;
}

function spawnerNodeRow(file, parentNode, sp, sel, depth) {
  const row = el('div', { class: 'sp-node', style: `--depth:${depth}` });
  const headRow = el('div', { class: 'sp-head' + (sel && sel.subId === sp.node.id ? ' active' : '') });

  if (sp.kind === 'bot') headRow.append(botVisual(sp.bot), el('span', { class: 'sp-label', text: botDisplayName(sp.bot) }));
  else if (sp.kind === 'tank') headRow.append(tankVisual(sp), el('span', { class: 'sp-label', text: `Tank ${sp.health} HP · speed ${sp.speed}` }));
  else if (sp.kind === 'sentry') headRow.append(sentryChip(sp), el('span', { class: 'sp-label', text: 'Sentry Gun' }));
  else headRow.append(el('span', { class: 'sp-kind', text: sp.node.key }));

  const btns = el('span', { class: 'sp-btns' },
    el('button', { class: 'icon-btn sm', text: 'Edit', title: 'Edit raw block', onclick: e => { e.stopPropagation(); rawEditModal(file, parentNode, sp.node, sp.node.key); } }),
    el('button', { class: 'icon-btn sm', text: 'Copy', title: 'Duplicate', onclick: e => { e.stopPropagation(); beginEdit(file); const c = cloneNode(sp.node); parentNode.children.splice(parentNode.children.indexOf(sp.node) + 1, 0, c); commitEdit(file); } }),
    el('button', { class: 'icon-btn sm danger', text: '×', title: 'Remove', onclick: e => { e.stopPropagation(); beginEdit(file); removeNode(parentNode, sp.node); commitEdit(file); } })
  );
  headRow.append(btns);
  headRow.addEventListener('click', () => {
    const f = activeFile();
    if (f && f.selection) { f.selection.subId = f.selection.subId === sp.node.id ? null : sp.node.id; emit('selection'); }
  });
  row.append(headRow);

  if (sel && sel.subId === sp.node.id && sp.kind === 'bot') row.append(botEditor(file, sp.node));
  if (sel && sel.subId === sp.node.id && sp.kind === 'tank') row.append(tankEditor(file, sp.node));

  if (sp.children) {
    for (const c of sp.children) row.append(spawnerNodeRow(file, sp.node, c, sel, depth + 1));
    row.append(el('div', { class: 'sp-add-child' }, addSpawnerButtons(file, sp.node, true)));
  }
  return row;
}

function addSpawnerButtons(file, parentNode, compact = false) {
  const mk = (label, build) => el('button', {
    class: 'btn sm', text: label, onclick: () => {
      beginEdit(file);
      parentNode.children.push(build());
      commitEdit(file);
    }
  });
  return el('div', { class: 'btn-row' + (compact ? ' compact' : '') },
    mk('+ TFBot', () => makeBlock('TFBot', [makeKV('Class', 'Scout'), makeKV('Skill', 'Normal')])),
    mk('+ Tank', () => makeBlock('Tank', [makeKV('Health', 20000), makeKV('Speed', 75), makeKV('Name', 'tankboss'), makeKV('StartingPathTrackNode', 'boss_path_a1')])),
    mk('+ Squad', () => makeBlock('Squad', [makeBlock('TFBot', [makeKV('Class', 'Soldier'), makeKV('Skill', 'Normal')])])),
    mk('+ Random', () => makeBlock('RandomChoice', [makeBlock('TFBot', [makeKV('Class', 'Scout')]), makeBlock('TFBot', [makeKV('Class', 'Pyro')])]))
  );
}

function botEditor(file, node) {
  const model = activeFile().model;
  const tplList = ensureDatalist('dl-templates', [...model.templates.values()].map(t => t.name).sort());
  const wrap = el('div', { class: 'bot-editor' });

  const tplField = el('div', { class: 'tpl-pick-row' },
    editText(file, node, 'Template', { list: tplList }),
    el('button', { class: 'btn sm', text: 'pick', onclick: () => templatePickerModal(file, node) }));

  wrap.append(el('div', { class: 'field-grid' },
    field('Template', tplField),
    field('Class', selectInput((getValue(node, 'Class', '') || '').toLowerCase(), [
      { value: '', label: '(from template)' },
      ...['Scout', 'Soldier', 'Pyro', 'Demoman', 'HeavyWeapons', 'Engineer', 'Medic', 'Sniper', 'Spy'].map(c => ({ value: c.toLowerCase(), label: c }))
    ], v => {
      beginEdit(file);
      setValue(node, 'Class', v ? v[0].toUpperCase() + v.slice(1) : null);
      commitEdit(file);
    })),
    field('Skill', selectInput(getValue(node, 'Skill', ''), [{ value: '', label: '(default)' }, ...SKILLS.map(s => ({ value: s, label: s }))], v => {
      beginEdit(file);
      setValue(node, 'Skill', v || null);
      commitEdit(file);
    })),
    field('Health', editNum(file, node, 'Health', { min: 1, step: 1, placeholder: 'default' })),
    field('Scale', editNum(file, node, 'Scale', { min: 0.1, placeholder: 'default' })),
    field('Name', editText(file, node, 'Name')),
    field('ClassIcon', el('div', { class: 'tpl-pick-row' },
      editText(file, node, 'ClassIcon'),
      el('button', { class: 'btn sm', text: 'pick', onclick: () => iconBrowserModal(file, { onPick: v => {
        beginEdit(file);
        setValue(node, 'ClassIcon', v);
        commitEdit(file);
      } }) }))),
    field('WeaponRestrictions', selectInput(getValue(node, 'WeaponRestrictions', ''), RESTRICTIONS.map(r => ({ value: r, label: r || '(none)' })), v => {
      beginEdit(file);
      setValue(node, 'WeaponRestrictions', v || null);
      commitEdit(file);
    }))
  ));

  const attrsWrap = el('div', { class: 'attr-toggles' });
  const current = findAll(node, 'Attributes').map(a => a.value);
  for (const a of COMMON_ATTRS) {
    const on = current.some(c => c.toLowerCase() === a.toLowerCase());
    const b = el('button', { class: 'attr-btn' + (on ? ' on' : ''), text: a, onclick: () => {
      beginEdit(file);
      if (on) {
        const kv = findAll(node, 'Attributes').find(x => x.value.toLowerCase() === a.toLowerCase());
        if (kv) removeNode(node, kv);
      } else {
        node.children.push(makeKV('Attributes', a));
      }
      commitEdit(file);
    } });
    attrsWrap.append(b);
  }
  wrap.append(field('Attributes', attrsWrap));

  const itemsWrap = el('div', { class: 'items-list' });
  for (const kv of findAll(node, 'Item')) {
    itemsWrap.append(el('div', { class: 'item-row' },
      el('span', { text: kv.value }),
      el('button', { class: 'icon-btn sm danger', text: '×', title: 'Remove', onclick: () => { beginEdit(file); removeNode(node, kv); commitEdit(file); } })));
  }
  const addItem = textInput('', v => {
    if (!v) return;
    beginEdit(file);
    node.children.push(makeKV('Item', v));
    commitEdit(file);
  }, { placeholder: 'add item...' });
  itemsWrap.append(addItem);
  wrap.append(field('Items', itemsWrap));

  const resolved = resolveBot(node, model.templates);
  wrap.append(el('div', { class: 'tip', text: `Resolved: ${CLASS_INFO[resolved.cls] ? CLASS_INFO[resolved.cls].label : '?'} · ${resolved.health} HP${resolved.isGiant ? ' · Giant' : ''}${resolved.isBoss ? ' · Boss bar' : ''}` }));
  return wrap;
}

function tankEditor(file, node) {
  const wrap = el('div', { class: 'bot-editor' },
    el('div', { class: 'field-grid' },
      field('Health', editNum(file, node, 'Health', { min: 1, step: 1 })),
      field('Speed', editNum(file, node, 'Speed', { min: 1 })),
      field('Name', editText(file, node, 'Name')),
      field('StartingPathTrackNode', editText(file, node, 'StartingPathTrackNode')),
      field('Skin', editNum(file, node, 'Skin', { min: 0, step: 1, placeholder: '0' }))
    ));
  const start = (getValue(node, 'StartingPathTrackNode', '') || '').toLowerCase();
  const speed = getNumberish(getValue(node, 'Speed', '75'));
  if (start && file.tankPaths && file.tankPaths.results && file.tankPaths.results[start]) {
    const r = file.tankPaths.results[start];
    wrap.append(el('div', { class: 'tip', text: `Path from map: ${r.distance.toLocaleString()} HU over ${r.nodes} nodes -> ~${Math.round(r.distance / Math.max(1, speed))}s at speed ${speed}${r.approx ? ' (node name matched as ' + r.matched + ')' : ''}` }));
  }
  return wrap;
}

function getNumberish(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 75;
}

function waveEditor(file, wave) {
  const wrap = el('div', {});
  wrap.append(head('Wave ' + (wave.index + 1), `${wave.wavespawns.length} wavespawns · $${wave.totalCurrency}`));
  wrap.append(section('Wave settings',
    field('WaitWhenDone', editNum(file, wave.node, 'WaitWhenDone', { min: 0 })),
    field('Checkpoint', checkbox(file, wave.node, 'Checkpoint')),
    field('Description', editText(file, wave.node, 'Description')),
    field('Sound', editText(file, wave.node, 'Sound'))
  ));
  const outputs = ['StartWaveOutput', 'DoneOutput', 'InitWaveOutput'].map(key => {
    const node = findFirst(wave.node, key);
    return el('div', { class: 'stat-row' },
      el('span', { text: key }),
      node
        ? el('button', { class: 'btn sm', text: 'Edit', onclick: () => rawEditModal(file, wave.node, node, key) })
        : el('button', { class: 'btn sm', text: 'Add', onclick: () => {
            beginEdit(file);
            wave.node.children.unshift(makeBlock(key, [makeKV('Target', key === 'DoneOutput' ? 'wave_finished_relay' : 'wave_start_relay'), makeKV('Action', 'Trigger')]));
            commitEdit(file);
          } }));
  });
  wrap.append(section('Outputs', ...outputs));
  wrap.append(section('Wave actions',
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', text: 'Duplicate wave', onclick: () => waveAction(file, wave, 'dup') }),
      el('button', { class: 'btn', text: '+ Wave after', onclick: () => waveAction(file, wave, 'addafter') }),
      el('button', { class: 'btn', text: '↑ Move up', onclick: () => waveAction(file, wave, 'up') }),
      el('button', { class: 'btn', text: '↓ Move down', onclick: () => waveAction(file, wave, 'down') }),
      el('button', { class: 'btn danger', text: 'Delete wave', onclick: () => waveAction(file, wave, 'del') })
    )));
  wrap.append(section('', el('button', { class: 'btn', text: 'Edit raw', onclick: () => rawEditModal(file, file.model.root, wave.node, 'Wave') })));
  return wrap;
}

function waveAction(file, wave, action) {
  if (action === 'del') {
    modal(`Delete wave ${wave.index + 1}?`, el('div', { class: 'close-msg', text: `${wave.wavespawns.length} wavespawn${wave.wavespawns.length === 1 ? '' : 's'} and $${wave.totalCurrency} will be removed.` }), [
      { label: 'Cancel', action: () => true },
      { label: 'Delete wave', danger: true, action: () => { doWaveAction(file, wave, 'del'); return true; } }
    ]);
    return;
  }
  doWaveAction(file, wave, action);
}

function doWaveAction(file, wave, action) {
  const root = file.model.root;
  const waves = findAll(root, 'Wave');
  const idx = waves.indexOf(wave.node);
  beginEdit(file);
  if (action === 'dup') {
    const copy = cloneNode(wave.node);
    root.children.splice(root.children.indexOf(wave.node) + 1, 0, copy);
  } else if (action === 'addafter') {
    const w = makeBlock('Wave', [
      makeBlock('StartWaveOutput', [makeKV('Target', 'wave_start_relay'), makeKV('Action', 'Trigger')]),
      makeBlock('DoneOutput', [makeKV('Target', 'wave_finished_relay'), makeKV('Action', 'Trigger')])
    ]);
    root.children.splice(root.children.indexOf(wave.node) + 1, 0, w);
  } else if (action === 'del') {
    removeNode(root, wave.node);
    file.selection = null;
    if (state.view.mode === 'wave') state.view = { mode: 'overview', wave: 0 };
  } else if (action === 'up' && idx > 0) {
    removeNode(root, wave.node);
    root.children.splice(root.children.indexOf(waves[idx - 1]), 0, wave.node);
  } else if (action === 'down' && idx < waves.length - 1) {
    removeNode(root, wave.node);
    root.children.splice(root.children.indexOf(waves[idx + 1]) + 1, 0, wave.node);
  }
  commitEdit(file);
}

function missionEditor(file, m) {
  const wrap = el('div', {});
  wrap.append(head('Support Mission', m.objective));
  const whereList = ensureDatalist('dl-where', [...file.model.spawnPoints]);
  wrap.append(section('Mission',
    field('Objective', selectInput(m.objective, ['DestroySentries', 'Sniper', 'Spy', 'Engineer', 'SeekAndDestroy'].map(o => ({ value: o, label: o })), v => {
      beginEdit(file);
      setValue(m.node, 'Objective', v);
      commitEdit(file);
    })),
    field('Where', editText(file, m.node, 'Where', { list: whereList })),
    el('div', { class: 'field-grid' },
      field('BeginAtWave', editNum(file, m.node, 'BeginAtWave', { min: 1, step: 1 })),
      field('RunForThisManyWaves', editNum(file, m.node, 'RunForThisManyWaves', { min: 1, step: 1 })),
      field('InitialCooldown', editNum(file, m.node, 'InitialCooldown', { min: 0 })),
      field('CooldownTime', editNum(file, m.node, 'CooldownTime', { min: 0 })),
      field('DesiredCount', editNum(file, m.node, 'DesiredCount', { min: 1, step: 1 }))
    )));
  if (m.spawner && m.spawner.kind === 'bot') {
    wrap.append(section('Bot', botEditor(file, m.spawner.node)));
  } else {
    wrap.append(section('Bot', addSpawnerButtons(file, m.node)));
  }
  wrap.append(section('',
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', text: 'Edit raw', onclick: () => rawEditModal(file, file.model.root, m.node, 'Mission') }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: () => { beginEdit(file); removeNode(file.model.root, m.node); file.selection = null; commitEdit(file); } })
    )));
  return wrap;
}

function templateViewer(file, t) {
  const wrap = el('div', {});
  wrap.append(head(t.name, 'from ' + t.source));
  const bot = resolveBot(t.node, file.model.templates);
  if (bot.cls !== 'unknown' || bot.attrs.length) {
    wrap.append(section('Resolved bot',
      el('div', { class: 'tpl-chip' }, botVisual(bot, { size: 'lg' })),
      statRow('Class', CLASS_INFO[bot.cls] ? CLASS_INFO[bot.cls].label : '?'),
      statRow('Health', bot.health),
      bot.skill ? statRow('Skill', bot.skill) : null,
      bot.items.length ? statRow('Items', bot.items.join(', ')) : null
    ));
  }
  const pre = el('pre', { class: 'raw-view', text: serialize({ bases: [], children: [t.node], tail: [] }) });
  wrap.append(section('Definition', pre));
  if (t.source === 'this file') {
    wrap.append(section('', el('button', { class: 'btn', text: 'Edit raw', onclick: () => {
      const tblock = findAll(file.model.root, 'Templates').find(tb => tb.children.includes(t.node));
      rawEditModal(file, tblock, t.node, t.name);
    } })));
  }
  return wrap;
}

function templatePickerModal(file, node) {
  const list = [...file.model.templates.values()];
  const search = el('input', { class: 'inp tpl-search', placeholder: `Search ${list.length} templates...`, type: 'search' });
  const grid = el('div', { class: 'tpl-grid tpl-grid-modal' });
  const renderGrid = () => {
    clear(grid);
    const q = search.value.toLowerCase();
    for (const t of list) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const bot = resolveBot(t.node, file.model.templates);
      grid.append(el('div', {
        class: 'tpl-card',
        onclick: () => {
          beginEdit(file);
          setValue(node, 'Template', t.name);
          commitEdit(file);
          closeModal();
        }
      },
        el('div', { class: 'tpl-head' }, botVisual(bot), el('span', { class: 'tpl-name', text: t.name })),
        el('div', { class: 'tpl-meta', text: `${CLASS_INFO[bot.cls] ? CLASS_INFO[bot.cls].label : '—'} · ${bot.health} HP${bot.isGiant ? ' · Giant' : ''}` }),
        el('div', { class: 'tpl-src ' + (t.source === 'this file' ? 'local' : 'base'), text: t.source })));
    }
    if (!grid.children.length) grid.append(el('div', { class: 'empty-note', text: 'No templates match' }));
  };
  search.addEventListener('input', renderGrid);
  renderGrid();
  modal('Pick a template', el('div', {}, search, grid));
  setTimeout(() => search.focus(), 50);
}

export function rawEditModal(file, parentNode, node, title) {
  const ta = el('textarea', { class: 'raw-edit', spellcheck: 'false' });
  ta.value = serialize({ bases: [], children: [node], tail: [] });
  const err = el('div', { class: 'raw-err' });
  const body = el('div', {}, ta, err);
  modal('Edit ' + title, body, [
    { label: 'Cancel', action: () => true },
    {
      label: 'Apply', primary: true, action: () => {
        try {
          const doc = parse(ta.value);
          const blocks = doc.children.filter(n => n.type === 'block');
          if (blocks.length !== 1) throw new Error('Expected exactly one block, got ' + blocks.length);
          beginEdit(file);
          const idx = parentNode.children.indexOf(node);
          parentNode.children.splice(idx, 1, blocks[0]);
          if (file.selection && file.selection.nodeId === node.id) file.selection.nodeId = blocks[0].id;
          if (file.selection && file.selection.subId === node.id) file.selection.subId = blocks[0].id;
          commitEdit(file);
          toast('Applied');
          return true;
        } catch (e) {
          err.textContent = e.message;
          return false;
        }
      }
    }
  ]);
  setTimeout(() => ta.focus(), 50);
}
