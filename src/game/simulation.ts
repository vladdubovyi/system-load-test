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
import { buildSimulationReport } from './report';
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
  isStorageType,
} from './component-taxonomy';
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

function pickRequestColor(scenario: RuntimeScenario): { colorIndex: number; celebrity: boolean } {
  const celebrity = Math.random() < scenario.celebrityShare;
  if (celebrity) {
    const idx =
      CELEBRITY_COLOR_INDICES[
        Math.floor(Math.random() * CELEBRITY_COLOR_INDICES.length)
      ];
    return { colorIndex: idx, celebrity: true };
  }
  const normalColors = REQUEST_COLORS.map((_, i) => i).filter(
    (i) => !CELEBRITY_COLOR_INDICES.includes(i as (typeof CELEBRITY_COLOR_INDICES)[number])
  );
  return {
    colorIndex: normalColors[Math.floor(Math.random() * normalColors.length)],
    celebrity: false,
  };
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
    return (
      isComputeType(toType) ||
      toType === 'shortener' ||
      toType === 'backend' ||
      toType === 'rate-limiter' ||
      toType === 'cdn'
    );
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
    return isStorageType(toType) || toType === 'redis' || toType === 'database';
  }

  if (isStorageType(fromType ?? '') || fromType === 'redis' || fromType === 'database') {
    return isComputeType(toType) || toType === 'backend' || toType === 'shortener';
  }

  return false;
}

export type TopologyChangeListener = () => void;

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
  private pendingRecoveries: { componentId: string; at: number }[] = [];

  constructor(
    components: PlacedComponent[],
    belts: ConveyorBelt[],
    componentConfigs: Map<string, ComponentInstanceConfig> = new Map(),
    onTopologyChange: TopologyChangeListener | null = null,
    scenario: RuntimeScenario = getActiveScenario()
  ) {
    this.scenario = scenario;
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

    this.components.splice(
      this.components.findIndex((component) => component.id === instance.id),
      1
    );
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

  private applyPredictiveScaling(): void {
    if (!this.spikeActive) return;

    for (const component of this.components) {
      if (!isScalePrimary(component)) continue;

      const cfg = this.scalingConfig(component);
      const scaling = this.scalingState.get(component.id)!;
      if (!cfg?.predictive.enabled || !cfg.horizontal.enabled) continue;

      const trafficShare =
        component.type === 'backend'
          ? this.scenario.readRatio
          : 1 - this.scenario.readRatio;
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

  start(): void {
    this.time = 0;
    this.status = 'running';
    this.spawnAccumulator = 0;
    this.totalSpawned = 0;
    this.totalCompleted = 0;
    this.totalDropped = 0;
    this.requests = [];
    this.finishedRequests = [];
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
    this.pendingRecoveries = [];
    this.restoreInitialTopology();
    this.resetStates();
    this.onTopologyChange?.();
    this.totalSpawned = 0;
    this.totalCompleted = 0;
    this.totalDropped = 0;
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
      const anyFailed = [...this.componentState.values()].some((s) => s.failed);
      this.status = anyFailed ? 'lost' : 'won';
      this.message = anyFailed
        ? 'Time\'s up — some components failed under load.'
        : 'Success! Your architecture survived the traffic storm.';
    }

    return this.getSnapshot();
  }

  private updateTrafficPattern(dt: number): void {
    if (this.spikeActive) {
      this.spikeTimer -= dt;
      if (this.spikeTimer <= 0) {
        this.spikeActive = false;
        this.currentRps = this.scenario.baseRps;
      }
    } else if (Math.random() < this.scenario.spikeChance * dt) {
      this.spikeActive = true;
      this.spikeTimer = 2.5 + Math.random() * 3;
      this.currentRps = this.scenario.baseRps * this.scenario.spikeMultiplier;
      this.applyPredictiveScaling();
    } else {
      const jitter = 1 + (Math.random() - 0.5) * 0.15;
      this.currentRps = this.scenario.baseRps * jitter;
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
  }

  private finishRequest(request: Request, state: 'done' | 'dropped'): void {
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
  }

  private spawnRequest(headStart = 0): void {
    const sourcePort = getSourcePort(this.components);
    const outgoing = this.beltByFromPort.get(sourcePort.id) ?? [];
    if (outgoing.length === 0) {
      this.totalDropped += 1;
      return;
    }

    const belt = outgoing[0];
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.9) {
      beltSt.dropped += 1;
      this.totalDropped += 1;
      return;
    }

    const kind: RequestKind = Math.random() < this.scenario.readRatio ? 'read' : 'create';
    const { colorIndex, celebrity } = pickRequestColor(this.scenario);
    const id = nextRequestId++;

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
  }

  private updateBelts(dt: number): void {
    for (const request of this.requests) {
      if (request.state !== 'traveling' || !request.beltId) continue;

      request.progress += request.travelSpeed * dt;
      if (request.progress < 1) continue;

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

    if (
      component.type === 'load-balancer' ||
      component.type === 'api-gateway' ||
      isIngressType(component.type)
    ) {
      if (request.kind === 'create') {
        if (this.ingressHasTarget(component, 'shortener')) {
          return this.routeFromIngress(request, component, (type) => type === 'shortener', headStart);
        }
        return this.routeFromIngress(request, component, (type) => isComputeType(type), headStart);
      }
      if (this.ingressHasTarget(component, 'backend')) {
        return this.routeFromIngress(request, component, (type) => type === 'backend', headStart);
      }
      return this.routeFromIngress(request, component, (type) => isComputeType(type), headStart);
    }

    if (component.type === 'rate-limiter' || component.type === 'cdn') {
      return this.routeFromIngress(request, component, (type) => isComputeType(type), headStart);
    }

    if (component.type === 'shortener' && request.kind !== 'create') {
      return { ok: false, reason: 'Shortener only handles create requests' };
    }
    if (component.type === 'backend' && request.kind !== 'read') {
      return { ok: false, reason: 'Backend only handles read requests' };
    }

    const limit = this.getEffectiveQueueLimit(component);
    const queued = this.queuedCount(component.id);
    if (queued >= limit) {
      return { ok: false, reason: `queue full (${queued}/${limit})` };
    }
    return { ok: true, routed: false };
  }

  private ingressHasTarget(ingress: PlacedComponent, targetType: ComponentType): boolean {
    const outPort = getComponentPorts(ingress).find((p) => p.side === 'out');
    if (!outPort) return false;
    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    return belts.some((belt) => this.targetComponentOf(belt)?.type === targetType);
  }

  private routeFromIngress(
    request: Request,
    ingress: PlacedComponent,
    matches: (type: ComponentType) => boolean,
    headStart: number
  ): AcceptResult {
    const outPort = getComponentPorts(ingress).find((p) => p.side === 'out');
    if (!outPort) return { ok: false, reason: `${ingress.label} has no outgoing port` };

    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    const validBelts = belts.filter((belt) => {
      const comp = this.targetComponentOf(belt);
      if (!comp || !matches(comp.type)) return false;
      const compSt = this.componentState.get(comp.id);
      if (!compSt || compSt.failed) return false;
      if (this.isStartingUp(comp.id)) return false;
      return true;
    });

    if (validBelts.length === 0) {
      return { ok: false, reason: `no healthy ${request.kind} route from ${ingress.label}` };
    }

    const belt = validBelts[Math.floor(Math.random() * validBelts.length)];
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.9) {
      return { ok: false, reason: `link out of ${ingress.label} is congested` };
    }

    const targetComp = this.targetComponentOf(belt)!;
    const limit = this.getEffectiveQueueLimit(targetComp);
    const queued = this.queuedCount(targetComp.id);
    if (queued >= limit) {
      return { ok: false, reason: `${targetComp.label} queue full (${queued}/${limit})` };
    }

    this.logEvent(
      request,
      this.componentEvent('routed', ingress, { beltId: belt.id, detail: `→ ${targetComp.label}` })
    );
    this.placeOnBelt(request, belt, headStart);
    return { ok: true, routed: true };
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

      if (state.queue >= queueLimit) {
        const timer = (this.overloadTimers.get(component.id) ?? 0) + dt;
        this.overloadTimers.set(component.id, timer);
        if (timer >= 1.8) {
          state.failed = true;
          this.status = 'lost';
          this.message = `${component.label} overloaded and failed!`;
        }
      } else {
        this.overloadTimers.set(component.id, 0);
      }
    }

    this.requests = this.requests.filter((r) => r.state !== 'done' && r.state !== 'dropped');
  }

  private canEmitOnBelt(belt: ConveyorBelt): boolean {
    const beltSt = this.beltState.get(belt.id)!;
    return beltSt.traveling < belt.capacity * 0.9;
  }

  private pickAvailableBelt(belts: ConveyorBelt[]): ConveyorBelt | undefined {
    const available = belts.filter((belt) => this.canEmitOnBelt(belt));
    if (available.length === 0) return undefined;
    return available[Math.floor(Math.random() * available.length)];
  }

  private completeOneRequest(component: PlacedComponent, headStart = 0): boolean {
    const outPort = getComponentPorts(component).find((p) => p.side === 'out');
    if (!outPort) {
      return this.completeQueuedRequest(component);
    }

    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    if (belts.length === 0) {
      if (
        isStorageType(component.type) ||
        component.type === 'database' ||
        component.type === 'redis'
      ) {
        return this.completeQueuedRequest(component);
      }
      return false;
    }

    if (component.type === 'backend') {
      const redisBelts = belts.filter((b) => this.targetComponentOf(b)?.type === 'redis');
      const dbBelts = belts.filter((b) => this.targetComponentOf(b)?.type === 'database');

      const preferRedis =
        redisBelts.length > 0 &&
        (dbBelts.length === 0 || Math.random() < this.scenario.cacheHitRatio);
      const candidates = preferRedis ? redisBelts : dbBelts.length > 0 ? dbBelts : belts;
      const belt = this.pickAvailableBelt(candidates);
      if (!belt) {
        if (!preferRedis) return false;
        const fallback = this.pickAvailableBelt(dbBelts.length > 0 ? dbBelts : belts);
        if (!fallback) return false;
        return this.forwardFromComponent(component, fallback, headStart, 'cache link congested, falling back to storage');
      }
      return this.forwardFromComponent(
        component,
        belt,
        headStart,
        preferRedis ? 'cache hit' : 'cache miss'
      );
    }

    if (component.type === 'shortener') {
      const dbBelts = belts.filter((b) => {
        const targetType = this.targetComponentOf(b)?.type;
        return isStorageType(targetType ?? '') || targetType === 'database';
      });
      const belt = this.pickAvailableBelt(dbBelts.length > 0 ? dbBelts : belts);
      if (!belt) return false;
      return this.forwardFromComponent(component, belt, headStart, 'generated short code, persisting mapping');
    }

    if (isComputeType(component.type)) {
      const cacheBelts = belts.filter((b) =>
        isCacheType(this.targetComponentOf(b)?.type ?? '')
      );
      const storageBelts = belts.filter((b) => {
        const targetType = this.targetComponentOf(b)?.type ?? '';
        return isStorageType(targetType) || targetType === 'database';
      });
      const preferCache =
        cacheBelts.length > 0 &&
        (storageBelts.length === 0 || Math.random() < this.scenario.cacheHitRatio);
      const candidates = preferCache
        ? cacheBelts
        : storageBelts.length > 0
          ? storageBelts
          : belts;
      const belt = this.pickAvailableBelt(candidates);
      if (belt) {
        return this.forwardFromComponent(
          component,
          belt,
          headStart,
          cacheBelts.length > 0 ? (preferCache ? 'cache hit' : 'cache miss') : undefined
        );
      }
    }

    if (isStorageType(component.type) || component.type === 'database' || component.type === 'redis') {
      return this.completeQueuedRequest(component);
    }

    return false;
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

  private forwardFromComponent(
    component: PlacedComponent,
    belt: ConveyorBelt,
    headStart: number,
    detail?: string
  ): boolean {
    if (!this.canEmitOnBelt(belt)) return false;
    const request = this.takeQueuedRequest(component);
    if (!request) return false;

    const target = this.targetComponentOf(belt);
    this.logEvent(request, this.componentEvent('processed', component, { detail }));
    this.logEvent(
      request,
      this.componentEvent('forwarded', component, {
        beltId: belt.id,
        detail: `→ ${target?.label ?? this.labelFor(belt.toPortId)}`,
      })
    );
    this.placeOnBelt(request, belt, headStart);
    return true;
  }

  private completeQueuedRequest(component: PlacedComponent): boolean {
    const request = this.takeQueuedRequest(component);
    if (!request) return false;
    this.logEvent(request, this.componentEvent('processed', component));
    this.logEvent(request, this.componentEvent('completed', component));
    this.finishRequest(request, 'done');
    this.totalCompleted += 1;
    return true;
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
      currentRps: this.currentRps,
      spikeActive: this.spikeActive,
      message: this.message,
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
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    id: `belt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromPortId,
    toPortId,
    capacity: isIngress ? 2000 : 1000,
  };
}

export { SOURCE_ID, COMPONENT_DEFS, SCENARIO, REQUEST_COLORS };
