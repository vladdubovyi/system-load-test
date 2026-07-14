// ComponentType is now a string to support dynamic components from backend
// Legacy types for backward compatibility
export type ComponentType = string;

export type LegacyComponentType =
  | 'load-balancer'
  | 'shortener'
  | 'backend'
  | 'database'
  | 'redis';

export type RequestKind = 'create' | 'read';

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
}

export interface ConveyorBelt {
  id: string;
  fromPortId: string;
  toPortId: string;
  capacity: number;
}

export interface Request {
  id: number;
  kind: RequestKind;
  colorIndex: number;
  celebrity: boolean;
  progress: number;
  beltId: string | null;
  currentComponentId: string | null;
  targetPortId: string | null;
  state: 'traveling' | 'queued' | 'processing' | 'done' | 'dropped';
  waitTime: number;
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
  currentRps: number;
  spikeActive: boolean;
  message: string;
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
  missingComponents: ComponentType[];
  totalSpawned: number;
  totalCompleted: number;
  totalDropped: number;
  successRate: number;
  peakRps: number;
  spikeEvents: number;
  availabilityPct: number;
  recommendations: string[];
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
};
