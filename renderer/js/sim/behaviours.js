import { createRegistry } from './registry.js';
import { fetchFlag, deliverFlag, deployBomb, escortFlagCarrier, pushToPoint } from './behaviours/bomb.js';
import { escortSquadLeader } from './behaviours/squad.js';
import { medicHeal, spyLeaveSpawn, spyLurk, engineerToNest, engineerBuild, busterToSentry, gatebotToGate, sniperToSpot, sniperLurk } from './behaviours/support.js';

export const behaviours = createRegistry('behaviour', {
  required: ['step'],
  optional: ['selects', 'enter', 'requires']
});

behaviours.registerAll([
  escortSquadLeader, busterToSentry, gatebotToGate, sniperToSpot, sniperLurk, spyLeaveSpawn, engineerToNest, medicHeal, pushToPoint, fetchFlag,
  deliverFlag, deployBomb, escortFlagCarrier, spyLurk, engineerBuild
]);

export function selectBehaviour(a, ctx, capabilities) {
  for (const b of behaviours.enabled(capabilities)) {
    if (b.selects && b.selects(a, ctx)) return b;
  }
  return null;
}
