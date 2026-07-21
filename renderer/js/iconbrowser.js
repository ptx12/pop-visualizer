import { el, clear, modal, closeModal, toast } from './ui.js';
import { listAllIcons, ensureIcons, iconURL } from './icons.js';
import { native } from './native.js';

const PAGE = 400;

export function shortIconName(name) {
  return name.replace(/^leaderboard_class_/, '');
}

export async function iconBrowserModal(file, opts = {}) {
  const body = el('div', { class: 'icon-browser' },
    el('div', { class: 'empty-note', text: 'Scanning icon sources...' }));
  modal(opts.onPick ? 'Pick a robot icon' : 'Icon library', body);

  const fileDirs = [];
  if (file && file.path) {
    const dir = native.dirname(file.path);
    fileDirs.push(dir, native.join(dir, 'materials', 'hud'));
  }
  let all;
  try {
    all = await listAllIcons(fileDirs);
  } catch (e) {
    clear(body).append(el('div', { class: 'empty-note', text: 'Could not list icons: ' + e.message }));
    return;
  }
  if (!document.body.contains(body)) return;

  const sources = [...new Set(all.map(i => i.source))];
  const search = el('input', { class: 'inp tpl-search', type: 'search', placeholder: `Search ${all.length} icons...` });
  const srcSel = el('select', { class: 'inp' }, el('option', { value: '', text: 'All sources' }),
    ...sources.map(s => el('option', { value: s, text: s })));
  const count = el('span', { class: 'icon-count' });
  const grid = el('div', { class: 'icon-grid' });
  const footer = el('div', { class: 'icon-more' });
  clear(body).append(el('div', { class: 'icon-browse-bar' }, search, srcSel, count), grid, footer);

  let limit = PAGE;
  let pending = new Set();
  let timer = null;

  async function flush() {
    timer = null;
    const batch = [...pending].filter(c => c.isConnected);
    pending.clear();
    if (!batch.length) return;
    await ensureIcons(batch.map(c => c.dataset.name), fileDirs);
    for (const c of batch) {
      const ph = c.querySelector('.ic-ph');
      if (!ph) continue;
      const url = iconURL(c.dataset.name);
      if (url) ph.replaceWith(el('img', { src: url, draggable: 'false' }));
      else ph.classList.add('ic-missing');
    }
  }

  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      pending.add(en.target);
    }
    if (pending.size && !timer) timer = setTimeout(flush, 60);
  }, { root: grid, rootMargin: '160px' });

  function pick(name) {
    const short = shortIconName(name);
    if (opts.onPick) {
      closeModal();
      opts.onPick(short);
      return;
    }
    navigator.clipboard.writeText(short).then(
      () => toast(`Copied ClassIcon "${short}"`),
      () => toast('Could not copy to clipboard', 'error'));
  }

  function renderGrid() {
    io.disconnect();
    pending.clear();
    clear(grid);
    clear(footer);
    const q = search.value.toLowerCase();
    const src = srcSel.value;
    const matches = all.filter(it =>
      (!src || it.source === src) && (!q || shortIconName(it.name).includes(q)));
    count.textContent = matches.length === all.length
      ? `${all.length} icons` : `${matches.length} of ${all.length} icons`;
    matches.slice(0, limit).forEach((it, i) => {
      const card = el('div', {
        class: 'icon-card',
        title: it.name + '\nfrom: ' + it.source + (opts.onPick ? '' : '\nclick to copy ClassIcon value'),
        dataset: { name: it.name },
        onclick: () => pick(it.name)
      },
        el('span', { class: 'ic-ph' }),
        el('span', { class: 'ic-name', text: shortIconName(it.name) }),
        el('span', { class: 'ic-src', text: it.source }));
      grid.append(card);
      if (i < 60) pending.add(card);
      else io.observe(card);
    });
    if (pending.size && !timer) timer = setTimeout(flush, 0);
    if (!matches.length) grid.append(el('div', { class: 'empty-note', text: 'No icons match' }));
    if (matches.length > limit) {
      footer.append(el('button', {
        class: 'btn sm', text: `Show ${Math.min(PAGE * 2, matches.length - limit)} more (${matches.length - limit} hidden)`,
        onclick: () => { limit += PAGE * 2; renderGrid(); }
      }));
    }
  }

  search.addEventListener('input', () => { limit = PAGE; renderGrid(); });
  srcSel.addEventListener('change', () => { limit = PAGE; renderGrid(); });
  renderGrid();
  setTimeout(() => search.focus(), 50);
}
