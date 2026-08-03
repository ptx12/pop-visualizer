import { createRegistry } from './registry.js';
import { fetchFlag, deliverFlag, deployBomb, escortFlagCarrier, pushToPoint } from './behaviours/bomb.js';
import { escortSquadLeader } from './behaviours/squad.js';
import { medicHeal, spyLeaveSpawn, spyLurk, engineerToNest, engineerBuild, busterToSentry, gatebotToGate, sniperToSpot, sniperLurk, idle } from './behaviours/support.js';

export const behaviours = createRegistry('behaviour', {
  required: ['step'],
  optional: ['selects', 'enter', 'requires']
});

behaviours.registerAll([
  idle, escortSquadLeader, busterToSentry, gatebotToGate, sniperToSpot, sniperLurk, spyLeaveSpawn, engineerToNest, medicHeal, pushToPoint, fetchFlag,
  deliverFlag, deployBomb, escortFlagCarrier, spyLurk, engineerBuild
]);

const ACTION_BEHAVIOUR = {
  fetchflag: 'fetchFlag',
  escortflag: 'escortFlagCarrier',
  pushtocapturepoint: 'pushToPoint',
  sniper: 'sniperToSpot',
  medic: 'medicHeal',
  spy: 'spyLeaveSpawn',
  suicidebomber: 'busterToSentry',
  idle: 'idle',
  passive: 'idle'
};

export function behaviourForAction(action) {
  return ACTION_BEHAVIOUR[String(action || '').trim().toLowerCase()] || null;
}

export function selectBehaviour(a, ctx, capabilities) {
  const enabled = behaviours.enabled(capabilities);
  const forced = a.bot && behaviourForAction(a.bot.action);
  if (forced) {
    const hit = enabled.find(b => b.id === forced);
    if (hit) return hit;
  }
  for (const b of enabled) {
    if (b.selects && b.selects(a, ctx)) return b;
  }
  return null;
}
