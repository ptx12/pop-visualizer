import { createRegistry } from './registry.js';
import { separation } from './systems/separation.js';
import { healing } from './systems/healing.js';
import { bombFollow, record, bombTrail } from './systems/record.js';
import { damageZones } from './systems/damage.js';

export const systems = createRegistry('system', {
  required: ['step'],
  optional: ['init', 'requires']
});

systems.registerAll([separation, healing, bombFollow, record, damageZones, bombTrail]);

export function buildPipeline(ctx, capabilities) {
  const active = systems.enabled(capabilities);
  const state = new Map();
  for (const s of active) if (s.init) state.set(s.id, s.init(ctx));
  return {
    ids: active.map(s => s.id),
    run(t, dt) {
      for (const s of active) s.step(ctx, t, dt, state.get(s.id));
    }
  };
}
