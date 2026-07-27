import { getTFPath } from './icons.js';

export const BOT_MODEL = {
  scout: 'models/bots/scout/bot_scout',
  soldier: 'models/bots/soldier/bot_soldier',
  pyro: 'models/bots/pyro/bot_pyro',
  demoman: 'models/bots/demo/bot_demo',
  heavyweapons: 'models/bots/heavy/bot_heavy',
  engineer: 'models/bots/engineer/bot_engineer',
  medic: 'models/bots/medic/bot_medic',
  sniper: 'models/bots/sniper/bot_sniper',
  spy: 'models/bots/spy/bot_spy'
};

const HUMAN_MODEL = {
  scout: 'models/player/scout', soldier: 'models/player/soldier', pyro: 'models/player/pyro',
  demoman: 'models/player/demo', heavyweapons: 'models/player/heavy', engineer: 'models/player/engineer',
  medic: 'models/player/medic', sniper: 'models/player/sniper', spy: 'models/player/spy'
};

const DEFAULT_WEAPON = {
  scout: 'models/weapons/c_models/c_scattergun',
  soldier: 'models/weapons/c_models/c_rocketlauncher/c_rocketlauncher',
  pyro: 'models/weapons/c_models/c_flamethrower/c_flamethrower',
  demoman: 'models/weapons/c_models/c_grenadelauncher/c_grenadelauncher',
  heavyweapons: 'models/weapons/c_models/c_minigun/c_minigun',
  engineer: 'models/weapons/c_models/c_shotgun/c_shotgun',
  medic: 'models/weapons/c_models/c_medigun/c_medigun',
  sniper: 'models/weapons/c_models/c_sniperrifle/c_sniperrifle',
  spy: 'models/weapons/c_models/c_revolver/c_revolver'
};

// Stock melee world models, for bots restricted to MeleeOnly with no explicit Item.
// Heavy is deliberately absent: his stock fists have no world model (bare hands).
const DEFAULT_MELEE = {
  scout: 'models/weapons/c_models/c_bat',
  soldier: 'models/weapons/c_models/c_shovel/c_shovel',
  pyro: 'models/weapons/c_models/c_fireaxe_pyro/c_fireaxe_pyro',
  demoman: 'models/weapons/c_models/c_bottle/c_bottle',
  engineer: 'models/weapons/c_models/c_wrench/c_wrench',
  medic: 'models/weapons/c_models/c_bonesaw/c_bonesaw',
  sniper: 'models/weapons/c_models/c_machete/c_machete',
  spy: 'models/weapons/c_models/c_knife/c_knife'
};

const SLOT_FOR_RESTRICTION = { meleeonly: 'melee', primaryonly: 'primary', secondaryonly: 'secondary' };

function cleanModelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.mdl$/i, '').toLowerCase().trim();
}

const EMPTY_RE = /(^|\/)empty\d*$/i;

function f32(b) { const u = b instanceof Uint8Array ? b : new Uint8Array(b); return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); }
function u32(b) { const u = b instanceof Uint8Array ? b : new Uint8Array(b); return new Uint32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); }
function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }

function quatMat(q, p) {
  const [x, y, z, w] = q;
  const m = new Float32Array(16);
  m[0] = 1 - 2 * (y * y + z * z); m[4] = 2 * (x * y - w * z); m[8] = 2 * (x * z + w * y); m[12] = p[0];
  m[1] = 2 * (x * y + w * z); m[5] = 1 - 2 * (x * x + z * z); m[9] = 2 * (y * z - w * x); m[13] = p[1];
  m[2] = 2 * (x * z - w * y); m[6] = 2 * (y * z + w * x); m[10] = 1 - 2 * (x * x + y * y); m[14] = p[2];
  m[15] = 1;
  return m;
}

function matMul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function matInvertRigid(m) {
  const r = new Float32Array(16);
  r[0] = m[0]; r[4] = m[1]; r[8] = m[2];
  r[1] = m[4]; r[5] = m[5]; r[9] = m[6];
  r[2] = m[8]; r[6] = m[9]; r[10] = m[10];
  r[15] = 1;
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

function pickRunAnim(anims) {
  if (!anims || !anims.length) return null;
  const runN = anims.filter(a => a.numframes > 1 && /runn$/i.test(a.name));
  const pri = ['a_primary_runn', 'a_secondary_runn', 'a_melee_runn', 'a_building_runn', 'a_pda_runn'];
  for (const p of pri) { const hit = runN.find(a => a.name.toLowerCase() === p); if (hit) return hit; }
  if (runN.length) return runN[0];
  const any = anims.filter(a => a.numframes > 1 && /_runn/i.test(a.name));
  if (any.length) return any[0];
  return anims.find(a => a.numframes > 1) || null;
}

function skinPose(pos, nrm, bw, bi, skinMats) {
  const n = pos.length / 3;
  const sp = new Float32Array(pos.length);
  const sn = new Float32Array(nrm.length);
  for (let v = 0; v < n; v++) {
    const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
    const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0;
    const nb = bi[v * 4 + 3];
    for (let k = 0; k < nb; k++) {
      const w = nb === 1 ? 1 : bw[v * 3 + k];
      if (w <= 0) continue;
      const m = skinMats[bi[v * 4 + k]];
      if (!m) continue;
      ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
      oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
      oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
      mx += w * (m[0] * nx + m[4] * ny + m[8] * nz);
      my += w * (m[1] * nx + m[5] * ny + m[9] * nz);
      mz += w * (m[2] * nx + m[6] * ny + m[10] * nz);
    }
    sp[v * 3] = ox; sp[v * 3 + 1] = oy; sp[v * 3 + 2] = oz;
    sn[v * 3] = mx; sn[v * 3 + 1] = my; sn[v * 3 + 2] = mz;
  }
  return { pos: sp, nrm: sn };
}

export async function loadPropModel(base) {
  if (!base) return null;
  const tfPath = await getTFPath();
  const payload = await window.popnative.modelLoad({ kind: 'vpk', base, tfPath, animMatch: null });
  if (!payload || payload.error || !payload.positions) return null;
  let pos = f32(payload.positions), nrm = f32(payload.normals);
  // A prop_dynamic is an animated entity: with no defaultanim it rests in sequence 0, so that
  // is the pose the game shows. Static props never animate, which is why only the dynamic ones
  // looked wrong (e.g. rottenburg's barricade_pikes, 21 bones + 2 sequences, sat rotated and
  // did not span the tank path it is placed to block). Skin by the first animation's frame 0,
  // world x invBind exactly as the bot path does; models with no animation are untouched.
  const bones = payload.bones;
  const anim = (payload.anims && payload.anims.length) ? payload.anims[0] : null;
  if (bones && bones.length && anim && anim.numframes > 0 && payload.boneWeights && payload.boneIds) {
    const nb = bones.length;
    const bindWorld = [], invBind = [];
    for (let b = 0; b < nb; b++) {
      const local = quatMat(bones[b].quat, bones[b].pos);
      const w = bones[b].parent >= 0 ? matMul(bindWorld[bones[b].parent], local) : local;
      bindWorld.push(w);
      invBind.push(matInvertRigid(w));
    }
    const af = f32(anim.frames);
    const world = [], skin = [];
    for (let b = 0; b < nb; b++) {
      const o = b * 7;
      const local = quatMat([af[o + 3], af[o + 4], af[o + 5], af[o + 6]], [af[o], af[o + 1], af[o + 2]]);
      const w = bones[b].parent >= 0 ? matMul(world[bones[b].parent], local) : local;
      world.push(w);
      skin.push(matMul(w, invBind[b]));
    }
    const posed = skinPose(pos, nrm, f32(payload.boneWeights), u8(payload.boneIds), skin);
    pos = posed.pos; nrm = posed.nrm;
  }
  return {
    positions: pos, normals: nrm, uv: f32(payload.uvs), idx: u32(payload.indices),
    meshes: payload.meshes || [],
    textures: payload.textures || [], cdtextures: payload.cdtextures || [], skins: payload.skins || []
  };
}

export function botModelBase(bot) {
  if (!bot) return null;
  if (bot.model) {
    const m = cleanModelPath(bot.model);
    if (m && !EMPTY_RE.test(m)) return m;
  }
  if (bot.useHumanModel && HUMAN_MODEL[bot.cls]) return HUMAN_MODEL[bot.cls];
  return BOT_MODEL[bot.cls] || null;
}

const itemCache = new Map();

export async function resolveBotItems(names) {
  const need = [...new Set(names.filter(n => n && !itemCache.has(String(n).toLowerCase())))];
  if (!need.length) return false;
  let res = {};
  try { res = await window.popnative.itemsResolve(need, await getTFPath()) || {}; } catch {}
  for (const n of need) itemCache.set(String(n).toLowerCase(), res[n] || null);
  return true;
}

function botItemRecs(bot) {
  const out = [];
  for (const it of (bot.items || [])) {
    const rec = itemCache.get(String(it).toLowerCase());
    if (rec && rec.model && !EMPTY_RE.test(rec.model)) out.push(rec);
  }
  return out;
}

export function botCosmeticModels(bot) {
  if (!bot) return [];
  return botItemRecs(bot).filter(r => !r.isWeapon && !r.wearable).map(r => r.model);
}

const SLOT_INDEX = { primary: 0, secondary: 1, melee: 2 };

// Every model a bot visibly carries: its ACTIVE weapon (which slot that is comes from the
// popfile's WeaponRestrictions — MeleeOnly demoknights hold the sword, not the launcher)
// plus any wearables, which TF2 draws on the body permanently (demo shields, banners).
export function botWeaponModels(bot) {
  if (!bot) return [];
  const stripped = new Set(bot.stripSlots || []);
  const restriction = String(bot.restriction || '').toLowerCase().replace(/[^a-z]/g, '');
  const activeSlot = SLOT_FOR_RESTRICTION[restriction] || 'primary';
  const out = [];

  const custom = (bot.customWeapons || []).filter(w => w.model && !EMPTY_RE.test(cleanModelPath(w.model)));
  if (custom.length) {
    const want = SLOT_INDEX[activeSlot];
    const pick = custom.find(w => w.slot === want) || custom.find(w => w.slot === 0) || custom[0];
    out.push(cleanModelPath(pick.model));
  }

  const recs = botItemRecs(bot);
  const wearables = recs.filter(r => r.wearable);
  if (!out.length) {
    const active = recs.find(r => r.isWeapon && !r.wearable && r.slot === activeSlot)
      || recs.find(r => r.isWeapon && !r.wearable);
    if (active) out.push(active.model);
    else if (!stripped.has(SLOT_INDEX[activeSlot])) {
      const fallback = activeSlot === 'melee' ? DEFAULT_MELEE[bot.cls] : DEFAULT_WEAPON[bot.cls];
      if (fallback) out.push(fallback);
    }
  }
  for (const w of wearables) out.push(w.model);
  return [...new Set(out.filter(Boolean))];
}

export function botWeaponModel(bot) {
  const list = botWeaponModels(bot);
  return list.length ? list[0] : null;
}

export async function loadBotPose(base) {
  if (!base) return null;
  const tfPath = await getTFPath();
  const payload = await window.popnative.modelLoad({ kind: 'vpk', base, tfPath, animMatch: 'runn' });
  if (!payload || payload.error || !payload.positions) return null;

  const pos = f32(payload.positions), nrm = f32(payload.normals), uv = f32(payload.uvs);
  const bw = f32(payload.boneWeights), bi = u8(payload.boneIds), idx = u32(payload.indices);
  const bones = payload.bones;
  const nb = bones.length;

  const bindWorld = [];
  const invBind = [];
  for (let b = 0; b < nb; b++) {
    const local = quatMat(bones[b].quat, bones[b].pos);
    const world = bones[b].parent >= 0 ? matMul(bindWorld[bones[b].parent], local) : local;
    bindWorld.push(world);
    invBind.push(matInvertRigid(world));
  }

  const anim = pickRunAnim(payload.anims);
  const frames = [];
  const boneWorldFrames = [];
  if (anim) {
    const af = f32(anim.frames);
    for (let f = 0; f < anim.numframes; f++) {
      const world = [];
      const skin = [];
      for (let b = 0; b < nb; b++) {
        const o = (f * nb + b) * 7;
        const local = quatMat([af[o + 3], af[o + 4], af[o + 5], af[o + 6]], [af[o], af[o + 1], af[o + 2]]);
        const parent = bones[b].parent;
        const w = parent >= 0 ? matMul(world[parent], local) : local;
        world.push(w);
        skin.push(matMul(w, invBind[b]));
      }
      boneWorldFrames.push(world);
      frames.push(skinPose(pos, nrm, bw, bi, skin));
    }
  } else {
    boneWorldFrames.push(bindWorld);
    frames.push({ pos, nrm });
  }

  const flagAtt = (payload.attachments || []).find(a => /^flag$/i.test(a.name));
  const flagFrames = [];
  if (flagAtt && flagAtt.localbone >= 0 && flagAtt.localbone < nb) {
    for (let f = 0; f < boneWorldFrames.length; f++) flagFrames.push(matMul(boneWorldFrames[f][flagAtt.localbone], flagAtt.local));
  }

  return {
    frames, uv, idx,
    meshes: payload.meshes || [],
    textures: payload.textures || [], cdtextures: payload.cdtextures || [], skins: payload.skins || [],
    numframes: frames.length, fps: anim ? (anim.fps || 30) : 30,
    boneWorldFrames, boneNames: bones.map(b => String(b.name || '').toLowerCase()),
    flagFrames: flagFrames.length ? flagFrames : null,
    bbox: payload.bbox
  };
}

export async function loadAttachment(itemBase, pose) {
  if (!itemBase || !pose || !pose.boneWorldFrames) return null;
  const tfPath = await getTFPath();
  const payload = await window.popnative.modelLoad({ kind: 'vpk', base: itemBase, tfPath, animMatch: '__none__' });
  if (!payload || payload.error || !payload.positions) return null;

  const pos = f32(payload.positions), nrm = f32(payload.normals), uv = f32(payload.uvs);
  const bw = f32(payload.boneWeights), bi = u8(payload.boneIds), idx = u32(payload.indices);
  const bones = payload.bones;
  const nb = bones.length;

  const local = bones.map(b => quatMat(b.quat, b.pos));
  const invBind = [];
  const bindWorld = [];
  for (let b = 0; b < nb; b++) {
    const w = bones[b].parent >= 0 ? matMul(bindWorld[bones[b].parent], local[b]) : local[b];
    bindWorld.push(w);
    invBind.push(matInvertRigid(w));
  }
  const toBot = bones.map(b => pose.boneNames.indexOf(String(b.name || '').toLowerCase()));
  const merged = toBot.some(i => i >= 0);

  const nf = pose.numframes;
  const frames = [];
  for (let f = 0; f < nf; f++) {
    const botW = pose.boneWorldFrames[f];
    const world = [];
    const skin = [];
    for (let b = 0; b < nb; b++) {
      const w = toBot[b] >= 0 ? botW[toBot[b]]
        : bones[b].parent >= 0 ? matMul(world[bones[b].parent], local[b]) : local[b];
      world.push(w);
      skin.push(matMul(w, invBind[b]));
    }
    frames.push(skinPose(pos, nrm, bw, bi, skin));
  }

  return {
    frames, uv, idx, merged,
    meshes: payload.meshes || [],
    textures: payload.textures || [], cdtextures: payload.cdtextures || [], skins: payload.skins || [],
    numframes: nf
  };
}
