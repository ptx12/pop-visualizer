import { CLASS_INFO, botDisplayName } from './popmodel.js';
import { iconURL, iconNameFor, classIconName, tankIconName } from './icons.js';

const SKILL_COLORS = { easy: '#74c66a', normal: '#e3c74e', hard: '#e2913c', expert: '#d4504a' };

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function loader(label) {
  const lbl = el('div', { class: 'loading-label', text: label });
  const node = el('div', { class: 'loading' },
    el('div', { class: 'loading-bar' }, el('div', { class: 'loading-fill' })),
    lbl);
  node.label = lbl;
  return node;
}

export function fmtNum(n, dec = 1) {
  if (!Number.isFinite(n)) return '∞';
  const r = Math.round(n * 10 ** dec) / 10 ** dec;
  return String(r % 1 === 0 ? Math.round(r) : r.toFixed(dec));
}

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1e6) return fmtNum(n / 1e6, 1) + 'm';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return fmtNum(n / 1e3, 1) + 'k';
  return String(Math.round(n));
}

export function fmtTime(s) {
  if (!Number.isFinite(s)) return '∞';
  if (s < 60) return fmtNum(s) + 's';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function botVisual(bot, opts = {}) {
  const url = iconURL(iconNameFor(bot)) || iconURL(classIconName(bot.cls));
  if (!url) return classChip(bot, opts);
  const cls = ['boticon'];
  if (bot.isGiant) cls.push('bi-giant');
  if (bot.isBoss) cls.push('bi-boss');
  if (bot.alwaysCrit) cls.push('bi-crit');
  if (opts.random) cls.push('bi-random');
  if (opts.dim) cls.push('bi-dim');
  if (opts.size) cls.push('bi-' + opts.size);
  const wrap = el('span', { class: cls.join(' '), title: opts.title || chipTitle(bot) },
    el('img', { src: url, draggable: 'false' }));
  const skill = bot.skill ? SKILL_COLORS[bot.skill.toLowerCase()] : null;
  if (skill) wrap.append(el('span', { class: 'bi-skill', style: `background:${skill}` }));
  if (bot.isBoss) wrap.append(el('span', { class: 'bi-bossdot', title: 'Boss health bar' }));
  if (opts.random) wrap.append(el('span', { class: 'bi-q', text: '?' }));
  if (opts.count && opts.count > 1) wrap.append(el('span', { class: 'bi-count', text: 'x' + opts.count }));
  return wrap;
}

export function tankVisual(tank, opts = {}) {
  const url = iconURL(tankIconName(tank)) || iconURL('leaderboard_class_tank');
  if (!url) return tankChip(tank, opts);
  const wrap = el('span', {
    class: 'boticon bi-tankicon' + (opts.random ? ' bi-random' : '') + (opts.size ? ' bi-' + opts.size : ''),
    title: `Tank — ${tank.health} HP, speed ${tank.speed}${tank.startNode ? ', path ' + tank.startNode : ''}`
  }, el('img', { src: url, draggable: 'false' }));
  if (opts.count && opts.count > 1) wrap.append(el('span', { class: 'bi-count', text: 'x' + opts.count }));
  return wrap;
}

export function classChip(bot, opts = {}) {
  const info = CLASS_INFO[bot.cls] || CLASS_INFO.unknown;
  const chip = el('span', {
    class: 'chip' + (bot.isGiant ? ' chip-giant' : '') + (bot.isBoss ? ' chip-boss' : '') + (opts.random ? ' chip-random' : '') + (opts.dim ? ' chip-dim' : ''),
    style: `--chip:${info.color}`,
    title: opts.title || chipTitle(bot)
  }, el('span', { class: 'chip-label', text: info.short }));
  if (opts.random) chip.append(el('span', { class: 'chip-q', text: '?' }));
  if (opts.count && opts.count > 1) chip.append(el('span', { class: 'chip-count', text: 'x' + opts.count }));
  return chip;
}

export function tankChip(tank, opts = {}) {
  const chip = el('span', {
    class: 'chip chip-tank' + (opts.random ? ' chip-random' : ''),
    style: `--chip:${CLASS_INFO.tank.color}`,
    title: `Tank — ${tank.health} HP, speed ${tank.speed}${tank.startNode ? ', path ' + tank.startNode : ''}`
  }, el('span', { class: 'chip-label', text: 'TANK' }));
  if (opts.count && opts.count > 1) chip.append(el('span', { class: 'chip-count', text: 'x' + opts.count }));
  return chip;
}

export function sentryChip(sentry) {
  return el('span', { class: 'chip', style: `--chip:${CLASS_INFO.sentrygun.color}`, title: `Sentry Gun level ${sentry.level}` },
    el('span', { class: 'chip-label', text: 'SG' + sentry.level }));
}

function chipTitle(bot) {
  const parts = [botDisplayName(bot)];
  parts.push(`${(CLASS_INFO[bot.cls] || CLASS_INFO.unknown).label} — ${bot.health} HP`);
  if (bot.skill) parts.push('Skill: ' + bot.skill);
  if (bot.isGiant) parts.push('Giant');
  if (bot.isBoss) parts.push('Boss bar');
  if (bot.templateChain.length) parts.push('Template: ' + bot.templateChain.join(' → '));
  if (bot.missingTemplates.length) parts.push('MISSING: ' + bot.missingTemplates.join(', '));
  if (bot.items.length) parts.push('Items: ' + bot.items.join(', '));
  return parts.join('\n');
}

export function compositionChips(ws, limit = 8, opts = {}) {
  const groups = [];
  for (const entry of ws.bots) {
    const key = entry.bot ? `b:${entry.bot.cls}:${botDisplayName(entry.bot)}:${entry.bot.isGiant}:${entry.bot.isBoss}:${entry.random}`
      : entry.tank ? `t:${entry.tank.health}` : entry.sentry ? `s:${entry.sentry.level}` : 'o:' + (entry.other ? entry.other.label : '?');
    const g = groups.find(x => x.key === key);
    if (g) g.count += entry.mult;
    else groups.push({ key, entry, count: entry.mult });
  }
  const wrap = el('span', { class: 'chips' });
  groups.slice(0, limit).forEach(g => {
    if (g.entry.bot) wrap.append(botVisual(g.entry.bot, { count: g.count, random: g.entry.random, size: opts.size }));
    else if (g.entry.tank) wrap.append(tankVisual(g.entry.tank, { count: g.count, random: g.entry.random, size: opts.size }));
    else if (g.entry.sentry) wrap.append(sentryChip(g.entry.sentry));
    else {
      const label = g.entry.other && g.entry.other.label ? g.entry.other.label : '???';
      const short = label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '???';
      wrap.append(el('span', { class: 'chip', style: '--chip:#a06bc8', title: label + (g.entry.other && g.entry.other.health ? ` — ${g.entry.other.health} HP` : '') },
        el('span', { class: 'chip-label', text: short }),
        g.count > 1 ? el('span', { class: 'chip-count', text: 'x' + g.count }) : null));
    }
  });
  if (groups.length > limit) wrap.append(el('span', { class: 'chips-more', text: '+' + (groups.length - limit) }));
  return wrap;
}

let tipEl = null;
export function showTip(content, x, y) {
  if (!tipEl) {
    tipEl = el('div', { class: 'tooltip' });
    document.body.append(tipEl);
  }
  clear(tipEl);
  tipEl.append(content.nodeType ? content : document.createTextNode(content));
  tipEl.style.display = 'block';
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 10;
  if (top + r.height > innerHeight - 8) top = y - r.height - 10;
  tipEl.style.left = Math.max(4, left) + 'px';
  tipEl.style.top = Math.max(4, top) + 'px';
}

export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

let menuEl = null;
export function contextMenu(x, y, items) {
  closeMenu();
  menuEl = el('div', { class: 'ctxmenu', style: `left:${x}px;top:${y}px` });
  for (const item of items) {
    if (item === '-') { menuEl.append(el('div', { class: 'ctxmenu-sep' })); continue; }
    const row = el('div', {
      class: 'ctxmenu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : ''),
      text: item.label,
      role: 'menuitem',
      tabindex: item.disabled ? null : 0,
      'data-kbd': item.disabled ? null : true
    });
    if (!item.disabled) row.addEventListener('click', () => { closeMenu(); item.action(); });
    menuEl.append(row);
  }
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  if (r.right > innerWidth) menuEl.style.left = Math.max(4, x - r.width) + 'px';
  if (r.bottom > innerHeight) menuEl.style.top = Math.max(4, y - r.height) + 'px';
  setTimeout(() => addEventListener('mousedown', onDocDown), 0);
}

function onDocDown(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

export function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; removeEventListener('mousedown', onDocDown); }
}

let popEl = null;
let popOnClose = null;
function onPopDown(e) {
  if (popEl && !popEl.contains(e.target) && !e.target.closest('[data-popanchor]')) closePopover();
}
function rawClosePopover() {
  if (!popEl) return;
  popEl.remove();
  popEl = null;
  popOnClose = null;
  removeEventListener('mousedown', onPopDown);
}
export function closePopover() {
  const cb = popOnClose;
  rawClosePopover();
  if (cb) cb();
}
export function popover(anchor, node, onClose = null) {
  rawClosePopover();
  popOnClose = onClose;
  popEl = el('div', { class: 'popover' }, node);
  document.body.append(popEl);
  const a = anchor.getBoundingClientRect();
  const p = popEl.getBoundingClientRect();
  let left = a.left;
  if (left + p.width > innerWidth - 6) left = innerWidth - p.width - 6;
  let top = a.bottom + 4;
  if (top + p.height > innerHeight - 6) top = Math.max(6, a.top - p.height - 4);
  popEl.style.left = Math.max(6, left) + 'px';
  popEl.style.top = top + 'px';
  setTimeout(() => addEventListener('mousedown', onPopDown), 0);
  return popEl;
}
export function isPopoverOpen() { return !!popEl; }

let modalWrap = null;
let modalPrevFocus = null;

function trapFocus(e, box) {
  if (e.key !== 'Tab') return;
  const focusables = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function modal(title, body, buttons = []) {
  closeModal();
  modalPrevFocus = document.activeElement;
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('span', { text: title }), el('button', { class: 'icon-btn', text: '×', title: 'Close', onclick: closeModal })),
    el('div', { class: 'modal-body' }, body),
    buttons.length ? el('div', { class: 'modal-foot' }, buttons.map(b =>
      el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), text: b.label, onclick: () => { if (b.action() !== false) closeModal(); } })
    )) : null
  );
  box.addEventListener('keydown', e => trapFocus(e, box));
  modalWrap = el('div', { class: 'modal-overlay', onmousedown: e => { if (e.target === modalWrap) closeModal(); } }, box);
  document.body.append(modalWrap);
  const autoTarget = box.querySelector('.modal-foot .btn.primary') || box.querySelector('.modal-foot .btn') || box.querySelector('.modal-head .icon-btn');
  if (autoTarget) autoTarget.focus();
  return box;
}

export function closeModal() {
  if (modalWrap) {
    modalWrap.remove();
    modalWrap = null;
    if (modalPrevFocus && modalPrevFocus.isConnected && modalPrevFocus.focus) modalPrevFocus.focus();
    modalPrevFocus = null;
  }
}

export function isModalOpen() {
  return !!modalWrap;
}

let toastTimer = null;
export function toast(msg, kind = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast', role: 'status', title: 'Click to dismiss' });
    t.addEventListener('click', () => { t.className = ''; clearTimeout(toastTimer); });
    document.body.append(t);
  }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 7000 : 2600);
}

export function field(labelText, input, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label', text: labelText, title: hint || '' }),
    input);
}

export function numInput(value, onchange, opts = {}) {
  const input = el('input', {
    type: 'number', class: 'inp', value: value ?? '',
    step: opts.step ?? 'any', min: opts.min, max: opts.max, placeholder: opts.placeholder
  });
  input.addEventListener('change', () => {
    let v = input.value === '' ? null : parseFloat(input.value);
    if (v !== null && !Number.isFinite(v)) v = null;
    if (v !== null) {
      let clamped = v;
      if (opts.min !== undefined && opts.min !== null && clamped < opts.min) clamped = opts.min;
      if (opts.max !== undefined && opts.max !== null && clamped > opts.max) clamped = opts.max;
      if (opts.step === 1) clamped = Math.round(clamped);
      if (clamped !== v) {
        input.value = clamped;
        input.classList.add('inp-clamped');
        setTimeout(() => input.classList.remove('inp-clamped'), 600);
        v = clamped;
      }
    }
    onchange(v);
  });
  return input;
}

export function textInput(value, onchange, opts = {}) {
  const input = el('input', { type: 'text', class: 'inp', value: value ?? '', placeholder: opts.placeholder, list: opts.list });
  input.addEventListener('change', () => onchange(input.value.trim() === '' ? null : input.value.trim()));
  return input;
}

export function selectInput(value, options, onchange) {
  const sel = el('select', { class: 'inp' });
  for (const o of options) sel.append(el('option', { value: o.value, text: o.label, selected: o.value === value }));
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}

export function ensureDatalist(id, values) {
  let dl = document.getElementById(id);
  if (!dl) { dl = el('datalist', { id }); document.body.append(dl); }
  clear(dl);
  for (const v of values) dl.append(el('option', { value: v }));
  return id;
}
