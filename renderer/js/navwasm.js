let mod = null;
let loading = null;

async function wasmBytes() {
  if (typeof window !== 'undefined' && window.popnative && window.popnative.navKernel) {
    const buf = await window.popnative.navKernel();
    if (!buf) throw new Error('navkernel.wasm not found');
    return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
  }
  const url = new URL('../../shared/navkernel.wasm', import.meta.url);
  if (typeof fetch === 'function' && url.protocol !== 'file:') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('navkernel.wasm ' + res.status);
    return await res.arrayBuffer();
  }
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(url);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function initNavWasm() {
  if (mod) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const bytes = await wasmBytes();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      mod = instance.exports;
      return true;
    } catch {
      mod = null;
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function navWasmReady() {
  return !!mod;
}

function upload(areas, weights) {
  const n = areas.length;
  const flat = new Float64Array(n * 10);
  const conns = [];
  for (let i = 0; i < n; i++) {
    const a = areas[i];
    const b = i * 10;
    flat[b] = a.id;
    flat[b + 1] = a.nw[0];
    flat[b + 2] = a.nw[1];
    flat[b + 3] = a.nw[2];
    flat[b + 4] = a.se[0];
    flat[b + 5] = a.se[1];
    flat[b + 6] = a.se[2];
    flat[b + 7] = weights.get(a.id) || 1;
    flat[b + 8] = conns.length;
    flat[b + 9] = a.connect.length;
    for (const c of a.connect) conns.push(c);
  }
  const connArr = new Int32Array(conns);
  const aPtr = mod.alloc(flat.byteLength);
  const cPtr = mod.alloc(Math.max(4, connArr.byteLength));
  new Float64Array(mod.memory.buffer, aPtr, flat.length).set(flat);
  if (connArr.length) new Int32Array(mod.memory.buffer, cPtr, connArr.length).set(connArr);
  mod.nav_build(aPtr, n, cPtr, connArr.length);
}

export function buildNavGraphWasm(mapData, weights) {
  if (!mod) return null;
  const areas = (mapData.nav && mapData.nav.areas) || [];
  const byId = new Map();
  for (const a of areas) byId.set(a.id, a);
  if (!areas.length) return null;
  upload(areas, weights || new Map());

  const outAddr = mod.out_ptr();
  let outView = new Float64Array(mod.memory.buffer, outAddr, 8);
  const out = () => {
    if (outView.buffer !== mod.memory.buffer) outView = new Float64Array(mod.memory.buffer, outAddr, 8);
    return outView;
  };
  const centers = new Map();
  for (const a of areas) centers.set(a.id, [(a.nw[0] + a.se[0]) / 2, (a.nw[1] + a.se[1]) / 2, (a.nw[2] + a.se[2]) / 2]);

  const maxId = mod.nav_max_id();
  const fieldCache = new Map();

  const zOf = p => (p.length > 2 && p[2] !== undefined ? p[2] : NaN);

  function nearestArea(p) {
    const id = mod.nav_nearest(p[0], p[1], zOf(p));
    return id < 0 ? null : byId.get(id) || null;
  }

  function areaAt(p, hintId) {
    const id = mod.nav_area_at(p[0], p[1], zOf(p), hintId == null ? -1 : hintId);
    return id < 0 ? null : byId.get(id) || null;
  }

  function flowField(targetId) {
    if (targetId == null || targetId < 0) return null;
    if (fieldCache.has(targetId)) return fieldCache.get(targetId);
    const cap = maxId + 1;
    const ptr = mod.alloc(cap * 8);
    const ok = mod.nav_field_by_id(targetId, ptr, cap);
    if (!ok) return null;
    const arr = new Float64Array(mod.memory.buffer, ptr, cap).slice();
    const field = {
      targetId,
      dist: {
        get(id) {
          const v = arr[id];
          return v === undefined || !isFinite(v) ? undefined : v;
        },
        values() {
          const vals = [];
          for (const v of arr) if (isFinite(v)) vals.push(v);
          return vals;
        }
      }
    };
    fieldCache.set(targetId, field);
    return field;
  }

  function nextToward(field, areaId) {
    if (!field || areaId == null) return null;
    const id = mod.nav_next_toward(field.targetId, areaId);
    return id < 0 ? null : id;
  }

  function portal(aId, bId) {
    if (aId == null || bId == null) return null;
    if (!mod.nav_portal(aId, bId)) return null;
    const o = out();
    return [o[0], o[1]];
  }

  function center(id) {
    if (id == null) return null;
    if (!mod.nav_center(id)) return null;
    const o = out();
    return [o[0], o[1], o[2]];
  }

  function applyOut(a, ret) {
    const o = outView.buffer === mod.memory.buffer ? outView : out();
    a.pos[0] = o[0];
    a.pos[1] = o[1];
    const na = o[3];
    if (na >= 0) {
      a.areaId = na;
      a.z = o[2];
    }
    return ret;
  }

  function moveAlong(a, targetPt, dt, speed) {
    const ret = mod.move_along(a.pos[0], a.pos[1], NaN, a.areaId == null ? -1 : a.areaId, targetPt[0], targetPt[1], zOf(targetPt), dt, speed);
    return applyOut(a, ret);
  }

  function moveField(a, field, targetPt, dt, speed) {
    if (!field) return moveAlong(a, targetPt, dt, speed);
    const ret = mod.move_field(a.pos[0], a.pos[1], NaN, a.areaId == null ? -1 : a.areaId, field.targetId, targetPt[0], targetPt[1], zOf(targetPt), dt, speed);
    return applyOut(a, ret);
  }

  return { byId, centers, nearestArea, areaAt, flowField, nextToward, portal, center, moveAlong, moveField, wasm: true };
}
