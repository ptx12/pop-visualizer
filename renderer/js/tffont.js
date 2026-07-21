import { native } from './native.js';
import { getTFPath } from './icons.js';

let started = false;

function toArrayBuffer(bytes) {
  if (!bytes) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.byteLength) return null;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

async function addFace(name, bytes) {
  const buf = toArrayBuffer(bytes);
  if (!buf || typeof FontFace === 'undefined') return false;
  const face = new FontFace(name, buf);
  await face.load();
  document.fonts.add(face);
  return true;
}

export async function loadTFFonts() {
  if (started || !native.isElectron || !window.popnative || !window.popnative.tfFonts) return false;
  started = true;
  try {
    const data = await window.popnative.tfFonts(await getTFPath());
    if (!data) return false;
    const got = [];
    if (await addFace('TF2Build', data.build)) got.push('build');
    if (await addFace('TF2Secondary', data.secondary)) got.push('secondary');
    if (!got.length) return false;
    document.body.classList.add('tf-font');
    return true;
  } catch {
    return false;
  }
}
