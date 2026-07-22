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
      return { kind: 'sentry', node, count: 1, level: api.getNumber(node, 'Level', 1) };
    }
  },
  {
    id: 'botnpc',
    parse(node, api) {
      return { kind: 'other', node, label: api.getValue(node, 'Name', 'BotNpc'), health: api.getNumber(node, 'Health', 0), count: 1 };
    }
  },
  {
    id: 'halloweenboss',
    parse(node, api) {
      return { kind: 'other', node, label: api.getValue(node, 'BossType', 'HalloweenBoss'), count: 1 };
    }
  },
  {
    id: 'pointtemplate',
    parse(node, api) {
      return { kind: 'other', node, label: api.getValue(node, 'Name', 'PointTemplate'), count: 1 };
    }
  }
]);

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
