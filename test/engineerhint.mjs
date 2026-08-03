import { findEngineerNest } from '../renderer/js/sim/behaviours/support.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const nests = [
  { name: 'onbomb', origin: [0, 0, 0] },
  { name: 'close', origin: [900, 0, 0] },
  { name: 'behind_near', origin: [-1400, 0, 0] },
  { name: 'behind_far', origin: [-2600, 0, 0] },
  { name: 'way_behind', origin: [-9000, 0, 0] },
  { name: 'ahead', origin: [6000, 0, 0] }
];

const ctxFor = (bombX, outside) => ({
  nests,
  bomb: { pos: [bombX, 0, 0] },
  hatchDistAt: p => 20000 - p[0],
  hatchDistOutsideSpawns: () => outside
});

const seed = () => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };

function sample(ctx, n = 400, t = 0) {
  const r = seed();
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const hit = findEngineerNest(ctx, r, t);
    seen.add(hit ? hit.name : 'none');
  }
  return seen;
}

const midMap = sample(ctxFor(0, 999999));
check('a nest sitting on the bomb is never chosen — the game requires 1300u of separation',
  !midMap.has('onbomb'), [...midMap].join(','));
check('a nest inside the 1300u exclusion is never chosen',
  !midMap.has('close'), [...midMap].join(','));
check('nests ahead of the bomb are skipped while legal ones exist',
  !midMap.has('ahead'), [...midMap].join(','));
check('nests more than 3000u behind the bomb are skipped while legal ones exist',
  !midMap.has('way_behind'), [...midMap].join(','));
check('every legal nest behind the bomb can come up, since the game picks at random',
  midMap.has('behind_near') && midMap.has('behind_far'), [...midMap].join(','));

const noneLegal = sample({
  ...ctxFor(0, 999999),
  nests: [{ name: 'onbomb', origin: [0, 0, 0] }, { name: 'ahead', origin: [6000, 0, 0] }]
});
check('with no legal nest the engineer still falls back rather than standing idle',
  !noneLegal.has('none'), [...noneLegal].join(','));

const clamped = sample(ctxFor(-8000, 20000 - 1000));
check('a bomb still in the spawn clamps to the furthest area outside the spawn rooms',
  !clamped.has('none'), [...clamped].join(','));

const gated = {
  ...ctxFor(0, 999999),
  nests: [
    { name: 'early', origin: [-2000, 0, 0], startDisabled: true },
    { name: 'late', origin: [-2200, 0, 0], startDisabled: true }
  ],
  hintLive: (h, t) => (h.name === 'early' ? t < 50 : t >= 50)
};
const before = sample({ ...gated, bomb: gated.bomb }, 60);
check('only the hints the map has switched on are considered', !before.has('late'), [...before].join(','));

let lateSeen = false;
{ const r = seed(); for (let i = 0; i < 60; i++) { const h = findEngineerNest(gated, r, 80); if (h && h.name === 'late') lateSeen = true; } }
check('a hint switched on later becomes available at that time', lateSeen);

let earlyAfter = false;
{ const r = seed(); for (let i = 0; i < 60; i++) { const h = findEngineerNest(gated, r, 80); if (h && h.name === 'early') earlyAfter = true; } }
check('a hint the map switched off is no longer chosen', !earlyAfter);

const onlyAhead = { ...ctxFor(0, 999999), nests: [{ name: 'ahead', origin: [6000, 0, 0] }] };
check('a walking engineer falls back to an out-of-range nest',
  findEngineerNest(onlyAhead, seed(), 0, true) !== null);
check('a TeleportToHint engineer refuses an out-of-range nest, as out_of_range_ok is false for it',
  findEngineerNest(onlyAhead, seed(), 0, false) === null);
check('a TeleportToHint engineer still takes a legal in-band nest',
  findEngineerNest(ctxFor(0, 999999), seed(), 0, false) !== null);

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
