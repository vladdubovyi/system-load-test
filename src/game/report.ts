import type {
  ComponentReport,
  ComponentType,
  FlowKindStat,
  ObjectiveResult,
  PlacedComponent,
  SimulationReport,
} from './types';
import type { Objectives } from './flow-types';
import type { ScoringPriorities } from './scenario-types';
import { allObjectivesMet, evaluateObjectives, type RunCounts } from './objectives';
import { getActiveScenario } from './scenario-runtime';
import type { ComponentTelemetry } from './types';
import type {
  ArchitectureConfig,
  ComponentScalingState,
} from './architecture-config';
import type { ComponentInstanceConfig } from './component-config';
import { getDatabaseConfigForComponent } from './component-config';
import { getScaleGroupMembers } from './scale-instances';
import { getComponentDef } from './component-catalog';

const SCALED_MAX_THRESHOLD = 75;
const SCALED_AVG_THRESHOLD = 58;
const SCALED_QUEUE_THRESHOLD = 65;
const SCALED_OVERLOAD_FRACTION = 0.08;

/** Strict bar for a perfect 100 — only well-provisioned architectures should pass. */
const EXCELLENCE = {
  minSuccessRate: 0.96,
  maxDropRate: 0.03,
  maxOverloadFraction: 0.08,
  maxQueueFill: 55,
  maxAvgUtil: 72,
};

/**
 * Score dimensions. The weighted average of these (each 0..1) is the score;
 * a scenario's `scoringPriorities` bias the weights toward what that
 * challenge is actually teaching.
 */
type Dimension =
  | 'reliability'
  | 'correctness'
  | 'availability'
  | 'headroom'
  | 'latency'
  | 'efficiency'
  | 'faultTolerance';

/** Applied when a scenario declares no priorities. */
const BASE_WEIGHTS: Record<Dimension, number> = {
  reliability: 25,
  correctness: 15,
  availability: 15,
  headroom: 15,
  latency: 10,
  efficiency: 10,
  faultTolerance: 10,
};

/** Which dimension each scenario scoring priority reinforces. */
const PRIORITY_DIMENSION: Record<keyof ScoringPriorities, Dimension> = {
  availability: 'availability',
  latency: 'latency',
  throughput: 'reliability',
  durability: 'correctness',
  storageEfficiency: 'efficiency',
  bandwidth: 'reliability',
  cost: 'efficiency',
  scalability: 'headroom',
  faultTolerance: 'faultTolerance',
};

/** Score ceilings for runs that did not fully succeed. */
const CAP_OBJECTIVES_MISSED = 72;
const CAP_BROKEN_SERVICES = 55;

export interface ReportInput {
  components: PlacedComponent[];
  telemetry: Map<string, ComponentTelemetry>;
  componentState: Map<
    string,
    { processed: number; dropped: number; failed: boolean }
  >;
  duration: number;
  outcome: 'won' | 'lost';
  totalSpawned: number;
  totalCompleted: number;
  totalDropped: number;
  /** Per-kind tallies, violation steps and drop reasons from the engine. */
  counts: RunCounts;
  /** Win conditions for the active scenario; undefined means survival only. */
  objectives?: Objectives;
  /** Scenario scoring priorities, used to weight the score dimensions. */
  scoringPriorities?: ScoringPriorities;
  /** Traffic seed the run was generated from (interview-platform.md §8). */
  seed: number;
  peakRps: number;
  spikeEvents: number;
  architectureConfig: ArchitectureConfig;
  componentConfigs: Map<string, ComponentInstanceConfig>;
  scalingState: Map<string, ComponentScalingState>;
}

function gradeFromScore(score: number): string {
  if (score >= 92) return 'A';
  if (score >= 84) return 'B';
  if (score >= 72) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function effectiveMonthlyCost(
  component: PlacedComponent,
  input: ReportInput
): number {
  const def = getComponentDef(component.type);
  if (component.scaleGroupId && component.scaleGroupId !== component.id) {
    return 0;
  }

  let cost = def.monthlyCost;
  const scaling = input.scalingState.get(component.id);

  if (component.type === 'shortener' || component.type === 'backend') {
    const instances = getScaleGroupMembers(input.components, component.id).length;
    const vertical = scaling?.maxVerticalMultiplier ?? 1;
    cost *= instances * vertical;
  }

  if (component.type === 'database') {
    const dbCfg = getDatabaseConfigForComponent(component, input.componentConfigs);
    if (dbCfg) {
      const { replication, sharding } = dbCfg;
      if (sharding.enabled) cost *= Math.max(1, sharding.shardCount);
      if (replication.enabled) cost += def.monthlyCost * replication.readReplicas * 0.55;
    }
  }

  return cost;
}

function buildComponentReports(input: ReportInput): ComponentReport[] {
  return input.components
    .filter(
      (component) => !component.scaleGroupId || component.scaleGroupId === component.id
    )
    .map((component) => {
    const tel = input.telemetry.get(component.id);
    const st = input.componentState.get(component.id);
    const def = getComponentDef(component.type);
    const avgLoad = tel ? tel.loadIntegral / Math.max(input.duration, 0.001) : 0;
    const processed = st?.processed ?? 0;
    const scaling = input.scalingState.get(component.id);
    const instances = getScaleGroupMembers(input.components, component.id).length;
    const effectiveCapacity =
      component.capacity * instances * (scaling?.maxVerticalMultiplier ?? 1);
    const utilizationPct =
      effectiveCapacity > 0
        ? (processed / (effectiveCapacity * input.duration)) * 100
        : 0;
    const monthlyCost = effectiveMonthlyCost(component, input);

    return {
      id: component.id,
      type: component.type,
      label: component.label,
      emoji: def.emoji,
      maxLoad: Math.min(tel?.maxLoad ?? 0, 100),
      avgLoad: Math.min(avgLoad, 100),
      maxQueueFill: Math.min(tel?.maxQueueFill ?? 0, 100),
      downtimeSeconds: tel?.downtimeSeconds ?? 0,
      overloadSeconds: tel?.overloadSeconds ?? 0,
      queuePressureSeconds: tel?.queuePressureSeconds ?? 0,
      idleSeconds: tel?.idleSeconds ?? 0,
      processed: Math.round(processed),
      dropped: Math.round(st?.dropped ?? 0),
      failed: st?.failed ?? false,
      monthlyCost,
      utilizationPct: Math.min(utilizationPct, 100),
    };
  });
}

function findScaledServices(
  reports: ComponentReport[],
  duration: number
): ComponentReport[] {
  return reports.filter((r) => {
    if (r.failed) return false;
    const overloadFraction = r.overloadSeconds / Math.max(duration, 0.001);
    return (
      r.maxLoad >= SCALED_MAX_THRESHOLD ||
      r.avgLoad >= SCALED_AVG_THRESHOLD ||
      r.maxQueueFill >= SCALED_QUEUE_THRESHOLD ||
      overloadFraction >= SCALED_OVERLOAD_FRACTION
    );
  });
}

function findOverloadedServices(
  reports: ComponentReport[],
  duration: number
): ComponentReport[] {
  return reports.filter(
    (r) => r.overloadSeconds / Math.max(duration, 0.001) >= EXCELLENCE.maxOverloadFraction
  );
}

function findWastedResources(reports: ComponentReport[]): ComponentReport[] {
  const byType = new Map<ComponentType, ComponentReport[]>();
  for (const report of reports) {
    const list = byType.get(report.type) ?? [];
    list.push(report);
    byType.set(report.type, list);
  }

  const wasted: ComponentReport[] = [];

  for (const report of reports) {
    const duplicates = (byType.get(report.type) ?? []).length > 1;
    const optionalIdle =
      report.type === 'redis' &&
      report.avgLoad < 12 &&
      report.maxLoad < 30;

    if (duplicates) {
      const sameType = byType.get(report.type) ?? [];
      const sorted = [...sameType].sort((a, b) => b.processed - a.processed);
      if (sorted.indexOf(report) > 0 && report.avgLoad < 30) {
        wasted.push(report);
      }
      continue;
    }

    if (optionalIdle) {
      wasted.push(report);
    }
  }

  return wasted;
}

/**
 * A perfect 100 is reserved for designs that win on every objective and
 * still have real headroom. The legacy per-type configuration checks are
 * gone: what matters is the measured result, not which chips were applied.
 */
function meetsExcellence(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  objectivesMet: boolean
): boolean {
  if (input.outcome !== 'won' || !objectivesMet || broken.length > 0) {
    return false;
  }

  const successRate =
    input.totalSpawned > 0 ? input.totalCompleted / input.totalSpawned : 0;
  const dropRate =
    input.totalSpawned + input.totalDropped > 0
      ? input.totalDropped / (input.totalSpawned + input.totalDropped)
      : 0;

  if (successRate < EXCELLENCE.minSuccessRate) return false;
  if (dropRate > EXCELLENCE.maxDropRate) return false;
  if (input.counts.totalViolated > 0) return false;

  for (const report of reports) {
    const overloadFraction = report.overloadSeconds / Math.max(input.duration, 0.001);
    if (overloadFraction > EXCELLENCE.maxOverloadFraction) return false;
    if (report.maxQueueFill > EXCELLENCE.maxQueueFill) return false;
    if (report.avgLoad > EXCELLENCE.maxAvgUtil) return false;
  }

  return true;
}

/** Blend the scenario's priorities into the base dimension weights. */
function resolveWeights(priorities?: ScoringPriorities): Record<Dimension, number> {
  const weights = { ...BASE_WEIGHTS };
  if (!priorities) return weights;

  const entries = Object.entries(priorities).filter(
    ([key, value]) => typeof value === 'number' && value > 0 && key in PRIORITY_DIMENSION
  ) as [keyof ScoringPriorities, number][];
  if (entries.length === 0) return weights;

  // Priorities are relative, so normalize before adding: a challenge that
  // weights latency 40/100 shifts the same amount whether the scenario used
  // percentages or raw points.
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  for (const [key, value] of entries) {
    weights[PRIORITY_DIMENSION[key]] += (value / total) * 100;
  }

  return weights;
}

/** Each dimension scored 0..1 from the run's measurements. */
function scoreDimensions(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  wasted: ComponentReport[]
): Record<Dimension, number> {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const successRate =
    input.totalSpawned > 0 ? input.totalCompleted / input.totalSpawned : 0;
  const violationRate =
    input.totalSpawned > 0 ? input.counts.totalViolated / input.totalSpawned : 0;

  const avgPeakLoad =
    reports.reduce((sum, r) => sum + r.maxLoad, 0) / Math.max(reports.length, 1);
  const overloadBurden =
    reports.reduce(
      (sum, r) => sum + r.overloadSeconds / Math.max(input.duration, 0.001),
      0
    ) / Math.max(reports.length, 1);

  const totalDowntime = reports.reduce((sum, r) => sum + r.downtimeSeconds, 0);
  const downtimeRatio =
    totalDowntime / Math.max(reports.length * input.duration, 0.001);

  const queueBurden =
    reports.reduce(
      (sum, r) => sum + Math.min(r.queuePressureSeconds / Math.max(input.duration, 0.001), 1),
      0
    ) / Math.max(reports.length, 1);

  const totalCost = reports.reduce((sum, r) => sum + r.monthlyCost, 0);
  const wastedCost = wasted.reduce((sum, r) => sum + r.monthlyCost, 0);
  const wasteRatio = totalCost > 0 ? wastedCost / totalCost : 0;

  return {
    reliability: clamp01(successRate),
    correctness: clamp01(1 - violationRate * 2),
    availability: clamp01(1 - downtimeRatio * 4),
    headroom: clamp01(1 - Math.max(0, avgPeakLoad - 50) / 50) * clamp01(1 - overloadBurden * 3),
    latency: clamp01(1 - queueBurden * 2),
    efficiency: clamp01(1 - wasteRatio),
    faultTolerance: clamp01(1 - broken.length / Math.max(reports.length, 1) * 2),
  };
}

function computeScore(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  wasted: ComponentReport[],
  objectivesMet: boolean
): number {
  const weights = resolveWeights(input.scoringPriorities);
  const dimensions = scoreDimensions(input, reports, broken, wasted);

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const weighted = (Object.keys(weights) as Dimension[]).reduce(
    (sum, key) => sum + weights[key] * dimensions[key],
    0
  );

  // Survival is a gate rather than a dimension: a run that ended early only
  // earns credit for the share of the scenario it actually lasted.
  const survivalRatio =
    input.outcome === 'won'
      ? 1
      : Math.min(1, input.duration / Math.max(getActiveScenario().duration, 0.001));

  let score = (weighted / Math.max(totalWeight, 0.001)) * 94;
  if (input.outcome !== 'won') {
    score *= 0.5 + survivalRatio * 0.3;
  }

  if (!objectivesMet) score = Math.min(score, CAP_OBJECTIVES_MISSED);
  if (broken.length > 0) score = Math.min(score, CAP_BROKEN_SERVICES);

  score = Math.max(0, Math.min(94, Math.round(score)));

  if (meetsExcellence(input, reports, broken, objectivesMet)) {
    return 100;
  }

  return score;
}

function buildRecommendations(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  scaled: ComponentReport[],
  overloaded: ComponentReport[],
  wasted: ComponentReport[],
  objectives: ObjectiveResult[]
): string[] {
  const tips: string[] = [];

  // Failed objectives are the most actionable feedback there is: they say
  // exactly which requirement the design missed and why.
  for (const objective of objectives) {
    if (!objective.met && objective.cause) {
      tips.push(`${objective.label} (${objective.target}): ${objective.cause}`);
    }
  }

  if (broken.length > 0) {
    tips.push(
      `${broken.map((r) => r.label).join(', ')} failed — add caching, scale out, or increase capacity.`
    );
  }

  if (overloaded.length > 0) {
    tips.push(
      `${overloaded.map((r) => r.label).join(', ')} ran at 100% capacity too often — add instances or cache before the database.`
    );
  }

  if (scaled.length > 0) {
    tips.push(
      `High load on ${scaled.map((r) => r.label).join(', ')} — scale the read path horizontally and keep Redis in front of the database.`
    );
  }

  if (wasted.length > 0) {
    tips.push(
      `Reduce idle spend on ${wasted.map((r) => r.label).join(', ')} — right-size or remove duplicates.`
    );
  }

  const dbReports = reports.filter((r) => r.type === 'database');
  const redis = reports.find((r) => r.type === 'redis');
  const hotDb = dbReports.find((db) => db.avgLoad > 50);
  if (hotDb && (!redis || redis.avgLoad < 20)) {
    tips.push('Database is hot — route reads through Redis cache-aside before hitting the database.');
  }

  const backendCount =
    input.scalingState.get(
      input.components.find((c) => c.type === 'backend')?.id ?? ''
    )?.maxInstancesReached ?? 1;
  if (backendCount < 2 && reports.some((r) => r.type === 'backend' && r.maxLoad >= 80)) {
    tips.push('Read path is the bottleneck — enable horizontal auto-scaling on Backend.');
  }

  if (!input.architectureConfig.database.sharding.enabled) {
    tips.push('Enable database sharding to partition writes and cache misses.');
  }

  if (!input.architectureConfig.database.replication.enabled) {
    tips.push('Enable read replicas so cache misses do not hammer the primary database.');
  }

  if (input.totalDropped > input.totalSpawned * 0.05) {
    tips.push('Too many dropped requests — check bottlenecks and queue limits on belts.');
  }

  const queueHot = reports.filter((r) => r.maxQueueFill >= 90 && !r.failed);
  if (queueHot.length > 0) {
    tips.push(
      `Queue saturation on ${queueHot.map((r) => r.label).join(', ')} — requests are waiting; scale capacity or add instances.`
    );
  }

  if (input.outcome === 'won' && tips.length === 0) {
    tips.push('Production-grade architecture — healthy headroom across all services.');
  }

  return tips.slice(0, 6);
}

/** One row per request kind the run actually spawned. */
function buildFlowStats(counts: RunCounts): FlowKindStat[] {
  const kinds = new Set([
    ...Object.keys(counts.spawnedByKind),
    ...Object.keys(counts.completedByKind),
    ...Object.keys(counts.violatedByKind),
  ]);

  return [...kinds]
    .sort()
    .map((kind) => {
      const spawned = counts.spawnedByKind[kind] ?? 0;
      const completed = counts.completedByKind[kind] ?? 0;
      return {
        kind,
        spawned,
        completed,
        dropped: counts.droppedByKind[kind] ?? 0,
        violated: counts.violatedByKind[kind] ?? 0,
        completionRate:
          spawned > 0 ? Math.round((completed / spawned) * 1000) / 10 : 0,
      };
    });
}

export function buildSimulationReport(input: ReportInput): SimulationReport {
  const components = buildComponentReports(input);
  const brokenServices = components.filter((r) => r.failed);
  const scaledServices = findScaledServices(components, input.duration);
  const overloadedServices = findOverloadedServices(components, input.duration);
  const wastedResources = findWastedResources(components);
  const objectives = evaluateObjectives(input.objectives, input.counts);
  const objectivesMet = allObjectivesMet(objectives);
  const flowStats = buildFlowStats(input.counts);
  const totalCost = components.reduce((s, r) => s + r.monthlyCost, 0);
  const wastedCost = wastedResources.reduce((s, r) => s + r.monthlyCost, 0);
  const successRate =
    input.totalSpawned > 0
      ? Math.min(
          100,
          Math.round((input.totalCompleted / input.totalSpawned) * 1000) / 10
        )
      : 0;
  const totalDowntime = components.reduce((s, r) => s + r.downtimeSeconds, 0);
  const availabilityPct =
    components.length > 0
      ? Math.round(
          (1 - totalDowntime / (components.length * input.duration)) * 1000
        ) / 10
      : 100;

  const score = computeScore(
    input,
    components,
    brokenServices,
    wastedResources,
    objectivesMet
  );

  const recommendations = buildRecommendations(
    input,
    components,
    brokenServices,
    scaledServices,
    overloadedServices,
    wastedResources,
    objectives
  );

  return {
    outcome: input.outcome,
    duration: input.duration,
    score,
    grade: gradeFromScore(score),
    totalCost,
    wastedCost,
    components,
    brokenServices,
    scaledServices,
    wastedResources,
    totalSpawned: input.totalSpawned,
    totalCompleted: input.totalCompleted,
    totalDropped: input.totalDropped,
    totalViolated: input.counts.totalViolated,
    successRate,
    objectives,
    objectivesMet,
    flowStats,
    peakRps: Math.round(input.peakRps),
    spikeEvents: input.spikeEvents,
    availabilityPct,
    recommendations,
    seed: input.seed,
  };
}

export function formatCost(amount: number): string {
  return `$${amount.toLocaleString()}/mo`;
}

export function formatSeconds(seconds: number): string {
  if (seconds < 0.05) return '0s';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  return `${seconds.toFixed(1)}s`;
}
