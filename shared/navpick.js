export function sharedPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function rankNavCandidates(candidates, mapName) {
  const out = [];
  for (const c of candidates) {
    let rank = 0;
    let prefix = 0;
    if (c.kind === 'pak') rank = c.name === mapName ? 4 : 3;
    else if (c.name === mapName) rank = 2;
    else {
      prefix = sharedPrefixLen(c.name, mapName);
      rank = (prefix >= 8 && prefix >= c.name.length - 6) ? 1 : 0;
    }
    if (rank > 0) out.push({ ...c, rank, prefix });
  }
  out.sort((a, b) => b.rank - a.rank || b.prefix - a.prefix || (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name));
  return out;
}

export function nearNavNames(candidates, mapName, limit = 8) {
  return [...new Set(candidates
    .filter(c => c.kind !== 'pak' && sharedPrefixLen(c.name, mapName) >= 5)
    .map(c => c.name))].slice(0, limit);
}
