import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

let electronBin = null;
try { electronBin = require('electron'); } catch { electronBin = null; }
if (typeof electronBin !== 'string' || !existsSync(electronBin)) {
  console.log('skip smoke tests: electron is not installed');
  process.exit(0);
}
if (!existsSync(join(repo, 'vanilla', 'mvm_decoy_advanced.pop'))) {
  console.log('skip smoke tests: shipped popfiles missing');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'popvis-smoke-'));

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function render(name, args, timeoutMs) {
  return new Promise(resolve => {
    const out = join(work, name + '.png');
    const child = spawn(electronBin, ['.', '--headless', '--screenshot', out, ...args],
      { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const buf = existsSync(out) ? readFileSync(out) : null;
      resolve({ code, stdout, stderr, buf,
        hash: buf ? createHash('sha1').update(buf).digest('hex') : null,
        size: buf ? pngSize(buf) : null });
    });
  });
}

const baseline = await render('baseline', [], 120000);
check('the app boots and renders with no file open', baseline.code === 0 && !!baseline.buf,
  `exit ${baseline.code}, ${baseline.buf ? baseline.buf.length + ' bytes' : 'no image'}`);
if (!baseline.buf) {
  console.log(`\n${pass} passed, ${fail} failed`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
check('the window renders at a real size',
  baseline.size && baseline.size.width > 400 && baseline.size.height > 300,
  JSON.stringify(baseline.size));

const scenarios = [
  { name: 'overview', args: ['--open', 'vanilla/mvm_decoy_advanced.pop'], label: 'the overview opens a popfile' },
  { name: 'wave', args: ['--open', 'vanilla/mvm_decoy_advanced.pop', '--wave', '5'], label: 'a wave timeline draws' },
  { name: 'map', args: ['--open', 'vanilla/mvm_decoy_advanced.pop', '--wave', '5', '--view', 'map', '--time', '30', '--wait', '60000'], label: 'the map view draws robots' }
];

const hashes = new Map([['baseline', baseline.hash]]);
for (const s of scenarios) {
  const r = await render(s.name, s.args, 240000);
  check(s.label, r.code === 0 && !!r.buf && r.hash !== baseline.hash,
    r.buf ? (r.hash === baseline.hash ? 'rendered the same pixels as the empty app' : `exit ${r.code}`) : `exit ${r.code}, no image`);
  if (r.buf) hashes.set(s.name, r.hash);
}

check('each view renders something different from the others',
  new Set(hashes.values()).size === hashes.size,
  `${new Set(hashes.values()).size} distinct renders from ${hashes.size} views`);

rmSync(work, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
