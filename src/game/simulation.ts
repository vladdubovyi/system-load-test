import type {
  BeltState,
  BeltVisual,
  ComponentState,
  ComponentType,
  ConveyorBelt,
  PlacedComponent,
  Port,
  RequestKind,
  SimulationSnapshot,
  SimulationStatus,
} from './types';
import {
  CELEBRITY_COLOR_INDICES,
  COMPONENT_DEFS,
  REQUEST_COLORS,
  SCENARIO,
} from './types';

const SOURCE_ID = '__source__';
const TRANSIT_SECONDS = 1.8;
const MAX_ARRIVALS_PER_BELT_FRAME = 16;
const MAX_COMPLETIONS_PER_FRAME = 12;

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

const SOURCE_X = 48;
const SOURCE_Y = 280;

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
  private lbShortenerBelts: ConveyorBelt[] = [];
  private lbBackendBelts: ConveyorBelt[] = [];
  private backendRedisBelts: ConveyorBelt[] = [];
  private backendDbBelts: ConveyorBelt[] = [];
  private shortenerDbBelts: ConveyorBelt[] = [];
  private shortenerRedisBelts: ConveyorBelt[] = [];

  private componentState = new Map<string, ComponentState>();
  private beltState = new Map<string, BeltState>();
  private beltVisuals = new Map<string, BeltVisual>();
  private beltArrivalAcc = new Map<string, number>();
  private completionAcc = new Map<string, number>();

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

  private readonly snapshot: SimulationSnapshot = {
    time: 0,
    status: 'idle',
    components: this.componentState,
    belts: this.beltState,
    beltVisuals: this.beltVisuals,
    totalSpawned: 0,
    totalCompleted: 0,
    totalDropped: 0,
    currentRps: SCENARIO.baseRps,
    spikeActive: false,
    message: 'Wire up your system, then press Play.',
  };

  constructor(components: PlacedComponent[], belts: ConveyorBelt[]) {
    this.components = components;
    this.belts = belts;
    this.componentMap = new Map(components.map((c) => [c.id, c]));
    this.portMap = new Map();
    this.beltByFromPort = new Map();

    for (const belt of belts) {
      const list = this.beltByFromPort.get(belt.fromPortId) ?? [];
      list.push(belt);
      this.beltByFromPort.set(belt.fromPortId, list);
    }

    this.rebuildPorts();
    this.cacheRouting();
    this.resetStates();
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

  private cacheRouting(): void {
    this.lbShortenerBelts = [];
    this.lbBackendBelts = [];
    this.backendRedisBelts = [];
    this.backendDbBelts = [];
    this.shortenerDbBelts = [];
    this.shortenerRedisBelts = [];

    const lb = this.components.find((c) => c.type === 'load-balancer');
    if (lb) {
      const outPort = getComponentPorts(lb).find((p) => p.side === 'out');
      for (const belt of this.beltByFromPort.get(outPort?.id ?? '') ?? []) {
        const port = this.portMap.get(belt.toPortId);
        const comp = this.componentMap.get(port?.componentId ?? '');
        if (comp?.type === 'shortener') this.lbShortenerBelts.push(belt);
        if (comp?.type === 'backend') this.lbBackendBelts.push(belt);
      }
    }

    const backend = this.components.find((c) => c.type === 'backend');
    if (backend) {
      const outPort = getComponentPorts(backend).find((p) => p.side === 'out');
      for (const belt of this.beltByFromPort.get(outPort?.id ?? '') ?? []) {
        const port = this.portMap.get(belt.toPortId);
        const comp = this.componentMap.get(port?.componentId ?? '');
        if (comp?.type === 'redis') this.backendRedisBelts.push(belt);
        if (comp?.type === 'database') this.backendDbBelts.push(belt);
      }
    }

    const shortener = this.components.find((c) => c.type === 'shortener');
    if (shortener) {
      const outPort = getComponentPorts(shortener).find((p) => p.side === 'out');
      for (const belt of this.beltByFromPort.get(outPort?.id ?? '') ?? []) {
        const port = this.portMap.get(belt.toPortId);
        const comp = this.componentMap.get(port?.componentId ?? '');
        if (comp?.type === 'database') this.shortenerDbBelts.push(belt);
        if (comp?.type === 'redis') this.shortenerRedisBelts.push(belt);
      }
    }
  }

  private resetStates(): void {
    this.componentState.clear();
    this.beltState.clear();
    this.beltVisuals.clear();
    this.beltArrivalAcc.clear();
    this.completionAcc.clear();

    for (const component of this.components) {
      this.componentState.set(component.id, {
        load: 0,
        queue: 0,
        processing: 0,
        failed: false,
        processed: 0,
        dropped: 0,
      });
      this.completionAcc.set(component.id, 0);
    }
    for (const belt of this.belts) {
      this.beltState.set(belt.id, { load: 0, traveling: 0, dropped: 0 });
      this.beltArrivalAcc.set(belt.id, 0);
    }
  }

  start(): void {
    this.time = 0;
    this.status = 'running';
    this.spawnAccumulator = 0;
    this.totalSpawned = 0;
    this.totalCompleted = 0;
    this.totalDropped = 0;
    this.overloadTimers.clear();
    this.resetStates();
    this.message = 'Simulation running — watch for red overload!';
  }

  stop(): void {
    this.status = 'idle';
    this.message = 'Simulation stopped.';
  }

  reset(): void {
    this.status = 'idle';
    this.time = 0;
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
    this.updateTrafficPattern(dt);

    const spawnRate = this.currentRps;
    this.spawnAccumulator += spawnRate * dt;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnRequest();
    }

    this.updateBeltFlow(dt);
    this.updateComponents(dt);
    this.updateLoads();

    if (this.time >= SCENARIO.duration) {
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
    } else {
      const jitter = 1 + (Math.random() - 0.5) * 0.15;
      this.currentRps = SCENARIO.baseRps * jitter;
    }
  }

  private pushToBelt(belt: ConveyorBelt, visual?: BeltVisual): boolean {
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.5) {
      beltSt.dropped += 1;
      this.totalDropped += 1;
      return false;
    }

    beltSt.traveling += 1;
    const picked = visual ?? pickRequestColor();
    this.beltVisuals.set(belt.id, picked);
    return true;
  }

  private spawnRequest(): void {
    const sourcePort = getSourcePort(this.components);
    const outgoing = this.beltByFromPort.get(sourcePort.id) ?? [];
    if (outgoing.length === 0) {
      this.totalDropped += 1;
      return;
    }

    if (this.pushToBelt(outgoing[0])) {
      this.totalSpawned += 1;
    }
  }

  private updateBeltFlow(dt: number): void {
    for (const belt of this.belts) {
      const beltSt = this.beltState.get(belt.id)!;
      if (beltSt.traveling <= 0) continue;

      const acc =
        (this.beltArrivalAcc.get(belt.id) ?? 0) +
        (beltSt.traveling * dt) / TRANSIT_SECONDS;
      let arrivals = Math.min(Math.floor(acc), MAX_ARRIVALS_PER_BELT_FRAME);
      this.beltArrivalAcc.set(belt.id, acc - arrivals);

      if (arrivals <= 0) continue;

      arrivals = Math.min(arrivals, beltSt.traveling);
      beltSt.traveling -= arrivals;

      const targetPort = this.portMap.get(belt.toPortId);
      if (!targetPort) {
        this.totalDropped += arrivals;
        continue;
      }

      const component = this.componentMap.get(targetPort.componentId);
      if (!component) {
        this.totalDropped += arrivals;
        continue;
      }

      const compSt = this.componentState.get(component.id)!;
      const visual = this.beltVisuals.get(belt.id);

      for (let i = 0; i < arrivals; i++) {
        if (!this.deliverToComponent(component, compSt, visual)) {
          this.totalDropped += 1;
          compSt.dropped += 1;
        }
      }
    }
  }

  private deliverToComponent(
    component: PlacedComponent,
    state: ComponentState,
    visual?: BeltVisual
  ): boolean {
    if (state.failed) return false;

    if (component.type === 'load-balancer') {
      const kind: RequestKind =
        Math.random() < SCENARIO.readRatio ? 'read' : 'create';
      const targetBelts =
        kind === 'create' ? this.lbShortenerBelts : this.lbBackendBelts;
      if (targetBelts.length === 0) return false;

      const belt = targetBelts[Math.floor(Math.random() * targetBelts.length)];
      const targetPort = this.portMap.get(belt.toPortId)!;
      const targetComp = this.componentMap.get(targetPort.componentId)!;
      const targetSt = this.componentState.get(targetComp.id)!;
      if (targetSt.queue >= targetComp.queueLimit) return false;

      return this.pushToBelt(belt, visual);
    }

    if (component.type === 'shortener') {
      if (state.queue >= component.queueLimit) return false;
      state.queue += 1;
      return true;
    }

    if (component.type === 'backend') {
      if (state.queue >= component.queueLimit) return false;
      state.queue += 1;
      return true;
    }

    if (component.type === 'database' || component.type === 'redis') {
      if (state.queue >= component.queueLimit) return false;
      state.queue += 1;
      return true;
    }

    return false;
  }

  private updateComponents(dt: number): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      if (state.failed) continue;

      const processRate = component.capacity;
      const canProcess = Math.min(state.queue, processRate * dt);
      if (canProcess > 0) {
        state.queue -= canProcess;
        state.processing = canProcess / dt;
        state.processed += canProcess;

        const acc = (this.completionAcc.get(component.id) ?? 0) + canProcess;
        let completions = Math.min(
          Math.floor(acc),
          MAX_COMPLETIONS_PER_FRAME
        );
        this.completionAcc.set(component.id, acc - completions);

        while (completions-- > 0) {
          this.completeAtComponent(component);
        }
      } else {
        state.processing = 0;
      }

      const loadRatio =
        (state.queue + state.processing) / Math.max(component.queueLimit, 1);
      if (loadRatio >= 1) {
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
  }

  private completeAtComponent(component: PlacedComponent): void {
    if (component.type === 'database' || component.type === 'redis') {
      this.totalCompleted += 1;
      return;
    }

    if (component.type === 'backend') {
      const cacheHit =
        this.backendRedisBelts.length > 0 && Math.random() < 0.78;
      const pool = cacheHit
        ? this.backendRedisBelts
        : this.backendDbBelts.length > 0
          ? this.backendDbBelts
          : this.backendRedisBelts;
      if (pool.length === 0) {
        this.totalCompleted += 1;
        return;
      }
      const belt = pool[Math.floor(Math.random() * pool.length)];
      if (!this.pushToBelt(belt)) return;
      return;
    }

    if (component.type === 'shortener') {
      const pool =
        this.shortenerDbBelts.length > 0
          ? this.shortenerDbBelts
          : this.shortenerRedisBelts;
      if (pool.length === 0) {
        this.totalCompleted += 1;
        return;
      }
      this.pushToBelt(pool[0]);
      return;
    }

    this.totalCompleted += 1;
  }

  private updateLoads(): void {
    for (const component of this.components) {
      const state = this.componentState.get(component.id)!;
      const ratio = (state.queue + state.processing) / component.capacity;
      state.load = clamp(ratio * 100, 0, 150);
    }
    for (const belt of this.belts) {
      const state = this.beltState.get(belt.id)!;
      state.load = clamp((state.traveling / belt.capacity) * 100, 0, 150);
    }
  }

  getSnapshot(): SimulationSnapshot {
    this.snapshot.time = this.time;
    this.snapshot.status = this.status;
    this.snapshot.totalSpawned = this.totalSpawned;
    this.snapshot.totalCompleted = this.totalCompleted;
    this.snapshot.totalDropped = this.totalDropped;
    this.snapshot.currentRps = this.currentRps;
    this.snapshot.spikeActive = this.spikeActive;
    this.snapshot.message = this.message;
    return this.snapshot;
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
  return {
    id: `belt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromPortId,
    toPortId,
    capacity: 80,
  };
}

export { SOURCE_ID, COMPONENT_DEFS, SCENARIO, REQUEST_COLORS };
