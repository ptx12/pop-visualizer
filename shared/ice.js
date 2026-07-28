const SMOD = [
  [333, 313, 505, 369],
  [379, 375, 319, 391],
  [361, 445, 451, 397],
  [397, 425, 395, 505]
];

const SXOR = [
  [0x83, 0x85, 0x9b, 0xcd],
  [0xcc, 0xa7, 0xad, 0x41],
  [0x4b, 0x2e, 0xd4, 0x33],
  [0xea, 0xcb, 0x2e, 0x04]
];

const PBOX = [
  0x00000001, 0x00000080, 0x00000400, 0x00002000,
  0x00080000, 0x00200000, 0x01000000, 0x40000000,
  0x00000008, 0x00000020, 0x00000100, 0x00004000,
  0x00010000, 0x00800000, 0x04000000, 0x20000000,
  0x00000004, 0x00000010, 0x00000200, 0x00008000,
  0x00020000, 0x00400000, 0x08000000, 0x10000000,
  0x00000002, 0x00000040, 0x00000800, 0x00001000,
  0x00040000, 0x00100000, 0x02000000, 0x80000000
];

const KEYROT = [0, 1, 2, 3, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 0, 2];

function gfMult(a, b, m) {
  let res = 0;
  while (b) {
    if (b & 1) res ^= a;
    a <<= 1;
    b >>= 1;
    if (a >= 256) a ^= m;
  }
  return res;
}

function gfExp7(b, m) {
  if (b === 0) return 0;
  let x = gfMult(b, b, m);
  x = gfMult(b, x, m);
  x = gfMult(x, x, m);
  return gfMult(b, x, m);
}

function perm32(x) {
  let res = 0;
  let i = 0;
  while (x) {
    if (x & 1) res |= PBOX[i];
    i++;
    x >>>= 1;
  }
  return res >>> 0;
}

let sbox = null;

function initSboxes() {
  if (sbox) return sbox;
  sbox = [new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024)];
  for (let i = 0; i < 1024; i++) {
    const col = (i >> 1) & 0xff;
    const row = (i & 0x1) | ((i & 0x200) >> 8);
    sbox[0][i] = perm32(gfExp7(col ^ SXOR[0][row], SMOD[0][row]) * 0x1000000);
    sbox[1][i] = perm32(gfExp7(col ^ SXOR[1][row], SMOD[1][row]) * 0x10000);
    sbox[2][i] = perm32(gfExp7(col ^ SXOR[2][row], SMOD[2][row]) * 0x100);
    sbox[3][i] = perm32(gfExp7(col ^ SXOR[3][row], SMOD[3][row]));
  }
  return sbox;
}

function iceF(p, sk) {
  const tl = ((p >>> 16) & 0x3ff) | ((((p >>> 14) | (p << 18)) & 0xffc00) >>> 0);
  const tr = (p & 0x3ff) | ((p << 2) & 0xffc00);
  let al = (sk[2] & (tl ^ tr)) >>> 0;
  const ar = ((al ^ tr) ^ sk[1]) >>> 0;
  al = ((al ^ tl) ^ sk[0]) >>> 0;
  const s = initSboxes();
  return (s[0][al >>> 10] | s[1][al & 0x3ff] | s[2][ar >>> 10] | s[3][ar & 0x3ff]) >>> 0;
}

function scheduleBuild(sched, kb, n, keyrot, rotOfs) {
  for (let i = 0; i < 8; i++) {
    const kr = keyrot[rotOfs + i];
    const isk = sched[n + i];
    isk[0] = 0; isk[1] = 0; isk[2] = 0;
    for (let j = 0; j < 15; j++) {
      const si = j % 3;
      for (let k = 0; k < 4; k++) {
        const ki = (kr + k) & 3;
        const bit = kb[ki] & 1;
        isk[si] = (((isk[si] << 1) >>> 0) | bit) >>> 0;
        kb[ki] = ((kb[ki] >>> 1) | ((bit ^ 1) << 15)) & 0xffff;
      }
    }
  }
}

export function iceKeySchedule(key, level = 0) {
  const size = level < 1 ? 1 : level;
  const rounds = level < 1 ? 8 : level * 16;
  const sched = [];
  for (let i = 0; i < rounds; i++) sched.push(new Uint32Array(3));
  if (rounds === 8) {
    const kb = new Uint16Array(4);
    for (let i = 0; i < 4; i++) kb[3 - i] = ((key[i * 2] << 8) | key[i * 2 + 1]) & 0xffff;
    scheduleBuild(sched, kb, 0, KEYROT, 0);
    return { sched, rounds };
  }
  for (let i = 0; i < size; i++) {
    const kb = new Uint16Array(4);
    for (let j = 0; j < 4; j++) kb[3 - j] = ((key[i * 8 + j * 2] << 8) | key[i * 8 + j * 2 + 1]) & 0xffff;
    scheduleBuild(sched, kb, i * 8, KEYROT, 0);
    scheduleBuild(sched, kb, rounds - 8 - i * 8, KEYROT, 8);
  }
  return { sched, rounds };
}

export function iceDecryptBlock(ks, src, srcOfs, dst, dstOfs) {
  let l = ((src[srcOfs] << 24) | (src[srcOfs + 1] << 16) | (src[srcOfs + 2] << 8) | src[srcOfs + 3]) >>> 0;
  let r = ((src[srcOfs + 4] << 24) | (src[srcOfs + 5] << 16) | (src[srcOfs + 6] << 8) | src[srcOfs + 7]) >>> 0;
  for (let i = ks.rounds - 1; i > 0; i -= 2) {
    l = (l ^ iceF(r, ks.sched[i])) >>> 0;
    r = (r ^ iceF(l, ks.sched[i - 1])) >>> 0;
  }
  for (let i = 0; i < 4; i++) {
    dst[dstOfs + 3 - i] = r & 0xff;
    dst[dstOfs + 7 - i] = l & 0xff;
    r >>>= 8;
    l >>>= 8;
  }
}

export function decodeICE(buf, key) {
  const k = typeof key === 'string' ? Uint8Array.from(key, c => c.charCodeAt(0) & 0xff) : key;
  if (!k || k.length < 8) return buf;
  const ks = iceKeySchedule(k, 0);
  const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const out = new Uint8Array(src.length);
  let i = 0;
  for (; i + 8 <= src.length; i += 8) iceDecryptBlock(ks, src, i, out, i);
  for (; i < src.length; i++) out[i] = src[i];
  return out;
}
