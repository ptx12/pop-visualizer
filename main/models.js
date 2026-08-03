import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseMDL, parseVVD, parseVTX, buildMeshes, sampleAnim } from '../shared/mdl.js';
import { resolveActivities, includeBases } from '../shared/modelanims.js';
import { detectTFPath } from './tfpath.js';
import { httpGet, potatoUrl } from './potato.js';
import { readGameFile } from '../shared/gamefs.js';

async function readModelSet(src, tfPath) {
  const need = async rel => {
    if (src.kind === 'file') {
      try { return await fs.readFile(src.base + rel); } catch { return null; }
    }
    if (src.kind === 'vpk') return await readGameFile(src.base + rel, tfPath, src.bsp || null);
    try { return await httpGet(potatoUrl(src.base + rel), 128 * 1024 * 1024); } catch { return null; }
  };
  const mdl = await need('.mdl');
  if (!mdl) return null;
  const vvd = await need('.vvd');
  const vtx = (await need('.dx90.vtx')) || (await need('.dx80.vtx'));
  if (!vvd || !vtx) return { mdl };
  return { mdl, vvd, vtx };
}

function animFramesFor(mdl, targetBones, boneMap, match, pick) {
  const out = [];
  const wanted = pick && pick.length ? new Set(pick.map(n => n.toLowerCase())) : null;
  for (const a of mdl.anims) {
    if (a.animblock !== 0 || a.numframes < 1 || a.numframes > 1000) continue;
    if (wanted && !wanted.has(a.name.toLowerCase())) continue;
    if (!wanted && match && !match.some(m => a.name.toLowerCase().includes(m))) continue;
    const frames = new Float32Array(a.numframes * targetBones.length * 7);
    let ok = true;
    for (let f = 0; f < a.numframes; f++) {
      const s = sampleAnim(mdl, a, f);
      if (!s.ok) { ok = false; break; }
      for (let b = 0; b < targetBones.length; b++) {
        const srcIdx = boneMap ? boneMap[b] : b;
        const src = srcIdx >= 0 && srcIdx < s.bones.length ? s.bones[srcIdx] : null;
        const o = (f * targetBones.length + b) * 7;
        const bind = targetBones[b];
        const p = src ? src.pos : bind.pos;
        const q = src ? src.quat : bind.quat;
        frames[o] = p[0]; frames[o + 1] = p[1]; frames[o + 2] = p[2];
        frames[o + 3] = q[0]; frames[o + 4] = q[1]; frames[o + 5] = q[2]; frames[o + 6] = q[3];
      }
    }
    if (!ok) continue;
    out.push({ name: a.name, fps: a.fps || 30, numframes: a.numframes, moveDist: a.moveDist || 0, frames: Buffer.from(frames.buffer) });
  }
  return out;
}

export function register() {
  ipcMain.handle('model:load', async (e, src) => {
    try {
      const tfPath = src.kind === 'vpk' ? (src.tfPath || await detectTFPath()) : null;
      if (src.kind === 'vpk' && !tfPath) return { error: 'TF folder not found' };
      const set = await readModelSet(src, tfPath);
      if (!set) return { error: 'model not found' };
      const mdl = parseMDL(set.mdl);
      const bones = mdl.bones.map(b => ({ name: b.name, parent: b.parent, pos: b.pos, quat: b.quat }));
      const result = {
        name: mdl.header.name,
        version: mdl.header.version,
        textures: mdl.textures,
        cdtextures: mdl.cdtextures,
        skins: mdl.skins,
        bones,
        attachments: mdl.attachments || [],
        anims: []
      };
      if (set.vvd && set.vtx) {
        const vvd = parseVVD(set.vvd);
        const vtx = parseVTX(set.vtx);
        const built = buildMeshes(mdl, vvd, vtx);
        const n = built.verts.length;
        const pos = new Float32Array(n * 3);
        const nrm = new Float32Array(n * 3);
        const uv = new Float32Array(n * 2);
        const bw = new Float32Array(n * 3);
        const bi = new Uint8Array(n * 4);
        const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < n; i++) {
          const v = built.verts[i];
          pos.set(v.pos, i * 3);
          nrm.set(v.normal, i * 3);
          uv.set(v.uv, i * 2);
          bw.set(v.weights, i * 3);
          bi[i * 4] = v.bones[0]; bi[i * 4 + 1] = v.bones[1]; bi[i * 4 + 2] = v.bones[2]; bi[i * 4 + 3] = Math.max(1, Math.min(3, v.numBones));
          for (let a = 0; a < 3; a++) {
            bbox[a] = Math.min(bbox[a], v.pos[a]);
            bbox[a + 3] = Math.max(bbox[a + 3], v.pos[a]);
          }
        }
        let total = 0;
        for (const m of built.meshes) total += m.indices.length;
        const indices = new Uint32Array(total);
        const meshes = [];
        let ofs = 0;
        for (const m of built.meshes) {
          indices.set(m.indices, ofs);
          meshes.push({ material: m.material, offset: ofs, count: m.indices.length });
          ofs += m.indices.length;
        }
        result.numVerts = n;
        result.positions = Buffer.from(pos.buffer);
        result.normals = Buffer.from(nrm.buffer);
        result.uvs = Buffer.from(uv.buffer);
        result.boneWeights = Buffer.from(bw.buffer);
        result.boneIds = Buffer.from(bi.buffer);
        result.indices = Buffer.from(indices.buffer);
        result.meshes = meshes;
        result.bbox = bbox;
      }
      const match = src.animMatch
        ? (Array.isArray(src.animMatch) ? src.animMatch : [src.animMatch]).map(m => String(m).toLowerCase())
        : null;
      const activities = Array.isArray(src.activities) ? src.activities.map(String) : null;
      result.hitboxes = mdl.hitboxes || [];
      result.activities = {};

      const sources = [{ mdl, boneMap: null }];
      const seen = new Set([String(src.base).toLowerCase()]);
      const queue = includeBases(mdl, src.base);
      let guard = 0;
      while (queue.length && guard++ < 12) {
        const base = queue.shift();
        if (!base || seen.has(base)) continue;
        seen.add(base);
        try {
          const compSet = await readModelSet({ kind: src.kind, base, bsp: src.bsp }, tfPath);
          if (!compSet || !compSet.mdl) continue;
          const comp = parseMDL(compSet.mdl);
          for (const nested of (comp.includemodels || [])) queue.push(nested.replace(/\.mdl$/i, '').toLowerCase());
          if (!comp.sequences.length && !comp.anims.length) continue;
          const nameToIdx = new Map(comp.bones.map((b, i) => [b.name.toLowerCase(), i]));
          sources.push({ mdl: comp, boneMap: mdl.bones.map(b => nameToIdx.get(b.name.toLowerCase()) ?? -1) });
        } catch {}
      }

      const picked = sources.map(() => []);
      if (activities) {
        for (let i = 0; i < sources.length; i++) {
          const found = resolveActivities(sources[i].mdl, activities.filter(a => !result.activities[a]));
          for (const [act, name] of found) { result.activities[act] = name; picked[i].push(name); }
        }
      }
      const anyPicked = picked.some(p => p.length);
      result.anims = [];
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (anyPicked && !picked[i].length) continue;
        result.anims.push(...animFramesFor(s.mdl, mdl.bones, s.boneMap, anyPicked ? null : match, anyPicked ? picked[i] : null));
      }
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('game:buildtimes', async (e, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const buf = await readGameFile('scripts/objects.txt', tfPath);
    if (!buf) return null;
    const text = buf.toString('latin1');
    const out = {};
    const re = /ClassName\s+"?([a-z_]+)"?[\s\S]*?BuildTime\s+"?([0-9.]+)"?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = parseFloat(m[2]);
      if (Number.isFinite(v) && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = v;
    }
    return out;
  });

  ipcMain.handle('hlmv:find', async (e, tfPathOverride, override) => {
    if (override) {
      try { await fs.access(override); return override; } catch {}
    }
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return null;
    const game = path.dirname(tfPath);
    const win = process.platform === 'win32';
    const subs = win ? [['bin', 'x64'], ['bin', 'win64'], ['bin']] : [['bin', 'linux64'], ['bin']];
    const names = ['hlmvplusplus', 'hlmv++', 'hlmv_plus_plus', 'hlmv'].map(n => win ? n + '.exe' : n);
    for (const sub of subs) {
      for (const name of names) {
        const p = path.join(game, ...sub, name);
        try { await fs.access(p); return p; } catch {}
      }
    }
    return null;
  });

  ipcMain.handle('hlmv:open', async (e, exe, tfPathOverride, mdlPath) => {
    const tfPath = tfPathOverride || await detectTFPath();
    try {
      spawn(exe, ['-game', tfPath || '', mdlPath], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch {
      return false;
    }
  });
}
