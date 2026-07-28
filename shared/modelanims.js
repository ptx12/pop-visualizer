const FORWARD_RUN = /run_?n(?![ew])/i;
const FORWARD_POSE = /pose_?n(?![ew])/i;

export function animsForActivity(mdl, activity) {
  const want = String(activity).toLowerCase();
  const names = [];
  for (const s of mdl.sequences) {
    if (String(s.activity || '').toLowerCase() !== want) continue;
    for (const idx of s.blends) {
      const a = mdl.anims[idx];
      if (a && a.numframes > 0 && !names.includes(a.name)) names.push(a.name);
    }
  }
  if (!names.length) return null;
  return names.find(n => FORWARD_RUN.test(n))
    || names.find(n => FORWARD_POSE.test(n))
    || names.find(n => /runcenter/i.test(n))
    || names[0];
}

export function resolveActivities(mdl, activities) {
  const out = new Map();
  for (const act of activities) {
    const name = animsForActivity(mdl, act);
    if (name) out.set(act, name);
  }
  return out;
}

export function includeBases(mdl, base) {
  const out = (mdl.includemodels || []).map(n => n.replace(/\.mdl$/i, '').toLowerCase());
  if (!out.length) out.push(String(base).toLowerCase() + '_animations');
  return out;
}
