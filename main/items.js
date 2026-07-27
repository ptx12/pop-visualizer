import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectTFPath } from './tfpath.js';

const WEAPON_SLOTS = new Set(['primary', 'secondary', 'melee', 'pda', 'pda2', 'building', 'sapper']);

function parseKV(text) {
  let i = 0; const n = text.length;
  const skip = () => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const tok = () => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '"') { i++; const s = i; while (i < n && text[i] !== '"') i++; const t = text.slice(s, i); i++; return t; }
    if (c === '{' || c === '}') { i++; return c; }
    if (c === '[') { while (i < n && text[i] !== ']') i++; i++; return tok(); }
    const s = i; while (i < n && ' \t\r\n"{}'.indexOf(text[i]) < 0) i++;
    return text.slice(s, i);
  };
  const block = () => {
    const obj = {};
    for (;;) {
      const key = tok();
      if (key === null || key === '}') return obj;
      let val = tok();
      if (val === '[') val = tok();
      if (val === '{') val = block();
      if (obj[key] === undefined) obj[key] = val;
      else if (Array.isArray(obj[key])) obj[key].push(val);
      else obj[key] = [obj[key], val];
    }
  };
  return block();
}

let schemaCache = null;
async function loadSchema(tfPath) {
  if (schemaCache && schemaCache.tfPath === tfPath) return schemaCache;
  const out = { tfPath, byName: new Map(), byToken: new Map() };
  try {
    const raw = await fs.readFile(path.join(tfPath, 'scripts', 'items', 'items_game.txt'), 'latin1');
    const root = parseKV(raw);
    const ig = root.items_game || root;
    const items = ig.items || {};
    const prefabs = ig.prefabs || {};
    const field = (node, key, depth = 0) => {
      if (!node || depth > 8) return null;
      if (node[key]) return node[key];
      const pf = node.prefab;
      if (!pf) return null;
      for (const name of String(pf).split(/\s+/)) {
        const v = field(prefabs[name], key, depth + 1);
        if (v) return v;
      }
      return null;
    };
    for (const [defidx, it] of Object.entries(items)) {
      if (defidx === 'default' || typeof it !== 'object') continue;
      const model = field(it, 'model_player');
      if (!model || typeof model !== 'string') continue;
      const slot = String(field(it, 'item_slot') || 'misc').toLowerCase();
      const itemClass = String(field(it, 'item_class') || '').toLowerCase();
      const rec = {
        model: model.replace(/\\/g, '/').replace(/\.mdl$/i, '').toLowerCase(),
        slot, isWeapon: WEAPON_SLOTS.has(slot),
        // Wearables (demo shields, soldier banners, parachutes) are drawn on the body at all
        // times alongside the active weapon, so they must not compete for the weapon slot.
        wearable: /wearable/.test(itemClass)
      };
      const name = it.name;
      if (name && typeof name === 'string') out.byName.set(name.toLowerCase().trim(), rec);
      const token = it.item_name;
      if (token && typeof token === 'string' && token[0] === '#') out.byToken.set(token.slice(1).toLowerCase(), rec);
    }
  } catch (err) { out.error = err.message; }

  try {
    const buf = await fs.readFile(path.join(tfPath, 'resource', 'tf_english.txt'));
    const txt = buf.toString('utf16le').replace(/^﻿/, '');
    const root = parseKV(txt);
    const tokens = (root.lang && root.lang.Tokens) || (root.lang && root.lang.tokens) || {};
    for (const [token, english] of Object.entries(tokens)) {
      if (typeof english !== 'string') continue;
      const rec = out.byToken.get(String(token).toLowerCase());
      if (rec) out.byName.set(english.toLowerCase().trim().replace(/^the\s+/, ''), rec);
    }
  } catch {}

  schemaCache = out;
  return out;
}

function lookup(schema, name) {
  const key = String(name || '').toLowerCase().trim();
  return schema.byName.get(key) || schema.byName.get(key.replace(/^the\s+/, '')) || null;
}

export function register() {
  ipcMain.handle('items:resolve', async (e, names, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath || !Array.isArray(names)) return {};
    const schema = await loadSchema(tfPath);
    const out = {};
    for (const name of names) {
      const rec = lookup(schema, name);
      out[name] = rec ? { model: rec.model, slot: rec.slot, isWeapon: rec.isWeapon } : null;
    }
    return out;
  });
}
