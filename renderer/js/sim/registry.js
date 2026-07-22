const DEFAULT_ORDER = 100;

function fail(name, id, msg) {
  throw new Error(name + ' registry: ' + (id ? '"' + id + '" ' : '') + msg);
}

export function createRegistry(name, contract = {}) {
  const required = contract.required || [];
  const optional = contract.optional || [];
  const known = new Set(['id', 'order', ...required, ...optional]);
  const items = new Map();
  let sorted = null;

  function register(entry) {
    if (!entry || typeof entry !== 'object') fail(name, null, 'entry must be an object');
    const id = entry.id;
    if (typeof id !== 'string' || !id.trim()) fail(name, null, 'entry needs a non-empty string id');
    if (items.has(id)) fail(name, id, 'is already registered');
    for (const key of required) {
      if (typeof entry[key] !== 'function') fail(name, id, 'must define ' + key + '()');
    }
    for (const key of Object.keys(entry)) {
      if (!known.has(key)) fail(name, id, 'has unknown field "' + key + '"');
    }
    if (entry.order !== undefined && !Number.isFinite(entry.order)) fail(name, id, 'order must be a number');
    if (entry.requires !== undefined && !Array.isArray(entry.requires)) fail(name, id, 'requires must be an array');
    items.set(id, Object.freeze({ order: DEFAULT_ORDER, requires: [], ...entry }));
    sorted = null;
    return id;
  }

  function ordered() {
    if (!sorted) {
      sorted = [...items.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      Object.freeze(sorted);
    }
    return sorted;
  }

  return {
    name,
    contract: Object.freeze({ required: [...required], optional: [...optional] }),
    register,
    registerAll(entries) { return entries.map(register); },
    get(id) { return items.get(id) || null; },
    require(id) {
      const found = items.get(id);
      if (!found) fail(name, id, 'is not registered');
      return found;
    },
    has(id) { return items.has(id); },
    ids() { return ordered().map(e => e.id); },
    ordered,
    enabled(capabilities) {
      const caps = capabilities instanceof Set ? capabilities : new Set(capabilities || []);
      return ordered().filter(e => e.requires.every(c => caps.has(c)));
    },
    size() { return items.size; },
    reset() { items.clear(); sorted = null; }
  };
}
