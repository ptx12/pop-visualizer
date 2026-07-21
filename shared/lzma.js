import { LIMITS, cap } from './limits.js';

export function lzmaDecode(props, src, outSize) {
  cap(outSize, LIMITS.lzmaOut, 'lzma output');
  if (src.length < 5) throw new Error('lzma: source too short');
  if (outSize > src.length * LIMITS.lzmaRatio) throw new Error('lzma: decompression ratio too high');
  let d = props[0];
  if (d >= 9 * 5 * 5) throw new Error('bad lzma props');
  const lc = d % 9;
  d = (d / 9) | 0;
  const lp = d % 5;
  const pb = (d / 5) | 0;

  const out = Buffer.alloc(outSize);
  let outPos = 0;
  let srcPos = 0;

  let range = 0xFFFFFFFF >>> 0;
  let code = 0;
  srcPos++;
  for (let i = 0; i < 4; i++) code = ((code << 8) | src[srcPos++]) >>> 0;

  const kNumStates = 12;
  const probsLit = new Uint16Array(0x300 << (lc + lp)).fill(1024);
  const isMatch = new Uint16Array(kNumStates << 4).fill(1024);
  const isRep = new Uint16Array(kNumStates).fill(1024);
  const isRepG0 = new Uint16Array(kNumStates).fill(1024);
  const isRepG1 = new Uint16Array(kNumStates).fill(1024);
  const isRepG2 = new Uint16Array(kNumStates).fill(1024);
  const isRep0Long = new Uint16Array(kNumStates << 4).fill(1024);
  const posSlot = [new Uint16Array(64).fill(1024), new Uint16Array(64).fill(1024), new Uint16Array(64).fill(1024), new Uint16Array(64).fill(1024)];
  const specPos = new Uint16Array(115).fill(1024);
  const align = new Uint16Array(16).fill(1024);

  function makeLen() {
    return {
      choice: new Uint16Array(2).fill(1024),
      low: Array.from({ length: 16 }, () => new Uint16Array(8).fill(1024)),
      mid: Array.from({ length: 16 }, () => new Uint16Array(8).fill(1024)),
      high: new Uint16Array(256).fill(1024)
    };
  }
  const lenCoder = makeLen();
  const repLenCoder = makeLen();

  function normalize() {
    if (range < 0x1000000) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | (src[srcPos++] | 0)) >>> 0;
    }
  }

  function decodeBit(probs, idx) {
    const bound = (range >>> 11) * probs[idx];
    let bit;
    if ((code >>> 0) < bound) {
      range = bound >>> 0;
      probs[idx] += (2048 - probs[idx]) >> 5;
      bit = 0;
    } else {
      code = (code - bound) >>> 0;
      range = (range - bound) >>> 0;
      probs[idx] -= probs[idx] >> 5;
      bit = 1;
    }
    normalize();
    return bit;
  }

  function treeDecode(probs, bits) {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | decodeBit(probs, m);
    return m - (1 << bits);
  }

  function reverseTreeDecode(probs, bits, base = 0) {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = decodeBit(probs, base + m);
      m = (m << 1) | b;
      sym |= b << i;
    }
    return sym;
  }

  function directBits(bits) {
    let res = 0;
    for (let i = 0; i < bits; i++) {
      range = range >>> 1;
      code = (code - range) >>> 0;
      const t = (0 - (code >>> 31)) >>> 0;
      code = (code + (range & t)) >>> 0;
      res = ((res << 1) + (t + 1)) >>> 0;
      normalize();
    }
    return res >>> 0;
  }

  function lenDecode(coder, posState) {
    if (!decodeBit(coder.choice, 0)) return treeDecode(coder.low[posState], 3);
    if (!decodeBit(coder.choice, 1)) return 8 + treeDecode(coder.mid[posState], 3);
    return 16 + treeDecode(coder.high, 8);
  }

  let state = 0;
  let rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;

  while (outPos < outSize) {
    const posState = outPos & pbMask;
    if (!decodeBit(isMatch, (state << 4) + posState)) {
      const prevByte = outPos > 0 ? out[outPos - 1] : 0;
      const litState = ((outPos & lpMask) << lc) + (prevByte >> (8 - lc));
      const base = 0x300 * litState;
      let symbol = 1;
      if (state < 7) {
        while (symbol < 0x100) symbol = (symbol << 1) | decodeBit(probsLit, base + symbol);
      } else {
        let matchByte = out[outPos - rep0 - 1];
        while (symbol < 0x100) {
          const matchBit = (matchByte >> 7) & 1;
          matchByte = (matchByte << 1) & 0xFF;
          const bit = decodeBit(probsLit, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) {
            while (symbol < 0x100) symbol = (symbol << 1) | decodeBit(probsLit, base + symbol);
            break;
          }
        }
      }
      out[outPos++] = symbol & 0xFF;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (decodeBit(isRep, state)) {
      if (!decodeBit(isRepG0, state)) {
        if (!decodeBit(isRep0Long, (state << 4) + posState)) {
          state = state < 7 ? 9 : 11;
          out[outPos] = out[outPos - rep0 - 1];
          outPos++;
          continue;
        }
      } else {
        let dist;
        if (!decodeBit(isRepG1, state)) {
          dist = rep1;
        } else {
          if (!decodeBit(isRepG2, state)) {
            dist = rep2;
          } else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = 2 + lenDecode(repLenCoder, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = 2 + lenDecode(lenCoder, posState);
      state = state < 7 ? 7 : 10;
      const lenToPos = len < 6 ? len - 2 : 3;
      const slot = treeDecode(posSlot[lenToPos], 6);
      if (slot < 4) {
        rep0 = slot;
      } else {
        const numDirect = (slot >> 1) - 1;
        rep0 = ((2 | (slot & 1)) << numDirect) >>> 0;
        if (slot < 14) {
          rep0 = (rep0 + reverseTreeDecode(specPos, numDirect, rep0 - slot - 1)) >>> 0;
        } else {
          rep0 = (rep0 + (directBits(numDirect - 4) << 4)) >>> 0;
          rep0 = (rep0 + reverseTreeDecode(align, 4)) >>> 0;
          if (rep0 === 0xFFFFFFFF) break;
        }
      }
    }
    if (rep0 >= outPos || len > outSize - outPos) {
      if (rep0 >= outPos) throw new Error('lzma: bad distance');
      len = outSize - outPos;
    }
    const from = outPos - rep0 - 1;
    for (let i = 0; i < len; i++) out[outPos + i] = out[from + i];
    outPos += len;
  }
  return out;
}

export function decodeValveLZMA(buf) {
  if (buf.length < 17 || buf.toString('ascii', 0, 4) !== 'LZMA') return null;
  const actualSize = buf.readUInt32LE(4);
  const lzmaSize = buf.readUInt32LE(8);
  if (17 + lzmaSize > buf.length) throw new Error('lzma: declared size exceeds buffer');
  const props = buf.subarray(12, 17);
  const src = buf.subarray(17, 17 + lzmaSize);
  return lzmaDecode(props, src, actualSize);
}
