let nextId = 1;

export function freshId() {
  return nextId++;
}

export function tokenize(text, diags = null) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let blankPending = false;
  let sawTokenOnLine = false;

  while (i < n) {
    const c = text[i];
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      if (!sawTokenOnLine && tokens.length > 0) blankPending = true;
      sawTokenOnLine = false;
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === ' ' || c === '﻿') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      let j = i + 2;
      while (j < n && text[j] !== '\n') j++;
      tokens.push({ t: 'comment', v: text.slice(i + 2, j).replace(/\r$/, ''), line, gap: blankPending, sol: !sawTokenOnLine, s: i, e: j });
      blankPending = false;
      sawTokenOnLine = true;
      i = j;
      continue;
    }
    if (c === '{') {
      tokens.push({ t: 'open', line, gap: blankPending, s: i, e: i + 1 });
      blankPending = false;
      sawTokenOnLine = true;
      i++;
      continue;
    }
    if (c === '}') {
      tokens.push({ t: 'close', line, gap: blankPending, s: i, e: i + 1 });
      blankPending = false;
      sawTokenOnLine = true;
      i++;
      continue;
    }
    if (c === '"') {
      const startLine = line;
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === '\n') line++;
        j++;
      }
      if (j >= n && diags) diags.push({ line: startLine, msg: 'Unterminated quoted string', severity: 'error' });
      tokens.push({ t: 'str', v: text.slice(i + 1, j), q: true, line, gap: blankPending, s: i, e: Math.min(j + 1, n) });
      blankPending = false;
      sawTokenOnLine = true;
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < n) {
      const d = text[j];
      if (d === ' ' || d === '\t' || d === '\n' || d === '\r' || d === '{' || d === '}' || d === '"') break;
      if (d === '/' && text[j + 1] === '/') break;
      j++;
    }
    tokens.push({ t: 'str', v: text.slice(i, j), q: false, line, gap: blankPending, s: i, e: j });
    blankPending = false;
    sawTokenOnLine = true;
    i = j;
  }
  return tokens;
}

function fpKV(n) {
  return JSON.stringify([n.key, n.value, n.cond ?? null, n.inline ?? null, n.pre ?? [], !!n.gap, !!n.keyQ, !!n.valueQ, !!n.danglingComment]);
}

function fpHead(n) {
  return JSON.stringify([n.key, !!n.keyQ, n.cond ?? null, n.inline ?? null, n.pre ?? [], !!n.gap, n.lead ?? []]);
}

function fpClose(n) {
  return JSON.stringify([n.closeInline ?? null]);
}

function fpBase(b) {
  return JSON.stringify([b.path, b.inline ?? null, b.pre ?? []]);
}

export function parse(text) {
  const diagnostics = [];
  const tokens = tokenize(text, diagnostics);
  const doc = {
    type: 'doc', bases: [], children: [], tail: [], diagnostics,
    eol: text.includes('\r\n') ? '\r\n' : (text.includes('\n') ? '\n' : '\r\n')
  };
  let pos = 0;
  let cur = 0;

  function peek(k = 0) { return tokens[pos + k]; }

  function lineEndAfter(idx) {
    const nl = text.indexOf('\n', idx);
    return nl === -1 ? text.length : nl + 1;
  }

  function takeRegionPrev() {
    const last = tokens[pos - 1];
    const le = lineEndAfter(last.e);
    const nxt = tokens[pos];
    const end = nxt && nxt.s < le ? last.e : le;
    const raw = text.slice(cur, end);
    cur = end;
    return raw;
  }

  function collectComments() {
    const pre = [];
    let gap = false;
    while (pos < tokens.length && tokens[pos].t === 'comment' && tokens[pos].sol) {
      if (tokens[pos].gap && pre.length === 0) gap = true;
      pre.push(tokens[pos].v);
      pos++;
    }
    return { pre, gap };
  }

  function takeInline(nodeLine) {
    if (pos < tokens.length && tokens[pos].t === 'comment' && !tokens[pos].sol && tokens[pos].line === nodeLine) {
      const v = tokens[pos].v;
      pos++;
      return v;
    }
    return null;
  }

  function parseNodes(children, depth) {
    while (pos < tokens.length) {
      const { pre, gap } = collectComments();
      const tok = peek();
      if (!tok) {
        if (pre.length) doc.tail.push(...pre);
        return false;
      }
      if (tok.t === 'close') {
        if (depth === 0) {
          pos++;
          diagnostics.push({ line: tok.line, msg: 'Stray closing brace', severity: 'warn' });
          children.push({ id: freshId(), type: 'junk', key: '', raw: takeRegionPrev() });
          continue;
        }
        if (pre.length) {
          const dn = { id: freshId(), type: 'kv', key: '', value: '', pre, inline: null, gap: false, danglingComment: true };
          dn.raw = takeRegionPrev();
          dn.f0 = fpKV(dn);
          children.push(dn);
        }
        return true;
      }
      if (tok.t === 'comment') {
        pos++;
        continue;
      }
      if (tok.t === 'str' && /^#(base|include)$/i.test(tok.v) && depth === 0) {
        pos++;
        const pathTok = peek();
        let p = '';
        if (pathTok && pathTok.t === 'str') { p = pathTok.v; pos++; }
        const inline = takeInline(tok.line);
        const b = { id: freshId(), path: p, pre, inline };
        b.raw = takeRegionPrev();
        b.f0 = fpBase(b);
        doc.bases.push(b);
        continue;
      }
      if (tok.t === 'str') {
        pos++;
        let cond = null;
        let inlineCandidate = null;
        const leadComments = [];
        let next = peek();
        if (next && next.t === 'str' && !next.q && /^\[[!$]/.test(next.v)) {
          cond = next.v;
          pos++;
          next = peek();
        }
        while (next && next.t === 'comment') {
          if (next.line === tok.line && inlineCandidate === null) inlineCandidate = next.v;
          else leadComments.push(next.v);
          pos++;
          next = peek();
        }
        if (next && next.t === 'open') {
          pos++;
          const block = { id: freshId(), type: 'block', key: tok.v, keyQ: tok.q, cond, pre, gap: gap || tok.gap, inline: inlineCandidate, lead: leadComments, children: [], line: tok.line };
          const openInline = takeInline(next.line);
          if (openInline) {
            if (!block.inline) block.inline = openInline;
            else block.lead.unshift(openInline);
          }
          block.rawHead = takeRegionPrev();
          block.f0 = fpHead(block);
          const closed = parseNodes(block.children, depth + 1);
          if (closed && pos < tokens.length && peek() && peek().t === 'close') {
            const closeLine = peek().line;
            pos++;
            const trail = takeInline(closeLine);
            if (trail) block.closeInline = trail;
            block.rawClose = takeRegionPrev();
            block.f1 = fpClose(block);
          } else {
            diagnostics.push({ line: tok.line, msg: `Unclosed block "${tok.v}"`, severity: 'error' });
          }
          children.push(block);
          continue;
        }
        if (next && next.t === 'str') {
          pos++;
          let vcond = null;
          const after = peek();
          if (after && after.t === 'str' && !after.q && /^\[[!$]/.test(after.v) && after.line === next.line) {
            vcond = after.v;
            pos++;
          }
          const kv = { id: freshId(), type: 'kv', key: tok.v, keyQ: tok.q, value: next.v, valueQ: next.q, cond: vcond, pre: pre.concat(leadComments), gap: gap || tok.gap, inline: inlineCandidate, line: tok.line };
          const vInline = takeInline(next.line);
          if (vInline && !kv.inline) kv.inline = vInline;
          kv.raw = takeRegionPrev();
          kv.f0 = fpKV(kv);
          children.push(kv);
          continue;
        }
        diagnostics.push({ line: tok.line, msg: `Key "${tok.v}" has no value`, severity: 'info' });
        const bare = { id: freshId(), type: 'kv', key: tok.v, keyQ: tok.q, value: '', valueQ: false, cond, pre: pre.concat(leadComments), gap: gap || tok.gap, inline: inlineCandidate, line: tok.line };
        bare.raw = takeRegionPrev();
        bare.f0 = fpKV(bare);
        children.push(bare);
        continue;
      }
      if (tok.t === 'open') {
        pos++;
        diagnostics.push({ line: tok.line, msg: 'Block without a key', severity: 'warn' });
        const block = { id: freshId(), type: 'block', key: '', keyQ: false, cond: null, pre, gap, inline: null, lead: [], children: [], line: tok.line };
        block.rawHead = takeRegionPrev();
        block.f0 = fpHead(block);
        const closed = parseNodes(block.children, depth + 1);
        if (closed && pos < tokens.length && peek() && peek().t === 'close') {
          pos++;
          block.rawClose = takeRegionPrev();
          block.f1 = fpClose(block);
        } else {
          diagnostics.push({ line: tok.line, msg: 'Unclosed block', severity: 'error' });
        }
        children.push(block);
        continue;
      }
      pos++;
    }
    if (depth > 0) return false;
    return true;
  }

  parseNodes(doc.children, 0);
  doc.tailRaw = cur < text.length ? text.slice(cur) : null;
  return doc;
}

function needsQuote(s) {
  if (s === '' || s == null) return true;
  return /[\s{}"']|\/\//.test(s);
}

function fmt(s, wasQuoted) {
  if (needsQuote(s)) return '"' + s + '"';
  if (wasQuoted) return '"' + s + '"';
  return s;
}

export function serialize(doc) {
  const eol = doc.eol || '\r\n';
  const chunks = [];
  let atNL = true;
  const pushRaw = s => {
    if (!s) return;
    chunks.push(s);
    atNL = s.endsWith('\n');
  };
  const pushLine = s => {
    if (!atNL) chunks.push(eol);
    chunks.push(s + eol);
    atNL = true;
  };

  function emitNode(node, indent) {
    if (node.type === 'junk') { pushRaw(node.raw); return; }
    const pad = '\t'.repeat(indent);
    if (node.type === 'kv') {
      if (node.raw != null && node.f0 === fpKV(node)) { pushRaw(node.raw); return; }
      if (node.gap) pushLine('');
      for (const c of node.pre || []) pushLine(pad + '//' + c);
      if (node.danglingComment) return;
      let line = pad + fmt(node.key, node.keyQ) + '\t' + fmt(node.value, node.valueQ);
      if (node.cond) line += ' ' + node.cond;
      if (node.inline) line += '\t//' + node.inline;
      pushLine(line);
      return;
    }
    if (node.rawHead != null && node.f0 === fpHead(node)) {
      pushRaw(node.rawHead);
    } else {
      if (node.gap) pushLine('');
      for (const c of node.pre || []) pushLine(pad + '//' + c);
      let head = pad + fmt(node.key, node.keyQ);
      if (node.cond) head += ' ' + node.cond;
      pushLine(head);
      pushLine(pad + '{' + (node.inline ? '\t//' + node.inline : ''));
      for (const c of node.lead || []) pushLine(pad + '\t//' + c);
    }
    for (const child of node.children) emitNode(child, indent + 1);
    if (node.rawClose != null && node.f1 === fpClose(node)) pushRaw(node.rawClose);
    else pushLine(pad + '}' + (node.closeInline ? '\t//' + node.closeInline : ''));
  }

  for (const b of doc.bases) {
    if (b.raw != null && b.f0 === fpBase(b)) { pushRaw(b.raw); continue; }
    for (const c of b.pre || []) pushLine('//' + c);
    pushLine('#base ' + (needsQuote(b.path) ? '"' + b.path + '"' : b.path) + (b.inline ? '\t//' + b.inline : ''));
  }
  for (const node of doc.children) emitNode(node, 0);
  if (doc.tailRaw != null) pushRaw(doc.tailRaw);
  else for (const c of doc.tail || []) pushLine('//' + c);
  return chunks.join('');
}

export function stripRaw(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'doc') {
    for (const b of node.bases) { delete b.raw; delete b.f0; }
    node.tailRaw = null;
    node.children.forEach(stripRaw);
    return node;
  }
  delete node.raw;
  delete node.rawHead;
  delete node.rawClose;
  delete node.f0;
  delete node.f1;
  if (node.children) node.children.forEach(stripRaw);
  return node;
}

export function makeKV(key, value) {
  return { id: freshId(), type: 'kv', key, value: String(value), keyQ: false, valueQ: needsQuote(String(value)), cond: null, pre: [], gap: false, inline: null };
}

export function makeBlock(key, children = []) {
  return { id: freshId(), type: 'block', key, keyQ: false, cond: null, pre: [], gap: false, inline: null, children };
}

export function cloneNode(node) {
  const copy = JSON.parse(JSON.stringify(node));
  (function reid(x) {
    x.id = freshId();
    if (x.children) x.children.forEach(reid);
  })(copy);
  return copy;
}

export function findAll(block, key) {
  const lower = key.toLowerCase();
  return (block.children || []).filter(c => c.key.toLowerCase() === lower);
}

export function findFirst(block, key) {
  const lower = key.toLowerCase();
  return (block.children || []).find(c => c.key.toLowerCase() === lower) || null;
}

export function getValue(block, key, fallback = null) {
  const node = findFirst(block, key);
  if (node && node.type === 'kv') return node.value;
  return fallback;
}

export function getNumber(block, key, fallback = 0) {
  const v = getValue(block, key, null);
  if (v === null) return fallback;
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : fallback;
}

export function setValue(block, key, value) {
  const node = findFirst(block, key);
  if (value === null || value === undefined || value === '') {
    if (node) block.children.splice(block.children.indexOf(node), 1);
    return;
  }
  const str = String(value);
  if (node && node.type === 'kv') {
    node.value = str;
    node.valueQ = node.valueQ || needsQuote(str);
  } else {
    block.children.push(makeKV(key, str));
  }
}

export function removeNode(parent, node) {
  const idx = parent.children.indexOf(node);
  if (idx >= 0) parent.children.splice(idx, 1);
}

export function stripForCompare(doc) {
  function walk(node) {
    if (node.type === 'kv') return { k: node.key.toLowerCase(), v: node.value };
    return { k: node.key.toLowerCase(), c: node.children.filter(x => !x.danglingComment && x.type !== 'junk').map(walk) };
  }
  return {
    bases: doc.bases.map(b => b.path.toLowerCase()),
    nodes: doc.children.filter(x => x.type !== 'junk').map(walk)
  };
}
