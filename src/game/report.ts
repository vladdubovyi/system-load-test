import type {
  ComponentReport,
  ComponentType,
  PlacedComponent,
  SimulationReport,
} from './types';
import { COMPONENT_DEFS, SCENARIO } from './types';
import type { ComponentTelemetry } from './types';
import type {
  ArchitectureConfig,
  ComponentScalingState,
} from './architecture-config';

const REQUIRED_COMPONENTS: ComponentType[] = [
  'load-balancer',
  'shortener',
  'backend',
  'database',
];

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
  peakRps: number;
  spikeEvents: number;
  architectureConfig: ArchitectureConfig;
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
  const def = COMPONENT_DEFS[component.type];
  let cost = def.monthlyCost;
  const scaling = input.scalingState.get(component.id);

  if (component.type === 'shortener' || component.type === 'backend') {
    const instances = scaling?.maxInstancesReached ?? 1;
    const vertical = scaling?.maxVerticalMultiplier ?? 1;
    cost *= instances * vertical;
  }

  if (component.type === 'database') {
    const { replication, sharding } = input.architectureConfig.database;
    if (sharding.enabled) cost *= Math.max(1, sharding.shardCount);
    if (replication.enabled) cost += def.monthlyCost * replication.readReplicas * 0.55;
  }

  return cost;
}

function buildComponentReports(input: ReportInput): ComponentReport[] {
  return input.components.map((component) => {
    const tel = input.telemetry.get(component.id);
    const st = input.componentState.get(component.id);
    const def = COMPONENT_DEFS[component.type];
    const avgLoad = tel ? tel.loadIntegral / Math.max(input.duration, 0.001) : 0;
    const processed = st?.processed ?? 0;
    const scaling = input.scalingState.get(component.id);
    const effectiveCapacity =
      component.capacity *
      (scaling?.maxInstancesReached ?? 1) *
      (scaling?.maxVerticalMultiplier ?? 1);
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

function findMissingComponents(components: PlacedComponent[]): ComponentType[] {
  const placed = new Set(components.map((c) => c.type));
  return REQUIRED_COMPONENTS.filter((type) => !placed.has(type));
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

function meetsExcellence(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  missing: ComponentType[]
): boolean {
  if (input.outcome !== 'won' || broken.length > 0 || missing.length > 0) {
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

  for (const report of reports) {
    const overloadFraction = report.overloadSeconds / Math.max(input.duration, 0.001);
    if (overloadFraction > EXCELLENCE.maxOverloadFraction) return false;
    if (report.maxQueueFill > EXCELLENCE.maxQueueFill) return false;
    if (report.avgLoad > EXCELLENCE.maxAvgUtil) return false;
  }

  const redis = reports.find((r) => r.type === 'redis');
  const db = reports.find((r) => r.type === 'database');
  const cfg = input.architectureConfig;

  if (
    !cfg.autoScaling.shortener.horizontal.enabled ||
    !cfg.autoScaling.backend.horizontal.enabled
  ) {
    return false;
  }
  if (!cfg.database.sharding.enabled || cfg.database.sharding.shardCount < 2) {
    return false;
  }
  if (!cfg.database.replication.enabled || cfg.database.replication.readReplicas < 1) {
    return false;
  }
  if (!redis || redis.avgLoad < 10) return false;
  if (db && db.avgLoad > 55) return false;

  return true;
}

function computeScore(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  wasted: ComponentReport[],
  missing: ComponentType[]
): number {
  let score = 0;

  // Survival (30 pts)
  if (input.outcome === 'won') {
    score += 30;
  } else {
    const survivalRatio = input.duration / SCENARIO.duration;
    score += Math.round(30 * survivalRatio * 0.5);
  }

  // Reliability (25 pts) — completion & drop rate
  const successRate =
    input.totalSpawned > 0 ? input.totalCompleted / input.totalSpawned : 0;
  score += Math.round(Math.min(successRate, 1) * 18);
  const dropRate =
    input.totalSpawned + input.totalDropped > 0
      ? input.totalDropped / (input.totalSpawned + input.totalDropped)
      : 1;
  score += Math.round(Math.max(0, 7 - dropRate * 35));

  // Capacity headroom (20 pts) — penalize sustained saturation
  const avgPeakLoad =
    reports.reduce((s, r) => s + r.maxLoad, 0) / Math.max(reports.length, 1);
  const headroomScore = Math.max(0, 1 - Math.max(0, avgPeakLoad - 50) / 50);
  score += Math.round(headroomScore * 12);

  const overloadBurden = reports.reduce(
    (s, r) => s + r.overloadSeconds / Math.max(input.duration, 0.001),
    0
  ) / Math.max(reports.length, 1);
  score += Math.round(Math.max(0, 8 * (1 - overloadBurden * 3)));

  // Availability (10 pts)
  const totalDowntime = reports.reduce((s, r) => s + r.downtimeSeconds, 0);
  const downtimeRatio = totalDowntime / Math.max(reports.length * input.duration, 1);
  score += Math.round(Math.max(0, 10 * (1 - downtimeRatio * 4)));

  // Efficiency (10 pts)
  const totalCost = reports.reduce((s, r) => s + r.monthlyCost, 0);
  const wastedCost = wasted.reduce((s, r) => s + r.monthlyCost, 0);
  const wasteRatio = totalCost > 0 ? wastedCost / totalCost : 0;
  score += Math.round(Math.max(0, 10 * (1 - wasteRatio)));

  // Architecture completeness (5 pts)
  score += Math.round(
    ((REQUIRED_COMPONENTS.length - missing.length) / REQUIRED_COMPONENTS.length) * 5
  );

  // Penalties
  score -= broken.length * 10;
  score -= missing.length * 8;

  const queuePenalty = reports.reduce(
    (s, r) => s + Math.min(r.queuePressureSeconds / input.duration, 1),
    0
  );
  score -= Math.round(queuePenalty * 4);

  const scaledCount = findScaledServices(reports, input.duration).length;
  score -= scaledCount * 3;

  score = Math.max(0, Math.min(94, Math.round(score)));

  if (meetsExcellence(input, reports, broken, missing)) {
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
  missing: ComponentType[]
): string[] {
  const tips: string[] = [];

  if (missing.length > 0) {
    tips.push(
      `Add missing components: ${missing.map((t) => COMPONENT_DEFS[t].label).join(', ')}.`
    );
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

export function buildSimulationReport(input: ReportInput): SimulationReport {
  const components = buildComponentReports(input);
  const brokenServices = components.filter((r) => r.failed);
  const scaledServices = findScaledServices(components, input.duration);
  const overloadedServices = findOverloadedServices(components, input.duration);
  const wastedResources = findWastedResources(components);
  const missingComponents = findMissingComponents(input.components);
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
    missingComponents
  );

  const recommendations = buildRecommendations(
    input,
    components,
    brokenServices,
    scaledServices,
    overloadedServices,
    wastedResources,
    missingComponents
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
    missingComponents,
    totalSpawned: input.totalSpawned,
    totalCompleted: input.totalCompleted,
    totalDropped: input.totalDropped,
    successRate,
    peakRps: Math.round(input.peakRps),
    spikeEvents: input.spikeEvents,
    availabilityPct,
    recommendations,
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
