import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { request as httpsRequest } from 'node:https';
import { parseMDL } from '../shared/mdl.js';
import { sendCmd } from './context.js';
import { detectTFPath } from './tfpath.js';
import { flushMapCaches, sharedPrefixLen } from './maps.js';

const POTATO_BASE = 'https://testing.potato.tf/tf/';

export function httpGet(url, maxBytes = 512 * 1024 * 1024, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).href, maxBytes, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n > maxBytes) { req.destroy(new Error('too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function httpExists(url, redirects = 3) {
  return new Promise(resolve => {
    const req = httpsRequest(url, { method: 'HEAD' }, res => {
      res.resume();
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        resolve(httpExists(new URL(res.headers.location, url).href, redirects - 1));
        return;
      }
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

export function potatoUrl(rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.includes('..')) return null;
  return POTATO_BASE + clean.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');
}

function dlProgress(label) {
  sendCmd({ type: 'dlprog', label });
}

async function saveUnder(tfPath, rel, buf) {
  const dest = path.join(tfPath, 'download', rel.replace(/\//g, path.sep));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return dest;
}

async function fetchToDownload(tfPath, rel, results, optional = false) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (clean.includes('..')) return null;
  for (const root of [path.join(tfPath, 'download'), tfPath]) {
    try {
      await fs.access(path.join(root, clean));
      results.push({ path: clean, status: 'exists' });
      return await fs.readFile(path.join(root, clean));
    } catch {}
  }
  dlProgress('Downloading ' + clean);
  let buf = null;
  try { buf = await httpGet(potatoUrl(clean)); } catch {}
  if (!buf) {
    if (!optional) results.push({ path: clean, status: 'missing' });
    return null;
  }
  await saveUnder(tfPath, clean, buf);
  results.push({ path: clean, status: 'downloaded', bytes: buf.length });
  return buf;
}

function vmtTextureRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(/\$(basetexture2?|bumpmap|normalmap|detail|envmapmask|phongexponenttexture|selfillummask|lightwarptexture)"?\s*"?([^"\r\n]+?)"?\s*$/gim)) {
    const v = m[2].trim().replace(/\\/g, '/');
    if (v && !v.startsWith('_rt_') && !v.startsWith('env_cubemap')) out.add(v.toLowerCase());
  }
  for (const m of text.matchAll(/include"?\s*"?([^"\r\n]+?)"?\s*$/gim)) {
    const v = m[1].trim().replace(/\\/g, '/').toLowerCase();
    if (v.endsWith('.vmt')) out.add('!' + v);
  }
  return out;
}

export function register() {
  ipcMain.handle('potato:list', async (e, rel) => {
    const url = potatoUrl(rel.endsWith('/') || rel === '' ? rel : rel + '/');
    if (!url) return null;
    let body;
    try { body = await httpGet(url, 8 * 1024 * 1024); } catch { return null; }
    if (!body) return null;
    const html = body.toString('utf8');
    const dirs = [];
    const files = [];
    for (const m of html.matchAll(/<a\s+href="([^"]+)"/gi)) {
      let href = m[1];
      if (href.startsWith('?') || href.startsWith('/') || href.startsWith('..') || /^https?:/i.test(href)) continue;
      try { href = decodeURIComponent(href); } catch {}
      if (href.endsWith('/')) dirs.push(href.slice(0, -1));
      else files.push({ name: href, size: 0 });
    }
    return { dirs: [...new Set(dirs)].sort(), files };
  });

  ipcMain.handle('potato:model', async (e, mdlRel, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return { error: 'TF folder not found' };
    const base = String(mdlRel).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.mdl$/i, '').toLowerCase();
    if (base.includes('..')) return { error: 'bad path' };
    const results = [];
    const mdlBuf = await fetchToDownload(tfPath, base + '.mdl', results);
    if (!mdlBuf) return { error: 'model not found on index', results };
    for (const ext of ['.vvd', '.dx90.vtx', '.dx80.vtx', '.sw.vtx', '.phy', '.ani']) {
      await fetchToDownload(tfPath, base + ext, results, ext === '.phy' || ext === '.ani' || ext === '.sw.vtx' || ext === '.dx80.vtx');
    }
    try {
      const mdl = parseMDL(mdlBuf);
      const vmtQueue = [];
      for (const tex of mdl.textures) {
        const t = tex.replace(/\\/g, '/').toLowerCase();
        if (t.includes('/')) vmtQueue.push('materials/' + t + '.vmt');
        else for (const cd of mdl.cdtextures) vmtQueue.push(('materials/' + cd + t + '.vmt').replace(/\/+/g, '/'));
      }
      const seenVmt = new Set();
      const vtfSet = new Set();
      while (vmtQueue.length) {
        const rel = vmtQueue.shift().replace(/\/+/g, '/');
        if (seenVmt.has(rel)) continue;
        seenVmt.add(rel);
        const vmtBuf = await fetchToDownload(tfPath, rel, results, true);
        if (!vmtBuf) continue;
        for (const ref of vmtTextureRefs(vmtBuf.toString('latin1'))) {
          if (ref.startsWith('!')) vmtQueue.push(ref.slice(1));
          else vtfSet.add('materials/' + ref.replace(/\.vtf$/, '') + '.vtf');
        }
      }
      for (const rel of vtfSet) await fetchToDownload(tfPath, rel, results, true);
    } catch {}
    dlProgress('');
    return { results };
  });

  ipcMain.handle('potato:map', async (e, mapName, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return { error: 'TF folder not found' };
    const name = String(mapName).toLowerCase().replace(/\.bsp$/, '');
    if (!/^[a-z0-9_\-.]+$/.test(name)) return { error: 'bad map name' };
    const results = [];
    const bsp = await fetchToDownload(tfPath, 'maps/' + name + '.bsp', results);
    await fetchToDownload(tfPath, 'maps/' + name + '.nav', results, true);
    dlProgress('');
    if (!bsp) {
      const bz = await httpExists(potatoUrl('maps/' + name + '.bsp.bz2'));
      return { error: bz ? 'only a .bsp.bz2 exists on the index for this map' : 'map not found on the index', results };
    }
    return { results };
  });

  ipcMain.handle('potato:navs', async (e, mapName) => {
    const name = String(mapName).toLowerCase().replace(/\.bsp$/, '');
    if (!/^[a-z0-9_\-.]+$/.test(name)) return { error: 'bad map name' };
    let body;
    try { body = await httpGet(potatoUrl('maps/'), 16 * 1024 * 1024); } catch { body = null; }
    if (!body) return { error: 'could not reach the potato.tf index' };
    const navs = [];
    for (const m of body.toString('utf8').matchAll(/<a\s+href="([^"]+\.nav)"/gi)) {
      let href = m[1];
      try { href = decodeURIComponent(href); } catch {}
      navs.push(href.toLowerCase().replace(/\.nav$/, ''));
    }
    const stem = s => s.replace(/^mvm_/, '');
    const wanted = stem(name);
    const scored = [];
    for (const n of [...new Set(navs)]) {
      if (n === name) { scored.push({ name: n, exact: true, score: 999 }); continue; }
      const l = sharedPrefixLen(stem(n), wanted);
      if (l >= 5) scored.push({ name: n, exact: false, score: l });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { candidates: scored.slice(0, 12).map(({ name: n, exact }) => ({ name: n, exact })) };
  });

  ipcMain.handle('potato:nav', async (e, mapName, sourceName, tfPathOverride) => {
    const tfPath = tfPathOverride || await detectTFPath();
    if (!tfPath) return { error: 'TF folder not found' };
    const name = String(mapName).toLowerCase().replace(/\.bsp$/, '');
    const src = String(sourceName).toLowerCase().replace(/\.nav$/, '');
    if (!/^[a-z0-9_\-.]+$/.test(name) || !/^[a-z0-9_\-.]+$/.test(src)) return { error: 'bad map name' };
    dlProgress('Downloading ' + src + '.nav');
    let buf = null;
    try { buf = await httpGet(potatoUrl('maps/' + src + '.nav')); } catch {}
    dlProgress('');
    if (!buf) return { error: src + '.nav is not on the index' };
    const dest = await saveUnder(tfPath, 'maps/' + name + '.nav', buf);
    flushMapCaches();
    return { saved: dest, source: src, bytes: buf.length, renamed: src !== name };
  });
}
