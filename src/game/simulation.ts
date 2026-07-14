import type {
  BeltState,
  ComponentState,
  ComponentType,
  ComponentTelemetry,
  ConveyorBelt,
  PlacedComponent,
  Port,
  Request,
  RequestKind,
  SimulationReport,
  SimulationSnapshot,
  SimulationStatus,
} from './types';
import { buildSimulationReport } from './report';
import type { ComponentInstanceConfig } from './component-config';
import {
  aggregateArchitectureConfig,
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
  CELEBRITY_COLOR_INDICES,
  COMPONENT_DEFS,
  REQUEST_COLORS,
  SCENARIO,
} from './types';

const SOURCE_ID = '__source__';
const IDLE_LOAD_THRESHOLD = 15;

let nextRequestId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pickRequestColor(): { colorIndex: number; celebrity: boolean } {
  const celebrity = Math.random() < SCENARIO.celebrityShare;
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
      return [];
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
    return toType === 'load-balancer';
  }

  if (fromType === 'load-balancer') {
    return toType === 'shortener' || toType === 'backend';
  }

  if (fromType === 'shortener') {
    return toType === 'database' || toType === 'redis';
  }

  if (fromType === 'backend') {
    return toType === 'redis' || toType === 'database';
  }

  if (fromType === 'redis' || fromType === 'database') {
    return toType === 'backend' || toType === 'shortener';
  }

  return false;
}

export class SimulationEngine {
  private components: PlacedComponent[];
  private belts: ConveyorBelt[];
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
  private currentRps = SCENARIO.baseRps;
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

  constructor(
    components: PlacedComponent[],
    belts: ConveyorBelt[],
    componentConfigs: Map<string, ComponentInstanceConfig> = new Map()
  ) {
    this.componentConfigs = componentConfigs;
    this.components = components;
    this.belts = belts;
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
      multiplier *= 1 + Math.max(0, replication.readReplicas) * SCENARIO.readRatio;
    }
    return multiplier;
  }

  private getEffectiveCapacity(component: PlacedComponent): number {
    if (component.type === 'database') {
      return component.capacity * this.getDatabaseMultiplier(component);
    }

    if (isScalableType(component.type)) {
      const scaling = this.scalingState.get(component.id);
      const cfg = this.scalingConfig(component);
      if (
        scaling &&
        cfg &&
        (cfg.horizontal.enabled || cfg.vertical.enabled || cfg.predictive.enabled)
      ) {
        return component.capacity * scaling.instances * scaling.verticalMultiplier;
      }
    }

    return component.capacity;
  }

  private getEffectiveQueueLimit(component: PlacedComponent): number {
    if (isScalableType(component.type)) {
      const scaling = this.scalingState.get(component.id);
      const cfg = this.scalingConfig(component);
      if (scaling && cfg?.horizontal.enabled) {
        return component.queueLimit * scaling.instances;
      }
    }
    if (component.type === 'database') {
      return Math.round(component.queueLimit * this.getDatabaseMultiplier(component));
    }
    return component.queueLimit;
  }

  /** Pre-scale before traffic arrives so spikes do not drop at the load balancer. */
  private applyPredictiveScaling(): void {
    if (!this.spikeActive) return;

    for (const component of this.components) {
      if (!isScalableType(component.type)) continue;

      const cfg = this.scalingConfig(component);
      const scaling = this.scalingState.get(component.id)!;
      if (!cfg?.predictive.enabled || !cfg.horizontal.enabled) continue;

      const trafficShare =
        component.type === 'backend'
          ? SCENARIO.readRatio
          : 1 - SCENARIO.readRatio;
      const needed = Math.ceil((this.currentRps * trafficShare) / component.capacity);
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
  }

  private updateAutoScaling(dt: number): void {
    for (const component of this.components) {
      if (!isScalableType(component.type)) continue;

      const cfg = this.scalingConfig(component);
      if (!cfg) continue;
      const scaling = this.scalingState.get(component.id)!;
      const state = this.componentState.get(component.id)!;
      const targetUtil = cfg.horizontal.targetUtilization;
      const queueLimit = this.getEffectiveQueueLimit(component);
      const queuePressure =
        queueLimit > 0 ? (state.queue / queueLimit) * 100 : 0;
      const effectiveCap = this.getEffectiveCapacity(component);
      const utilization =
        effectiveCap > 0 ? (state.processing / effectiveCap) * 100 : state.load;

      if (!cfg.reactive.enabled) {
        scaling.maxInstancesReached = Math.max(
          scaling.maxInstancesReached,
          scaling.instances
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
          this.message = `${component.label} auto-scaled to ${scaling.instances} instances`;
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
        scaling.instances
      );
      scaling.maxVerticalMultiplier = Math.max(
        scaling.maxVerticalMultiplier,
        scaling.verticalMultiplier
      );
    }
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
  }

  private resetStates(): void {
    this.componentState.clear();
    this.beltState.clear();
    this.telemetry.clear();
    this.completionDebt.clear();
    this.initScalingState();
    for (const component of this.components) {
      this.componentState.set(component.id, {
        load: 0,
        queue: 0,
        processing: 0,
        failed: false,
        processed: 0,
        dropped: 0,
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
    this.overloadTimers.clear();
    this.completionDebt.clear();
    this.peakRps = 0;
    this.spikeEvents = 0;
    this.wasSpikeActive = false;
    this.draining = false;
    this.resetStates();
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
    this.resetStates();
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
    const inDrain =
      this.draining || this.time >= SCENARIO.duration;

    if (!inDrain) {
      this.updateTrafficPattern(dt);
      this.applyPredictiveScaling();
      this.spawnAccumulator += this.currentRps * dt;
      while (this.spawnAccumulator >= 1) {
        this.spawnAccumulator -= 1;
        this.spawnRequest();
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
      this.time >= SCENARIO.duration + SCENARIO.drainDuration
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
        this.currentRps = SCENARIO.baseRps;
      }
    } else if (Math.random() < SCENARIO.spikeChance * dt) {
      this.spikeActive = true;
      this.spikeTimer = 2.5 + Math.random() * 3;
      this.currentRps = SCENARIO.baseRps * SCENARIO.spikeMultiplier;
      this.applyPredictiveScaling();
    } else {
      const jitter = 1 + (Math.random() - 0.5) * 0.15;
      this.currentRps = SCENARIO.baseRps * jitter;
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

  private spawnRequest(): void {
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

    const kind: RequestKind = Math.random() < SCENARIO.readRatio ? 'read' : 'create';
    const { colorIndex, celebrity } = pickRequestColor();

    this.requests.push({
      id: nextRequestId++,
      kind,
      colorIndex,
      celebrity,
      progress: 0,
      beltId: belt.id,
      currentComponentId: null,
      targetPortId: belt.toPortId,
      state: 'traveling',
      waitTime: 0,
    });
    beltSt.traveling += 1;
    this.totalSpawned += 1;
  }

  private updateBelts(dt: number): void {
    const speed = 0.85;
    for (const request of this.requests) {
      if (request.state !== 'traveling' || !request.beltId) continue;

      request.progress += speed * dt;
      if (request.progress < 1) continue;

      request.progress = 0;
      const belt = request.beltId ? this.beltById.get(request.beltId) : undefined;
      if (!belt) continue;

      const beltSt = this.beltState.get(belt.id)!;
      beltSt.traveling = Math.max(0, beltSt.traveling - 1);

      const targetPort = this.portMap.get(belt.toPortId);
      if (!targetPort) {
        request.state = 'dropped';
        this.totalDropped += 1;
        continue;
      }

      const componentId = targetPort.componentId;
      const compSt = this.componentState.get(componentId);
      const component = this.componentMap.get(componentId);
      if (!compSt || !component) {
        request.state = 'dropped';
        this.totalDropped += 1;
        continue;
      }

      if (!this.acceptRequest(request, component, compSt)) {
        request.state = 'dropped';
        compSt.dropped += 1;
        this.totalDropped += 1;
        continue;
      }

      if (component.type === 'load-balancer' && request.state === 'traveling') {
        continue;
      }

      request.currentComponentId = componentId;
      request.beltId = null;
      request.state = 'queued';
    }
  }

  private acceptRequest(
    request: Request,
    component: PlacedComponent,
    state: ComponentState
  ): boolean {
    if (state.failed) return false;

    if (component.type === 'load-balancer') {
      if (request.kind === 'create') {
        return this.routeFromBalancer(request, 'shortener');
      }
      return this.routeFromBalancer(request, 'backend');
    }

    if (component.type === 'shortener' && request.kind !== 'create') {
      return false;
    }
    if (component.type === 'backend' && request.kind !== 'read') {
      return false;
    }

    if (this.queuedCount(component.id) >= this.getEffectiveQueueLimit(component)) return false;
    return true;
  }

  private routeFromBalancer(request: Request, targetType: ComponentType): boolean {
    const lb = this.components.find((c) => c.type === 'load-balancer');
    if (!lb) return false;

    const outPort = getComponentPorts(lb).find((p) => p.side === 'out');
    if (!outPort) return false;

    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    const validBelts = belts.filter((belt) => {
      const port = this.portMap.get(belt.toPortId);
      if (!port) return false;
      const comp = this.componentMap.get(port.componentId);
      return comp?.type === targetType;
    });

    if (validBelts.length === 0) return false;

    const belt = validBelts[Math.floor(Math.random() * validBelts.length)];
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.9) return false;

    const targetPort = this.portMap.get(belt.toPortId)!;
    const targetComp = this.componentMap.get(targetPort.componentId)!;
    if (this.queuedCount(targetComp.id) >= this.getEffectiveQueueLimit(targetComp)) return false;

    request.beltId = belt.id;
    request.targetPortId = belt.toPortId;
    request.state = 'traveling';
    request.currentComponentId = null;
    beltSt.traveling += 1;
    return true;
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
          if (this.completeOneRequest(component)) {
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

      if (component.type === 'load-balancer') {
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

  private completeOneRequest(component: PlacedComponent): boolean {
    const outPort = getComponentPorts(component).find((p) => p.side === 'out');
    if (!outPort) {
      if (this.finishQueuedRequest(component.id)) {
        this.totalCompleted += 1;
        return true;
      }
      return false;
    }

    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    if (belts.length === 0) {
      if (component.type === 'database' || component.type === 'redis') {
        if (this.finishQueuedRequest(component.id)) {
          this.totalCompleted += 1;
          return true;
        }
      }
      return false;
    }

    if (component.type === 'backend') {
      const redisBelts = belts.filter((b) => {
        const port = this.portMap.get(b.toPortId);
        return this.componentMap.get(port?.componentId ?? '')?.type === 'redis';
      });
      const dbBelts = belts.filter((b) => {
        const port = this.portMap.get(b.toPortId);
        return this.componentMap.get(port?.componentId ?? '')?.type === 'database';
      });

      const preferRedis =
        redisBelts.length > 0 &&
        (dbBelts.length === 0 || Math.random() < 0.97);
      const candidates = preferRedis ? redisBelts : dbBelts.length > 0 ? dbBelts : belts;
      const belt = this.pickAvailableBelt(candidates);
      if (!belt) {
        if (!preferRedis) return false;
        const fallback = this.pickAvailableBelt(dbBelts.length > 0 ? dbBelts : belts);
        if (!fallback) return false;
        return this.forwardFromComponent(component, fallback, 'read');
      }
      return this.forwardFromComponent(component, belt, 'read');
    }

    if (component.type === 'shortener') {
      const dbBelts = belts.filter((b) => {
        const port = this.portMap.get(b.toPortId);
        return this.componentMap.get(port?.componentId ?? '')?.type === 'database';
      });
      const belt = this.pickAvailableBelt(dbBelts.length > 0 ? dbBelts : belts);
      if (!belt) return false;
      return this.forwardFromComponent(component, belt, 'create');
    }

    return false;
  }

  private forwardFromComponent(
    component: PlacedComponent,
    belt: ConveyorBelt,
    kind: RequestKind
  ): boolean {
    if (!this.canEmitOnBelt(belt)) return false;
    const visual = this.takeQueuedVisual(component);
    if (!visual) return false;
    this.emitOnBelt(belt, kind, visual);
    return true;
  }

  private takeQueuedVisual(
    component: PlacedComponent
  ): { colorIndex: number; celebrity: boolean } | undefined {
    const idx = this.requests.findIndex(
      (r) => r.state === 'queued' && r.currentComponentId === component.id
    );
    if (idx === -1) return undefined;
    const req = this.requests[idx];
    req.state = 'done';
    return { colorIndex: req.colorIndex, celebrity: req.celebrity };
  }

  private finishQueuedRequest(componentId: string): boolean {
    const idx = this.requests.findIndex(
      (r) => r.state === 'queued' && r.currentComponentId === componentId
    );
    if (idx === -1) return false;
    this.requests[idx].state = 'done';
    return true;
  }

  private emitOnBelt(
    belt: ConveyorBelt,
    kind: RequestKind,
    visual?: { colorIndex: number; celebrity: boolean }
  ): void {
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.9) {
      this.totalDropped += 1;
      return;
    }

    const { colorIndex, celebrity } = visual ?? pickRequestColor();
    this.requests.push({
      id: nextRequestId++,
      kind,
      colorIndex,
      celebrity,
      progress: 0,
      beltId: belt.id,
      currentComponentId: null,
      targetPortId: belt.toPortId,
      state: 'traveling',
      waitTime: 0,
    });
    beltSt.traveling += 1;
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
      duration: SCENARIO.duration,
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
        instances: st.instances,
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
  const def = COMPONENT_DEFS[type];
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
