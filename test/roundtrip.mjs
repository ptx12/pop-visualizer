import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse, serialize, stripForCompare, stripRaw } from '../renderer/js/kv.js';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const roots = [
  join(repo, 'vanilla'),
  join(repo, 'base'),
  repo,
  join(repo, '..', 'RafMod missions'),
  join(repo, '..', 'RafMod missions', 'scripts and other stuff'),
  join(repo, '..', 'RafMod missions', 'MA'),
  join(repo, '..', 'RafMod missions', 'Vanilla Missions'),
  join(repo, '..', 'missions'),
  join(repo, '..')
];

function diffPath(a, b, path = '$') {
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (typeof a !== 'object' || a === null) return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: len ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diffPath(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = diffPath(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function firstByteDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

let pass = 0, byteFail = 0, semFail = 0, errors = 0;
const seen = new Set();

for (const root of roots) {
  let entries;
  try { entries = readdirSync(root); } catch { continue; }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.pop')) continue;
    const full = join(root, name);
    if (seen.has(full.toLowerCase())) continue;
    seen.add(full.toLowerCase());
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile() || st.size === 0) continue;
    try {
      const text = readFileSync(full, 'latin1');
      const doc1 = parse(text);
      const out = serialize(doc1);
      let ok = true;
      if (out !== text) {
        byteFail++;
        ok = false;
        const i = firstByteDiff(out, text);
        console.log(`BYTE ${name}: differs at offset ${i} (want ${JSON.stringify(text.slice(Math.max(0, i - 20), i + 20))}, got ${JSON.stringify(out.slice(Math.max(0, i - 20), i + 20))})`);
      }
      const want = stripForCompare(doc1);
      stripRaw(doc1);
      const gen = serialize(doc1);
      const doc2 = parse(gen);
      const d = diffPath(want, stripForCompare(doc2));
      if (d) {
        semFail++;
        ok = false;
        console.log(`SEM  ${name}: ${d}`);
      }
      if (ok) pass++;
    } catch (e) {
      errors++;
      console.log(`ERROR ${name}: ${e.message}`);
    }
  }
}

let diagFail = 0;
const diagCases = [
  ['unclosed block', readFileSync(join(repo, 'test', 'broken_sample.pop'), 'latin1'), d => d.some(x => x.severity === 'error' && /Unclosed block/.test(x.msg))],
  ['stray brace byte-exact', 'A\r\n{\r\n\tK\t1\r\n}\r\n}\r\n', d => d.some(x => /Stray closing/.test(x.msg)), true],
  ['unterminated quote', 'A\r\n{\r\n\tK\t"x\r\n}\r\n', d => d.some(x => x.severity === 'error' && /Unterminated/.test(x.msg))]
];
for (const [name, text, expect, wantByte] of diagCases) {
  const doc = parse(text);
  if (!expect(doc.diagnostics)) { diagFail++; console.log(`DIAG ${name}: expected diagnostic missing (${JSON.stringify(doc.diagnostics)})`); }
  if (wantByte && serialize(doc) !== text) { diagFail++; console.log(`DIAG ${name}: not byte-exact`); }
}

console.log(`\n${pass} passed (byte-exact + generated-path semantic), ${byteFail} byte diffs, ${semFail} semantic diffs, ${errors} errors, ${diagFail} diagnostic failures, ${seen.size} files`);
if (pass < 25) { console.log('FAIL: corpus too small — expected at least the bundled vanilla missions'); process.exit(1); }
if (byteFail || semFail || errors || diagFail) process.exit(1);
