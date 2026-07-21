import { el, clear, compositionChips } from './ui.js';
import { state, emit, beginEdit, commitEdit, matchesSearch } from './state.js';
import { makeBlock, makeKV, removeNode } from './kv.js';

function folded(key) {
  return localStorage.getItem('popvis.navfold.' + key) === '1';
}

function setFolded(key, v) {
  if (v) localStorage.setItem('popvis.navfold.' + key, '1');
  else localStorage.removeItem('popvis.navfold.' + key);
}

function groupHead(key, label, count, extra) {
  const isFolded = folded(key);
  return el('div', {
    class: 'nav-group' + (isFolded ? ' folded' : ''),
    onclick: () => { setFolded(key, !isFolded); emit('sidebar'); }
  },
    el('span', { class: 'nav-group-label', text: label + (isFolded && count ? ' (' + count + ')' : '') }),
    extra || null,
    el('span', { class: 'nav-fold', text: isFolded ? '+' : '-' }));
}

function attachWaveReorder(handle, row, file, wavesWrap) {
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rows = [...wavesWrap.querySelectorAll('.nav-wave')];
    const startIdx = rows.indexOf(row);
    if (startIdx < 0) return;
    let curIdx = startIdx;
    row.classList.add('reordering');
    const move = ev => {
      let target = curIdx;
      rows.forEach((rw, i) => {
        const r = rw.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) target = i;
        if (i === 0 && ev.clientY < r.top + r.height / 2) target = 0;
      });
      if (target !== curIdx) {
        curIdx = target;
        rows.forEach(rw => rw.classList.remove('drop-above'));
        if (rows[curIdx]) rows[curIdx].classList.add('drop-above');
      }
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      row.classList.remove('reordering');
      rows.forEach(rw => rw.classList.remove('drop-above'));
      if (curIdx === startIdx) return;
      beginEdit(file);
      const parent = file.model.root;
      const waveNodes = file.model.waves.map(w => w.node);
      const nodeToMove = waveNodes[startIdx];
      const targetNode = waveNodes[curIdx];
      removeNode(parent, nodeToMove);
      const newIdx = parent.children.indexOf(targetNode);
      parent.children.splice(curIdx > startIdx ? newIdx + 1 : newIdx, 0, nodeToMove);
      if (state.view.mode === 'wave' || state.view.mode === 'map') state.view.wave = curIdx;
      commitEdit(file);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
}

export function renderSidebar(container, file) {
  clear(container);
  if (!file) return;
  const m = file.model;

  const nav = el('div', { class: 'nav' });
  const item = (label, mode, extra = {}) => {
    const perWave = mode === 'wave' || mode === 'map';
    const active = state.view.mode === mode && (!perWave || state.view.wave === extra.wave);
    const row = el('div', {
      class: 'nav-item' + (active ? ' active' : '') + (extra.cls ? ' ' + extra.cls : ''),
      role: 'button', tabindex: 0, 'data-kbd': true,
      onclick: () => {
        state.view = { mode, wave: extra.wave ?? 0 };
        if (extra.select !== undefined) file.selection = extra.select;
        emit();
      }
    }, ...(extra.children || [el('span', { text: label })]));
    return row;
  };

  nav.append(item('Overview', 'overview'));
  if (m.waves.length) nav.append(item('Map', 'map', { wave: state.view.mode === 'map' || state.view.mode === 'wave' ? state.view.wave : 0 }));

  const addWaveBtn = el('button', { class: 'icon-btn sm', text: '+', title: 'Add wave at end', onclick: e => {
    e.stopPropagation();
    beginEdit(file);
    m.root.children.push(makeBlock('Wave', [
      makeBlock('StartWaveOutput', [makeKV('Target', 'wave_start_relay'), makeKV('Action', 'Trigger')]),
      makeBlock('DoneOutput', [makeKV('Target', 'wave_finished_relay'), makeKV('Action', 'Trigger')])
    ]));
    commitEdit(file);
    state.view = { mode: 'wave', wave: m.waves.length };
    emit();
  } });
  nav.append(groupHead('waves', 'WAVES', m.waves.length, addWaveBtn));

  if (!folded('waves')) {
    const wavesWrap = el('div', { class: 'nav-waves' });
    m.waves.forEach(w => {
      const lintErr = file.lint.filter(l => l.wave === w.index && l.severity === 'error').length;
      const lintWarn = file.lint.filter(l => l.wave === w.index && l.severity === 'warn').length;
      const matches = state.search ? w.wavespawns.filter(ws => matchesSearch(ws, state.search)).length : 0;
      const pseudo = { bots: w.wavespawns.flatMap(ws => ws.bots).slice(0, 40) };
      const dragHandle = el('span', { class: 'nav-drag', text: '⋮⋮', title: 'Drag to reorder waves' });
      const row = item('', state.view.mode === 'map' ? 'map' : 'wave', {
        wave: w.index,
        cls: 'nav-wave' + (state.search && !matches ? ' dimmed' : ''),
        children: [
          el('div', { class: 'nav-wave-top' },
            dragHandle,
            el('span', { class: 'nav-wave-num', text: 'W' + (w.index + 1) }),
            el('span', { class: 'nav-wave-cash', text: '$' + w.totalCurrency }),
            el('span', { class: 'nav-wave-bots', text: w.totalBots + (w.supportBots || w.wavespawns.some(x => x.support === 'unlimited') ? '+' : '') }),
            w.tankCount ? el('span', { class: 'badge tank sm', text: w.tankCount > 1 ? 'TANK ×' + w.tankCount : 'TANK' }) : null,
            state.search && matches ? el('span', { class: 'lint-badge match', text: matches }) : null
          ),
          el('div', { class: 'nav-wave-chips' }, compositionChips(pseudo, 7, { size: 'sm' }))
        ]
      });
      attachWaveReorder(dragHandle, row, file, wavesWrap);
      wavesWrap.append(row);
    });
    nav.append(wavesWrap);
  }

  let relayCount = 0;
  const seenRelays = new Set();
  for (const w of m.waves) {
    for (const ws of w.wavespawns) {
      for (const o of ws.outputs) {
        if (o.target && !seenRelays.has(o.target.toLowerCase())) { seenRelays.add(o.target.toLowerCase()); relayCount++; }
      }
    }
  }

  nav.append(groupHead('mission', 'MISSION', 5));
  if (!folded('mission')) {
    nav.append(item(`Support missions (${m.missions.length})`, 'missions'));
    nav.append(item(`Templates (${m.templates.size})`, 'templates'));
    nav.append(item(`Relays (${relayCount})`, 'relays'));
    nav.append(item('Compare versions', 'diff'));
    nav.append(item('Settings & blocks', 'settings'));
  }

  container.append(nav);
}
