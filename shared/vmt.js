export function stripVmtComments(text) {
  let out = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { quoted = !quoted; out += c; continue; }
    if (!quoted && c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

export function vmtParam(text, name) {
  const H = '[^\\S\\r\\n]';
  const key = '(?:"\\$' + name + '"|\'\\$' + name + '\')' + H + '*|\\$' + name + H + '+';
  const value = '"([^"\\r\\n]*)"|\'([^\'\\r\\n]*)\'|([^\\s\\r\\n]+)';
  const m = text.match(new RegExp('^' + H + '*(?:' + key + ')(?:' + value + ')' + H + '*$', 'im'));
  if (!m) return null;
  const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
  return v === undefined ? null : v.trim();
}

export function vmtFlag(text, name) {
  const v = vmtParam(text, name);
  return v !== null && v !== '0' && v !== '';
}

export function vmtShader(text) {
  const m = text.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*(?:\r?\n)?\s*\{/);
  return m ? m[1].toLowerCase() : null;
}

export function vmtTexturePath(value) {
  if (!value) return null;
  const clean = String(value).trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase();
  return clean ? 'materials/' + clean + '.vtf' : null;
}

export function vmtColor(text, name) {
  const v = vmtParam(text, name);
  if (!v) return null;
  const m = v.match(/^\s*([{[])\s*([-0-9.]+)[\s,]+([-0-9.]+)[\s,]+([-0-9.]+)\s*[}\]]\s*$/);
  if (!m) return null;
  const scale = m[1] === '{' ? 1 / 255 : 1;
  return [parseFloat(m[2]) * scale, parseFloat(m[3]) * scale, parseFloat(m[4]) * scale]
    .map(c => Math.max(0, Math.min(1, c)));
}
