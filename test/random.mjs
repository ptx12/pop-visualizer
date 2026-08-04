import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const wasmPath = new URL('../wasm/simcore/build/ents.wasm', import.meta.url);
if (!existsSync(wasmPath)) {
  console.log('skip random tests: ents.wasm not built (run wasm/simcore/build.sh)');
  process.exit(0);
}

let ex = null;
const mod = await WebAssembly.instantiate(readFileSync(wasmPath), {
  env: {
      emscripten_notify_memory_growth: () => {},
      __syscall_getcwd(buf, size) {
        if (!buf || size < 2) return -34;
        const bytes = new Uint8Array(ex.memory.buffer);
        bytes[buf] = 47;
        bytes[buf + 1] = 0;
        return 2;
      },
    },
  wasi_snapshot_preview1: {
    proc_exit: () => {},
    fd_write(fd, iov, iovcnt, pnum) {
      const view = new DataView(ex.memory.buffer);
      let total = 0;
      for (let i = 0; i < iovcnt; i++) total += view.getUint32(iov + i * 8 + 4, true);
      view.setUint32(pnum, total, true);
      return 0;
    },
    fd_close: () => 0, fd_seek: () => 0,
    environ_sizes_get: () => 0, environ_get: () => 0, clock_time_get: () => 0,
  },
});
ex = mod.instance.exports;
if (ex._initialize) ex._initialize();

const IA = 16807, IM = 2147483647, IQ = 127773, IR = 2836, NTAB = 32;
const NDIV = 1 + ((IM - 1) / NTAB | 0);
const AM = 1.0 / IM;
const RNMX = 1.0 - 1.2e-7;
const MAX_RANDOM_RANGE = 0x7FFFFFFF;

function makeStream(seed) {
  let idum = seed < 0 ? seed : -seed;
  let iy = 0;
  const iv = new Array(NTAB).fill(0);
  return function next() {
    let j, k;
    if (idum <= 0 || !iy) {
      if (-idum < 1) idum = 1; else idum = -idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = (idum / IQ) | 0;
        idum = IA * (idum - k * IQ) - IR * k;
        if (idum < 0) idum += IM;
        if (j < NTAB) iv[j] = idum;
      }
      iy = iv[0];
    }
    k = (idum / IQ) | 0;
    idum = IA * (idum - k * IQ) - IR * k;
    if (idum < 0) idum += IM;
    j = (iy / NDIV) | 0;
    iy = iv[j];
    iv[j] = idum;
    return iy;
  };
}

const f32 = Math.fround;

function randomFloat(next, low, high) {
  let fl = f32(AM * next());
  if (fl > RNMX) fl = f32(RNMX);
  return f32(f32(fl * f32(high - low)) + low);
}

function randomInt(next, low, high) {
  const x = 1 + high - low;
  if (x <= 1 || MAX_RANDOM_RANGE < x - 1) return low;
  const maxAcceptable = MAX_RANDOM_RANGE - ((MAX_RANDOM_RANGE + 1) % x);
  let n = 0;
  do { n = next(); } while (n > maxAcceptable);
  return low + (n % x);
}

const SEEDS = [0, 1, 7, 42, 1337, 0x7fffffff, -5];

let rawMatch = 0, rawTotal = 0;
for (const seed of SEEDS) {
  ex.sim_ents_random_seed(seed);
  const next = makeStream(seed);
  for (let i = 0; i < 2000; i++) {
    rawTotal++;
    if (ex.sim_ents_random_float(0, 1) === randomFloat(next, 0, 1)) rawMatch++;
  }
}
check("RandomFloat matches Valve's ran1 bit for bit across seeds",
  rawMatch === rawTotal, `${rawMatch}/${rawTotal}`);

let intMatch = 0, intTotal = 0;
const RANGES = [[0, 1], [0, 9], [1, 100], [-50, 50], [0, 0x3fffffff]];
for (const seed of SEEDS) {
  ex.sim_ents_random_seed(seed);
  const next = makeStream(seed);
  for (let i = 0; i < 400; i++) {
    for (const [lo, hi] of RANGES) {
      intTotal++;
      if (ex.sim_ents_random_int(lo, hi) === randomInt(next, lo, hi)) intMatch++;
    }
  }
}
check('RandomInt matches the same stream through the rejection loop',
  intMatch === intTotal, `${intMatch}/${intTotal}`);

ex.sim_ents_random_seed(12345);
const a = [];
for (let i = 0; i < 64; i++) a.push(ex.sim_ents_random_float(0, 1));
ex.sim_ents_random_seed(12345);
const b = [];
for (let i = 0; i < 64; i++) b.push(ex.sim_ents_random_float(0, 1));
check('reseeding replays the same sequence', a.every((v, i) => v === b[i]));

ex.sim_ents_random_seed(1);
let low = 1, high = 0, sum = 0;
const N = 200000;
for (let i = 0; i < N; i++) {
  const v = ex.sim_ents_random_float(0, 1);
  if (v < low) low = v;
  if (v > high) high = v;
  sum += v;
}
check('RandomFloat stays inside [0,1)', low >= 0 && high < 1,
  `${low.toExponential(3)} .. ${high}`);
check('the mean of 200k draws is 0.5 to three places',
  Math.abs(sum / N - 0.5) < 5e-4, (sum / N).toFixed(6));

ex.sim_ents_random_seed(9);
const buckets = new Int32Array(10);
for (let i = 0; i < 100000; i++) buckets[ex.sim_ents_random_int(0, 9)]++;
const min = Math.min(...buckets), max = Math.max(...buckets);
check('RandomInt covers every value in range without bias',
  min > 9000 && max < 11000, `${min}..${max} per 10000`);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
