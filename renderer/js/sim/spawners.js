import { createRegistry } from './registry.js';

export const spawners = createRegistry('spawner', {
  required: ['parse'],
  optional: ['instantiate', 'requires']
});

spawners.registerAll([
  {
    id: 'tfbot',
    parse(node, api) {
      return { kind: 'bot', node, bot: api.resolveBot(node), count: 1 };
    },
    instantiate(sp) {
      return { entries: [{ bot: sp.bot }], squad: false };
    }
  },
  {
    id: 'tank',
    parse(node, api) {
      return {
        kind: 'tank', node, count: 1,
        health: api.getNumber(node, 'Health', 50000),
        speed: api.getNumber(node, 'Speed', 75),
        name: api.getValue(node, 'Name', 'tankboss'),
        icon: api.getValue(node, 'ClassIcon', null),
        startNode: api.getValue(node, 'StartingPathTrackNode', null)
      };
    }
  },
  {
    id: 'squad',
    parse(node, api) {
      const children = api.parseChildren(node);
      return { kind: 'squad', node, children, count: children.reduce((s, c) => s + c.count, 0) };
    },
    instantiate(sp, api) {
      const entries = [];
      for (const c of sp.children || []) entries.push(...api.instantiate(c).entries);
      return { entries, squad: true };
    }
  },
  {
    id: 'randomchoice',
    parse(node, api) {
      const children = api.parseChildren(node);
      return { kind: 'random', node, children, count: 1, placement: false };
    },
    instantiate(sp, api) {
      const kids = (sp.children || []).filter(Boolean);
      if (!kids.length) return { entries: [], squad: false };
      return api.instantiate(kids[Math.floor(api.rng() * kids.length)]);
    }
  },
  {
    id: 'randomplacement',
    parse(node, api) {
      const children = api.parseChildren(node);
      return { kind: 'random', node, children, placement: true, count: Math.max(1, api.getNumber(node, 'Count', children.length)) };
    }
  },
  {
    id: 'mob',
    parse(node, api) {
      const children = api.parseChildren(node);
      return { kind: 'mob', node, children, count: Math.max(1, api.getNumber(node, 'Count', 1)) };
    }
  },
  {
    id: 'sentrygun',
    parse(node, api) {
      const level = api.getNumber(node, 'Level', 1);
      return staticEntity(node, api, 'sentry', {
        entityKind: 'sentry', label: 'Sentry Gun', level,
        icon: 'sentry_' + level, defaultTeam: 2
      });
    },
    instantiate: instantiateStatic
  },
  {
    id: 'botnpc',
    parse(node, api) {
      return staticEntity(node, api, 'other', { entityKind: 'botnpc', label: api.getValue(node, 'Name', 'BotNpc') });
    },
    instantiate: instantiateStatic
  },
  {
    id: 'halloweenboss',
    parse(node, api) {
      return staticEntity(node, api, 'other', {
        entityKind: 'boss', label: api.getValue(node, 'BossType', 'HalloweenBoss'),
        icon: api.getValue(node, 'ClassIcon', null)
      });
    },
    instantiate: instantiateStatic
  },
  {
    id: 'pointtemplate',
    parse(node, api) {
      return staticEntity(node, api, 'other', { entityKind: 'template', label: api.getValue(node, 'Name', 'PointTemplate') });
    },
    instantiate: instantiateStatic
  }
]);

function parseOrigin(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().split(/\s+/).map(Number);
  return p.length >= 3 && p.every(Number.isFinite) ? p : null;
}

function staticEntity(node, api, kind, base) {
  return {
    kind, node, count: 1, static: true,
    origin: parseOrigin(api.getValue(node, 'Origin', null)),
    health: api.getNumber(node, 'Health', 0),
    icon: base.icon ?? api.getValue(node, 'ClassIcon', null),
    team: api.getNumber(node, 'TeamNum', base.defaultTeam ?? 3),
    entityKind: base.entityKind,
    label: base.label,
    level: base.level
  };
}

function instantiateStatic(sp) {
  return { entries: [{ prop: sp }], squad: false };
}

export const SPAWNER_KEYS = new Set(spawners.ids());

export function parseSpawnerNode(node, api) {
  const entry = spawners.get(node.key.toLowerCase());
  if (!entry) return { kind: 'other', node, label: node.key, count: 1 };
  return entry.parse(node, api);
}

export function instantiateSpawner(sp, api) {
  if (!sp) return { entries: [], squad: false };
  const entry = sp.node ? spawners.get(sp.node.key.toLowerCase()) : null;
  if (entry && entry.instantiate) return entry.instantiate(sp, api);
  return { entries: api.collect(sp), squad: false };
}
