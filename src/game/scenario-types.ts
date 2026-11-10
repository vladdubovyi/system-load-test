import type { FlowSpec, NodeSelector, Objectives, TagDefinition, ScenarioHint } from './flow-types';

export interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  requirements: string[];
  duration: number;
  drainDuration: number;
  traffic: TrafficProfile;
  allowedComponents: string[];
  scoringPriorities: ScoringPriorities;
  failureScenarios?: FailureScenario[];
  /** Hint ladder (product-directions.md §4.4). */
  hints?: ScenarioHint[];
  referenceArchitecture?: ReferenceArchitecture;
  /** Required request flows (docs/specs/flow-correctness.md); falls back to flow-presets by slug. */
  flows?: FlowSpec[];
  /** Data-driven win conditions evaluated at the end of a run. */
  objectives?: Objectives;
  /** Roles the user can assign to placed components; flow steps may select on them. */
  tags?: TagDefinition[];
}

export interface TrafficProfile {
  baseRps: number;
  spikeMultiplier?: number;
  spikeChance?: number;
  pattern: 'constant' | 'spike' | 'gradual' | 'random';
  requestTypes?: Record<string, number>;
  /** Multi-phase traffic (docs/specs/product-directions.md §3.4); undefined means flat. */
  phases?: TrafficPhase[];
  characteristics?: {
    celebrityShare?: number;
    fileSize?: string;
    hotDataRatio?: number;
    [key: string]: any;
  };
}

export interface ScoringPriorities {
  availability?: number;
  latency?: number;
  throughput?: number;
  durability?: number;
  storageEfficiency?: number;
  bandwidth?: number;
  cost?: number;
  scalability?: number;
  faultTolerance?: number;
}

/**
 * A point on the traffic timeline (product-directions.md §3.4). `baseRps` is
 * interpolated linearly between points; `requestTypes` switches at the point.
 */
export interface TrafficPhase {
  atSeconds: number;
  baseRps?: number;
  requestTypes?: Record<string, number>;
}

/**
 * A scripted failure phase (product-directions.md §3.3): at `atSeconds` of
 * simulation time the engine injects `type` into the first board component
 * matching `target`, for `durationSeconds`. Scenario time, so deterministic
 * and room-safe with no new run inputs.
 */
export interface FailureScenario {
  id: string;
  label: string;
  atSeconds: number;
  target: NodeSelector;
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  durationSeconds: number;
}

export interface ReferenceArchitecture {
  components: Array<{
    id: string;
    type: string;
    x: number;
    y: number;
  }>;
  connections: Array<{
    from: string;
    to: string;
  }>;
}

export interface Challenge {
  id: string;
  name: string;
  slug: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  overviewContent?: string;
  videoUrl?: string;
  createdAt: string;
  scenario: ScenarioDefinition;
  allowedComponents: string[];
}

export interface ComponentDefinition {
  id: string;
  componentType: string;
  label: string;
  category: 'networking' | 'compute' | 'storage' | 'messaging' | 'infrastructure';
  defaultCapacity: number;
  defaultQueueLimit: number;
  monthlyCost: number;
  emoji: string;
  width: number;
  height: number;
  description: string;
  enabled: boolean;
  /** Semantic capabilities (see capabilities.ts); falls back to built-in per-type table. */
  capabilities?: string[];
}
