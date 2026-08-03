export const KILL_RADIUS = 200;

export const killRadiusOf = kp => kp[2] || KILL_RADIUS;

export function killPointAt(list, wx, wy) {
  let hit = -1, bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const r = killRadiusOf(list[i]);
    const d = (list[i][0] - wx) ** 2 + (list[i][1] - wy) ** 2;
    if (d < r * r && d < bestD) { bestD = d; hit = i; }
  }
  return hit;
}

export function inKillZone(list, x, y) {
  for (const kp of list) {
    const r = killRadiusOf(kp);
    if ((kp[0] - x) ** 2 + (kp[1] - y) ** 2 < r * r) return true;
  }
  return false;
}

export function killPointsFor(mapName) {
  try { return JSON.parse(localStorage.getItem('popvis.killpts.' + mapName) || '[]') || []; } catch { return []; }
}

export function saveKillPoints(mapName, list) {
  if (list.length) localStorage.setItem('popvis.killpts.' + mapName, JSON.stringify(list));
  else localStorage.removeItem('popvis.killpts.' + mapName);
}
