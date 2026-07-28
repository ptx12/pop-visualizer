import { el, clear, toast } from './ui.js';
import { state, activeFile, onChange } from './state.js';
import { diagnosticCounts, diagnosticsText } from './diagnostics.js';

const segments = new Map();
let bar = null;

export function setStatus(key, seg) {
  segments.set(key, seg);
  render();
}

export function clearStatus(key) {
  if (segments.delete(key)) render();
}

export function clearStatusPrefix(prefix) {
  let hit = false;
  for (const key of [...segments.keys()]) {
    if (key.startsWith(prefix)) { segments.delete(key); hit = true; }
  }
  if (hit) render();
}

function extensionSummary(model) {
  const found = [];
  const te = model.templateEntities;
  if (te && (te.spawns.length || te.capzones.length || te.flags.length || te.tracks.length || (te.navVolumes || []).length)) found.push('PointTemplates');
  if ((model.extraSpawnPoints || []).length) found.push('ExtraSpawnPoint');
  if ((model.extraTankPaths || []).length) found.push('ExtraTankPath');
  let interrupts = false;
  for (const w of model.waves) {
    for (const ws of w.wavespawns) {
      for (const b of ws.bots) {
        if (b.bot && b.bot.interrupts && b.bot.interrupts.length) { interrupts = true; break; }
      }
      if (interrupts) break;
    }
    if (interrupts) break;
  }
  if (interrupts) found.push('InterruptAction');
  return found;
}

function seg(node) {
  bar.append(node);
}

function render() {
  if (!bar) return;
  clear(bar);
  const file = activeFile();
  if (file && file.model) {
    const ext = extensionSummary(file.model);
    seg(el('span', {
      class: 'sb-seg',
      title: ext.length
        ? 'Extended constructs used by this mission: ' + ext.join(', ') + '. Parsed and simulated where supported; formal provider profiles come later.'
        : 'No extended constructs detected — stock Valve syntax',
      text: ext.length ? 'Valve + ' + ext.join(', ') : 'Valve'
    }));
    const w = file.model.waves.length;
    seg(el('span', { class: 'sb-seg sb-dim', text: w + (w === 1 ? ' wave' : ' waves') + ' · $' + file.model.startingCurrency + ' start' }));
    const lint = file.lint || [];
    const errs = lint.filter(l => l.severity === 'error').length;
    const warns = lint.filter(l => l.severity === 'warn').length;
    seg(el('span', {
      class: 'sb-seg' + (errs ? ' sb-err' : warns ? ' sb-warn' : ' sb-dim'),
      title: 'Errors and warnings found in this mission — per-wave counts are on the wave rows',
      'aria-label': errs + ' errors, ' + warns + ' warnings',
      text: errs + ' errors · ' + warns + ' warnings'
    }));
  } else {
    seg(el('span', { class: 'sb-seg sb-dim', text: 'No file open' }));
  }
  for (const [, s] of segments) {
    if (s.view && s.view !== state.view.mode) continue;
    const attrs = {
      class: 'sb-seg' + (s.onclick ? ' sb-btn' : '') + (s.kind ? ' sb-' + s.kind : ''),
      title: s.title || null,
      text: s.text
    };
    if (s.onclick) attrs.onclick = s.onclick;
    seg(el(s.onclick ? 'button' : 'span', attrs));
  }
  const d = diagnosticCounts();
  if (d.total) {
    seg(el('span', { class: 'grow' }));
    seg(el('button', {
      class: 'sb-seg sb-btn sb-dim' + (d.err ? ' sb-err' : ''),
      title: 'Internal diagnostics recorded this session (fallbacks, asset probes, failures) — click to copy the report',
      onclick: async () => {
        try { await navigator.clipboard.writeText(diagnosticsText()); toast('Diagnostics report copied'); }
        catch { toast('Clipboard unavailable', 'error'); }
      },
      text: d.total + ' diagnostics'
    }));
  }
}

export function initStatusBar() {
  bar = document.getElementById('statusbar');
  onChange(render);
  render();
}
