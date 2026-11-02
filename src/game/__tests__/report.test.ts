import { describe, expect, it } from 'vitest';
import { buildSimulationReport, type ReportInput } from '../report';
import { EMPTY_COUNTS, type RunCounts } from '../objectives';
import type { ComponentTelemetry, PlacedComponent } from '../types';
import type { ScoringPriorities } from '../scenario-types';

function component(id: string, type: string, label: string): PlacedComponent {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 120,
    height: 72,
    label,
    capacity: 1000,
    queueLimit: 100,
  };
}

function telemetry(overrides: Partial<ComponentTelemetry> = {}): ComponentTelemetry {
  return {
    loadIntegral: 0,
    maxLoad: 0,
    maxQueueFill: 0,
    downtimeSeconds: 0,
    overloadSeconds: 0,
    queuePressureSeconds: 0,
    idleSeconds: 0,
    failedAt: null,
    ...overrides,
  };
}

interface InputOverrides {
  counts?: Partial<RunCounts>;
  scoringPriorities?: ScoringPriorities;
  outcome?: 'won' | 'lost';
  totalCompleted?: number;
  totalDropped?: number;
  failed?: boolean;
  objectives?: ReportInput['objectives'];
  maxLoad?: number;
}

function input(overrides: InputOverrides = {}): ReportInput {
  const components = [
    component('lb', 'load-balancer', 'Load Balancer'),
    component('db', 'database', 'SQL Database'),
  ];
  const maxLoad = overrides.maxLoad ?? 30;

  return {
    components,
    telemetry: new Map(components.map((c) => [c.id, telemetry({ maxLoad, loadIntegral: maxLoad * 45 })])),
    componentState: new Map(
      components.map((c) => [
        c.id,
        { processed: 1000, dropped: 0, failed: overrides.failed === true && c.id === 'db' },
      ])
    ),
    duration: 45,
    outcome: overrides.outcome ?? 'won',
    totalSpawned: 1000,
    totalCompleted: overrides.totalCompleted ?? 1000,
    totalDropped: overrides.totalDropped ?? 0,
    counts: {
      ...EMPTY_COUNTS,
      totalSpawned: 1000,
      spawnedByKind: { create: 300, read: 700 },
      completedByKind: { create: 300, read: 700 },
      ...overrides.counts,
      brokenServices: overrides.failed ? ['SQL Database'] : (overrides.counts?.brokenServices ?? []),
    },
    objectives: overrides.objectives,
    scoringPriorities: overrides.scoringPriorities,
    peakRps: 400,
    spikeEvents: 2,
    architectureConfig: {
      database: { replication: { enabled: false, readReplicas: 0 }, sharding: { enabled: false, shardCount: 1 } },
    } as ReportInput['architectureConfig'],
    componentConfigs: new Map(),
    scalingState: new Map(),
  };
}

describe('buildSimulationReport — objectives', () => {
  it('reports survival-only objectives for a scenario without flows', () => {
    const report = buildSimulationReport(input());

    expect(report.objectives.map((o) => o.id)).toEqual(['failures']);
    expect(report.objectivesMet).toBe(true);
  });

  it('breaks the run down per request kind', () => {
    const report = buildSimulationReport(
      input({
        counts: {
          spawnedByKind: { create: 300, read: 700 },
          completedByKind: { create: 150, read: 700 },
          droppedByKind: { create: 50 },
          violatedByKind: { create: 100 },
          totalViolated: 100,
        },
      })
    );

    expect(report.flowStats.map((s) => s.kind)).toEqual(['create', 'read']);
    const create = report.flowStats.find((s) => s.kind === 'create')!;
    expect(create).toMatchObject({ spawned: 300, completed: 150, dropped: 50, violated: 100 });
    expect(create.completionRate).toBe(50);
    expect(report.totalViolated).toBe(100);
  });

  it('turns a failed objective into the first recommendation', () => {
    const report = buildSimulationReport(
      input({
        objectives: { minCompletionRate: { create: 0.9 } },
        counts: {
          completedByKind: { create: 0, read: 700 },
          violatedByKind: { create: 300 },
          totalViolated: 300,
          violationsByStep: { 'create:persist': 300 },
        },
      })
    );

    expect(report.objectivesMet).toBe(false);
    expect(report.recommendations[0]).toContain('persist');
  });

  it('caps the score when objectives are missed, even on a surviving run', () => {
    const clean = buildSimulationReport(input());
    const missed = buildSimulationReport(
      input({
        objectives: { maxViolationRate: 0 },
        counts: { totalViolated: 400 },
      })
    );

    expect(missed.score).toBeLessThan(clean.score);
    expect(missed.score).toBeLessThanOrEqual(72);
  });

  it('awards a perfect score only to a clean, objective-meeting run', () => {
    expect(buildSimulationReport(input()).score).toBe(100);
    // One violation is enough to lose the perfect score.
    expect(
      buildSimulationReport(
        input({ objectives: { maxViolationRate: 1 }, counts: { totalViolated: 1 } })
      ).score
    ).toBeLessThan(100);
  });
});

describe('buildSimulationReport — scoring priorities', () => {
  it('weights the score toward the dimensions a scenario cares about', () => {
    // Same run, two scenarios: one scored on raw throughput, one on cost.
    // Heavy drops should hurt the throughput-focused scenario more.
    const lossy = { totalCompleted: 600, totalDropped: 400 };

    const throughput = buildSimulationReport(
      input({ ...lossy, scoringPriorities: { throughput: 100 } })
    ).score;
    const cost = buildSimulationReport(
      input({ ...lossy, scoringPriorities: { cost: 100 } })
    ).score;

    expect(throughput).toBeLessThan(cost);
  });

  it('ignores priorities it has no dimension for', () => {
    const withUnknown = buildSimulationReport(
      input({ scoringPriorities: { accuracy: 50 } as ScoringPriorities })
    );
    expect(withUnknown.score).toBe(buildSimulationReport(input()).score);
  });
});
