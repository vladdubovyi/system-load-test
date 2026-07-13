import type {
  BeltState,
  ComponentState,
  ComponentType,
  ConveyorBelt,
  PlacedComponent,
  Port,
  Request,
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
  private beltByToPort: Map<string, ConveyorBelt>;

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

  constructor(components: PlacedComponent[], belts: ConveyorBelt[]) {
    this.components = components;
    this.belts = belts;
    this.componentMap = new Map(components.map((c) => [c.id, c]));
    this.portMap = new Map();
    this.beltByFromPort = new Map();
    this.beltByToPort = new Map();

    for (const belt of belts) {
      const list = this.beltByFromPort.get(belt.fromPortId) ?? [];
      list.push(belt);
      this.beltByFromPort.set(belt.fromPortId, list);
      this.beltByToPort.set(belt.toPortId, belt);
    }

    this.rebuildPorts();
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

  private resetStates(): void {
    this.componentState.clear();
    this.beltState.clear();
    for (const component of this.components) {
      this.componentState.set(component.id, {
        load: 0,
        queue: 0,
        processing: 0,
        failed: false,
        processed: 0,
        dropped: 0,
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
    this.updateTrafficPattern(dt);

    const spawnRate = this.currentRps;
    this.spawnAccumulator += spawnRate * dt;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnRequest();
    }

    this.updateBelts(dt);
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

  private spawnRequest(): void {
    const sourcePort = getSourcePort(this.components);
    const outgoing = this.beltByFromPort.get(sourcePort.id) ?? [];
    if (outgoing.length === 0) {
      this.totalDropped += 1;
      return;
    }

    const belt = outgoing[0];
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.5) {
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
    const speed = 0.55;
    for (const request of this.requests) {
      if (request.state !== 'traveling' || !request.beltId) continue;

      request.progress += speed * dt;
      if (request.progress < 1) continue;

      request.progress = 0;
      const belt = this.belts.find((b) => b.id === request.beltId);
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

      if (request.state === 'traveling') {
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

    if (state.queue >= component.queueLimit) return false;
    state.queue += 1;
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
    if (beltSt.traveling >= belt.capacity * 0.5) return false;

    const targetPort = this.portMap.get(belt.toPortId)!;
    const targetComp = this.componentMap.get(targetPort.componentId)!;
    const targetSt = this.componentState.get(targetComp.id)!;
    if (targetSt.queue >= targetComp.queueLimit) return false;

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

      const processRate = component.capacity;
      const canProcess = Math.min(state.queue, processRate * dt);
      if (canProcess > 0) {
        state.queue -= canProcess;
        state.processing = canProcess / dt;
        state.processed += canProcess;

        for (let i = 0; i < Math.ceil(canProcess); i++) {
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

    this.requests = this.requests.filter((r) => r.state !== 'done' && r.state !== 'dropped');
  }

  private completeAtComponent(component: PlacedComponent): void {
    const outPort = getComponentPorts(component).find((p) => p.side === 'out');
    if (!outPort) {
      this.totalCompleted += 1;
      return;
    }

    const belts = this.beltByFromPort.get(outPort.id) ?? [];
    if (belts.length === 0) {
      if (component.type === 'database' || component.type === 'redis') {
        this.totalCompleted += 1;
      }
      return;
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

      const cacheHit = redisBelts.length > 0 && Math.random() < 0.78;
      const chosen = cacheHit
        ? redisBelts[Math.floor(Math.random() * redisBelts.length)]
        : dbBelts.length > 0
          ? dbBelts[Math.floor(Math.random() * dbBelts.length)]
          : belts[0];

      this.emitOnBelt(chosen, 'read');
      return;
    }

    if (component.type === 'shortener') {
      const dbBelts = belts.filter((b) => {
        const port = this.portMap.get(b.toPortId);
        return this.componentMap.get(port?.componentId ?? '')?.type === 'database';
      });
      const belt = dbBelts[0] ?? belts[0];
      this.emitOnBelt(belt, 'create');
      return;
    }

    this.totalCompleted += 1;
  }

  private emitOnBelt(belt: ConveyorBelt, kind: RequestKind): void {
    const beltSt = this.beltState.get(belt.id)!;
    if (beltSt.traveling >= belt.capacity * 0.5) {
      this.totalDropped += 1;
      return;
    }

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
    return {
      time: this.time,
      status: this.status,
      components: new Map(this.componentState),
      belts: new Map(this.beltState),
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
  return {
    id: `belt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromPortId,
    toPortId,
    capacity: 80,
  };
}

export { SOURCE_ID, COMPONENT_DEFS, SCENARIO, REQUEST_COLORS };
