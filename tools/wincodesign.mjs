import { existsSync, mkdirSync, readdirSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { get } from 'node:https';
import path from 'node:path';

const VERSION = '2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${VERSION}/winCodeSign-${VERSION}.7z`;

if (process.platform !== 'win32') process.exit(0);

const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
const target = path.join(cache, `winCodeSign-${VERSION}`);
const sevenZip = path.resolve('node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

if (existsSync(path.join(target, 'rcedit-x64.exe'))) {
  cleanLeftovers();
  process.exit(0);
}

if (!existsSync(sevenZip)) {
  console.error('7za.exe not found — run npm install first');
  process.exit(1);
}

mkdirSync(cache, { recursive: true });

const archive = findArchive() || (await download());
if (!archive) {
  console.error('could not obtain winCodeSign archive');
  process.exit(1);
}

console.log('preparing winCodeSign cache (skipping macOS symlinks Windows cannot create)');
rmSync(target, { recursive: true, force: true });
execFileSync(sevenZip, ['x', archive, `-o${target}`, '-x!darwin*', '-y'], { stdio: 'ignore' });

if (!existsSync(path.join(target, 'rcedit-x64.exe'))) {
  console.error('extraction did not produce rcedit-x64.exe');
  process.exit(1);
}

cleanLeftovers();
console.log('winCodeSign cache ready at ' + target);

function findArchive() {
  let best = null;
  for (const name of readdirSync(cache)) {
    if (!name.endsWith('.7z')) continue;
    const full = path.join(cache, name);
    const size = statSync(full).size;
    if (size > 5_000_000 && (!best || size > best.size)) best = { full, size };
  }
  return best ? best.full : null;
}

function download() {
  const dest = path.join(cache, `winCodeSign-${VERSION}.7z`);
  console.log('downloading ' + URL);
  return new Promise(resolve => {
    const fetch = (url, redirects = 5) => {
      get(url, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          fetch(new URL(res.headers.location, url).href, redirects - 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    };
    fetch(URL);
  });
}

function cleanLeftovers() {
  let freed = 0;
  for (const name of readdirSync(cache)) {
    if (!/^\d+(\.7z)?$/.test(name)) continue;
    const full = path.join(cache, name);
    try {
      freed += dirSize(full);
      rmSync(full, { recursive: true, force: true });
    } catch {}
  }
  if (freed > 1e6) console.log('removed ' + (freed / 1e6).toFixed(0) + ' MB of failed-extraction leftovers');
}

function dirSize(p) {
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    return readdirSync(p).reduce((n, c) => n + dirSize(path.join(p, c)), 0);
  } catch {
    return 0;
  }
}
