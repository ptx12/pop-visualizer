import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEntityLump, parseEntities, readModels } from '../shared/bsp.js';
import { loadEntitySim, entitySimMovers } from '../shared/entssim.js';
import { extractMapEntities } from '../main/mapentities.js';
import { parseNav } from '../shared/nav.js';
import { readTonemapSettings } from '../shared/tonemap.js';
import { extractGeometry } from '../shared/bspgeo.js';
import { bakeTopDown } from '../shared/bsprender.js';
import { makeMaterialLoader } from '../shared/materials.js';
import { encodePNG } from '../shared/png.js';

const TF = process.env.TF_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf';
const MAPS = `${TF}/maps`;
const map = process.argv[2] || 'mvm_decoy';
const bsp = `${MAPS}/${map}.bsp`;
const here = fileURLToPath(new URL('.', import.meta.url));

const text = readEntityLump(bsp);
const ents = parseEntities(text);
const models = readModels(bsp);
await loadEntitySim(bsp, map);
const ent = extractMapEntities(ents, models, entitySimMovers(bsp));

let nav = null;
try { nav = parseNav(readFileSync(`${MAPS}/${map}.nav`)); if (nav) { nav.name = map + '.nav'; nav.approx = false; } }
catch (err) { console.log('nav read failed:', err.message); }
console.log('nav areas', nav ? nav.areas.length : 'none');

const mapData = { map, ...ent, tonemap: readTonemapSettings(ents), nav,
  navSearch: { searched: [], near: [], reason: null } };
const g = extractGeometry(bsp);
const mapGeo = g ? { polys: g.polys, bounds: g.bounds, zRange: g.zRange, lit: g.lit, data: Array.from(g.data) } : null;

const baked = await bakeTopDown(bsp, makeMaterialLoader(TF, bsp), {
  nav, spawns: ent.spawns, tracks: ent.tracks, moverTracks: entitySimMovers(bsp) });
console.log('baked', baked ? `${baked.width}x${baked.height}` : 'null');

const fx = { mapData, mapGeo, mapTexture: null };
if (baked) {
  writeFileSync(here + '.fixture-map.png', Buffer.from(encodePNG(baked.rgba, baked.width, baked.height)));
  const hg = baked.heightGrid;
  if (hg) writeFileSync(here + '.fixture-height.bin', Buffer.from(hg.grid.buffer, hg.grid.byteOffset, hg.grid.byteLength));
  fx.mapTexture = { width: baked.width, height: baked.height, bounds: baked.bounds,
    heightGrid: hg ? { gw: hg.gw, gh: hg.gh, cellPx: hg.cellPx, zMin: hg.zMin, zMax: hg.zMax } : null };
}
writeFileSync(here + '.fixture.json', JSON.stringify(fx));
console.log('fixture written for ' + map);
