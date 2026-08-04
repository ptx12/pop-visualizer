export const DEFAULT_SIM_OPTS = {
  teamDPS: 1000,
  robotLimit: 22,
  step: 0.5
};

export const SIM_UNAVAILABLE_NOTE = 'Wave simulation is being rebuilt on the compiled Source population manager.';

export function simAvailable() {
  return false;
}

export function simulateWave(wave, opts = {}) {
  const o = { ...DEFAULT_SIM_OPTS, ...opts };
  return {
    results: new Map(),
    waveEnd: 0,
    curve: [],
    peak: 0,
    issues: [],
    opts: o,
    robotLimit: Math.max(1, Math.round(o.robotLimit || 22)),
    missions: o.missions || [],
    probes: o.probes || [],
    unavailable: true,
    note: SIM_UNAVAILABLE_NOTE
  };
}
