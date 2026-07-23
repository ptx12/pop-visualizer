import { getValue } from '../kv.js';

// RafMod/SigMod missions define map geometry — spawn points, capture zones, the
// bomb, tank path_tracks — inside PointTemplates in the popfile rather than the
// BSP. The sim reads spawns/paths/objective from the map, so those popfile
// entities are invisible to it unless we extract them here and merge them in.
// (logic_relay / trigger entities are already picked up by buildTriggerGraph,
// which walks the whole doc, so relays/gating need nothing from this.)

const SPAWN_CLS = /^info_player_teamspawn$/i;
const CAPZONE_CLS = /^func_capturezone$/i;
const FLAG_CLS = /^item_teamflag$/i;
const TRACK_CLS = /^path_track$/i;
const TANK_CLS = /^(tank_boss|func_tank(train)?|prop_dynamic_build|base_boss)$/i;

function parseVec(s) {
  if (typeof s !== 'string') return null;
  const p = s.trim().replace(/,/g, ' ').split(/\s+/).map(Number);
  return p.length >= 3 && p.every(Number.isFinite) ? p.slice(0, 3) : null;
}

export function extractTemplateEntities(doc) {
  const spawns = [], capzones = [], flags = [], tracks = [];
  const roots = [];
  const findRoots = node => {
    for (const c of node.children || []) {
      if (c.type !== 'block') continue;
      if (/^pointtemplates?$/i.test(c.key)) roots.push(c);
      else findRoots(c);
    }
  };
  findRoots(doc);

  const seenTrack = new Set();
  const collect = node => {
    for (const c of node.children || []) {
      if (c.type !== 'block') continue;
      const cls = c.key;
      const origin = parseVec(getValue(c, 'origin', null));
      const name = getValue(c, 'targetname', null);
      if (SPAWN_CLS.test(cls) && origin && name) {
        spawns.push({ name, origin, disabled: String(getValue(c, 'StartDisabled', '0')) !== '0' });
      } else if (CAPZONE_CLS.test(cls) && origin) {
        capzones.push(origin);
      } else if (FLAG_CLS.test(cls) && origin) {
        flags.push(origin);
      } else if (TRACK_CLS.test(cls) && origin && name && !seenTrack.has(name.toLowerCase())) {
        seenTrack.add(name.toLowerCase());
        tracks.push({ name, origin, target: getValue(c, 'target', null) });
      }
      collect(c);
    }
  };
  for (const r of roots) collect(r);
  return { spawns, capzones, flags, tracks };
}

export function hasTemplateEntities(te) {
  return !!(te && (te.spawns.length || te.capzones.length || te.flags.length || te.tracks.length));
}
