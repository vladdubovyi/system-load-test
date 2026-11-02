import type { Objectives } from './flow-types';
import type { ObjectiveResult } from './types';

/**
 * End-of-run objective evaluation (docs/specs/flow-correctness.md §6).
 *
 * A run is won when the design survives *and* every objective is met. Each
 * failed objective carries the dominant cause: the flow step most of its
 * requests died on, or failing that the component that dropped them.
 */

/** Everything the evaluator needs from a finished run. */
export interface RunCounts {
  totalSpawned: number;
  totalViolated: number;
  spawnedByKind: Record<string, number>;
  completedByKind: Record<string, number>;
  violatedByKind: Record<string, number>;
  droppedByKind: Record<string, number>;
  /** Violation tallies keyed `${kind}:${stepId}`. */
  violationsByStep: Record<string, number>;
  /** Drop tallies keyed `${kind}:${normalized reason}`. */
  dropReasons: Record<string, number>;
  /** Labels of components that failed under load. */
  brokenServices: string[];
}

export const EMPTY_COUNTS: RunCounts = {
  totalSpawned: 0,
  totalViolated: 0,
  spawnedByKind: {},
  completedByKind: {},
  violatedByKind: {},
  droppedByKind: {},
  violationsByStep: {},
  dropReasons: {},
  brokenServices: [],
};

function pct(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

/** Highest-count entry whose key starts with `${kind}:`, or null. */
function topForKind(
  tally: Record<string, number>,
  kind: string
): { detail: string; count: number } | null {
  let best: { detail: string; count: number } | null = null;
  for (const [key, count] of Object.entries(tally)) {
    if (!key.startsWith(`${kind}:`)) continue;
    if (!best || count > best.count) {
      best = { detail: key.slice(kind.length + 1), count };
    }
  }
  return best;
}

/** Highest-count entry across every kind. */
function topOverall(
  tally: Record<string, number>
): { kind: string; detail: string; count: number } | null {
  let best: { kind: string; detail: string; count: number } | null = null;
  for (const [key, count] of Object.entries(tally)) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    if (!best || count > best.count) {
      best = {
        kind: key.slice(0, separator),
        detail: key.slice(separator + 1),
        count,
      };
    }
  }
  return best;
}

/**
 * Why did requests of this kind not complete? Flow violations are the more
 * actionable explanation, so they win over drops when both occurred. With
 * neither, the shortfall is simply requests still in flight when the clock
 * ran out — a latency problem, not a correctness one.
 */
function causeForKind(counts: RunCounts, kind: string): string {
  const step = topForKind(counts.violationsByStep, kind);
  if (step) {
    return `Most ${kind} requests died at flow step "${step.detail}" (${step.count.toLocaleString()} violations) — the next required component is not reachable.`;
  }

  const drop = topForKind(counts.dropReasons, kind);
  if (drop) {
    return `Most ${kind} requests were dropped: ${drop.detail} (${drop.count.toLocaleString()}).`;
  }

  const spawned = counts.spawnedByKind[kind] ?? 0;
  const completed = counts.completedByKind[kind] ?? 0;
  const unfinished = Math.max(0, spawned - completed);
  return `${unfinished.toLocaleString()} ${kind} requests were still in flight when the run ended — the path is correct but too slow.`;
}

export function evaluateObjectives(
  objectives: Objectives | undefined,
  counts: RunCounts
): ObjectiveResult[] {
  const results: ObjectiveResult[] = [];

  if (objectives) {
    for (const [kind, min] of Object.entries(objectives.minCompletionRate ?? {})) {
      const spawned = counts.spawnedByKind[kind] ?? 0;
      const completed = counts.completedByKind[kind] ?? 0;
      const rate = spawned > 0 ? completed / spawned : 1;
      const met = rate >= min;

      results.push({
        id: `completion:${kind}`,
        label: `${kind} completion rate`,
        target: `≥ ${pct(min)}`,
        actual:
          spawned > 0
            ? `${pct(rate)} (${completed.toLocaleString()} of ${spawned.toLocaleString()})`
            : 'no requests of this kind',
        met,
        cause: met ? undefined : causeForKind(counts, kind),
      });
    }

    const maxViolationRate = objectives.maxViolationRate ?? 0;
    const violationRate =
      counts.totalSpawned > 0 ? counts.totalViolated / counts.totalSpawned : 0;
    const violationsMet = violationRate <= maxViolationRate;
    const topViolation = topOverall(counts.violationsByStep);

    results.push({
      id: 'violations',
      label: maxViolationRate === 0 ? 'No flow violations' : 'Flow violations',
      target: `≤ ${pct(maxViolationRate)}`,
      actual: `${pct(violationRate)} (${counts.totalViolated.toLocaleString()} requests)`,
      met: violationsMet,
      cause:
        violationsMet || !topViolation
          ? undefined
          : `Most violations: ${topViolation.kind} requests at flow step "${topViolation.detail}" (${topViolation.count.toLocaleString()}).`,
    });
  }

  if (objectives?.noComponentFailures !== false) {
    const broken = counts.brokenServices;
    results.push({
      id: 'failures',
      label: 'No component failures',
      target: '0 failed',
      actual: broken.length === 0 ? 'all components healthy' : `${broken.length} failed`,
      met: broken.length === 0,
      cause:
        broken.length === 0
          ? undefined
          : `${broken.join(', ')} overloaded and stopped serving traffic.`,
    });
  }

  return results;
}

export function allObjectivesMet(results: ObjectiveResult[]): boolean {
  return results.every((result) => result.met);
}
