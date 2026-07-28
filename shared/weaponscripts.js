import { decodeICE } from './ice.js';
import { parseVDF, vdfGet } from './vdf.js';
import { readGameFile } from './gamefs.js';
import { normalizeRole } from './weaponrole.js';

const TF_SCRIPT_KEY = 'E2NcUkG2';

const caches = new Map();

function cacheFor(tfPath) {
  let c = caches.get(tfPath);
  if (!c) { c = { roles: new Map() }; caches.set(tfPath, c); }
  return c;
}

export function flushWeaponScripts() { caches.clear(); }

async function readScript(name, tfPath) {
  const plain = await readGameFile('scripts/' + name + '.txt', tfPath);
  if (plain) return { text: plain.toString('latin1') };
  const enc = await readGameFile('scripts/' + name + '.ctx', tfPath);
  if (enc) return { buf: enc };
  return null;
}

export async function readWeaponScript(itemClass, tfPath) {
  const name = String(itemClass || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!name || !tfPath) return null;
  const src = await readScript(name, tfPath);
  if (!src) return null;
  let text = src.text;
  if (text === undefined) {
    const dec = Buffer.from(decodeICE(src.buf, TF_SCRIPT_KEY)).toString('latin1');
    if (!/WeaponData/i.test(dec)) return null;
    text = dec;
  }
  const root = parseVDF(text);
  const named = vdfGet(root, 'WeaponData');
  if (named && typeof named === 'object') return named;
  const blocks = Object.values(root).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (blocks.length === 1) return blocks[0];
  return root;
}

export async function weaponRole(itemClass, tfPath) {
  const name = String(itemClass || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!name || !tfPath) return null;
  const cache = cacheFor(tfPath);
  if (cache.roles.has(name)) return cache.roles.get(name);
  const data = await readWeaponScript(name, tfPath);
  const role = data ? (normalizeRole(vdfGet(data, 'WeaponType')) || 'primary') : null;
  cache.roles.set(name, role);
  return role;
}
