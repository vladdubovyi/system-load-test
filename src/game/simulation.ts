import type {
  BeltState,
  ComponentState,
  ComponentType,
  ComponentTelemetry,
  ConveyorBelt,
  PlacedComponent,
  Port,
  Request,
  RequestEvent,
  RequestKind,
  SimulationReport,
  SimulationSnapshot,
  SimulationStatus,
} from './types';
import { createRng, randomSeed, type Rng } from './rng';
import { buildSimulationReport } from './report';
import { allObjectivesMet, evaluateObjectives, type RunCounts } from './objectives';
import type { ComponentInstanceConfig } from './component-config';
import {
  aggregateArchitectureConfig,
  cloneComponentConfig,
  getAutoScalingForComponent,
  getDatabaseConfigForComponent,
} from './component-config';
import type {
  AutoScalingConfig,
  ComponentScalingState,
  DatabaseConfig,
} from './architecture-config';
import { isScalableType } from './architecture-config';
import {
  createInstanceBelts,
  createScaleInstance,
  getScaleGroupMembers,
  getScalePrimaryId,
  isScalePrimary,
  pickDespawnInstance,
  removeInstanceBelts,
} from './scale-instances';
import { applyBoardLayout } from './board-layout';
import {
  isCacheType,
  isComputeType,
  isIngressType,
  isQueueType,
  isStorageType,
} from './component-taxonomy';
import { getCapabilities } from './capabilities';
import { allSteps, describeSelector, matchPendingStep, selectorMatches } from './flows';
import { baseRpsAt, requestTypesAt, sortPhases } from './traffic-phases';
import type { TrafficPhase } from './scenario-types';
import type { ScriptedFailureState } from './types';
import type { FlowSpec, FlowStep, RequestFlowState } from './flow-types';
import { getComponentDef } from './component-catalog';
import { getActiveScenario, type RuntimeScenario } from './scenario-runtime';
import { beltLength, beltTravelSeconds } from './belt-geometry';
import {
  CELEBRITY_COLOR_INDICES,
  COMPONENT_DEFS,
  REQUEST_COLORS,
  SCENARIO,
} from './types';

const SOURCE_ID = '__source__';
const IDLE_LOAD_THRESHOLD = 15;
/** How many completed/dropped requests stay inspectable after they finish. */
const FINISHED_ARCHIVE_LIMIT = 400;
/**
 * Example requests for the coaching drawer (product-directions.md §4.2):
 * finished requests are reservoir-sampled per (kind, end state) so one
 * outcome cannot evict another's examples. Sampling draws from its own seeded
 * generator, never the engine's, so the run itself is untouched and the same
 * seed picks the same examples.
 */
export const EXAMPLE_POOL_LIMIT = 50;

let nextRequestId = 1;

type AcceptResult = { ok: true; routed: boolean } | { ok: false; reason: string };

/** Deterministic lateral lane in [-1, 1] so a stream spreads across the belt. */
function laneFor(id: number): number {
  return ((id * 0.7548776662466927) % 1) * 2 - 1;
}

/** Deterministic key in [0, 1) used to sub-sample which requests get drawn. */
function visualKeyFor(id: number): number {
  return (id * 0.6180339887498949) % 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Collapse a drop reason into something worth aggregating: the live counts
 * inside a reason ("queue full (83/80)") differ on every drop and would
 * scatter the tally across hundreds of near-identical keys.
 */
function normalizeDropReason(reason: string, component?: PlacedComponent): string {
  const generalized = reason.replace(/\s*\([^)]*\)/g, '').trim();
  if (!component) return generalized;
  return generalized.includes(component.label)
    ? generalized
    : `${component.label}: ${generalized}`;
}

function pickRequestColor(
  scenario: RuntimeScenario,
  rng: Rng
): { colorIndex: number; celebrity: boolean } {
  const celebrity = rng.chance(scenario.celebrityShare);
  if (celebrity) {
    return { colorIndex: rng.pick(CELEBRITY_COLOR_INDICES), celebrity: true };
  }
  const normalColors = REQUEST_COLORS.map((_, i) => i).filter(
    (i) => !CELEBRITY_COLOR_INDICES.includes(i as (typeof CELEBRITY_COLOR_INDICES)[number])
  );
  return { colorIndex: rng.pick(normalColors), celebrity: false };
}

const SOURCE_X = 400;
const SOURCE_Y = 300;

export function getSourcePort(_components: PlacedComponent[]): Port {
  return {
    id: `${SOURCE_ID}:out`,
    componentId: SOURCE_ID,
    side: 'out',
    label: 'Requests',
    x: SOURCE_X,
    y: SOURCE_Y,
  };
}

export function getComponentPorts(component: PlacedComponent): Port[] {
  const cy = component.y + component.height / 2;

  switch (component.type) {
    case 'load-balancer':
      return [
        {
          id: `${component.id}:in`,
          componentId: component.id,
          side: 'in',
          label: 'in',
          x: component.x,
          y: cy,
        },
        {
          id: `${component.id}:out`,
          componentId: component.id,
          side: 'out',
          label: 'out',
          x: component.x + component.width,
          y: cy,
        },
      ];
    case 'shortener':
      return [
        {
          id: `${component.id}:in`,
          componentId: component.id,
          side: 'in',
          label: 'in',
          x: component.x,
          y: cy,
        },
        {
          id: `${component.id}:out`,
          componentId: component.id,
          side: 'out',
          label: 'out',
          x: component.x + component.width,
          y: cy,
        },
      ];
    case 'backend':
      return [
        {
          id: `${component.id}:in`,
          componentId: component.id,
          side: 'in',
          label: 'in',
          x: component.x,
          y: cy,
        },
        {
          id: `${component.id}:out`,
          componentId: component.id,
          side: 'out',
          label: 'out',
          x: component.x + component.width,
          y: cy,
        },
      ];
    case 'database':
    case 'redis':
      return [
        {
          id: `${component.id}:in`,
          componentId: component.id,
          side: 'in',
          label: 'in',
          x: component.x,
          y: cy,
        },
        {
          id: `${component.id}:out`,
          componentId: component.id,
          side: 'out',
          label: 'out',
          x: component.x + component.width,
          y: cy,
        },
      ];
    default:
      return [
        {
          id: `${component.id}:in`,
          componentId: component.id,
          side: 'in',
          label: 'in',
          x: component.x,
          y: cy,
        },
        {
          id: `${component.id}:out`,
          componentId: component.id,
          side: 'out',
          label: 'out',
          x: component.x + component.width,
          y: cy,
        },
      ];
  }
}

/**
 * Types an ingress node may forward to: compute tiers, traffic filters
 * (rate limiter / CDN), and other ingress nodes — an API gateway behind a
 * load balancer is a normal topology. `canConnect` and the engine's routing
 * must agree on this, otherwise a wire the UI accepts drops every request.
 */
export function isIngressForwardTarget(type: ComponentType): boolean {
  return (
    isComputeType(type) ||
    isIngressType(type) ||
    type === 'rate-limiter' ||
    type === 'cdn'
  );
}

export function canConnect(
  fromPort: Port,
  toPort: Port,
  componentMap: Map<string, PlacedComponent>
): boolean {
  if (fromPort.side !== 'out' || toPort.side !== 'in') return false;
  if (fromPort.componentId === toPort.componentId) return false;

  const fromType =
    fromPort.componentId === SOURCE_ID
      ? 'source'
      : componentMap.get(fromPort.componentId)?.type;
  const toType = componentMap.get(toPort.componentId)?.type;

  if (!toType) return false;

  if (fromType === 'source') {
    return isIngressType(toType) || toType === 'load-balancer' || toType === 'api-gateway';
  }

  if (isIngressType(fromType ?? '')) {
    return isIngressForwardTarget(toType);
  }

  if (fromType === 'rate-limiter' || fromType === 'cdn') {
    return isComputeType(toType) || toType === 'backend' || toType === 'shortener';
  }

  if (fromType === 'load-balancer') {
    return isComputeType(toType) || toType === 'shortener' || toType === 'backend';
  }

  if (fromType === 'shortener') {
    return isStorageType(toType) || toType === 'database' || toType === 'redis';
  }

  if (fromType === 'backend' || isComputeType(fromType ?? '')) {
    // Compute may also hand work to a queue (the file-storage starter's
    // API → Message Queue belt).
    return (
      isStorageType(toType) || isQueueType(toType) || toType === 'redis' || toType === 'database'
    );
  }

  if (isQueueType(fromType ?? '')) {
    // A queue feeds workers: Message Queue → Worker Service.
    return isComputeType(toType);
  }

  if (isStorageType(fromType ?? '') || fromType === 'redis' || fromType === 'database') {
    // A cache may chain to a durable store: that belt carries cache misses
    // onward to the database (flow-correctness miss chaining).
    if (isCacheType(fromType ?? '') && isStorageType(toType)) return true;
    return isComputeType(toType) || toType === 'backend' || toType === 'shortener';
  }

  return false;
}

/**
 * Human explanation for a wire `canConnect` refuses, shown as a toast where
 * the rejection used to be silent. Must stay in sync with the pair table in
 * `canConnect` above (longer term both derive from capabilities).
 */
export function connectionRejectionReason(
  fromPort: Port,
  toPort: Port,
  componentMap: Map<string, PlacedComponent>
): string {
  if (fromPort.componentId === toPort.componentId) {
    return 'A component cannot connect to itself.';
  }

  const to = componentMap.get(toPort.componentId);
  const toLabel = to?.label ?? 'that component';

  if (fromPort.componentId === SOURCE_ID) {
    return `Incoming requests can only go to an ingress — a load balancer or API gateway — not ${toLabel}.`;
  }

  const from = componentMap.get(fromPort.componentId);
  if (!from || !to) return 'That connection is not possible.';

  if (isIngressType(from.type)) {
    return `${from.label} can forward to compute services, rate limiters, CDNs, or another ingress — not ${toLabel}.`;
  }
  if (from.type === 'rate-limiter' || from.type === 'cdn') {
    return `${from.label} can only forward to a compute service — not ${toLabel}.`;
  }
  if (isComputeType(from.type)) {
    return `${from.label} can send work to a durable store (database), a cache, or a message queue — not ${toLabel}.`;
  }
  if (isQueueType(from.type)) {
    return `${from.label} can only feed a compute service such as a worker — not ${toLabel}.`;
  }
  if (isCacheType(from.type)) {
    return `${from.label} can pass cache misses to a durable store or serve a compute service — not ${toLabel}.`;
  }
  if (isStorageType(from.type)) {
    return `${from.label} can only serve a compute service — not ${toLabel}.`;
  }
  return `${from.label} cannot connect to ${toLabel}.`;
}

export type TopologyChangeListener = () => void;

/** Human wording for a scripted failure type (HUD banner, status bar). */
export function describeFailure(type: 'shutdown' | 'latency' | 'capacity' | 'partition'): string {
  switch (type) {
    case 'shutdown':
      return 'is down';
    case 'latency':
      return 'is slow';
    case 'capacity':
      return 'lost half its capacity';
    case 'partition':
      return 'is partitioned';
  }
}

export class SimulationEngine {
  private components: PlacedComponent[];
  private belts: ConveyorBelt[];
  private readonly initialComponents: PlacedComponent[];
  private readonly initialBelts: ConveyorBelt[];
  private componentMap: Map<string, PlacedComponent>;
  private portMap: Map<string, Port>;
  private beltByFromPort: Map<string, ConveyorBelt[]>;
  private beltByToPort: Map<string, ConveyorBelt>;
  private beltById: Map<string, ConveyorBelt>;

  private componentState = new Map<string, ComponentState>();
  private beltState = new Map<string, BeltState>();
  private requests: Request[] = [];

  private time = 0;
  private status: SimulationStatus = 'idle';
  private spawnAccumulator = 0;
  private totalSpawned = 0;
  private totalCompleted = 0;
  private totalDropped = 0;
  private totalViolated = 0;
  private spawnedByKind = new Map<string, number>();
  private completedByKind = new Map<string, number>();
  private droppedByKind = new Map<string, number>();
  private violatedByKind = new Map<string, number>();
  /** Violation tallies keyed `${kind}:${stepId}` for the end-of-run report. */
  private violationsByStep = new Map<string, number>();
  /** Drop tallies keyed `${kind}:${reason}`, for the report's dominant cause. */
  private dropReasons = new Map<string, number>();
  /** Flow spec per request kind; kinds without one are violated on arrival. */
  private flowsByKind = new Map<string, FlowSpec>();
  /** Scripted failure phases (product-directions §3.3) and their live state. */
  private scriptedPhases: ScriptedFailureState[] = [];
  /** Per phase id: the component id it hit, and the labels of others that failed meanwhile. */
  private scriptedTargets = new Map<string, string>();
  private scriptedFailedDuring = new Map<string, Set<string>>();
  /** Multi-phase traffic (§3.4), sorted once. */
  private trafficPhases: TrafficPhase[] = [];
  private currentRps = getActiveScenario().baseRps;
  private spikeActive = false;
  private spikeTimer = 0;
  private message = 'Wire up your system, then press Play.';
  private overloadTimers = new Map<string, number>();
  private completionDebt = new Map<string, number>();
  private telemetry = new Map<string, ComponentTelemetry>();
  private peakRps = 0;
  private spikeEvents = 0;
  private wasSpikeActive = false;
  private draining = false;
  private componentConfigs: Map<string, ComponentInstanceConfig>;
  private scalingState = new Map<string, ComponentScalingState>();
  private scaleUpTimers = new Map<string, number>();
  private scaleDownTimers = new Map<string, number>();
  private startupUntil = new Map<string, number>();
  private onTopologyChange: TopologyChangeListener | null = null;
  private readonly scenario: RuntimeScenario;
  private beltTravelTime = new Map<string, number>();
  private finishedRequests: Request[] = [];
  private examplePool = new Map<string, Request[]>();
  private exampleSeen = new Map<string, number>();
  private exampleRng: Rng = createRng(1);
  private pendingRecoveries: { componentId: string; at: number }[] = [];
  /**
   * Every random draw in a run comes from this generator (spec §8). It is
   * re-created from `seed` on each `start()`, so the same board and seed
   * replay the same run, on this client or any other.
   */
  private rng: Rng;
  private readonly seed: number;

  constructor(
    components: PlacedComponent[],
    belts: ConveyorBelt[],
    componentConfigs: Map<string, ComponentInstanceConfig> = new Map(),
    onTopologyChange: TopologyChangeListener | null = null,
    scenario: RuntimeScenario = getActiveScenario(),
    seed: number = randomSeed()
  ) {
    this.scenario = scenario;
    this.seed = seed;
    this.rng = createRng(seed);
    for (const spec of scenario.flows ?? []) {
      this.flowsByKind.set(spec.kind, spec);
    }
    this.trafficPhases = sortPhases(scenario.trafficPhases);
    this.resetScriptedPhases();
    this.componentConfigs = componentConfigs;
    this.components = components;
    this.belts = belts;
    this.initialComponents = structuredClone(components);
    this.initialBelts = structuredClone(belts);
    this.onTopologyChange = onTopologyChange;
    this.componentMap = new Map(components.map((c) => [c.id, c]));
    this.portMap = new Map();
    this.beltByFromPort = new Map();
    this.beltByToPort = new Map();
    this.beltById = new Map();

    for (const belt of belts) {
      const list = this.beltByFromPort.get(belt.fromPortId) ?? [];
      list.push(belt);
      this.beltByFromPort.set(belt.fromPortId, list);
      this.beltByToPort.set(belt.toPortId, belt);
      this.beltById.set(belt.id, belt);
    }

    this.rebuildPorts();
    this.resetStates();
  }

  setComponentConfigs(configs: Map<string, ComponentInstanceConfig>): void {
    this.componentConfigs = configs;
  }

  setTopologyChangeListener(listener: TopologyChangeListener | null): void {
    this.onTopologyChange = listener;
  }

  private scalingPrimaryId(component: PlacedComponent): string | null {
    if (!isScalableType(component.type)) return null;
    return isScalePrimary(component) ? component.id : getScalePrimaryId(component);
  }

  private isStartingUp(componentId: string): boolean {
    const until = this.startupUntil.get(componentId);
    return until !== undefined && this.time < until;
  }

  private startupProgress(componentId: string): number {
    const until = this.startupUntil.get(componentId);
    if (until === undefined) return 1;
    if (this.time >= until) return 1;
    const primaryId = this.scalingPrimaryId(this.componentMap.get(componentId)!);
    if (!primaryId) return 1;
    const component = this.componentMap.get(primaryId)!;
    const cfg = this.scalingConfig(component);
    const duration = cfg?.horizontal.startupTimeSeconds ?? 4;
    if (duration <= 0) return 1;
    const remaining = until - this.time;
    return clamp(1 - remaining / duration, 0, 1);
  }

  private restoreInitialTopology(): void {
    this.components.length = 0;
    this.components.push(...structuredClone(this.initialComponents));
    this.belts.length = 0;
    this.belts.push(...structuredClone(this.initialBelts));
    this.rebuildComponentMaps();
    this.startupUntil.clear();
  }

  private rebuildComponentMaps(): void {
    this.componentMap = new Map(this.components.map((component) => [component.id, component]));
    this.beltByFromPort.clear();
    this.beltByToPort.clear();
    this.beltById.clear();

    for (const belt of this.belts) {
      const list = this.beltByFromPort.get(belt.fromPortId) ?? [];
      list.push(belt);
      this.beltByFromPort.set(belt.fromPortId, list);
      this.beltByToPort.set(belt.toPortId, belt);
      this.beltById.set(belt.id, belt);
    }

    this.rebuildPorts();
  }

  private initComponentRuntime(component: PlacedComponent, startupSeconds = 0): void {
    const startingUp = startupSeconds > 0;
    this.componentState.set(component.id, {
      load: 0,
      queue: 0,
      processing: 0,
      failed: false,
      processed: 0,
      dropped: 0,
      startingUp,
      startupProgress: startingUp ? 0 : 1,
    });
    this.completionDebt.set(component.id, 0);
    this.telemetry.set(component.id, {
      loadIntegral: 0,
      maxLoad: 0,
      maxQueueFill: 0,
      downtimeSeconds: 0,
      overloadSeconds: 0,
      queuePressureSeconds: 0,
      idleSeconds: 0,
      failedAt: null,
    });
    this.overloadTimers.set(component.id, 0);

    if (startupSeconds > 0) {
      this.startupUntil.set(component.id, this.time + startupSeconds);
    }
  }

  private registerScaleInstance(
    primary: PlacedComponent,
    instance: PlacedComponent,
    newBelts: ConveyorBelt[],
    startupSeconds: number
  ): void {
    this.components.push(instance);
    this.componentMap.set(instance.id, instance);
    this.belts.push(...newBelts);

    for (const belt of newBelts) {
      const list = this.beltByFromPort.get(belt.fromPortId) ?? [];
      list.push(belt);
      this.beltByFromPort.set(belt.fromPortId, list);
      this.beltByToPort.set(belt.toPortId, belt);
      this.beltById.set(belt.id, belt);
      this.beltState.set(belt.id, { load: 0, traveling: 0, dropped: 0 });
    }

    this.rebuildPorts();
    this.initComponentRuntime(instance, startupSeconds);

    const primaryConfig = this.componentConfigs.get(primary.id);
    if (primaryConfig) {
      this.componentConfigs.set(instance.id, cloneComponentConfig(primaryConfig));
    }
  }

  private unregisterScaleInstance(instance: PlacedComponent): void {
    const removedBelts = new Set(
      this.belts
        .filter(
          (belt) =>
            belt.fromPortId.startsWith(`${instance.id}:`) ||
            belt.toPortId.startsWith(`${instance.id}:`)
        )
        .map((belt) => belt.id)
    );

    const index = this.components.findIndex((component) => component.id === instance.id);
    if (index < 0) return;
    this.components.splice(index, 1);
    this.componentMap.delete(instance.id);
    this.componentState.delete(instance.id);
    this.completionDebt.delete(instance.id);
    this.telemetry.delete(instance.id);
    this.overloadTimers.delete(instance.id);
    this.startupUntil.delete(instance.id);
    this.componentConfigs.delete(instance.id);

    const remainingBelts = removeInstanceBelts(instance.id, this.belts);
    this.belts.length = 0;
    this.belts.push(...remainingBelts);

    for (const beltId of removedBelts) {
      this.beltState.delete(beltId);
    }

    this.rebuildComponentMaps();
  }

  private spawnScaleInstance(primary: PlacedComponent, skipStartup = false): void {
    const group = getScaleGroupMembers(this.components, primary.id);
    const instanceIndex = group.length;
    const instance = createScaleInstance(primary, instanceIndex);
    const newBelts = createInstanceBelts(primary, instance, this.components, this.belts);
    const cfg = this.scalingConfig(primary);
    const startupSeconds =
      !skipStartup &&
      cfg?.horizontal.enabled &&
      cfg.horizontal.startupTimeSeconds > 0
        ? cfg.horizontal.startupTimeSeconds
        : 0;

    this.registerScaleInstance(primary, instance, newBelts, startupSeconds);
    this.message = `${primary.label} scaled out to ${group.length + 1} instances`;
  }

  private despawnScaleInstance(primary: PlacedComponent): void {
    const victim = pickDespawnInstance(this.components, primary.id, (id) =>
      this.queuedCount(id)
    );
    if (!victim) return;
    this.unregisterScaleInstance(victim);
    const remaining = getScaleGroupMembers(this.components, primary.id).length;
    this.message = `${primary.label} scaled in to ${remaining} instances`;
  }

  private reconcileScaleInstances(): void {
    let topologyChanged = false;

    for (const component of [...this.components]) {
      if (!isScalePrimary(component)) continue;

      const cfg = this.scalingConfig(component);
      const scaling = this.scalingState.get(component.id);
      if (!cfg?.horizontal.enabled || !scaling) continue;

      let actual = getScaleGroupMembers(this.components, component.id).length;
      while (actual < scaling.instances) {
        const skipStartup =
          actual < cfg.horizontal.minInstances ||
          (this.spikeActive && cfg.predictive.enabled);
        this.spawnScaleInstance(component, skipStartup);
        actual += 1;
        topologyChanged = true;
      }
      while (actual > scaling.instances) {
        this.despawnScaleInstance(component);
        actual -= 1;
        topologyChanged = true;
      }
    }

    if (topologyChanged) {
      applyBoardLayout(this.components);
      this.rebuildPorts();
      this.onTopologyChange?.();
    }
  }

  private aggregateGroupMetrics(primary: PlacedComponent): {
    utilization: number;
    queuePressure: number;
    totalProcessing: number;
    totalCapacity: number;
  } {
    const members = getScaleGroupMembers(this.components, primary.id);
    let totalProcessing = 0;
    let totalCapacity = 0;
    let totalQueue = 0;
    let totalQueueLimit = 0;

    for (const member of members) {
      const state = this.componentState.get(member.id);
      if (!state) continue;
      totalProcessing += state.processing;
      totalCapacity += this.getEffectiveCapacity(member);
      totalQueue += state.queue;
      totalQueueLimit += this.getEffectiveQueueLimit(member);
    }

    const utilization =
      totalCapacity > 0 ? (totalProcessing / totalCapacity) * 100 : 0;
    const queuePressure =
      totalQueueLimit > 0 ? (totalQueue / totalQueueLimit) * 100 : 0;

    return { utilization, queuePressure, totalProcessing, totalCapacity };
  }

  private updateStartupStates(): void {
    for (const [componentId, state] of this.componentState) {
      const startingUp = this.isStartingUp(componentId);
      state.startingUp = startingUp;
      state.startupProgress = this.startupProgress(componentId);
    }
  }

  private scalingConfig(component: PlacedComponent): AutoScalingConfig | null {
    return getAutoScalingForComponent(component, this.componentConfigs);
  }

  private databaseConfig(component: PlacedComponent): DatabaseConfig | null {
    return getDatabaseConfigForComponent(component, this.componentConfigs);
  }

  private initScalingState(): void {
    this.scalingState.clear();
    this.scaleUpTimers.clear();
    this.scaleDownTimers.clear();
    for (const component of this.components) {
      if (!isScalePrimary(component)) continue;
      const cfg = this.scalingConfig(component);
      const minInstances =
        cfg?.horizontal.enabled ? cfg.horizontal.minInstances : 1;
      this.scalingState.set(component.id, {
        instances: minInstances,
        verticalMultiplier: 1,
        maxInstancesReached: minInstances,
        maxVerticalMultiplier: 1,
      });
      this.scaleUpTimers.set(component.id, 0);
      this.scaleDownTimers.set(component.id, 0);
    }
  }

  private getDatabaseMultiplier(component: PlacedComponent): number {
    const dbCfg = this.databaseConfig(component);
    if (!dbCfg) return 1;
    const { replication, sharding } = dbCfg;
    let multiplier = 1;
    if (sharding.enabled) {
      multiplier *= Math.max(1, sharding.shardCount);
    }
    if (replication.enabled) {
      multiplier *= 1 + Math.max(0, replication.readReplicas) * this.scenario.readRatio;
    }
    return multiplier;
  }

  private getEffectiveCapacity(component: PlacedComponent): number {
    if (this.isStartingUp(component.id)) return 0;

    if (component.type === 'database') {
      return component.capacity * this.getDatabaseMultiplier(component);
    }

    if (isScalableType(component.type)) {
      const primaryId = getScalePrimaryId(component);
      const scaling = this.scalingState.get(primaryId);
      const primary = this.componentMap.get(primaryId);
      const cfg = primary ? this.scalingConfig(primary) : null;
      if (scaling && cfg && cfg.vertical.enabled) {
        return component.capacity * scaling.verticalMultiplier;
      }
    }

    return component.capacity;
  }

  private getEffectiveQueueLimit(component: PlacedComponent): number {
    if (this.isStartingUp(component.id)) return 0;

    if (component.type === 'database') {
      return Math.round(component.queueLimit * this.getDatabaseMultiplier(component));
    }
    return component.queueLimit;
  }

  /**
   * Estimated share of total traffic a scale group will receive, used by
   * predictive pre-scaling: the summed spawn weight of every request kind
   * whose flow this component can serve, split evenly across the scale
   * groups that can serve it (the interpreter picks uniformly among
   * satisfying belts). Kinds without a flow carry no routable traffic.
   */
  private predictiveTrafficShare(component: PlacedComponent): number {
    const weights = Object.entries(this.requestTypesNow()).filter(
      ([, weight]) => weight > 0
    );
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) return 0;

    const serves = (candidate: PlacedComponent, kind: string): boolean => {
      const spec = this.flowsByKind.get(kind);
      if (!spec) return false;
      return allSteps(spec).some((step) => selectorMatches(step.require, candidate));
    };

    let share = 0;
    for (const [kind, weight] of weights) {
      if (!serves(component, kind)) continue;
      const peerGroups = this.components.filter(
        (c) => isScalePrimary(c) && isScalableType(c.type) && serves(c, kind)
      ).length;
      share += weight / total / Math.max(1, peerGroups);
    }
    return share;
  }

  private applyPredictiveScaling(): void {
    if (!this.spikeActive) return;

    for (const component of this.components) {
      if (!isScalePrimary(component)) continue;

      const cfg = this.scalingConfig(component);
      const scaling = this.scalingState.get(component.id)!;
      if (!cfg?.predictive.enabled || !cfg.horizontal.enabled) continue;

      const trafficShare = this.predictiveTrafficShare(component);
      const needed = Math.ceil(
        (this.currentRps * trafficShare) / component.capacity
      );
      const desired = Math.min(
        cfg.horizontal.maxInstances,
        Math.max(
          scaling.instances,
          Math.ceil(needed * cfg.predictive.preScaleFactor)
        )
      );
      scaling.instances = desired;
      scaling.maxInstancesReached = Math.max(scaling.maxInstancesReached, scaling.instances);
    }

    this.reconcileScaleInstances();
  }

  private updateAutoScaling(dt: number): void {
    for (const component of this.components) {
      if (!isScalePrimary(component)) continue;

      const cfg = this.scalingConfig(component);
      if (!cfg) continue;
      const scaling = this.scalingState.get(component.id)!;
      const { utilization, queuePressure } = this.aggregateGroupMetrics(component);
      const targetUtil = cfg.horizontal.targetUtilization;

      if (!cfg.reactive.enabled) {
        scaling.maxInstancesReached = Math.max(
          scaling.maxInstancesReached,
          getScaleGroupMembers(this.components, component.id).length
        );
        scaling.maxVerticalMultiplier = Math.max(
          scaling.maxVerticalMultiplier,
          scaling.verticalMultiplier
        );
        continue;
      }

      let upTimer = this.scaleUpTimers.get(component.id) ?? 0;
      let downTimer = this.scaleDownTimers.get(component.id) ?? 0;
      const hot = utilization >= targetUtil || queuePressure >= 55;

      if (hot) {
        upTimer += dt;
        downTimer = 0;
      } else if (utilization < targetUtil * 0.5 && queuePressure < 25) {
        downTimer += dt;
        upTimer = 0;
      } else {
        upTimer = 0;
        downTimer = 0;
      }

      this.scaleUpTimers.set(component.id, upTimer);
      this.scaleDownTimers.set(component.id, downTimer);

      if (
        upTimer >= cfg.reactive.scaleUpDelaySeconds &&
        (cfg.horizontal.enabled || cfg.vertical.enabled)
      ) {
        if (
          cfg.horizontal.enabled &&
          scaling.instances < cfg.horizontal.maxInstances
        ) {
          scaling.instances += 1;
          this.scaleUpTimers.set(component.id, 0);
        } else if (
          cfg.vertical.enabled &&
          scaling.verticalMultiplier < cfg.vertical.maxMultiplier &&
          utilization >= cfg.vertical.targetUtilization
        ) {
          scaling.verticalMultiplier = Math.min(
            cfg.vertical.maxMultiplier,
            Math.round((scaling.verticalMultiplier + 0.2) * 10) / 10
          );
          this.scaleUpTimers.set(component.id, 0);
          this.message = `${component.label} vertically scaled to ×${scaling.verticalMultiplier.toFixed(1)}`;
        }
      }

      if (
        cfg.horizontal.enabled &&
        downTimer >= cfg.reactive.scaleDownDelaySeconds &&
        scaling.instances > cfg.horizontal.minInstances
      ) {
        scaling.instances -= 1;
        this.scaleDownTimers.set(component.id, 0);
      }

      scaling.maxInstancesReached = Math.max(
        scaling.maxInstancesReached,
        getScaleGroupMembers(this.components, component.id).length
      );
      scaling.maxVerticalMultiplier = Math.max(
        scaling.maxVerticalMultiplier,
        scaling.verticalMultiplier
      );
    }

    this.reconcileScaleInstances();
  }

  private rebuildPorts(): void {
    this.portMap.clear();
    const source = getSourcePort(this.components);
    this.portMap.set(source.id, source);
    for (const component of this.components) {
      for (const port of getComponentPorts(component)) {
        this.portMap.set(port.id, port);
      }
    }
    this.rebuildBeltTravelTimes();
  }

  /** Constant pixel speed: long belts take longer than short ones. */
  private rebuildBeltTravelTimes(): void {
    this.beltTravelTime.clear();
    for (const belt of this.belts) {
      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;
      this.beltTravelTime.set(belt.id, beltTravelSeconds(beltLength(from, to)));
    }
  }

  private resetStates(): void {
    this.componentState.clear();
    this.beltState.clear();
    this.telemetry.clear();
    this.completionDebt.clear();
    this.overloadTimers.clear();
    this.startupUntil.clear();
    this.initScalingState();
    for (const component of this.components) {
      this.initComponentRuntime(component, 0);
    }
    for (const belt of this.belts) {
      this.beltState.set(belt.id, { load: 0, traveling: 0, dropped: 0 });
    }
  }

  private resetRequestCounters(): void {
    this.totalSpawned = 0;
    this.totalCompleted = 0;
    this.totalDropped = 0;
    this.totalViolated = 0;
    this.spawnedByKind.clear();
    this.completedByKind.clear();
    this.droppedByKind.clear();
    this.violatedByKind.clear();
    this.violationsByStep.clear();
    this.dropReasons.clear();
  }

  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /** The traffic seed this engine replays (spec §8). */
  getSeed(): number {
    return this.seed;
  }

  start(): void {
    this.rng = createRng(this.seed);
    this.time = 0;
    this.status = 'running';
    this.resetScriptedPhases();
    this.spawnAccumulator = 0;
    this.resetRequestCounters();
    this.requests = [];
    this.finishedRequests = [];
    this.resetExamples();
    this.pendingRecoveries = [];
    this.peakRps = 0;
    this.spikeEvents = 0;
    this.wasSpikeActive = false;
    this.draining = false;
    this.restoreInitialTopology();
    this.resetStates();
    this.reconcileScaleInstances();
    this.onTopologyChange?.();
    this.message = 'Simulation running — watch for red overload!';
    nextRequestId = 1;
  }

  stop(): void {
    this.status = 'idle';
    this.message = 'Simulation stopped.';
  }

  reset(): void {
    this.status = 'idle';
    this.time = 0;
    this.requests = [];
    this.finishedRequests = [];
    this.resetExamples();
    this.pendingRecoveries = [];
    this.restoreInitialTopology();
    this.resetStates();
    this.onTopologyChange?.();
    this.resetRequestCounters();
    this.message = 'Wire up your system, then press Play.';
  }

  tick(dt: number): SimulationSnapshot {
    if (this.status !== 'running') {
      return this.getSnapshot();
    }

    this.time += dt;
    this.updateStartupStates();
    this.processRecoveries();
    const inDrain =
      this.draining || this.time >= this.scenario.duration;

    if (!inDrain) this.fireScriptedPhases();
    this.updateScriptedPhaseFlags();

    if (!inDrain) {
      this.updateTrafficPattern(dt);
      this.applyPredictiveScaling();
      this.spawnAccumulator += this.currentRps * dt;
      const spawnCount = Math.floor(this.spawnAccumulator);
      if (spawnCount > 0) {
        this.spawnAccumulator -= spawnCount;
        // Spread this tick's arrivals across the tick so they form a stream.
        for (let i = 0; i < spawnCount; i++) {
          this.spawnRequest(dt * (i / spawnCount));
        }
      }
    } else if (!this.draining) {
      this.draining = true;
      this.currentRps = 0;
      this.spawnAccumulator = 0;
      this.spikeActive = false;
      this.message = 'Draining in-flight requests…';
    }

    this.updateBelts(dt);
    this.syncQueueCounts();
    this.updateComponents(dt);
    this.updateLoads();
    this.updateAutoScaling(dt);

    if (!inDrain) {
      this.recordTelemetry(dt);
    }

    if (
      this.draining &&
      this.time >= this.scenario.duration + this.scenario.drainDuration
    ) {
      // A run is won by surviving *and* meeting the scenario's objectives
      // (spec §6): completion floors per request kind and a violation
      // ceiling. Scenarios without objectives are judged on survival alone.
      const anyFailed = [...this.componentState.values()].some((s) => s.failed);
      const objectives = evaluateObjectives(this.scenario.objectives, this.runCounts());
      const met = allObjectivesMet(objectives);

      this.status = met ? 'won' : 'lost';
      if (anyFailed) {
        this.message = 'Time\'s up — some components failed under load.';
      } else if (!met) {
        const missed = objectives.filter((objective) => !objective.met);
        this.message = `Your architecture survived, but missed ${missed.length} objective${missed.length === 1 ? '' : 's'}: ${missed
          .map((objective) => objective.label)
          .join(', ')}.`;
      } else {
        this.message = 'Success! Your architecture survived the traffic storm.';
      }
    }

    return this.getSnapshot();
  }

  private updateTrafficPattern(dt: number): void {
    if (this.spikeActive) {
      this.spikeTimer -= dt;
      if (this.spikeTimer <= 0) {
        this.spikeActive = false;
        this.currentRps = this.baseRpsNow();
      }
    } else if (this.rng.chance(this.scenario.spikeChance * dt)) {
      this.spikeActive = true;
      this.spikeTimer = 2.5 + this.rng.next() * 3;
      this.currentRps = this.baseRpsNow() * this.scenario.spikeMultiplier;
      this.applyPredictiveScaling();
    } else {
      const jitter = 1 + (this.rng.next() - 0.5) * 0.15;
      this.currentRps = this.baseRpsNow() * jitter;
    }

    this.peakRps = Math.max(this.peakRps, this.currentRps);
    if (this.spikeActive && !this.wasSpikeActive) {
      this.spikeEvents += 1;
    }
    this.wasSpikeActive = this.spikeActive;
  }

  private recordTelemetry(dt: number): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      const tel = this.telemetry.get(component.id)!;

      tel.loadIntegral += state.load * dt;
      tel.maxLoad = Math.max(tel.maxLoad, state.load);

      const queueLimit = this.getEffectiveQueueLimit(component);
      const queueFill =
        queueLimit > 0 ? (state.queue / queueLimit) * 100 : 0;
      tel.maxQueueFill = Math.max(tel.maxQueueFill, queueFill);

      if (state.failed) {
        tel.downtimeSeconds += dt;
        if (tel.failedAt === null) {
          tel.failedAt = this.time;
        }
      }

      if (state.load >= 100) {
        tel.overloadSeconds += dt;
      }

      if (queueFill >= 80) {
        tel.queuePressureSeconds += dt;
      }

      if (state.load < IDLE_LOAD_THRESHOLD && !state.failed) {
        tel.idleSeconds += dt;
      }
    }
  }

  private queuedCount(componentId: string): number {
    return this.requests.filter(
      (r) => r.state === 'queued' && r.currentComponentId === componentId
    ).length;
  }

  private syncQueueCounts(): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      state.queue = this.queuedCount(component.id);
    }
  }

  private labelFor(componentId: string): string {
    return this.componentMap.get(componentId)?.label ?? componentId;
  }

  private targetComponentOf(belt: ConveyorBelt): PlacedComponent | undefined {
    const port = this.portMap.get(belt.toPortId);
    return port ? this.componentMap.get(port.componentId) : undefined;
  }

  private beltTravelSpeed(belt: ConveyorBelt): number {
    const seconds = this.beltTravelTime.get(belt.id) ?? 1.2;
    return 1 / seconds;
  }

  private logEvent(request: Request, event: RequestEvent): void {
    request.events.push(event);
  }

  private componentEvent(
    kind: RequestEvent['kind'],
    component: PlacedComponent,
    extra: Partial<RequestEvent> = {}
  ): RequestEvent {
    return {
      kind,
      at: this.time,
      componentId: component.id,
      componentLabel: component.label,
      componentType: component.type,
      ...extra,
    };
  }

  /**
   * Put a request onto a belt. `headStart` is how many seconds of travel have
   * notionally already elapsed, which lets a batch emitted within one tick be
   * spread evenly along the belt instead of stacking at the start.
   */
  private placeOnBelt(request: Request, belt: ConveyorBelt, headStart = 0): void {
    const beltSt = this.beltState.get(belt.id)!;
    if (request.flow) {
      const fromPort = this.portMap.get(belt.fromPortId);
      request.flow.trail.push({
        beltId: belt.id,
        fromComponentId: fromPort?.componentId ?? SOURCE_ID,
      });
    }
    request.beltId = belt.id;
    request.targetPortId = belt.toPortId;
    request.currentComponentId = null;
    request.arrivedAt = null;
    request.state = 'traveling';
    request.travelSpeed = this.beltTravelSpeed(belt);
    request.progress = clamp(request.travelSpeed * Math.max(0, headStart), 0, 0.999);
    beltSt.traveling += 1;
  }

  private archiveRequest(request: Request): void {
    this.finishedRequests.push(request);
    if (this.finishedRequests.length > FINISHED_ARCHIVE_LIMIT) {
      this.finishedRequests.splice(0, this.finishedRequests.length - FINISHED_ARCHIVE_LIMIT);
    }
    this.sampleExample(request);
  }

  private resetExamples(): void {
    this.examplePool.clear();
    this.exampleSeen.clear();
    // Decorrelated from the main stream; deterministic for the seed.
    this.exampleRng = createRng((this.getSeed() ^ 0x5bd1e995) >>> 0);
  }

  /** Reservoir sampling per (kind, end state): every finished request has an equal chance of being kept. */
  private sampleExample(request: Request): void {
    const key = `${request.kind}:${request.state}`;
    const seen = (this.exampleSeen.get(key) ?? 0) + 1;
    this.exampleSeen.set(key, seen);
    let pool = this.examplePool.get(key);
    if (!pool) {
      pool = [];
      this.examplePool.set(key, pool);
    }
    if (pool.length < EXAMPLE_POOL_LIMIT) {
      pool.push(request);
      return;
    }
    const slot = Math.floor(this.exampleRng.next() * seen);
    if (slot < EXAMPLE_POOL_LIMIT) pool[slot] = request;
  }

  /** Sampled finished requests of one kind and end state, for the coaching drawer (§4.2). */
  getExampleRequests(kind: string, state: 'done' | 'dropped' | 'violated'): Request[] {
    return [...(this.examplePool.get(`${kind}:${state}`) ?? [])];
  }

  /** Requests neither completed nor dropped — what "still in flight" means at the end of a run. */
  getUnfinishedRequests(kind?: string): Request[] {
    return this.requests.filter(
      (r) =>
        r.state !== 'done' &&
        r.state !== 'dropped' &&
        r.state !== 'violated' &&
        (kind === undefined || r.kind === kind)
    );
  }

  private finishRequest(request: Request, state: 'done' | 'dropped' | 'violated'): void {
    request.state = state;
    request.finishedAt = this.time;
    request.beltId = null;
    this.archiveRequest(request);
  }

  private dropRequest(request: Request, reason: string, component?: PlacedComponent): void {
    this.logEvent(request, {
      kind: 'dropped',
      at: this.time,
      componentId: component?.id,
      componentLabel: component?.label,
      componentType: component?.type,
      detail: reason,
    });
    this.finishRequest(request, 'dropped');
    this.totalDropped += 1;
    this.bump(this.droppedByKind, request.kind);
    this.bump(
      this.dropReasons,
      `${request.kind}:${normalizeDropReason(reason, component)}`
    );
  }

  /** Terminate a request that cannot take its next required flow step. */
  private violateRequest(
    request: Request,
    component: PlacedComponent,
    step: FlowStep | null,
    reason: string
  ): void {
    this.logEvent(request, this.componentEvent('violated', component, { detail: reason }));
    this.finishRequest(request, 'violated');
    this.totalViolated += 1;
    this.bump(this.violatedByKind, request.kind);
    if (step) {
      this.bump(this.violationsByStep, `${request.kind}:${step.id}`);
    }
  }

  private spawnRequest(headStart = 0): void {
    const sourcePort = getSourcePort(this.components);
    const outgoing = this.beltByFromPort.get(sourcePort.id) ?? [];
    if (outgoing.length === 0) {
      this.totalDropped += 1;
      return;
    }

    // Every wire out of the source carries traffic: pick uniformly among the
    // belts with headroom, and only drop when all of them are congested.
    const belt = this.pickAvailableBelt(outgoing);
    if (!belt) {
      this.beltState.get(outgoing[0].id)!.dropped += 1;
      this.totalDropped += 1;
      return;
    }

    const kind = this.pickRequestKind();
    const { colorIndex, celebrity } = pickRequestColor(this.scenario, this.rng);
    const id = nextRequestId++;
    const spec = this.flowsByKind.get(kind);

    const request: Request = {
      id,
      kind,
      colorIndex,
      celebrity,
      progress: 0,
      beltId: null,
      currentComponentId: null,
      targetPortId: null,
      state: 'traveling',
      waitTime: 0,
      spawnedAt: this.time,
      finishedAt: null,
      travelSpeed: 1,
      lane: laneFor(id),
      visualKey: visualKeyFor(id),
      arrivedAt: null,
      events: [],
      flow: spec
        ? {
            kind,
            stepIndex: 0,
            pending: [...spec.steps],
            satisfiedBy: {},
            trail: [],
            returnLeg: null,
            resume: false,
          }
        : null,
    };

    const target = this.targetComponentOf(belt);
    this.logEvent(request, {
      kind: 'spawned',
      at: this.time,
      beltId: belt.id,
      detail: target ? `→ ${target.label}` : undefined,
    });
    this.placeOnBelt(request, belt, headStart);
    this.requests.push(request);
    this.totalSpawned += 1;
    this.bump(this.spawnedByKind, kind);
  }

  /** Weighted pick over the scenario's request kinds. */
  private pickRequestKind(): RequestKind {
    const entries = Object.entries(this.requestTypesNow()).filter(([, w]) => w > 0);
    if (entries.length === 0) {
      return this.rng.chance(this.scenario.readRatio) ? 'read' : 'create';
    }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.rng.next() * total;
    for (const [kind, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return entries[entries.length - 1][0];
  }

  private updateBelts(dt: number): void {
    for (const request of this.requests) {
      if (request.state !== 'traveling' || !request.beltId) continue;

      request.progress += request.travelSpeed * dt;
      if (request.progress < 1) continue;

      if (request.flow?.returnLeg) {
        this.advanceReturnLeg(request);
        continue;
      }

      // Carry the overshoot into the next hop so streams stay evenly spaced.
      const overshootSeconds = (request.progress - 1) / request.travelSpeed;
      request.progress = 1;

      const belt = this.beltById.get(request.beltId);
      if (!belt) {
        this.dropRequest(request, 'belt no longer exists');
        continue;
      }

      const beltSt = this.beltState.get(belt.id);
      if (beltSt) beltSt.traveling = Math.max(0, beltSt.traveling - 1);

      const targetPort = this.portMap.get(belt.toPortId);
      if (!targetPort) {
        this.dropRequest(request, 'target port missing');
        continue;
      }

      const componentId = targetPort.componentId;
      const compSt = this.componentState.get(componentId);
      const component = this.componentMap.get(componentId);
      if (!compSt || !component) {
        this.dropRequest(request, 'target component missing');
        continue;
      }

      request.beltId = null;
      this.logEvent(request, this.componentEvent('arrived', component));

      const result = this.acceptRequest(request, component, compSt, overshootSeconds);
      if (!result.ok) {
        compSt.dropped += 1;
        this.dropRequest(request, result.reason, component);
        continue;
      }

      if (result.routed) continue;

      request.currentComponentId = componentId;
      request.arrivedAt = this.time;
      request.state = 'queued';
    }
  }

  private acceptRequest(
    request: Request,
    component: PlacedComponent,
    state: ComponentState,
    headStart: number
  ): AcceptResult {
    if (state.failed) return { ok: false, reason: `${component.label} is down` };
    if (state.startingUp) return { ok: false, reason: `${component.label} is still starting up` };

    // Every request is flow-driven (flow-authoring §5). A kind the scenario
    // defines no flow for is a configuration error, not a routing mode: the
    // lint reports it before Play, and here each such request dies visibly.
    if (!request.flow) {
      this.violateRequest(
        request,
        component,
        null,
        `Request kind "${request.kind}" has no flow — add one in the scenario editor`
      );
      return { ok: true, routed: true };
    }
    return this.acceptFlowRequest(request, component, headStart);
  }

  private updateComponents(dt: number): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      if (state.failed) continue;

      const processRate = this.getEffectiveCapacity(component);
      const queueLimit = this.getEffectiveQueueLimit(component);
      const debt = (this.completionDebt.get(component.id) ?? 0) + processRate * dt;
      let completions = Math.floor(debt);
      this.completionDebt.set(component.id, debt - completions);
      completions = Math.min(completions, state.queue);

      if (completions > 0) {
        let processed = 0;
        for (let i = 0; i < completions; i++) {
          // Spread this tick's batch along the outgoing belt.
          const headStart = dt * (i / completions);
          if (this.completeOneRequest(component, headStart)) {
            processed += 1;
            continue;
          }
          break;
        }
        state.processing = processed / dt;
        state.processed += processed;
        const unused = completions - processed;
        if (unused > 0) {
          this.completionDebt.set(
            component.id,
            (this.completionDebt.get(component.id) ?? 0) + unused
          );
        }
      } else {
        state.processing = 0;
      }

      if (component.type === 'load-balancer' || isIngressType(component.type)) {
        continue;
      }

      if (this.isActiveScriptedTarget(component.id)) {
        // Down by script, not by design: the drill's own target does not
        // "fail"; what matters is whether everything else survives it.
        this.overloadTimers.set(component.id, 0);
        continue;
      }

      if (state.queue >= queueLimit) {
        const timer = (this.overloadTimers.get(component.id) ?? 0) + dt;
        this.overloadTimers.set(component.id, timer);
        if (timer >= 1.8) {
          state.failed = true;
          this.status = 'lost';
          this.message = `${component.label} overloaded and failed!`;
          this.recordCollateralFailure(component);
        }
      } else {
        this.overloadTimers.set(component.id, 0);
      }
    }

    this.requests = this.requests.filter(
      (r) => r.state !== 'done' && r.state !== 'dropped' && r.state !== 'violated'
    );
  }

  private canEmitOnBelt(belt: ConveyorBelt): boolean {
    const beltSt = this.beltState.get(belt.id)!;
    return beltSt.traveling < belt.capacity * 0.9;
  }

  private pickAvailableBelt(belts: ConveyorBelt[]): ConveyorBelt | undefined {
    const available = belts.filter((belt) => this.canEmitOnBelt(belt));
    if (available.length === 0) return undefined;
    return this.rng.pick(available);
  }

  /** Process one queued request at a component through the flow interpreter. */
  private completeOneRequest(component: PlacedComponent, headStart = 0): boolean {
    const request = this.requests.find(
      (r) => r.state === 'queued' && r.currentComponentId === component.id
    );
    if (!request) return false;
    // Queued requests always carry a flow: flow-less kinds are violated on
    // arrival in acceptRequest and never reach a queue.
    return this.interpretQueuedRequest(component, request, headStart);
  }

  /** Oldest queued request at a component, charged for its queue wait. */
  private takeQueuedRequest(component: PlacedComponent): Request | undefined {
    const request = this.requests.find(
      (r) => r.state === 'queued' && r.currentComponentId === component.id
    );
    if (!request) return undefined;
    if (request.arrivedAt !== null) {
      request.waitTime += Math.max(0, this.time - request.arrivedAt);
    }
    return request;
  }

  // ---------------------------------------------------------------------
  // Flow interpreter (docs/specs/flow-correctness.md §5)
  // ---------------------------------------------------------------------

  /** Advance the cursor past (and including) the step at `index`. */
  private consumeStep(
    flow: RequestFlowState,
    index: number,
    component: PlacedComponent
  ): FlowStep {
    const step = flow.pending[index];
    flow.pending = flow.pending.slice(index + 1);
    flow.stepIndex += index + 1;
    flow.satisfiedBy[step.id] = component.id;
    return step;
  }

  private resolveBranchProbability(probability: number | 'cacheHitRatio'): number {
    return probability === 'cacheHitRatio' ? this.scenario.cacheHitRatio : probability;
  }

  /**
   * Choose the outgoing belt for the next flow step. Optional steps are
   * taken when a satisfying belt exists (and skipped when it is merely
   * congested); a required step with no satisfying belt at all is a flow
   * violation, while a temporarily unusable one asks the caller to retry.
   */
  private pickFlowRoute(
    component: PlacedComponent,
    steps: FlowStep[]
  ):
    | { kind: 'belt'; belt: ConveyorBelt }
    | { kind: 'wait' }
    | { kind: 'violated'; step: FlowStep | null } {
    const outPort = getComponentPorts(component).find((p) => p.side === 'out');
    const belts = outPort ? this.beltByFromPort.get(outPort.id) ?? [] : [];

    for (const step of steps) {
      const matching = belts.filter((belt) => {
        const target = this.targetComponentOf(belt);
        return target !== undefined && selectorMatches(step.require, target);
      });
      if (matching.length === 0) {
        if (step.optional) continue;
        return { kind: 'violated', step };
      }
      const usable = matching.filter((belt) => {
        const target = this.targetComponentOf(belt)!;
        const targetState = this.componentState.get(target.id);
        if (!targetState || targetState.failed || this.isStartingUp(target.id)) return false;
        return this.canEmitOnBelt(belt);
      });
      if (usable.length === 0) {
        if (step.optional) continue;
        return { kind: 'wait' };
      }
      return { kind: 'belt', belt: this.rng.pick(usable) };
    }

    // Ran out of steps without a terminal: a malformed spec
    // (validateFlowSpec flags these) — fail the request visibly.
    return { kind: 'violated', step: null };
  }

  private flowViolationReason(
    request: Request,
    component: PlacedComponent,
    step: FlowStep | null
  ): string {
    const kind = request.flow?.kind ?? request.kind;
    if (!step) {
      return `${kind} ran out of flow steps at "${component.label}" without completing`;
    }
    const outPort = getComponentPorts(component).find((p) => p.side === 'out');
    const belts = outPort ? this.beltByFromPort.get(outPort.id) ?? [] : [];
    const targets = [
      ...new Set(
        belts
          .map((belt) => this.targetComponentOf(belt)?.label)
          .filter((label): label is string => label !== undefined)
      ),
    ];
    const connected =
      targets.length === 0
        ? 'nothing is connected'
        : `only ${targets.join(', ')} ${targets.length > 1 ? 'are' : 'is'} connected`;
    return `${kind} needed ${describeSelector(step.require, this.scenario.tags)} after "${component.label}", but ${connected}`;
  }

  /** Reason for a request landing on a node that satisfies no pending step. */
  private unmatchedStepReason(request: Request, component: PlacedComponent): string {
    const flow = request.flow!;
    const next = flow.pending.find((s) => !s.optional) ?? flow.pending[0];
    if (!next) {
      return `${flow.kind} arrived at "${component.label}" after its flow already ended`;
    }
    return `${flow.kind} needed ${describeSelector(next.require, this.scenario.tags)} but reached "${component.label}"`;
  }

  private completeFlowRequest(
    request: Request,
    component: PlacedComponent,
    detail?: string
  ): void {
    this.logEvent(request, this.componentEvent('processed', component, detail ? { detail } : {}));
    this.logEvent(request, this.componentEvent('completed', component));
    this.finishRequest(request, 'done');
    this.totalCompleted += 1;
    this.bump(this.completedByKind, request.kind);
  }

  private forwardFlowRequest(
    request: Request,
    component: PlacedComponent,
    belt: ConveyorBelt,
    headStart: number,
    detail?: string
  ): void {
    const target = this.targetComponentOf(belt);
    this.logEvent(request, this.componentEvent('processed', component, detail ? { detail } : {}));
    this.logEvent(
      request,
      this.componentEvent('forwarded', component, {
        beltId: belt.id,
        detail: `→ ${target?.label ?? this.labelFor(belt.toPortId)}`,
      })
    );
    this.placeOnBelt(request, belt, headStart);
  }

  /**
   * Flow interpreter core: advance the oldest queued request's cursor at
   * this component. Returns true when a processing slot was consumed; false
   * leaves the request queued for a retry (congested outgoing paths), just
   * like the legacy routing.
   */
  private interpretQueuedRequest(
    component: PlacedComponent,
    request: Request,
    headStart: number
  ): boolean {
    const flow = request.flow!;

    if (flow.resume) {
      // Just landed from a returnTo leg: this node already satisfied its
      // step earlier — only route the next one.
      const route = this.pickFlowRoute(component, flow.pending);
      if (route.kind === 'wait') return false;
      this.takeQueuedRequest(component);
      flow.resume = false;
      this.logEvent(request, this.componentEvent('processed', component));
      if (route.kind === 'violated') {
        this.violateRequest(
          request,
          component,
          route.step,
          this.flowViolationReason(request, component, route.step)
        );
        return true;
      }
      const target = this.targetComponentOf(route.belt);
      this.logEvent(
        request,
        this.componentEvent('forwarded', component, {
          beltId: route.belt.id,
          detail: `→ ${target?.label ?? this.labelFor(route.belt.toPortId)}`,
        })
      );
      this.placeOnBelt(request, route.belt, headStart);
      return true;
    }

    const idx = matchPendingStep(flow.pending, component);
    if (idx === -1) {
      this.takeQueuedRequest(component);
      this.logEvent(request, this.componentEvent('processed', component));
      const next = flow.pending.find((s) => !s.optional) ?? flow.pending[0] ?? null;
      this.violateRequest(request, component, next, this.unmatchedStepReason(request, component));
      return true;
    }

    const step = flow.pending[idx];
    let remainder = flow.pending.slice(idx + 1);
    let branchDetail: string | undefined;

    if (step.branch) {
      const probability = this.resolveBranchProbability(step.branch.probability);
      const hit = this.rng.chance(probability);
      const isCacheBranch = step.branch.probability === 'cacheHitRatio';
      const continuation = hit ? step.branch.onHit : step.branch.onMiss;
      if (continuation === 'complete') {
        this.takeQueuedRequest(component);
        this.consumeStep(flow, idx, component);
        this.completeFlowRequest(request, component, isCacheBranch ? 'cache hit' : undefined);
        return true;
      }
      branchDetail = isCacheBranch ? (hit ? 'cache hit' : 'cache miss') : undefined;
      remainder = [...continuation, ...remainder];
    } else if (step.terminal) {
      this.takeQueuedRequest(component);
      this.consumeStep(flow, idx, component);
      this.completeFlowRequest(request, component);
      return true;
    }

    if (step.returnTo) {
      this.takeQueuedRequest(component);
      this.consumeStep(flow, idx, component);
      flow.pending = remainder;
      this.logEvent(
        request,
        this.componentEvent('processed', component, branchDetail ? { detail: branchDetail } : {})
      );
      this.startReturnLeg(request, component, step);
      return true;
    }

    const route = this.pickFlowRoute(component, remainder);
    // Leave the request queued without mutating its cursor; a discarded
    // branch roll is simply re-rolled on the retry.
    if (route.kind === 'wait') return false;

    this.takeQueuedRequest(component);
    this.consumeStep(flow, idx, component);
    flow.pending = remainder;

    if (route.kind === 'violated') {
      this.logEvent(
        request,
        this.componentEvent('processed', component, branchDetail ? { detail: branchDetail } : {})
      );
      this.violateRequest(
        request,
        component,
        route.step,
        this.flowViolationReason(request, component, route.step)
      );
      return true;
    }

    this.forwardFlowRequest(request, component, route.belt, headStart, branchDetail);
    return true;
  }

  /**
   * Begin the reverse journey of a returnTo step: retrace the forward belts
   * back to the component that satisfied the named step.
   */
  private startReturnLeg(request: Request, component: PlacedComponent, step: FlowStep): void {
    const flow = request.flow!;
    const callerId = flow.satisfiedBy[step.returnTo!];
    const belts: string[] = [];
    let found = false;
    for (let i = flow.trail.length - 1; i >= 0; i--) {
      belts.push(flow.trail[i].beltId);
      if (flow.trail[i].fromComponentId === callerId) {
        flow.trail = flow.trail.slice(0, i);
        found = true;
        break;
      }
    }
    if (!callerId || !found) {
      this.violateRequest(
        request,
        component,
        step,
        `${flow.kind} could not return to step "${step.returnTo}" from "${component.label}"`
      );
      return;
    }
    flow.returnLeg = { belts, index: 0, callerId };
    this.placeOnReturnBelt(request, belts[0]);
  }

  /**
   * Reverse traversal of a belt (returnTo leg): travel time is charged at
   * the normal belt speed, but the leg is not rendered and does not count
   * toward the belt's occupancy.
   */
  private placeOnReturnBelt(request: Request, beltId: string): void {
    const belt = this.beltById.get(beltId);
    if (!belt) {
      this.dropRequest(request, 'return path no longer exists');
      return;
    }
    request.beltId = belt.id;
    request.targetPortId = belt.fromPortId;
    request.currentComponentId = null;
    request.arrivedAt = null;
    request.state = 'traveling';
    request.travelSpeed = this.beltTravelSpeed(belt);
    request.progress = 0;
  }

  /** A return-leg belt finished: hop to the next one or land at the caller. */
  private advanceReturnLeg(request: Request): void {
    const flow = request.flow!;
    const leg = flow.returnLeg!;
    leg.index += 1;
    if (leg.index < leg.belts.length) {
      this.placeOnReturnBelt(request, leg.belts[leg.index]);
      return;
    }

    const caller = this.componentMap.get(leg.callerId);
    const callerState = caller ? this.componentState.get(caller.id) : undefined;
    flow.returnLeg = null;
    request.beltId = null;
    request.progress = 0;
    if (!caller || !callerState || callerState.failed) {
      this.dropRequest(request, 'the calling component is no longer available', caller);
      return;
    }
    this.logEvent(request, this.componentEvent('returned', caller));
    const limit = this.getEffectiveQueueLimit(caller);
    const queued = this.queuedCount(caller.id);
    if (queued >= limit) {
      callerState.dropped += 1;
      this.dropRequest(request, `queue full (${queued}/${limit})`, caller);
      return;
    }
    flow.resume = true;
    request.currentComponentId = caller.id;
    request.arrivedAt = this.time;
    request.state = 'queued';
  }

  /**
   * Arrival handling for flow-driven requests. Ingress and traffic-filter
   * nodes stay pass-through — they route on arrival without queueing, as the
   * legacy engine did — while every other node queues the request.
   */
  private acceptFlowRequest(
    request: Request,
    component: PlacedComponent,
    headStart: number
  ): AcceptResult {
    const flow = request.flow!;
    const caps = getCapabilities(component.type);
    const passThrough = caps.has('ingress') || caps.has('traffic-filter');

    if (passThrough && !flow.resume) {
      const idx = matchPendingStep(flow.pending, component);
      if (idx === -1) {
        const next = flow.pending.find((s) => !s.optional) ?? flow.pending[0] ?? null;
        this.violateRequest(request, component, next, this.unmatchedStepReason(request, component));
        return { ok: true, routed: true };
      }
      const step = flow.pending[idx];
      if (!step.terminal && !step.branch && !step.returnTo) {
        const route = this.pickFlowRoute(component, flow.pending.slice(idx + 1));
        if (route.kind === 'violated') {
          this.consumeStep(flow, idx, component);
          this.violateRequest(
            request,
            component,
            route.step,
            this.flowViolationReason(request, component, route.step)
          );
          return { ok: true, routed: true };
        }
        if (route.kind === 'wait') {
          return { ok: false, reason: `link out of ${component.label} is congested` };
        }
        const targetComp = this.targetComponentOf(route.belt)!;
        const limit = this.getEffectiveQueueLimit(targetComp);
        const queued = this.queuedCount(targetComp.id);
        if (queued >= limit) {
          return { ok: false, reason: `${targetComp.label} queue full (${queued}/${limit})` };
        }
        this.consumeStep(flow, idx, component);
        this.logEvent(
          request,
          this.componentEvent('routed', component, {
            beltId: route.belt.id,
            detail: `→ ${targetComp.label}`,
          })
        );
        this.placeOnBelt(request, route.belt, headStart);
        return { ok: true, routed: true };
      }
    }

    const limit = this.getEffectiveQueueLimit(component);
    const queued = this.queuedCount(component.id);
    if (queued >= limit) {
      return { ok: false, reason: `queue full (${queued}/${limit})` };
    }
    return { ok: true, routed: false };
  }

  private updateLoads(): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      const effectiveCapacity = this.getEffectiveCapacity(component);
      if (component.type === 'load-balancer') {
        state.load = clamp((this.currentRps / effectiveCapacity) * 100, 0, 100);
      } else {
        const utilization =
          effectiveCapacity > 0 ? (state.processing / effectiveCapacity) * 100 : 0;
        state.load = clamp(utilization, 0, 100);
      }
    }
    for (const belt of this.belts) {
      const state = this.beltState.get(belt.id)!;
      state.load = clamp((state.traveling / belt.capacity) * 100, 0, 100);
    }
  }

  /** Look up a request by id among active and recently finished requests. */
  getRequest(id: number): Request | null {
    return (
      this.requests.find((r) => r.id === id) ??
      this.finishedRequests.find((r) => r.id === id) ??
      null
    );
  }

  getTime(): number {
    return this.time;
  }

  /** Everything the objective evaluator and the report need from this run. */
  private runCounts(): RunCounts {
    const brokenServices = this.components
      .filter((component) => this.componentState.get(component.id)?.failed)
      .map((component) => component.label);

    return {
      totalSpawned: this.totalSpawned,
      totalViolated: this.totalViolated,
      spawnedByKind: Object.fromEntries(this.spawnedByKind),
      completedByKind: Object.fromEntries(this.completedByKind),
      violatedByKind: Object.fromEntries(this.violatedByKind),
      droppedByKind: Object.fromEntries(this.droppedByKind),
      violationsByStep: Object.fromEntries(this.violationsByStep),
      dropReasons: Object.fromEntries(this.dropReasons),
      brokenServices,
      scriptedPhases: this.scriptedPhases.map((phase) => ({
        id: phase.id,
        label: phase.label,
        type: phase.type,
        atSeconds: phase.atSeconds,
        durationSeconds: phase.durationSeconds,
        componentLabel: phase.componentLabel,
        skipped: phase.skipped,
        failedDuring: [...(this.scriptedFailedDuring.get(phase.id) ?? [])],
      })),
    };
  }

  // ── Scripted failure phases and traffic phases (product-directions §3.3–§3.4) ──

  private resetScriptedPhases(): void {
    this.scriptedTargets.clear();
    this.scriptedFailedDuring.clear();
    this.scriptedPhases = (this.scenario.failureScenarios ?? []).map((spec) => ({
      id: spec.id,
      label: spec.label,
      type: spec.type,
      atSeconds: spec.atSeconds,
      durationSeconds: spec.durationSeconds,
      componentLabel: null,
      fired: false,
      skipped: false,
      until: null,
      active: false,
    }));
  }

  /**
   * Fire every phase whose time has come. The target is the first component
   * in board order that matches the selector — the same rule flows use. No
   * match means the phase is skipped and the report says so.
   */
  private fireScriptedPhases(): void {
    for (const phase of this.scriptedPhases) {
      if (phase.fired || this.time < phase.atSeconds) continue;
      phase.fired = true;
      const spec = (this.scenario.failureScenarios ?? []).find((f) => f.id === phase.id);
      const target = spec
        ? this.components.find((component) => selectorMatches(spec.target, component))
        : undefined;
      if (!target) {
        phase.skipped = true;
        continue;
      }
      phase.componentLabel = target.label;
      phase.until = this.time + phase.durationSeconds;
      phase.active = true;
      this.scriptedTargets.set(phase.id, target.id);
      this.scriptedFailedDuring.set(phase.id, new Set());
      this.injectFailure(target.id, phase.type, phase.durationSeconds);
      this.message = `⚡ ${phase.label}: ${target.label} ${describeFailure(phase.type)}`;
    }
  }

  private updateScriptedPhaseFlags(): void {
    for (const phase of this.scriptedPhases) {
      phase.active = phase.fired && !phase.skipped && phase.until !== null && this.time < phase.until;
    }
  }

  private isActiveScriptedTarget(componentId: string): boolean {
    for (const phase of this.scriptedPhases) {
      if (phase.active && this.scriptedTargets.get(phase.id) === componentId) return true;
    }
    return false;
  }

  private recordCollateralFailure(component: PlacedComponent): void {
    for (const phase of this.scriptedPhases) {
      if (!phase.active || this.scriptedTargets.get(phase.id) === component.id) continue;
      this.scriptedFailedDuring.get(phase.id)?.add(component.label);
    }
  }

  private baseRpsNow(): number {
    return baseRpsAt(this.scenario.baseRps, this.trafficPhases, this.time);
  }

  private requestTypesNow(): Record<string, number> {
    return requestTypesAt(this.scenario.requestTypes ?? {}, this.trafficPhases, this.time);
  }

  getReport(): SimulationReport {
    const outcome = this.status === 'won' ? 'won' : 'lost';
    const componentState = new Map(
      [...this.componentState.entries()].map(([id, st]) => [
        id,
        { processed: st.processed, dropped: st.dropped, failed: st.failed },
      ])
    );

    return buildSimulationReport({
      components: this.components,
      telemetry: this.telemetry,
      componentState,
      duration: this.scenario.duration,
      outcome,
      totalSpawned: this.totalSpawned,
      totalCompleted: this.totalCompleted,
      totalDropped: this.totalDropped,
      counts: this.runCounts(),
      objectives: this.scenario.objectives,
      scoringPriorities: this.scenario.scoringPriorities,
      seed: this.seed,
      peakRps: this.peakRps,
      spikeEvents: this.spikeEvents,
      architectureConfig: aggregateArchitectureConfig(this.components, this.componentConfigs),
      componentConfigs: this.componentConfigs,
      scalingState: this.scalingState,
    });
  }

  getSnapshot(): SimulationSnapshot {
    const scaling = new Map<string, { instances: number; verticalMultiplier: number }>();
    for (const [id, st] of this.scalingState) {
      scaling.set(id, {
        instances: getScaleGroupMembers(this.components, id).length,
        verticalMultiplier: st.verticalMultiplier,
      });
    }

    return {
      time: this.time,
      status: this.status,
      components: new Map(this.componentState),
      belts: new Map(this.beltState),
      scaling,
      activeRequests: [...this.requests],
      totalSpawned: this.totalSpawned,
      totalCompleted: this.totalCompleted,
      totalDropped: this.totalDropped,
      totalViolated: this.totalViolated,
      spawnedByKind: Object.fromEntries(this.spawnedByKind),
      completedByKind: Object.fromEntries(this.completedByKind),
      droppedByKind: Object.fromEntries(this.droppedByKind),
      violatedByKind: Object.fromEntries(this.violatedByKind),
      violationsByStep: Object.fromEntries(this.violationsByStep),
      currentRps: this.currentRps,
      spikeActive: this.spikeActive,
      message: this.message,
      seed: this.seed,
      scriptedFailures: this.scriptedPhases.map((phase) => ({ ...phase })),
    };
  }

  injectFailure(componentId: string, type: 'shutdown' | 'latency' | 'capacity' | 'partition', duration: number): void {
    const component = this.componentMap.get(componentId);
    if (!component) {
      console.warn(`Cannot inject failure: component ${componentId} not found`);
      return;
    }

    const state = this.componentState.get(componentId);
    if (!state) {
      console.warn(`Cannot inject failure: component state for ${componentId} not found`);
      return;
    }

    // Apply the failure effect
    switch (type) {
      case 'shutdown':
        // Simulate shutdown by setting capacity to 0
        component.capacity = 0;
        this.message = `⚠️ ${component.label} has shut down!`;
        break;
      case 'latency':
        // This would require more engine changes, so just mark as degraded
        this.message = `🐌 ${component.label} experiencing high latency!`;
        break;
      case 'capacity':
        // Reduce capacity by 50%
        const originalCapacity = component.capacity;
        component.capacity = Math.floor(originalCapacity * 0.5);
        this.message = `⚠️ ${component.label} capacity reduced to 50%!`;
        break;
      case 'partition':
        // This would require removing connections, simplified for now
        this.message = `🔌 ${component.label} network partition detected!`;
        break;
    }

    // Schedule recovery in simulation time so pausing also pauses the outage.
    if (type === 'shutdown' || type === 'capacity') {
      this.pendingRecoveries.push({ componentId, at: this.time + duration });
    }

    console.log(`Injected ${type} failure to ${component.label} for ${duration}s`);
  }

  private processRecoveries(): void {
    if (this.pendingRecoveries.length === 0) return;
    const due = this.pendingRecoveries.filter((r) => r.at <= this.time);
    if (due.length === 0) return;
    this.pendingRecoveries = this.pendingRecoveries.filter((r) => r.at > this.time);
    for (const recovery of due) {
      const component = this.componentMap.get(recovery.componentId);
      if (!component) continue;
      const def = getComponentDef(component.type);
      if (def) {
        component.capacity = def.capacity;
        this.message = `✅ ${component.label} recovered from failure.`;
      }
    }
  }
}

export function loadColor(load: number): string {
  const t = clamp(load / 100, 0, 1);
  if (t < 0.5) {
    const u = t / 0.5;
    const r = Math.round(34 + (251 - 34) * u);
    const g = Math.round(197 + (191 - 197) * u);
    const b = Math.round(94 + (36 - 94) * u);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const u = (t - 0.5) / 0.5;
  const r = Math.round(251 + (239 - 251) * u);
  const g = Math.round(191 + (68 - 191) * u);
  const b = Math.round(36 + (68 - 36) * u);
  return `rgb(${r}, ${g}, ${b})`;
}

export function createComponent(type: ComponentType, x: number, y: number): PlacedComponent {
  const def = getComponentDef(type);
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    x,
    y,
    width: def.width,
    height: def.height,
    label: def.label,
    capacity: def.capacity,
    queueLimit: def.queueLimit,
  };
}

export function createBelt(fromPortId: string, toPortId: string): ConveyorBelt {
  const isIngress = fromPortId.startsWith(SOURCE_ID);
  return {
    id: `belt-${crypto.randomUUID()}`,
    fromPortId,
    toPortId,
    capacity: isIngress ? 2000 : 1000,
  };
}

export { SOURCE_ID, COMPONENT_DEFS, SCENARIO, REQUEST_COLORS };
