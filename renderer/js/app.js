import { initNavWasm } from './navwasm.js';
import { el, clear, toast, isModalOpen, closeMenu, modal, closeModal, closePopover } from './ui.js';
import { state, activeFile, activateFile, onChange, emit, openFile, closeFile, undo, redo, saveFile, beginEdit, commitEdit, reloadFromDisk, refreshBases, newFile } from './state.js';
import { renderSidebar } from './sidebar.js';
import { renderTimeline, applySelectionClasses, duplicateWS, deleteWS, pasteWS, zoomBy, fitWave, addWaveSpawn } from './timeline.js';
import { renderInspector } from './inspector.js';
import { renderMapView, presetMapTime, renderMapInspector } from './mapview.js';
import { exportWavePng } from './exportpng.js';
import { icon } from './svgicon.js';
import { loadTFFonts } from './tffont.js';
import { renderModelBrowser } from './modelbrowser.js';
import { renderOverview, renderMissions, renderTemplates, renderSettings, renderWelcome, renderRelays, renderDiff, openViaDialog, showVanillaBrowser } from './views.js';
import { native } from './native.js';
import { setValue, removeNode, serialize, parse } from './kv.js';

const $ = id => document.getElementById(id);

function requestClose(f) {
  if (!f.dirty) { closeFile(f.id); return; }
  modal(`Close ${f.name}?`, el('div', { class: 'close-msg', text: 'There are unsaved changes.' }), [
    { label: 'Cancel', action: () => true },
    { label: 'Discard changes', danger: true, action: () => { closeFile(f.id); return true; } },
    { label: 'Save', primary: true, action: () => {
      (async () => { if (await doSave(f, false)) closeFile(f.id); })();
      return true;
    } }
  ]);
}

function renderTabs() {
  const tabs = $('tabs');
  clear(tabs);
  for (const f of state.files) {
    const dupName = state.files.some(o => o !== f && o.name.toLowerCase() === f.name.toLowerCase());
    const parentDir = f.path.split(/[\\/]/).slice(-2, -1)[0] || '';
    const tab = el('div', {
      class: 'tab' + (f.id === state.activeId ? ' active' : ''),
      title: f.path,
      role: 'tab', tabindex: 0, 'data-kbd': true,
      onclick: () => { activateFile(f.id); emit(); },
      onauxclick: e => {
        if (e.button !== 1) return;
        e.preventDefault();
        requestClose(f);
      }
    },
      el('span', { class: 'tab-name', text: f.name }),
      dupName && parentDir ? el('span', { class: 'tab-dir', text: parentDir }) : null,
      f.dirty ? el('span', { class: 'tab-dirty', text: '*' }) : null,
      f.conflict ? el('span', { class: 'tab-conflict', text: '!', title: 'Changed on disk' }) : null,
      el('span', { class: 'tab-close', text: 'x', onclick: e => {
        e.stopPropagation();
        requestClose(f);
      } }));
    tabs.append(tab);
  }
}

function renderBanner() {
  const bar = $('banner');
  clear(bar);
  const file = activeFile();
  const show = !!(file && (file.conflict || file.recoveryPending));
  document.body.classList.toggle('has-banner', show);
  if (!show) return;
  if (file.conflict) {
    bar.append(
      el('span', { class: 'banner-msg', text: file.name + ' was changed on disk while you have unsaved edits.' }),
      el('button', { class: 'btn sm', text: 'Reload from disk', title: 'Load the disk version. Ctrl+Z brings your edits back.', onclick: async () => {
        try {
          await reloadFromDisk(file, { preserveUndo: true });
          toast('Disk version loaded — Ctrl+Z restores your edits');
        } catch (e) {
          toast('Reload failed: ' + e.message, 'error');
        }
      } }),
      el('button', { class: 'btn sm', text: 'Compare', title: 'Show the differences against the disk version', onclick: () => {
        state.diffOtherId = '__disk';
        state.view = { mode: 'diff', wave: 0 };
        emit();
      } }),
      el('button', { class: 'btn sm', text: 'Keep mine', title: 'Dismiss the disk change. Save will overwrite it.', onclick: () => {
        file.conflict = false;
        emit();
        toast('Keeping your version — Save will overwrite the disk copy');
      } })
    );
    return;
  }
  bar.append(
    el('span', { class: 'banner-msg', text: 'Unsaved changes for ' + file.name + ' were recovered from a previous session.' }),
    el('button', { class: 'btn sm', text: 'Restore', title: 'Apply the recovered changes. Undo works as usual.', onclick: () => {
      try {
        const bak = file.recoveryPending;
        beginEdit(file);
        file.doc = parse(bak);
        commitEdit(file);
      } catch (e) {
        toast('Restore failed: ' + e.message, 'error');
      }
      file.recoveryPending = null;
      try { localStorage.removeItem('popvis.backup.' + file.path.toLowerCase()); } catch {}
      emit();
    } }),
    el('button', { class: 'btn sm', text: 'Discard', title: 'Delete the recovered copy', onclick: () => {
      file.recoveryPending = null;
      try { localStorage.removeItem('popvis.backup.' + file.path.toLowerCase()); } catch {}
      emit();
    } })
  );
}

function renderMainContent(file) {
  const main = $('main');
  if (state.view.mode !== 'map') closePopover();

  if (state.view.mode === 'models') {
    renderModelBrowser(main);
    return;
  }
  if (!file) { renderWelcome(main); return; }

  let mode = state.view.mode;
  if (state.dock && state.zen && mode !== 'wave' && file.model.waves.length) {
    state.view = { mode: 'wave', wave: 0 };
    mode = 'wave';
  }
  if (mode === 'wave' || mode === 'map') {
    if (!file.model.waves.length) mode = 'overview';
    else state.view.wave = Math.min(Math.max(0, state.view.wave), file.model.waves.length - 1);
  }
  if (mode === 'wave' || mode === 'map') {
    clear(main);
    if (!(state.dock && state.zen)) main.append(waveModeSwitch(mode));
    if (mode === 'wave') {
      const tlwrap = el('div', { class: 'tl-container' });
      main.append(tlwrap);
      renderTimeline(tlwrap, file, state.view.wave);
    } else {
      const wrap = el('div', { class: 'map-wrap' });
      main.append(wrap);
      renderMapView(wrap, file, state.view.wave);
    }
  }
  else if (mode === 'missions') renderMissions(main, file);
  else if (mode === 'templates') renderTemplates(main, file);
  else if (mode === 'settings') renderSettings(main, file);
  else if (mode === 'relays') renderRelays(main, file);
  else if (mode === 'diff') renderDiff(main, file);
  else renderOverview(main, file);
}

function waveModeSwitch(mode) {
  const mk = (label, m) => el('button', {
    class: 'seg-btn' + (mode === m ? ' on' : ''), text: label,
    onclick: () => { state.view = { mode: m, wave: state.view.wave }; emit(); }
  });
  return el('div', { class: 'view-seg' }, mk('Timeline', 'wave'), mk('Map', 'map'));
}

const TOOLBAR_ICONS = {
  'btn-open': ['folder', 'Open popfile'],
  'btn-vanilla': ['library', 'Vanilla missions'],
  'btn-save': ['save', 'Save'],
  'btn-saveas': ['save-as', 'Save As'],
  'btn-undo': ['undo', 'Undo'],
  'btn-redo': ['redo', 'Redo'],
  'btn-models': ['cube', 'Models'],
  'btn-dock': ['dock', 'Dock'],
  'btn-help': ['help', 'Help']
};

async function hideDockOnUnsupported() {
  if (native.isElectron && await native.isWindows()) return;
  const btn = $('btn-dock');
  if (btn) btn.style.display = 'none';
}

function initToolbarIcons() {
  for (const [id, [name, label]] of Object.entries(TOOLBAR_ICONS)) {
    const btn = $(id);
    if (!btn) continue;
    const hint = btn.getAttribute('title') || label;
    clear(btn);
    btn.append(icon(name, 16));
    btn.classList.add('icon-only');
    btn.setAttribute('title', hint);
    btn.setAttribute('aria-label', label);
  }
}

function renderToolbar() {
  const file = activeFile();
  $('btn-save').disabled = !file || !file.dirty;
  $('btn-save').classList.toggle('attention', !!(file && file.dirty));
  $('btn-saveas').disabled = !file;
  $('btn-undo').disabled = !file || !file.undo.length;
  $('btn-redo').disabled = !file || !file.redo.length;
}

function renderZenBar() {
  const bar = $('zenbar');
  const file = activeFile();
  document.body.classList.toggle('docked', !!state.dock);
  document.body.classList.toggle('zen', !!state.dock && state.zen);
  if (!state.dock || !file) return;
  $('zen-modify').textContent = state.zen ? 'Modify' : 'Focus';
  $('zen-name').textContent = file.name + (file.dirty ? ' *' : '');
  const sel = $('zen-wave');
  clear(sel);
  file.model.waves.forEach(w => {
    sel.append(el('option', {
      value: w.index,
      text: `Wave ${w.index + 1}  ($${w.totalCurrency}, ${w.totalBots} bots)`,
      selected: state.view.mode === 'wave' && state.view.wave === w.index
    }));
  });
}

const RENDER_PARTS = {
  all:       { tabs: 1, banner: 1, toolbar: 1, zen: 1, sidebar: 1, inspector: 1, main: 1, lint: 1 },
  selection: { selectionOnly: 1, inspector: 1 },
  timeline:  { tabs: 1, toolbar: 1, zen: 1, inspector: 1, main: 1, lint: 1 },
  fields:    { tabs: 1, toolbar: 1, zen: 1, main: 1, lint: 1 },
  sidebar:   { sidebar: 1 },
  lint:      { toolbar: 1, sidebar: 1, lint: 1 },
  search:    { sidebar: 1, main: 1 },
  map:       { main: 1 },
  tanks:     { toolbar: 1, inspector: 1, main: 1 },
  icons:     { sidebar: 1, inspector: 1, main: 1 }
};

function render(what = 'all') {
  const p = RENDER_PARTS[what] || RENDER_PARTS.all;
  const file = activeFile();
  document.title = file ? `${file.name}${file.dirty ? ' *' : ''} — pop visualizer` : 'pop visualizer';
  document.body.classList.toggle('no-file', !file);
  if (file && !file.parseNotified && file.doc.diagnostics && file.doc.diagnostics.some(d => d.severity === 'error')) {
    file.parseNotified = true;
    const errs = file.doc.diagnostics.filter(d => d.severity === 'error');
    const first = `line ${errs[0].line}: ${errs[0].msg}`;
    toast(file.name + ' — ' + (errs.length > 1 ? `${errs.length} parse errors, first at ${first}` : `parse error, ${first}`), 'error');
  }
  if (p.tabs) renderTabs();
  if (p.banner) renderBanner();
  if (p.toolbar) renderToolbar();
  if (p.zen) renderZenBar();
  if (p.sidebar) renderSidebar($('sidebar'), file);
  if (p.inspector) {
    if (file && state.view.mode === 'map' && file.model.waves.length) renderMapInspector($('inspector'), file, state.view.wave);
    else renderInspector($('inspector'), file);
  }
  if (p.main) renderMainContent(file);
  else if (p.selectionOnly) applySelectionClasses($('main'), file);
}

onChange(what => render(what));

async function showDockPicker() {
  if (!native.isElectron) { toast('Docking needs the desktop app', 'error'); return; }
  if (!(await native.isWindows())) { toast('Dock mode is Windows only', 'error'); return; }
  const wins = await window.popnative.winList();
  if (!wins.length) { toast('No windows found', 'error'); return; }
  const body = el('div', { class: 'dock-list' });
  const editors = wins.filter(w => /code|codium|notepad|sublime|studio/i.test(w.name));
  const rest = wins.filter(w => !editors.includes(w));
  for (const w of [...editors, ...rest]) {
    body.append(el('div', {
      class: 'dock-item' + (editors.includes(w) ? ' editorish' : ''),
      onclick: async () => {
        closeModal();
        await window.popnative.dockStart(w, { position: localStorage.getItem('popvis.dockpos') || 'bottom' });
        state.dock = { editor: w };
        state.zen = true;
        toast('Docked to ' + w.name);
        emit();
      }
    },
      el('span', { class: 'dock-proc', text: w.name }),
      el('span', { class: 'dock-title', text: w.title })));
  }
  modal('Dock onto a window', body);
}

async function exitDock() {
  if (native.isElectron) await window.popnative.dockStop();
  state.dock = null;
  state.zen = false;
  emit();
}

function helpModal() {
  const sec = (title, lines) => el('div', { class: 'help-sec' },
    el('div', { class: 'help-title', text: title }),
    ...lines.map(l => el('div', { class: 'help-line', text: l })));
  modal('Help', el('div', { class: 'help-body' },
    sec('Timeline', [
      'Drag a bar: WaitBeforeStarting. Snaps to other bars (Shift = no snap, Alt = 0.1s steps).',
      'Drag the right edge: WaitBetweenSpawns.',
      'Drag the circle at a bar end onto another row: WaitForAllSpawned link (Alt = WaitForAllDead).',
      'Click an arrow to edit or remove the link. Hovering a row highlights its arrows.',
      'Hold the mouse on a bar to fade rows that never overlap it.',
      'Amber diamonds: logic wavespawns (no robots; outputs, sounds, timing anchors).',
      'Ctrl+wheel or Ctrl+= / Ctrl+- / Ctrl+0: zoom. PageUp / PageDown: switch wave.',
      'Right-click rows: duplicate, move, copy, paste. Ctrl+V pastes WaveSpawn text. Double-click a name to rename.'
    ]),
    sec('Map', [
      'Timeline / Map switch sits top right of a wave view; Map is also in the sidebar.',
      'Full: geometry rendered from the BSP. Layout: nav mesh floor plan.',
      'Bot movement follows the TF2 bot AI (fetch, carry, escort, squads, spy teleports, engineer nests).',
      'Zones: defender damage bands. High DPS at the front line and the hatch, lower in between.',
      'DPS: combined defender damage per second. Bots and tanks die from zone damage against their HP.',
      'Wheel: zoom. Drag: pan. Hover a robot for details.'
    ]),
    sec('Models', [
      'Models (toolbar) browses local folders or the potato.tf index.',
      'Double-click a model: opens in HLMV++ / HLMV when found next to the TF2 install, otherwise the built-in viewer.',
      'The viewer rotates with drag, zooms with wheel, and plays inline animations (including <name>_animations.mdl companions).',
      'Get on a potato.tf model downloads it with its textures into tf/download.',
      'A missing mission map can be downloaded from the index from the Map view.'
    ]),
    sec('Icons', [
      'Lookup order: mission folder, extra folders (Settings), tf/download, tf/custom, tf2_textures_dir.vpk, bundled set.'
    ]),
    sec('Dock', [
      'Dock follows an editor window and stays on top. Click a row to jump the editor to that line.',
      'Disk changes reload automatically while docked.'
    ])));
}

function buildCommands(file) {
  const cmds = [];
  const go = (mode, wave = 0) => () => { state.view = { mode, wave }; emit(); };
  if (file) {
    const inWaveCtx = state.view.mode === 'map' ? 'map' : 'wave';
    cmds.push({ label: 'Go to Overview', hint: 'view', run: go('overview') });
    if (file.model.waves.length) {
      cmds.push({ label: 'Go to Timeline', hint: 'view', run: go('wave', state.view.wave || 0) });
      cmds.push({ label: 'Go to Map', hint: 'view', run: go('map', state.view.wave || 0) });
    }
    cmds.push({ label: 'Go to Missions', hint: 'view', run: go('missions') });
    cmds.push({ label: 'Go to Templates', hint: 'view', run: go('templates') });
    cmds.push({ label: 'Go to Relays', hint: 'view', run: go('relays') });
    cmds.push({ label: 'Go to Settings & blocks', hint: 'view', run: go('settings') });
    cmds.push({ label: 'Compare versions', hint: 'view', run: go('diff') });
    file.model.waves.forEach(w => cmds.push({
      label: `Wave ${w.index + 1}`,
      hint: `$${w.totalCurrency} · ${w.totalBots} bots`,
      run: go(inWaveCtx, w.index)
    }));
  }
  cmds.push({ label: 'Models', hint: 'view', run: () => { state.view = { mode: 'models', wave: 0 }; emit(); } });
  cmds.push({ label: 'Open popfile…', hint: 'file', run: () => openViaDialog() });
  if (file) {
    cmds.push({ label: 'Save', hint: 'Ctrl+S', run: () => doSave(file, false) });
    cmds.push({ label: 'Save As…', hint: 'Ctrl+Shift+S', run: () => doSave(file, true) });
    cmds.push({ label: 'Undo', hint: 'Ctrl+Z', run: () => undo(file) });
    cmds.push({ label: 'Redo', hint: 'Ctrl+Y', run: () => redo(file) });
    if (state.view.mode === 'wave' && file.model.waves[state.view.wave]) {
      cmds.push({ label: 'Add WaveSpawn to this wave', hint: 'edit', run: () => addWaveSpawn(file, file.model.waves[state.view.wave]) });
      cmds.push({ label: 'Export this wave as PNG', hint: 'edit', run: async () => {
        const cont = document.querySelector('.tl-container');
        if (!cont) return;
        try { if (await exportWavePng(cont, file, state.view.wave)) toast('Wave exported', 'ok'); }
        catch (err) { toast('Export failed: ' + err.message, 'error'); }
      } });
    }
    cmds.push({ label: 'Toggle compact rows', hint: 'view', run: () => { localStorage.setItem('popvis.compact', localStorage.getItem('popvis.compact') === '1' ? '0' : '1'); emit('timeline'); } });
  }
  cmds.push({ label: 'Help', hint: 'shortcuts', run: () => helpModal() });
  return cmds;
}

function openCommandPalette() {
  if (isModalOpen() || document.querySelector('.cmdp-overlay')) return;
  closeMenu();
  const file = activeFile();
  const cmds = buildCommands(file);
  const input = el('input', { class: 'cmdp-input', type: 'text', placeholder: 'Type a command…', spellcheck: 'false' });
  const list = el('div', { class: 'cmdp-list', role: 'listbox' });
  const box = el('div', { class: 'cmdp', role: 'dialog', 'aria-label': 'Command palette' }, input, list);
  const overlay = el('div', { class: 'cmdp-overlay' }, box);
  let items = cmds;
  let sel = 0;

  const renderList = () => {
    clear(list);
    if (!items.length) { list.append(el('div', { class: 'cmdp-empty', text: 'No matching commands' })); return; }
    items.forEach((c, i) => list.append(el('div', {
      class: 'cmdp-item' + (i === sel ? ' sel' : ''), role: 'option',
      onmousemove: () => { if (sel !== i) { sel = i; markSel(); } },
      onclick: () => run(c)
    },
      el('span', { class: 'cmdp-label', text: c.label }),
      c.hint ? el('span', { class: 'cmdp-hint', text: c.hint }) : null)));
    markSel();
  };
  const markSel = () => {
    [...list.children].forEach((n, i) => n.classList.toggle('sel', i === sel));
    if (list.children[sel]) list.children[sel].scrollIntoView({ block: 'nearest' });
  };
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    items = q ? cmds.filter(c => c.label.toLowerCase().includes(q) || (c.hint || '').toLowerCase().includes(q)) : cmds;
    sel = 0;
    renderList();
  };
  const close = () => { overlay.remove(); removeEventListener('keydown', onKey, true); };
  const run = c => { close(); Promise.resolve().then(() => c.run()); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = items.length ? (sel + 1) % items.length : 0; markSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = items.length ? (sel - 1 + items.length) % items.length : 0; markSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
  };
  input.addEventListener('input', filter);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  input.focus();
  renderList();
}

$('btn-help').addEventListener('click', helpModal);
$('btn-models').addEventListener('click', () => {
  state.view = state.view.mode === 'models' ? { mode: 'overview', wave: 0 } : { mode: 'models', wave: 0 };
  emit();
});
$('btn-dock').addEventListener('click', showDockPicker);
$('zen-exit').addEventListener('click', exitDock);
$('zen-modify').addEventListener('click', () => { state.zen = !state.zen; emit(); });
$('zen-side').addEventListener('click', () => {
  const next = (localStorage.getItem('popvis.dockpos') || 'bottom') === 'bottom' ? 'right' : 'bottom';
  localStorage.setItem('popvis.dockpos', next);
  if (native.isElectron) window.popnative.dockPos(next);
});
$('zen-wave').addEventListener('change', e => {
  state.view = { mode: 'wave', wave: parseInt(e.target.value, 10) || 0 };
  emit();
});

$('btn-open').addEventListener('click', openViaDialog);
$('btn-vanilla').addEventListener('click', showVanillaBrowser);

addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-kbd')) {
    e.preventDefault();
    document.activeElement.click();
  }
});
$('btn-save').addEventListener('click', () => { const f = activeFile(); if (f) doSave(f, false); });
$('btn-saveas').addEventListener('click', () => { const f = activeFile(); if (f) doSave(f, true); });
$('btn-undo').addEventListener('click', () => undo(activeFile()));
$('btn-redo').addEventListener('click', () => redo(activeFile()));

async function doSave(file, as) {
  try {
    const r = await saveFile(file, as);
    if (!r) return false;
    if (r.blocked === 'encoding') {
      const rows = r.bad.slice(0, 12).map(b => el('div', { class: 'enc-row', text: `line ${b.line}: "${b.ch}"${b.count > 1 ? ' ×' + b.count : ''}` }));
      if (r.bad.length > 12) rows.push(el('div', { class: 'enc-row', text: `+ ${r.bad.length - 12} more` }));
      modal('Save blocked', el('div', {},
        el('div', { class: 'enc-msg', text: 'Popfiles are Latin-1. These characters cannot be written to ' + file.name + ' and would be corrupted. Nothing was saved — replace them first:' }),
        ...rows));
      return false;
    }
    if (r.blocked === 'conflict') {
      toast(file.name + ' changed on disk — resolve the banner above the editor first', 'error');
      return false;
    }
    toast('Saved ' + file.name, 'ok');
    return true;
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
    return false;
  }
}

const searchBox = $('searchbox');
let searchTimer = null;
searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = searchBox.value.trim();
    emit('search');
  }, 180);
});

let nudgeFile = null;
addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') nudgeFile = null; });
addEventListener('pointerdown', () => { nudgeFile = null; });

addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') nudgeFile = null;
  if (isModalOpen()) {
    if (e.key === 'Escape') import('./ui.js').then(m => m.closeModal());
    return;
  }
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const textTyping = tag === 'INPUT' || tag === 'TEXTAREA';
  const file = activeFile();
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openViaDialog(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (file) doSave(file, e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !textTyping) { e.preventDefault(); undo(file); return; }
  if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !textTyping) { e.preventDefault(); redo(file); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchBox.focus(); searchBox.select(); return; }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); return; }
  if (typing) return;
  if (!file) return;

  if (mod && e.key.toLowerCase() === 'v' && state.view.mode === 'wave') {
    const wave = file.model.waves[state.view.wave];
    if (wave) { e.preventDefault(); pasteWS(file, wave); return; }
  }

  if (state.view.mode === 'wave') {
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(file, state.view.wave, 1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomBy(file, state.view.wave, 0.8); return; }
    if (mod && e.key === '0') { e.preventDefault(); fitWave(file, state.view.wave); return; }
  }

  if (e.key === 'Escape') {
    closeMenu();
    file.selection = null;
    if (file.multi) file.multi.clear();
    emit('selection');
    return;
  }

  const sel = file.selection;
  if (sel && sel.type === 'wavespawn') {
    const found = findSelectedWS(file, sel.nodeId);
    if (!found) return;
    const { wave, ws } = found;
    const group = file.multi && file.multi.size > 1 && file.multi.has(ws.node.id)
      ? wave.wavespawns.filter(w => file.multi.has(w.node.id))
      : [ws];
    if (e.key === 'Delete') {
      e.preventDefault();
      if (group.length > 1) {
        modal(`Delete ${group.length} wavespawns?`, el('div', { class: 'close-msg', text: group.map(w => w.name || '(unnamed)').join(', ') }), [
          { label: 'Cancel', action: () => true },
          { label: 'Delete', danger: true, action: () => {
            beginEdit(file);
            for (const w of group) removeNode(wave.node, w.node);
            file.multi.clear();
            file.selection = null;
            commitEdit(file);
            return true;
          } }
        ]);
      } else deleteWS(file, wave, ws);
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateWS(file, wave, ws); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 2 : 0.5);
      if (nudgeFile !== file) { beginEdit(file); nudgeFile = file; }
      for (const w of group) {
        const next = Math.max(0, Math.round((w.waitBeforeStarting + delta) * 10) / 10);
        setValue(w.node, 'WaitBeforeStarting', next);
      }
      if (!commitEdit(file, { emit: 'timeline' })) nudgeFile = null;
      return;
    }
  }

  if (state.view.mode === 'wave' || state.view.mode === 'map') {
    if (e.key === 'PageDown' && state.view.wave < file.model.waves.length - 1) { state.view.wave++; emit(); }
    if (e.key === 'PageUp' && state.view.wave > 0) { state.view.wave--; emit(); }
  }
});

function findSelectedWS(file, nodeId) {
  for (const wave of file.model.waves) {
    for (const ws of wave.wavespawns) {
      if (ws.node.id === nodeId) return { wave, ws };
    }
  }
  return null;
}

const MAIN_MIN = 280;

function initSplitters() {
  const defs = [
    { id: 'split-side', panel: $('sidebar'), other: $('inspector'), key: 'popvis.sidebarw', def: 250, min: 170, max: 460, dir: 1 },
    { id: 'split-insp', panel: $('inspector'), other: $('sidebar'), key: 'popvis.inspw', def: 330, min: 230, max: 560, dir: -1 }
  ];
  const roomFor = d => {
    const otherW = d.other.offsetParent === null ? 0 : d.other.getBoundingClientRect().width;
    return Math.max(d.min, Math.min(d.max, innerWidth - otherW - MAIN_MIN - 10));
  };
  const clampAll = () => {
    for (const d of defs) {
      if (d.panel.offsetParent === null) continue;
      const w = d.panel.getBoundingClientRect().width;
      const lim = roomFor(d);
      if (w > lim) d.panel.style.width = lim + 'px';
    }
  };
  for (const d of defs) {
    const saved = parseInt(localStorage.getItem(d.key), 10);
    if (saved >= d.min && saved <= d.max) d.panel.style.width = saved + 'px';
    const split = $(d.id);
    split.addEventListener('dblclick', () => {
      d.panel.style.width = d.def + 'px';
      localStorage.removeItem(d.key);
      clampAll();
    });
    split.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = d.panel.getBoundingClientRect().width;
      const lim = roomFor(d);
      document.body.classList.add('splitting');
      const move = ev => {
        const w = Math.min(lim, Math.max(d.min, startW + (ev.clientX - startX) * d.dir));
        d.panel.style.width = w + 'px';
      };
      const up = () => {
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        document.body.classList.remove('splitting');
        localStorage.setItem(d.key, Math.round(d.panel.getBoundingClientRect().width));
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  }
  addEventListener('resize', clampAll);
  clampAll();
}
initSplitters();

addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
addEventListener('dragleave', e => { if (e.relatedTarget === null) document.body.classList.remove('dropping'); });
addEventListener('drop', async e => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  for (const f of e.dataTransfer.files) {
    if (!f.name.toLowerCase().endsWith('.pop')) continue;
    try {
      if (native.isElectron) {
        await openFile(native.pathForFile(f));
      } else {
        const text = new TextDecoder('latin1').decode(await f.arrayBuffer());
        await openFile(f.name, text);
      }
    } catch (err) {
      toast('Failed to open ' + f.name + ': ' + err.message, 'error');
    }
  }
});

let allowUnload = false;
addEventListener('beforeunload', e => {
  if (!allowUnload && state.files.some(f => f.dirty)) e.preventDefault();
});

let backupTimer = null;
onChange(() => {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    for (const f of state.files) {
      if (f.virtual) continue;
      const key = 'popvis.backup.' + f.path.toLowerCase();
      try {
        if (f.dirty) {
          const text = serialize(f.doc);
          if (text.length < 2000000) localStorage.setItem(key, text);
        } else if (!f.recoveryPending) {
          localStorage.removeItem(key);
        }
      } catch {}
    }
  }, 1200);
});

let sessionBlocked = false;

let sessTimer = null;
onChange(() => {
  if (!native.isElectron || sessionBlocked) return;
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    try {
      const files = state.files.filter(f => !f.virtual).map(f => ({
        path: f.path,
        view: f.id === state.activeId && state.view.mode !== 'models' && state.view.mode !== 'welcome' ? state.view : f.viewState || null
      }));
      const act = activeFile();
      localStorage.setItem('popvis.session', JSON.stringify({ files, active: act && !act.virtual ? act.path : null }));
    } catch {}
  }, 600);
});

async function restoreSession() {
  if (sessionBlocked || state.files.length) return;
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('popvis.session') || 'null'); } catch {}
  if (!sess || !sess.files || !sess.files.length) return;
  const opened = [];
  for (const ent of sess.files) {
    if (sessionBlocked) return;
    try {
      opened.push([await openFile(ent.path), ent]);
    } catch {}
  }
  if (sessionBlocked) return;
  for (const [f, ent] of opened) if (ent.view) f.viewState = { ...ent.view };
  state.activeId = null;
  state.view = { mode: 'welcome', wave: 0 };
  emit();
}

native.onCommand(async cmd => {
  if (cmd.type === 'open' && cmd.path) {
    try {
      const opened = await openFile(cmd.path);
      if (cmd.view) state.view = { mode: cmd.view, wave: cmd.wave ?? 0 };
      else if (cmd.wave !== null && cmd.wave !== undefined) state.view = { mode: 'wave', wave: cmd.wave };
      if (cmd.time !== null && cmd.time !== undefined && opened) presetMapTime(opened, cmd.wave ?? 0, cmd.time);
      emit();
    } catch (e) {
      toast('Open failed: ' + e.message, 'error');
    }
    return;
  }
  if (cmd.type === 'dockrefused') {
    state.dock = null;
    state.zen = false;
    emit();
    toast(cmd.reason === 'minimized'
      ? 'That window is minimized — restore it, then dock again'
      : 'Could not dock onto that window', 'error');
    return;
  }
  if (cmd.type === 'docked') {
    state.dock = { editor: { name: 'cli', title: 'cli', exe: null, handle: cmd.handle } };
    state.zen = true;
    emit();
    return;
  }
  if (cmd.type === 'exportpng' && cmd.out) {
    const f = activeFile();
    if (!f) return;
    if (state.view.mode !== 'wave') {
      state.view = { mode: 'wave', wave: 0 };
      emit();
    }
    await new Promise(r => setTimeout(r, 150));
    const cont = document.querySelector('.tl-container');
    if (!cont) return;
    try {
      await exportWavePng(cont, f, state.view.wave, cmd.out);
    } catch (err) {
      toast('Export failed: ' + err.message, 'error');
    }
    return;
  }
  if (cmd.type === 'filechanged' && cmd.path) {
    const file = state.files.find(f => f.path === cmd.path);
    if (!file) {
      const users = state.files.filter(f => (f.baseDocs || []).some(b => b.path && b.path.toLowerCase() === cmd.path.toLowerCase()));
      if (users.length) {
        for (const f of users) {
          try { await refreshBases(f); } catch {}
        }
        toast(cmd.path.split(/[\\/]/).pop() + ' changed — templates re-resolved');
      }
      return;
    }
    if (file.dirty && !state.dock) {
      file.conflict = true;
      emit();
      return;
    }
    try {
      const hadEdits = file.dirty;
      await reloadFromDisk(file, { preserveUndo: hadEdits });
      toast(hadEdits ? file.name + ' reloaded from disk — Ctrl+Z restores your edits' : file.name + ' reloaded from disk');
    } catch (e) {
      toast('Reload failed: ' + e.message, 'error');
    }
    return;
  }
  if (cmd.type === 'nosession') {
    sessionBlocked = true;
    return;
  }
  if (cmd.type === 'wantclose') {
    if (window.popnative.closeAck) window.popnative.closeAck();
    const dirty = state.files.filter(f => f.dirty);
    if (!dirty.length) {
      allowUnload = true;
      window.popnative.closeProceed();
      return;
    }
    modal('Unsaved changes', el('div', { class: 'close-msg', text: dirty.map(f => f.name).join(', ') }), [
      { label: 'Cancel', action: () => true },
      { label: 'Discard all', danger: true, action: () => {
        allowUnload = true;
        window.popnative.closeProceed();
        return true;
      } },
      { label: 'Save all', primary: true, action: () => {
        (async () => {
          for (const f of dirty) {
            if (!await doSave(f, false)) { toast('Close cancelled — ' + f.name + ' was not saved', 'error'); return; }
          }
          allowUnload = true;
          window.popnative.closeProceed();
        })();
        return true;
      } }
    ]);
    return;
  }
  if (cmd.type === 'viewmodel') {
    const { viewerModal } = await import('./modelbrowser.js');
    viewerModal({ kind: 'file', base: cmd.base }, cmd.base.split(/[\\/]/).pop());
    return;
  }
  if (cmd.type === 'view') {
    state.view = { mode: cmd.view, wave: 0 };
    emit();
    return;
  }
  if (cmd.type === 'dlprog') {
    dispatchEvent(new CustomEvent('popvis-dlprog', { detail: cmd.label }));
    return;
  }
  if (cmd.type === 'docklost') {
    state.dock = null;
    state.zen = false;
    if (native.isElectron) window.popnative.dockStop();
    toast('Docked window closed — dock mode ended');
    emit();
  }
});

initToolbarIcons();
render();
loadTFFonts();
hideDockOnUnsupported();
initNavWasm();

if (native.isElectron) {
  setTimeout(() => { restoreSession(); }, 400);
}

if (!native.isElectron) {
  (async () => {
    const params = new URLSearchParams(location.search);
    const auto = params.get('open');
    if (auto) {
      try {
        await openFile(auto);
        const wave = params.get('wave');
        const view = params.get('view');
        if (view) state.view = { mode: view, wave: wave ? parseInt(wave, 10) : 0 };
        else if (wave !== null) state.view = { mode: 'wave', wave: parseInt(wave, 10) };
        emit();
      } catch (e) {
        console.error(e);
      }
    }
  })();
}
