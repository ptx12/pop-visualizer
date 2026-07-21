import { LIMITS, cap } from './limits.js';
import { readFileSync } from 'node:fs';

let wasm = null;
let wasmTried = false;

function vtfWasm() {
  if (wasmTried) return wasm;
  wasmTried = true;
  try {
    const url = new URL('./vtfkernel.wasm', import.meta.url);
    const bytes = readFileSync(url);
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    wasm = inst.exports;
  } catch {
    wasm = null;
  }
  return wasm;
}

export function vtfWasmReady() {
  return !!vtfWasm();
}

const FMT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, I8: 5, IA88: 6, A8: 8,
  ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, DXT1A: 20
};

function bytesPerPixel(fmt) {
  switch (fmt) {
    case FMT.RGBA8888: case FMT.ABGR8888: case FMT.ARGB8888: case FMT.BGRA8888: case FMT.BGRX8888: return 4;
    case FMT.RGB888: case FMT.BGR888: return 3;
    case FMT.IA88: return 2;
    case FMT.I8: case FMT.A8: return 1;
    default: return 0;
  }
}

function mipSize(w, h, fmt) {
  if (fmt === FMT.DXT1 || fmt === FMT.DXT1A) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fmt === FMT.DXT3 || fmt === FMT.DXT5) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  return w * h * bytesPerPixel(fmt);
}

function decode565(c) {
  const r = ((c >> 11) & 31) * 255 / 31 | 0;
  const g = ((c >> 5) & 63) * 255 / 63 | 0;
  const b = (c & 31) * 255 / 31 | 0;
  return [r, g, b];
}

function decodeDXTColor(buf, off, out, w, h, bx, by, alphaFromDXT1) {
  const c0 = buf.readUInt16LE(off);
  const c1 = buf.readUInt16LE(off + 2);
  const bits = buf.readUInt32LE(off + 4);
  const p0 = decode565(c0);
  const p1 = decode565(c1);
  const palette = [p0, p1];
  if (c0 > c1 || !alphaFromDXT1) {
    palette.push([(2 * p0[0] + p1[0]) / 3 | 0, (2 * p0[1] + p1[1]) / 3 | 0, (2 * p0[2] + p1[2]) / 3 | 0]);
    palette.push([(p0[0] + 2 * p1[0]) / 3 | 0, (p0[1] + 2 * p1[1]) / 3 | 0, (p0[2] + 2 * p1[2]) / 3 | 0]);
  } else {
    palette.push([(p0[0] + p1[0]) / 2 | 0, (p0[1] + p1[1]) / 2 | 0, (p0[2] + p1[2]) / 2 | 0]);
    palette.push([0, 0, 0]);
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx + px, y = by + py;
      if (x >= w || y >= h) continue;
      const idx = (bits >> ((py * 4 + px) * 2)) & 3;
      const o = (y * w + x) * 4;
      out[o] = palette[idx][0];
      out[o + 1] = palette[idx][1];
      out[o + 2] = palette[idx][2];
      if (alphaFromDXT1) out[o + 3] = (idx === 3 && !(c0 > c1)) ? 0 : 255;
    }
  }
}

function decodeDXT5Alpha(buf, off, out, w, h, bx, by) {
  const a0 = buf[off];
  const a1 = buf[off + 1];
  const pal = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0);
  } else {
    for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0);
    pal.push(0, 255);
  }
  let lo = buf.readUInt32LE(off + 2);
  let hi = buf.readUInt16LE(off + 6);
  for (let i = 0; i < 16; i++) {
    let code;
    if (i < 10) code = (lo >>> (i * 3)) & 7;
    else if (i === 10) code = ((lo >>> 30) | (hi << 2)) & 7;
    else code = (hi >>> (i * 3 - 32)) & 7;
    const x = bx + (i % 4), y = by + (i / 4 | 0);
    if (x >= w || y >= h) continue;
    out[(y * w + x) * 4 + 3] = pal[code];
  }
}

function decodeDXT3Alpha(buf, off, out, w, h, bx, by) {
  for (let i = 0; i < 16; i++) {
    const nib = (buf[off + (i >> 1)] >> ((i & 1) * 4)) & 15;
    const x = bx + (i % 4), y = by + (i / 4 | 0);
    if (x >= w || y >= h) continue;
    out[(y * w + x) * 4 + 3] = nib * 17;
  }
}

function decodeImage(buf, off, w, h, fmt) {
  const m = vtfWasm();
  if (m) {
    const out = decodeImageWasm(m, buf, off, w, h, fmt);
    if (out) return out;
  }
  return decodeImageJs(buf, off, w, h, fmt);
}

function decodeImageWasm(m, buf, off, w, h, fmt) {
  const outLen = w * h * 4;
  const need = mipSize(w, h, fmt);
  const src = buf.subarray(off, Math.min(buf.length, off + need));
  if (!src.length) return null;
  const srcPtr = m.reserve(src.length, outLen);
  if (!srcPtr) return null;
  new Uint8Array(m.memory.buffer, srcPtr, src.length).set(src);
  if (!m.decode_image(src.length, 0, w, h, fmt)) return null;
  return new Uint8Array(new Uint8Array(m.memory.buffer, m.out_addr(), outLen));
}

export function decodeImageJs(buf, off, w, h, fmt) {
  const out = new Uint8Array(w * h * 4);
  out.fill(255);
  if (fmt === FMT.DXT1 || fmt === FMT.DXT1A || fmt === FMT.DXT3 || fmt === FMT.DXT5) {
    const bw = Math.max(1, Math.ceil(w / 4));
    const bh = Math.max(1, Math.ceil(h / 4));
    const blockBytes = (fmt === FMT.DXT1 || fmt === FMT.DXT1A) ? 8 : 16;
    let p = off;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        if (fmt === FMT.DXT5) {
          decodeDXT5Alpha(buf, p, out, w, h, bx * 4, by * 4);
          decodeDXTColor(buf, p + 8, out, w, h, bx * 4, by * 4, false);
        } else if (fmt === FMT.DXT3) {
          decodeDXT3Alpha(buf, p, out, w, h, bx * 4, by * 4);
          decodeDXTColor(buf, p + 8, out, w, h, bx * 4, by * 4, false);
        } else {
          decodeDXTColor(buf, p, out, w, h, bx * 4, by * 4, true);
        }
        p += blockBytes;
      }
    }
    return out;
  }
  const bpp = bytesPerPixel(fmt);
  if (!bpp) throw new Error('unsupported VTF format ' + fmt);
  for (let i = 0; i < w * h; i++) {
    const s = off + i * bpp;
    const d = i * 4;
    switch (fmt) {
      case FMT.RGBA8888: out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; out[d + 3] = buf[s + 3]; break;
      case FMT.ABGR8888: out[d] = buf[s + 3]; out[d + 1] = buf[s + 2]; out[d + 2] = buf[s + 1]; out[d + 3] = buf[s]; break;
      case FMT.ARGB8888: out[d] = buf[s + 1]; out[d + 1] = buf[s + 2]; out[d + 2] = buf[s + 3]; out[d + 3] = buf[s]; break;
      case FMT.BGRA8888: out[d] = buf[s + 2]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s]; out[d + 3] = buf[s + 3]; break;
      case FMT.BGRX8888: out[d] = buf[s + 2]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s]; break;
      case FMT.RGB888: out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; break;
      case FMT.BGR888: out[d] = buf[s + 2]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s]; break;
      case FMT.I8: out[d] = out[d + 1] = out[d + 2] = buf[s]; break;
      case FMT.IA88: out[d] = out[d + 1] = out[d + 2] = buf[s]; out[d + 3] = buf[s + 1]; break;
      case FMT.A8: out[d] = out[d + 1] = out[d + 2] = 255; out[d + 3] = buf[s]; break;
    }
  }
  return out;
}

export function decodeVTF(buf) {
  if (buf.length < 80 || buf.toString('ascii', 0, 3) !== 'VTF') throw new Error('not a VTF');
  const verMajor = buf.readUInt32LE(4);
  const verMinor = buf.readUInt32LE(8);
  const headerSize = buf.readUInt32LE(12);
  const width = buf.readUInt16LE(16);
  const height = buf.readUInt16LE(18);
  if (width < 1 || height < 1) throw new Error('VTF has zero dimension');
  cap(width, LIMITS.vtfDim, 'VTF width');
  cap(height, LIMITS.vtfDim, 'VTF height');
  const frames = buf.readUInt16LE(24);
  const highFmt = buf.readInt32LE(52);
  const mipCount = buf[56];
  const lowFmt = buf.readInt32LE(57);
  const lowW = buf[61];
  const lowH = buf[62];

  let dataStart = -1;
  if (verMajor > 7 || (verMajor === 7 && verMinor >= 3)) {
    const numResources = cap(buf.readUInt32LE(68), LIMITS.vtfResources, 'VTF resources');
    for (let i = 0; i < numResources; i++) {
      const e = 80 + i * 8;
      if (e + 8 > buf.length) break;
      if (buf[e] === 0x30 && buf[e + 1] === 0 && buf[e + 2] === 0) {
        dataStart = buf.readUInt32LE(e + 4);
        break;
      }
    }
    if (dataStart < 0) throw new Error('no highres resource');
  } else {
    dataStart = headerSize;
    if (lowFmt !== -1 && lowW > 0 && lowH > 0) dataStart += mipSize(lowW, lowH, lowFmt);
  }

  let offset = dataStart;
  for (let m = mipCount - 1; m >= 1; m--) {
    const mw = Math.max(1, width >> m);
    const mh = Math.max(1, height >> m);
    offset += mipSize(mw, mh, highFmt) * Math.max(1, frames);
  }

  const rgba = decodeImage(buf, offset, width, height, highFmt);
  return { width, height, rgba };
}
