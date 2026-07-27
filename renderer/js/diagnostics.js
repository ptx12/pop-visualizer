const MAX_DIAGNOSTICS = 400;
const entries = [];
let seq = 0;

export function report(diag) {
  entries.push({ id: ++seq, time: Date.now(), severity: 'info', ...diag });
  if (entries.length > MAX_DIAGNOSTICS) entries.splice(0, entries.length - MAX_DIAGNOSTICS);
}

export function diagnostics() {
  return entries.slice();
}

export function diagnosticCounts() {
  let err = 0, warn = 0;
  for (const d of entries) {
    if (d.severity === 'error') err++;
    else if (d.severity === 'warn') warn++;
  }
  return { err, warn, total: entries.length };
}

export function diagnosticsText() {
  return entries.map(d => {
    const parts = [new Date(d.time).toISOString(), d.severity, d.operation || '?'];
    if (d.document) parts.push(d.document);
    if (d.asset) parts.push(d.asset);
    if (d.fallback) parts.push('fallback: ' + d.fallback);
    if (d.detail) parts.push(d.detail);
    if (d.error) parts.push(String((d.error && d.error.message) || d.error));
    return parts.join(' | ');
  }).join('\n');
}
