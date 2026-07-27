import { el, clear } from './ui.js';
import { state, activeFile, onChange, emit } from './state.js';

const SEV_ORDER = { error: 0, warn: 1, info: 2 };
const SEV_LABEL = { error: 'ERROR', warn: 'WARN', info: 'INFO' };

let sevFilter = null;

export function toggleProblems() {
  state.showLint = !state.showLint;
  emit('lint');
}

function countText(errs, warns, infos) {
  const parts = [];
  if (errs) parts.push(errs + (errs === 1 ? ' error' : ' errors'));
  if (warns) parts.push(warns + (warns === 1 ? ' warning' : ' warnings'));
  if (infos) parts.push(infos + ' info');
  return parts.length ? parts.join(' · ') : 'No problems';
}

function jumpTo(file, item) {
  if (item.wave != null && file.model.waves[item.wave]) {
    state.view = { mode: state.view.mode === 'map' ? 'map' : 'wave', wave: item.wave };
    const wave = file.model.waves[item.wave];
    const ws = item.node ? wave.wavespawns.find(w => w.node === item.node || w.node.id === item.node.id) : null;
    if (ws) {
      file.selection = { type: 'wavespawn', nodeId: ws.node.id };
      if (file.multi) file.multi.clear();
    }
  } else {
    state.view = { mode: 'overview', wave: 0 };
  }
  emit();
}

export function initProblems() {
  const panel = document.getElementById('lintpanel');
  const btn = document.getElementById('btn-problems');
  const render = () => {
    const file = activeFile();
    const lint = (file && file.lint) || [];
    const errs = lint.filter(l => l.severity === 'error').length;
    const warns = lint.filter(l => l.severity === 'warn').length;
    const infos = lint.length - errs - warns;
    btn.disabled = !file;
    btn.textContent = lint.length ? 'Problems (' + lint.length + ')' : 'Problems';
    btn.classList.toggle('has-errors', errs > 0);
    btn.setAttribute('aria-pressed', state.showLint ? 'true' : 'false');
    const open = state.showLint && !!file;
    panel.classList.toggle('open', open);
    clear(panel);
    if (!open) return;
    const chip = (label, sev, count) => el('button', {
      class: 'lint-chip' + (sevFilter === sev ? ' on' : ''),
      'aria-pressed': sevFilter === sev ? 'true' : 'false',
      text: count == null ? label : label + ' ' + count,
      onclick: () => { sevFilter = sevFilter === sev ? null : sev; emit('lint'); }
    });
    panel.append(el('div', { class: 'lint-head' },
      el('span', { text: countText(errs, warns, infos) + (file.lintStale ? ' — re-checking…' : '') }),
      el('span', { class: 'lint-filters' },
        chip('Errors', 'error', errs), chip('Warnings', 'warn', warns), chip('Info', 'info', infos)),
      el('span', { class: 'grow' }),
      el('button', { class: 'icon-btn sm', 'aria-label': 'Close Problems panel', title: 'Close (Ctrl+Shift+M)', text: '×', onclick: toggleProblems })));
    const list = el('div', { class: 'lint-list', role: 'list' });
    const sorted = [...lint].filter(l => !sevFilter || l.severity === sevFilter).sort((a, b) =>
      ((SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)) || ((a.wave ?? -1) - (b.wave ?? -1)));
    if (!sorted.length) list.append(el('div', { class: 'lint-empty', text: sevFilter ? 'No ' + sevFilter + ' problems' + (lint.length ? ' — ' + lint.length + ' total under other filters' : '') : 'No problems found in ' + file.name }));
    for (const item of sorted) {
      list.append(el('div', {
        class: 'lint-item ' + item.severity,
        role: 'listitem', tabindex: 0, 'data-kbd': true,
        onclick: () => jumpTo(file, item)
      },
        el('span', { class: 'lint-sev', text: SEV_LABEL[item.severity] || 'INFO' }),
        item.wave != null ? el('span', { class: 'lint-wave', text: 'W' + (item.wave + 1) }) : null,
        el('span', { class: 'lint-msg', text: item.msg })));
    }
    panel.append(list);
  };
  onChange(render);
  render();
}
