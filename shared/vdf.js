export function parseVDF(text) {
  let i = 0;
  const n = text.length;
  const skip = () => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const tok = () => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '"') { i++; const s = i; while (i < n && text[i] !== '"') i++; const t = text.slice(s, i); i++; return t; }
    if (c === '{' || c === '}') { i++; return c; }
    if (c === '[') { while (i < n && text[i] !== ']') i++; i++; return tok(); }
    const s = i;
    while (i < n && ' \t\r\n"{}'.indexOf(text[i]) < 0) i++;
    return text.slice(s, i);
  };
  const block = () => {
    const obj = {};
    for (;;) {
      const key = tok();
      if (key === null || key === '}') return obj;
      let val = tok();
      if (val === '[') val = tok();
      if (val === '{') val = block();
      if (obj[key] === undefined) obj[key] = val;
      else if (Array.isArray(obj[key])) obj[key].push(val);
      else obj[key] = [obj[key], val];
    }
  };
  return block();
}

export function vdfGet(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  const want = String(key).toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === want) return obj[k];
  return null;
}
