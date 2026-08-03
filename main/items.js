import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectTFPath } from './tfpath.js';
import { parseVDF as parseKV, vdfGet } from '../shared/vdf.js';
import { weaponRole } from '../shared/weaponscripts.js';
import { normalizeRole } from '../shared/weaponrole.js';

const WEAPON_SLOTS = new Set(['primary', 'secondary', 'melee', 'pda', 'pda2', 'building', 'sapper']);

const CLASS_KEYS = {
  scout: 'Scout', sniper: 'Sniper', soldier: 'Soldier', demoman: 'Demoman', medic: 'Medic',
  heavyweapons: 'Heavy', pyro: 'Pyro', spy: 'Spy', engineer: 'Engineer'
};

const BASENAME_KEYS = { ...CLASS_KEYS, demoman: 'demo' };

const cleanModel = m => String(m).replace(/\\/g, '/').replace(/\.mdl$/i, '').toLowerCase();

function styleModels(it, field) {
  const styles = field(it, 'visuals');
  const block = styles && typeof styles === 'object' ? vdfGet(styles, 'styles') : null;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const out = {};
  for (const [idx, st] of Object.entries(block)) {
    if (!st || typeof st !== 'object') continue;
    const m = vdfGet(st, 'model_player');
    if (typeof m !== 'string' || !m) continue;
    out[String(parseInt(idx, 10))] = { model: cleanModel(m) };
  }
  return Object.keys(out).length ? out : null;
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
      if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
      const pf = node.prefab;
      if (!pf) return null;
      for (const name of String(pf).split(/\s+/)) {
        const v = field(prefabs[name], key, depth + 1);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    };
    const perClassModels = node => {
      const block = field(node, 'model_player_per_class');
      if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
      const baseName = vdfGet(block, 'basename');
      const out = {};
      for (const [cls, key] of Object.entries(CLASS_KEYS)) {
        const explicit = vdfGet(block, key);
        if (typeof explicit === 'string' && explicit) { out[cls] = cleanModel(explicit); continue; }
        if (typeof baseName === 'string' && baseName) out[cls] = cleanModel(baseName.replace(/%s/g, BASENAME_KEYS[cls]));
      }
      return Object.keys(out).length ? out : null;
    };
    for (const [defidx, it] of Object.entries(items)) {
      if (defidx === 'default' || typeof it !== 'object') continue;
      const model = field(it, 'model_player');
      const modelPerClass = perClassModels(it);
      const hasBase = model && typeof model === 'string';
      if (!hasBase && !modelPerClass) continue;
      const slot = String(field(it, 'item_slot') || 'misc').toLowerCase();
      const itemClass = String(field(it, 'item_class') || '').toLowerCase();
      const rec = {
        model: hasBase ? cleanModel(model) : Object.values(modelPerClass)[0],
        modelPerClass,
        slot, isWeapon: WEAPON_SLOTS.has(slot),
        wearable: /wearable/.test(itemClass),
        itemClass,
        styles: styleModels(it, field),
        animSlot: normalizeRole(field(it, 'anim_slot'))
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

async function roleOf(rec, tfPath) {
  if (!rec || rec.wearable) return null;
  if (rec.animSlot) return rec.animSlot;
  return await weaponRole(rec.itemClass, tfPath);
}

export function register() {
  ipcMain.handle('items:resolve', async (e, names, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath || !Array.isArray(names)) return {};
    const schema = await loadSchema(tfPath);
    const out = {};
    for (const name of names) {
      const rec = lookup(schema, name);
      out[name] = rec ? { model: rec.model, modelPerClass: rec.modelPerClass, slot: rec.slot, isWeapon: rec.isWeapon, wearable: rec.wearable, role: await roleOf(rec, tfPath) } : null;
    }
    return out;
  });

  ipcMain.handle('items:weaponrole', async (e, itemClass, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    return await weaponRole(itemClass, tfPath);
  });
}
