import type {
  ComponentReport,
  ComponentType,
  PlacedComponent,
  SimulationReport,
} from './types';
import { COMPONENT_DEFS, SCENARIO } from './types';
import type { ComponentTelemetry } from './types';

const REQUIRED_COMPONENTS: ComponentType[] = [
  'load-balancer',
  'shortener',
  'backend',
  'database',
];

const SCALED_MAX_THRESHOLD = 82;
const SCALED_AVG_THRESHOLD = 68;

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
}

function gradeFromScore(score: number): string {
  if (score >= 92) return 'A';
  if (score >= 84) return 'B';
  if (score >= 72) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function buildComponentReports(input: ReportInput): ComponentReport[] {
  return input.components.map((component) => {
    const tel = input.telemetry.get(component.id);
    const st = input.componentState.get(component.id);
    const def = COMPONENT_DEFS[component.type];
    const avgLoad = tel ? tel.loadIntegral / Math.max(input.duration, 0.001) : 0;
    const processed = st?.processed ?? 0;
    const utilizationPct =
      component.capacity > 0 ? (processed / (component.capacity * input.duration)) * 100 : 0;

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
      monthlyCost: def.monthlyCost,
      utilizationPct: Math.min(utilizationPct, 100),
    };
  });
}

function findMissingComponents(components: PlacedComponent[]): ComponentType[] {
  const placed = new Set(components.map((c) => c.type));
  return REQUIRED_COMPONENTS.filter((type) => !placed.has(type));
}

function findScaledServices(reports: ComponentReport[]): ComponentReport[] {
  return reports.filter(
    (r) =>
      !r.failed &&
      (r.maxLoad >= SCALED_MAX_THRESHOLD || r.avgLoad >= SCALED_AVG_THRESHOLD)
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

function computeScore(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  wasted: ComponentReport[],
  missing: ComponentType[]
): number {
  let score = 0;

  // Survival (35 pts)
  if (input.outcome === 'won') {
    score += 35;
  } else {
    const survivalRatio = input.duration / SCENARIO.duration;
    score += Math.round(35 * survivalRatio * 0.55);
  }

  // Reliability (25 pts) — completion & drop rate
  const successRate =
    input.totalSpawned > 0 ? input.totalCompleted / input.totalSpawned : 0;
  score += Math.round(successRate * 18);
  const dropRate =
    input.totalSpawned > 0 ? input.totalDropped / input.totalSpawned : 1;
  score += Math.round(Math.max(0, 7 - dropRate * 20));

  // Availability (15 pts) — downtime across fleet
  const totalDowntime = reports.reduce((s, r) => s + r.downtimeSeconds, 0);
  const downtimeRatio = totalDowntime / Math.max(reports.length * input.duration, 1);
  score += Math.round(Math.max(0, 15 * (1 - downtimeRatio * 4)));

  // Efficiency (15 pts) — wasted spend & idle time
  const totalCost = reports.reduce((s, r) => s + r.monthlyCost, 0);
  const wastedCost = wasted.reduce((s, r) => s + r.monthlyCost, 0);
  const wasteRatio = totalCost > 0 ? wastedCost / totalCost : 0;
  score += Math.round(Math.max(0, 10 * (1 - wasteRatio)));
  const avgIdle =
    reports.reduce((s, r) => s + r.idleSeconds, 0) /
    Math.max(reports.length * input.duration, 1);
  score += Math.round(Math.max(0, 5 * (1 - avgIdle * 2)));

  // Architecture completeness (10 pts)
  score += Math.round(((REQUIRED_COMPONENTS.length - missing.length) / REQUIRED_COMPONENTS.length) * 10);

  // Penalties
  score -= broken.length * 8;
  score -= missing.length * 6;

  const overloadPenalty = reports.reduce(
    (s, r) => s + Math.min(r.overloadSeconds / input.duration, 1),
    0
  );
  score -= Math.round(overloadPenalty * 3);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildRecommendations(
  input: ReportInput,
  reports: ComponentReport[],
  broken: ComponentReport[],
  scaled: ComponentReport[],
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

  if (scaled.length > 0) {
    tips.push(
      `High load on ${scaled.map((r) => r.label).join(', ')} — consider horizontal scaling or sharding.`
    );
  }

  if (wasted.length > 0) {
    tips.push(
      `Reduce idle spend on ${wasted.map((r) => r.label).join(', ')} — right-size or remove duplicates.`
    );
  }

  const db = reports.find((r) => r.type === 'database');
  const redis = reports.find((r) => r.type === 'redis');
  if (db && db.avgLoad > 65 && (!redis || redis.avgLoad < 20)) {
    tips.push('Database is hot — route more reads through Redis cache.');
  }

  if (input.totalDropped > input.totalSpawned * 0.05) {
    tips.push('Too many dropped requests — check bottlenecks and queue limits on belts.');
  }

  const queueHot = reports.filter(
    (r) => r.maxQueueFill >= 90 && !r.failed
  );
  if (queueHot.length > 0) {
    tips.push(
      `Queue saturation on ${queueHot.map((r) => r.label).join(', ')} — requests are waiting; scale capacity or add instances.`
    );
  }

  if (input.outcome === 'won' && tips.length === 0) {
    tips.push('Solid architecture — try trimming cost or surviving a longer spike window.');
  }

  return tips.slice(0, 5);
}

export function buildSimulationReport(input: ReportInput): SimulationReport {
  const components = buildComponentReports(input);
  const brokenServices = components.filter((r) => r.failed);
  const scaledServices = findScaledServices(components);
  const wastedResources = findWastedResources(components);
  const missingComponents = findMissingComponents(input.components);
  const totalCost = components.reduce((s, r) => s + r.monthlyCost, 0);
  const wastedCost = wastedResources.reduce((s, r) => s + r.monthlyCost, 0);
  const successRate =
    input.totalSpawned > 0
      ? Math.round((input.totalCompleted / input.totalSpawned) * 1000) / 10
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
    recommendations: buildRecommendations(
      input,
      components,
      brokenServices,
      scaledServices,
      wastedResources,
      missingComponents
    ),
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
