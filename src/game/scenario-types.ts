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
  referenceArchitecture?: ReferenceArchitecture;
}

export interface TrafficProfile {
  baseRps: number;
  spikeMultiplier?: number;
  spikeChance?: number;
  pattern: 'constant' | 'spike' | 'gradual' | 'random';
  requestTypes?: Record<string, number>;
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

export interface FailureScenario {
  id: string;
  name: string;
  description: string;
  trigger?: {
    time?: number;
    condition?: string;
  };
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
}
