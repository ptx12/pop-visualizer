import { buildNavGraph, navAreaZ } from '../renderer/js/botai.js';
import { initNavWasm, navWasmReady, buildNavGraphWasm } from '../renderer/js/navwasm.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

function corridor(n) {
  const areas = [];
  for (let i = 0; i < n; i++) {
    const connect = [];
    if (i > 0) connect.push(i - 1);
    if (i < n - 1) connect.push(i + 1);
    if (i % 7 === 3 && i + 4 < n) connect.push(i + 4);
    areas.push({
      id: i,
      nw: [i * 200, 0, i * 8],
      se: (i + 1) * 200 === 0 ? [200, 300, i * 8] : [(i + 1) * 200, 300, i * 8],
      neZ: i * 8, swZ: i * 8,
      connect, tfAttributes: 0
    });
  }
  return { nav: { areas }, spawns: [], flags: [], capzones: [], redSpawns: [], hints: [], tracks: [], navVolumes: [], pathProps: [] };
}

const ok = await initNavWasm();
check('navkernel.wasm loads', ok && navWasmReady());
if (!ok) {
  console.log('\nnavkernel.wasm missing or invalid — run npm run build:wasm');
  process.exit(1);
}

const mapData = corridor(60);
const wasmG = buildNavGraphWasm(mapData, new Map());
check('wasm graph builds', !!wasmG && wasmG.wasm === true);

const jsG = buildNavGraphManually(mapData);

function buildNavGraphManually(md) {
  const g = buildNavGraph(md, [], false);
  function moveAlong(a, targetPt, dt, speed) {
    const dx0 = targetPt[0] - a.pos[0], dy0 = targetPt[1] - a.pos[1];
    const straight = Math.hypot(dx0, dy0);
    let wp = targetPt;
    let crossing = null;
    if (a.areaId != null) {
      const tArea = g.areaAt(targetPt, null);
      if (tArea && tArea.id !== a.areaId) {
        const next = g.nextToward(g.flowField(tArea.id), a.areaId);
        if (next != null) {
          crossing = next;
          const p = g.portal(a.areaId, next);
          if (p) wp = p;
        }
      }
    }
    let dx = wp[0] - a.pos[0], dy = wp[1] - a.pos[1];
    const d = Math.hypot(dx, dy) || 1;
    const stepLen = Math.min(d, speed * dt);
    const s = g.settle(a.pos[0], a.pos[1], a.z, a.pos[0] + dx / d * stepLen, a.pos[1] + dy / d * stepLen, a.areaId, crossing);
    a.pos[0] = s.pos[0];
    a.pos[1] = s.pos[1];
    if (s.area) { a.areaId = s.area.id; a.z = navAreaZ(s.area, a.pos[0], a.pos[1]); }
    return straight;
  }
  return { ...g, moveAlong };
}

const pts = [];
for (let i = 0; i < 400; i++) {
  pts.push([(i * 137) % 12000 - 500, (i * 61) % 500 - 100]);
  pts.push([(i * 89) % 12000, (i * 43) % 300, (i * 7) % 500]);
}

let mismatch = 0;
for (const p of pts) {
  const a = jsG.nearestArea(p);
  const b = wasmG.nearestArea(p);
  if ((a ? a.id : -1) !== (b ? b.id : -1)) mismatch++;
}
check('nearestArea matches JS on 800 points', mismatch === 0, mismatch + ' mismatches');

mismatch = 0;
for (const p of pts) {
  for (const hint of [null, 0, 12, 59]) {
    const a = jsG.areaAt(p, hint);
    const b = wasmG.areaAt(p, hint);
    if ((a ? a.id : -1) !== (b ? b.id : -1)) mismatch++;
  }
}
check('areaAt matches JS across hints', mismatch === 0, mismatch + ' mismatches');

const jsF = jsG.flowField(0);
const wF = wasmG.flowField(0);
let dmax = 0, stepMismatch = 0;
for (const a of mapData.nav.areas) {
  const dj = jsF.dist.get(a.id);
  const dw = wF.dist.get(a.id);
  if ((dj === undefined) !== (dw === undefined)) { stepMismatch++; continue; }
  if (dj !== undefined) dmax = Math.max(dmax, Math.abs(dj - dw));
  const nj = jsG.nextToward(jsF, a.id);
  const nw = wasmG.nextToward(wF, a.id);
  if ((nj ?? -1) !== (nw ?? -1)) stepMismatch++;
}
check('flowField distances match JS', dmax < 1e-9, 'max delta ' + dmax);
check('nextToward matches JS for every area', stepMismatch === 0, stepMismatch + ' mismatches');

let pMismatch = 0;
for (let i = 0; i < mapData.nav.areas.length - 1; i++) {
  const a = jsG.portal(i, i + 1);
  const b = wasmG.portal(i, i + 1);
  if (!a || !b || Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9) pMismatch++;
}
check('portal midpoints match JS', pMismatch === 0, pMismatch + ' mismatches');

const graph = buildNavGraph(mapData, []);
check('buildNavGraph prefers wasm when loaded', graph.wasm === true);

let walkDelta = 0;
let cutThrough = 0;
for (const start of [0, 5, 23, 41]) {
  const target = [mapData.nav.areas[Math.min(start + 6, 59)].nw[0] + 95, 150];
  const aJs = { pos: [mapData.nav.areas[start].nw[0] + 95, 150], areaId: start, z: 0 };
  const aWa = { pos: aJs.pos.slice(), areaId: start, z: 0 };
  for (let i = 0; i < 60; i++) {
    jsG.moveAlong(aJs, target, 0.25, 300);
    wasmG.moveAlong(aWa, target, 0.25, 300);
    walkDelta = Math.max(walkDelta, Math.abs(aJs.pos[0] - aWa.pos[0]), Math.abs(aJs.pos[1] - aWa.pos[1]));
    if (wasmG.areaAt(aWa.pos, aWa.areaId) === null) cutThrough++;
  }
}
check('moveAlong matches JS step for step', walkDelta < 1e-9, 'max delta ' + walkDelta);
check('moveAlong never leaves the mesh', cutThrough === 0, cutThrough + ' off-mesh steps');

let escaped = 0;
let escapedJs = 0;
for (const off of [[0, -9000], [40000, 150], [3000, 8000], [-6000, -6000]]) {
  const aWa = { pos: [mapData.nav.areas[10].nw[0] + 95, 150], areaId: 10, z: 0 };
  const aJs = { pos: aWa.pos.slice(), areaId: 10, z: 0 };
  for (let i = 0; i < 80; i++) {
    wasmG.moveAlong(aWa, off, 0.25, 400);
    jsG.moveAlong(aJs, off, 0.25, 400);
    if (!jsG.areaContaining(aWa.pos[0], aWa.pos[1], aWa.z, aWa.areaId)) escaped++;
    if (!jsG.areaContaining(aJs.pos[0], aJs.pos[1], aJs.z, aJs.areaId)) escapedJs++;
  }
}
check('wasm bots never step off the mesh chasing an unreachable point', escaped === 0, escaped + ' off-mesh steps');
check('JS bots never step off the mesh chasing an unreachable point', escapedJs === 0, escapedJs + ' off-mesh steps');

const far = { pos: [mapData.nav.areas[0].nw[0] + 95, 150], areaId: 0, z: 0 };
const nearTarget = [mapData.nav.areas[1].nw[0] + 95, 150];
wasmG.moveAlong(far, nearTarget, 0.25, 300);
const viaPortal = wasmG.portal(0, 1);
check('short cross-area hops route through the portal',
  Math.abs(far.pos[1] - viaPortal[1]) < Math.abs(far.pos[1] - nearTarget[1]) + 1e-9,
  'moved to ' + far.pos.map(v => v.toFixed(1)).join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
