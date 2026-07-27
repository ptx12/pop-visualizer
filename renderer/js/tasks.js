import { el, clear } from './ui.js';

const tasks = [];
let seq = 0;
let host = null;
const DONE_LINGER = 1600;
const ERR_LINGER = 6000;

function ensureHost() {
  if (!host) host = document.getElementById('taskcenter');
  return host;
}

function fmtBytes(n) {
  if (!n) return '';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  if (n >= 1 << 10) return Math.round(n / (1 << 10)) + ' KB';
  return n + ' B';
}

function render() {
  const h = ensureHost();
  if (!h) return;
  clear(h);
  for (const t of tasks) {
    const pct = t.total > 0 ? Math.min(1, t.done / t.total) : null;
    const meta = t.status === 'error' ? 'failed'
      : t.status === 'done' ? 'done'
      : pct != null ? Math.round(pct * 100) + '%'
      : '';
    const card = el('div', { class: 'task-card ' + t.status, role: 'status' },
      el('div', { class: 'task-top' },
        el('span', { class: 'task-label', text: t.label }),
        el('span', { class: 'task-meta', text: meta })));
    const bar = el('div', { class: 'task-bar' + (pct == null && t.status === 'running' ? ' indet' : '') });
    const fill = el('div', { class: 'task-fill' });
    if (pct != null) fill.style.width = (pct * 100).toFixed(1) + '%';
    else if (t.status !== 'running') fill.style.width = '100%';
    bar.append(fill);
    card.append(bar);
    const sub = t.status === 'error' ? (t.error || 'failed')
      : t.total > 0 && t.status === 'running' ? fmtBytes(t.done) + ' / ' + fmtBytes(t.total)
      : t.stage || '';
    if (sub) card.append(el('div', { class: 'task-sub' + (t.status === 'error' ? ' err' : ''), text: sub }));
    h.append(card);
  }
}

function drop(t, delay) {
  setTimeout(() => {
    const i = tasks.indexOf(t);
    if (i >= 0) { tasks.splice(i, 1); render(); }
  }, delay);
}

export function startTask(label, opts = {}) {
  const t = { id: ++seq, label, stage: opts.stage || '', done: 0, total: opts.total || 0, status: 'running', startedAt: Date.now(), error: null };
  tasks.push(t);
  render();
  return {
    id: t.id,
    progress(done, total) { t.done = done || 0; if (total != null) t.total = total; render(); },
    stage(s) { t.stage = s; render(); },
    label(s) { t.label = s; render(); },
    succeed(lbl) { if (tasks.indexOf(t) < 0) return; t.status = 'done'; if (lbl) t.label = lbl; t.stage = ''; render(); drop(t, DONE_LINGER); },
    fail(msg) { if (tasks.indexOf(t) < 0) return; t.status = 'error'; t.error = msg || 'failed'; render(); drop(t, ERR_LINGER); }
  };
}

let curDl = null;
let curDlLabel = null;

export function handleDlProg(d) {
  const label = typeof d === 'string' ? d : (d && d.label) || '';
  const done = d && typeof d.done === 'number' ? d.done : null;
  const total = d && typeof d.total === 'number' ? d.total : null;
  if (!label) {
    if (curDl) { curDl.succeed(); curDl = null; curDlLabel = null; }
    return;
  }
  if (curDlLabel !== label) {
    if (curDl) curDl.succeed();
    curDl = startTask(label, { total: total || 0 });
    curDlLabel = label;
  }
  if (done != null) curDl.progress(done, total);
}

export function initTasks() {
  ensureHost();
  render();
}
