import type { TrafficPhase } from './scenario-types';

/**
 * Multi-phase traffic (docs/specs/product-directions.md §3.4). Pure helpers
 * the engine reads every tick: `baseRps` interpolates linearly between the
 * phase points and holds the last value after them; the request mix is a
 * step function that switches at each point. Before the first point both
 * fall back to the scenario's flat values. No randomness here, so phases add
 * nothing to the seeded stream.
 */

export function sortPhases(phases: TrafficPhase[] | undefined): TrafficPhase[] {
  return [...(phases ?? [])].sort((a, b) => a.atSeconds - b.atSeconds);
}

/** Base RPS at `time`, given the flat `base` and sorted `phases`. */
export function baseRpsAt(base: number, phases: TrafficPhase[], time: number): number {
  const points = phases.filter((p) => typeof p.baseRps === 'number');
  if (points.length === 0 || time < points[0].atSeconds) return base;
  let previous = points[0];
  for (const point of points) {
    if (time < point.atSeconds) {
      const span = point.atSeconds - previous.atSeconds;
      if (span <= 0) return point.baseRps!;
      const t = (time - previous.atSeconds) / span;
      return previous.baseRps! + (point.baseRps! - previous.baseRps!) * t;
    }
    previous = point;
  }
  return previous.baseRps!;
}

/** Request mix at `time`: the latest phase at or before it that sets one, else `base`. */
export function requestTypesAt(
  base: Record<string, number>,
  phases: TrafficPhase[],
  time: number
): Record<string, number> {
  let current = base;
  for (const phase of phases) {
    if (phase.atSeconds > time) break;
    if (phase.requestTypes && Object.keys(phase.requestTypes).length > 0) current = phase.requestTypes;
  }
  return current;
}
