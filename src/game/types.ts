import type { ScriptedPhaseOutcome } from './objectives';
import type { RequestFlowState } from './flow-types';

// ComponentType is now a string to support dynamic components from backend
// Legacy types for backward compatibility
export type ComponentType = string;

export type LegacyComponentType =
  | 'load-balancer'
  | 'shortener'
  | 'backend'
  | 'database'
  | 'redis';

/**
 * Request kinds are scenario-defined (spawn weights come from
 * TrafficProfile.requestTypes): 'create' | 'read' for the URL shortener,
 * 'check' for the rate limiter, 'feedLoad' for the feed, and so on.
 */
export type RequestKind = string;

export type PortSide = 'in' | 'out';

export interface Port {
  id: string;
  componentId: string;
  side: PortSide;
  label: string;
  x: number;
  y: number;
}

export interface PlacedComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  capacity: number;
  queueLimit: number;
  /** Primary component id when this node was spawned by horizontal scaling. */
  scaleGroupId?: string;
  /** Fixed top-left anchor for laying out a scale group grid. */
  scaleAnchorX?: number;
  scaleAnchorY?: number;
  /** Scenario-defined roles assigned by the user (TagDefinition ids). */
  tags?: string[];
}

export interface ConveyorBelt {
  id: string;
  fromPortId: string;
  toPortId: string;
  capacity: number;
}

export type RequestState =
  | 'traveling'
  | 'queued'
  | 'processing'
  | 'done'
  | 'dropped'
  /** Terminal: the request could not take its next required flow step. */
  | 'violated';

/**
 * One entry in a request's journey log. The sequence of events for a single
 * request reads like a trace: spawned → arrived → (routed | processed → forwarded
 * | returned) → … → completed | dropped | violated.
 */
export type RequestEventKind =
  | 'spawned'
  | 'arrived'
  | 'routed'
  | 'processed'
  | 'forwarded'
  /** Travelled back to the caller of a returnTo flow step. */
  | 'returned'
  | 'completed'
  | 'dropped'
  /** Terminated because the next required flow step was unsatisfiable. */
  | 'violated';

export interface RequestEvent {
  kind: RequestEventKind;
  /** Simulation time in seconds. */
  at: number;
  componentId?: string;
  componentLabel?: string;
  componentType?: ComponentType;
  beltId?: string;
  /** Human readable detail such as the next hop or a drop reason. */
  detail?: string;
}

export interface Request {
  id: number;
  kind: RequestKind;
  colorIndex: number;
  celebrity: boolean;
  /** 0..1 position along the current belt while traveling. */
  progress: number;
  beltId: string | null;
  currentComponentId: string | null;
  targetPortId: string | null;
  state: RequestState;
  /** Total seconds spent waiting in component queues. */
  waitTime: number;
  /** Simulation time the request entered the system. */
  spawnedAt: number;
  /** Simulation time the request completed or was dropped, if finished. */
  finishedAt: number | null;
  /** Progress units per second on the current belt (1 / travel seconds). */
  travelSpeed: number;
  /** Stable lateral offset in [-1, 1] so a stream spreads across the belt. */
  lane: number;
  /** Stable pseudo-random key in [0, 1) used for deterministic sub-sampling. */
  visualKey: number;
  /** Simulation time the request arrived at its current component (if queued). */
  arrivedAt: number | null;
  events: RequestEvent[];
  /**
   * Flow cursor when the active scenario defines a flow for this request's
   * kind; null means the request is routed by the legacy heuristics.
   */
  flow: RequestFlowState | null;
}

export interface ComponentState {
  load: number;
  queue: number;
  processing: number;
  failed: boolean;
  processed: number;
  dropped: number;
  startingUp: boolean;
  startupProgress: number;
}

export interface BeltState {
  load: number;
  traveling: number;
  dropped: number;
}

export type SimulationStatus = 'idle' | 'running' | 'won' | 'lost';

export interface SimulationSnapshot {
  time: number;
  status: SimulationStatus;
  components: Map<string, ComponentState>;
  belts: Map<string, BeltState>;
  scaling: Map<string, { instances: number; verticalMultiplier: number }>;
  activeRequests: Request[];
  totalSpawned: number;
  totalCompleted: number;
  totalDropped: number;
  /** Requests terminated by a flow violation (distinct from drops). */
  totalViolated: number;
  spawnedByKind: Record<string, number>;
  completedByKind: Record<string, number>;
  droppedByKind: Record<string, number>;
  violatedByKind: Record<string, number>;
  /** Violation tallies keyed `${kind}:${stepId}`, for the end-of-run report. */
  violationsByStep: Record<string, number>;
  currentRps: number;
  spikeActive: boolean;
  message: string;
  /** Traffic seed the run is generated from (spec §8). */
  seed: number;
  /** Scripted failure phases and their live state (product-directions §3.3). */
  scriptedFailures: ScriptedFailureState[];
}

export interface ScriptedFailureState {
  id: string;
  label: string;
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  atSeconds: number;
  durationSeconds: number;
  /** The component the phase hit; null until it fires, or when nothing matched. */
  componentLabel: string | null;
  fired: boolean;
  skipped: boolean;
  /** Simulation time the phase ends; null until fired. */
  until: number | null;
  active: boolean;
}

export const REQUEST_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#34d399',
] as const;

export const CELEBRITY_COLOR_INDICES = [1, 2, 3] as const;

export const COMPONENT_DEFS: Record<
  ComponentType,
  {
    label: string;
    width: number;
    height: number;
    capacity: number;
    queueLimit: number;
    description: string;
    emoji: string;
    monthlyCost: number;
  }
> = {
  'load-balancer': {
    label: 'Load Balancer',
    width: 140,
    height: 72,
    capacity: 800,
    queueLimit: 120,
    description: 'Distributes incoming traffic',
    emoji: '⚖️',
    monthlyCost: 120,
  },
  shortener: {
    label: 'Shortener Service',
    width: 150,
    height: 72,
    capacity: 180,
    queueLimit: 80,
    description: 'Original URL → short URL',
    emoji: '✂️',
    monthlyCost: 180,
  },
  backend: {
    label: 'Backend Service',
    width: 150,
    height: 72,
    capacity: 220,
    queueLimit: 90,
    description: 'Short URL → original URL',
    emoji: '🔍',
    monthlyCost: 200,
  },
  database: {
    label: 'Database',
    width: 120,
    height: 72,
    capacity: 140,
    queueLimit: 60,
    description: 'Persistent URL mappings',
    emoji: '🗄️',
    monthlyCost: 350,
  },
  redis: {
    label: 'Redis Cache',
    width: 120,
    height: 72,
    capacity: 900,
    queueLimit: 150,
    description: 'Hot URL cache layer',
    emoji: '⚡',
    monthlyCost: 90,
  },
};

export interface ComponentTelemetry {
  loadIntegral: number;
  maxLoad: number;
  maxQueueFill: number;
  downtimeSeconds: number;
  overloadSeconds: number;
  queuePressureSeconds: number;
  idleSeconds: number;
  failedAt: number | null;
}

export interface ComponentReport {
  id: string;
  type: ComponentType;
  label: string;
  emoji: string;
  maxLoad: number;
  avgLoad: number;
  maxQueueFill: number;
  downtimeSeconds: number;
  overloadSeconds: number;
  queuePressureSeconds: number;
  idleSeconds: number;
  processed: number;
  dropped: number;
  failed: boolean;
  monthlyCost: number;
  utilizationPct: number;
}

/** One end-of-run win condition and how the run measured against it. */
export interface ObjectiveResult {
  /** Stable id: 'failures', 'violations' or `completion:${kind}`. */
  id: string;
  label: string;
  /** Human-readable threshold, e.g. '≥ 95.0%'. */
  target: string;
  /** Human-readable measurement, e.g. '81.2% (812 of 1,000)'. */
  actual: string;
  met: boolean;
  /** Dominant cause, present only when the objective failed. */
  cause?: string;
}

/** Per-request-kind totals for the report's flow breakdown. */
export interface FlowKindStat {
  kind: string;
  spawned: number;
  completed: number;
  dropped: number;
  violated: number;
  /** Completed share of spawned, 0..100. */
  completionRate: number;
}

export interface SimulationReport {
  outcome: 'won' | 'lost';
  duration: number;
  score: number;
  grade: string;
  totalCost: number;
  wastedCost: number;
  components: ComponentReport[];
  brokenServices: ComponentReport[];
  scaledServices: ComponentReport[];
  wastedResources: ComponentReport[];
  totalSpawned: number;
  totalCompleted: number;
  totalDropped: number;
  /** Requests terminated by a flow violation. */
  totalViolated: number;
  successRate: number;
  /** Win conditions evaluated at the end of the run (spec §6). */
  objectives: ObjectiveResult[];
  /** True when every objective was met; with survival this decides the outcome. */
  objectivesMet: boolean;
  /** Per-request-kind breakdown; empty for scenarios without flows. */
  flowStats: FlowKindStat[];
  peakRps: number;
  spikeEvents: number;
  availabilityPct: number;
  /** Traffic seed the run was generated from (interview-platform.md §8). */
  seed: number;
  recommendations: string[];
  /** Scripted failure phases and what happened during each (product-directions §3.3). */
  scriptedPhases: ScriptedPhaseOutcome[];
}

export const SCENARIO = {
  id: 'url-shortener',
  title: 'Design a URL Shortener',
  duration: 45,
  drainDuration: 10,
  requirements: [
    'Very high sustained load — millions of redirects per day',
    'Traffic spikes during viral events (celebrity links)',
    'Mixed request types: creates (shorten) and reads (redirect)',
    'Colored requests = different original URLs — a few go viral',
    'Goal: keep every component healthy for the full simulation',
  ],
  baseRps: 200,
  spikeMultiplier: 3.2,
  spikeChance: 0.08,
  readRatio: 0.72,
  celebrityShare: 0.82,
  /** Share of backend reads served from Redis without hitting the database. */
  cacheHitRatio: 0.97,
};
