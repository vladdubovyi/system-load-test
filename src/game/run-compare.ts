import { diffBoards, type BoardState } from './board-diff';
import { getActiveConfigBadges, type ComponentInstanceConfig } from './component-config';
import { formatCost } from './report';
import type { FlowKindStat, ObjectiveResult, PlacedComponent, SimulationReport } from './types';

/**
 * Same-seed A/B comparison (docs/specs/product-directions.md §4.3): pure
 * helpers behind the report's "Compare to A" panel. Nothing here persists
 * anything — a pinned run is tab memory held by the sandbox.
 */

export interface ComparedObjective {
  id: string;
  label: string;
  a: ObjectiveResult | null;
  b: ObjectiveResult | null;
}

export interface ComparedFlow {
  kind: string;
  a: FlowKindStat | null;
  b: FlowKindStat | null;
}

export interface ComparedMetric {
  id: string;
  label: string;
  a: string;
  b: string;
  /** Which side is better, when the metric has a direction. */
  better: 'a' | 'b' | null;
}

export interface RunComparison {
  sameSeed: boolean;
  seedA: number;
  seedB: number;
  objectives: ComparedObjective[];
  flows: ComparedFlow[];
  metrics: ComparedMetric[];
}

function metric(
  id: string,
  label: string,
  a: number,
  b: number,
  format: (n: number) => string,
  direction: 'higher' | 'lower' | 'none'
): ComparedMetric {
  let better: 'a' | 'b' | null = null;
  if (direction !== 'none' && a !== b) {
    const aWins = direction === 'higher' ? a > b : a < b;
    better = aWins ? 'a' : 'b';
  }
  return { id, label, a: format(a), b: format(b), better };
}

const pct = (n: number): string => `${n.toFixed(1)}%`;
const count = (n: number): string => n.toLocaleString();
const plain = (n: number): string => String(n);

/** Align two reports row by row. Seeds are compared, not enforced: the caller decides what to show. */
export function compareReports(a: SimulationReport, b: SimulationReport): RunComparison {
  const objectiveIds = [...new Set([...a.objectives.map((o) => o.id), ...b.objectives.map((o) => o.id)])];
  const objectives: ComparedObjective[] = objectiveIds.map((id) => {
    const oa = a.objectives.find((o) => o.id === id) ?? null;
    const ob = b.objectives.find((o) => o.id === id) ?? null;
    return { id, label: (ob ?? oa)!.label, a: oa, b: ob };
  });

  const kinds = [...new Set([...a.flowStats.map((f) => f.kind), ...b.flowStats.map((f) => f.kind)])];
  const flows: ComparedFlow[] = kinds.map((kind) => ({
    kind,
    a: a.flowStats.find((f) => f.kind === kind) ?? null,
    b: b.flowStats.find((f) => f.kind === kind) ?? null,
  }));

  const metrics: ComparedMetric[] = [
    metric('score', 'Score', a.score, b.score, plain, 'higher'),
    { id: 'grade', label: 'Grade', a: a.grade, b: b.grade, better: null },
    metric('successRate', 'Success rate', a.successRate, b.successRate, pct, 'higher'),
    metric('completed', 'Completed', a.totalCompleted, b.totalCompleted, count, 'higher'),
    metric('dropped', 'Dropped', a.totalDropped, b.totalDropped, count, 'lower'),
    metric('violated', 'Flow violations', a.totalViolated, b.totalViolated, count, 'lower'),
    metric('availability', 'Availability', a.availabilityPct, b.availabilityPct, pct, 'higher'),
    metric('broken', 'Broken services', a.brokenServices.length, b.brokenServices.length, count, 'lower'),
    metric('cost', 'Monthly cost', a.totalCost, b.totalCost, formatCost, 'lower'),
  ];

  return { sameSeed: a.seed === b.seed, seedA: a.seed, seedB: b.seed, objectives, flows, metrics };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * The board changes between two designs, in words: components added or
 * removed by label, configuration chips turned on or off per component, and
 * the net change in connections. Annotations are ignored — they do not run.
 */
export function summarizeBoardChanges(before: BoardState, after: BoardState): string[] {
  const diff = diffBoards(before, after);
  const lines: string[] = [];

  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const change of diff.changes) {
    if (change.kind !== 'component') continue;
    if (change.before === null && change.after) bump(added, (change.after as PlacedComponent).label);
    else if (change.after === null && change.before) bump(removed, (change.before as PlacedComponent).label);
  }
  for (const [label, n] of added) lines.push(`+${n} ${label}`);
  for (const [label, n] of removed) lines.push(`−${n} ${label}`);

  for (const change of diff.changes) {
    if (change.kind !== 'config') continue;
    const component =
      after.components.find((c) => c.id === change.id) ?? before.components.find((c) => c.id === change.id);
    if (!component) continue;
    const labels = (config: unknown): Set<string> =>
      new Set(getActiveConfigBadges(component, (config as ComponentInstanceConfig | null) ?? undefined).map((b) => b.label));
    const wasOn = labels(change.before);
    const isOn = labels(change.after);
    const on = [...isOn].filter((l) => !wasOn.has(l)).map((l) => `+${l}`);
    const off = [...wasOn].filter((l) => !isOn.has(l)).map((l) => `−${l}`);
    if (on.length > 0 || off.length > 0) lines.push(`${component.label}: ${[...on, ...off].join(', ')}`);
  }

  const beltDelta = diff.changes
    .filter((c) => c.kind === 'belt')
    .reduce((n, c) => n + (c.before === null ? 1 : 0) - (c.after === null ? 1 : 0), 0);
  if (beltDelta !== 0) {
    const n = Math.abs(beltDelta);
    lines.push(`${beltDelta > 0 ? '+' : '−'}${n} connection${n === 1 ? '' : 's'}`);
  }

  return lines;
}
