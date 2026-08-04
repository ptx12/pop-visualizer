export const PLAYBACK_UNAVAILABLE_NOTE = 'Bot movement playback is being rebuilt on the compiled Source simulation.';

export function botPlaybackAvailable() {
  return false;
}

export function createBotSim() {
  return {
    stepMany: () => true,
    progress: () => 1,
    result: () => ({ actors: [], end: 0, unavailable: true, note: PLAYBACK_UNAVAILABLE_NOTE })
  };
}

export function actorPosAt() {
  return null;
}

export function actorZAt() {
  return 0;
}

export function actorYawAt() {
  return 0;
}

export function actorDistAt() {
  return 0;
}
