import type { ComponentType } from './types';

export type ShardStrategy = 'hash' | 'range';

export interface HorizontalScalingConfig {
  enabled: boolean;
  minInstances: number;
  maxInstances: number;
  targetUtilization: number;
}

export interface VerticalScalingConfig {
  enabled: boolean;
  maxMultiplier: number;
  targetUtilization: number;
}

export interface ReactiveScalingConfig {
  enabled: boolean;
  scaleUpDelaySeconds: number;
  scaleDownDelaySeconds: number;
}

export interface PredictiveScalingConfig {
  enabled: boolean;
  preScaleFactor: number;
}

export interface AutoScalingConfig {
  horizontal: HorizontalScalingConfig;
  vertical: VerticalScalingConfig;
  reactive: ReactiveScalingConfig;
  predictive: PredictiveScalingConfig;
}

export interface DatabaseReplicationConfig {
  enabled: boolean;
  readReplicas: number;
}

export interface DatabaseShardingConfig {
  enabled: boolean;
  shardCount: number;
  strategy: ShardStrategy;
}

export interface DatabaseConfig {
  replication: DatabaseReplicationConfig;
  sharding: DatabaseShardingConfig;
}

export interface ArchitectureConfig {
  autoScaling: Record<'shortener' | 'backend', AutoScalingConfig>;
  database: DatabaseConfig;
}

export interface ComponentScalingState {
  instances: number;
  verticalMultiplier: number;
  maxInstancesReached: number;
  maxVerticalMultiplier: number;
}

export const SCALABLE_SERVICE_TYPES = ['shortener', 'backend'] as const;
export type ScalableServiceType = (typeof SCALABLE_SERVICE_TYPES)[number];

export function createDefaultAutoScaling(): AutoScalingConfig {
  return {
    horizontal: {
      enabled: false,
      minInstances: 1,
      maxInstances: 4,
      targetUtilization: 70,
    },
    vertical: {
      enabled: false,
      maxMultiplier: 2,
      targetUtilization: 85,
    },
    reactive: {
      enabled: true,
      scaleUpDelaySeconds: 2.5,
      scaleDownDelaySeconds: 8,
    },
    predictive: {
      enabled: false,
      preScaleFactor: 1.35,
    },
  };
}

export function createDefaultArchitectureConfig(): ArchitectureConfig {
  return {
    autoScaling: {
      shortener: createDefaultAutoScaling(),
      backend: createDefaultAutoScaling(),
    },
    database: {
      replication: {
        enabled: false,
        readReplicas: 1,
      },
      sharding: {
        enabled: false,
        shardCount: 2,
        strategy: 'hash',
      },
    },
  };
}

/** Reference preset: production-style scaling, replication, and sharding enabled. */
export function createReferenceArchitectureConfig(): ArchitectureConfig {
  return {
    autoScaling: {
      shortener: {
        horizontal: {
          enabled: true,
          minInstances: 1,
          maxInstances: 5,
          targetUtilization: 65,
        },
        vertical: {
          enabled: true,
          maxMultiplier: 1.5,
          targetUtilization: 82,
        },
        reactive: {
          enabled: true,
          scaleUpDelaySeconds: 2,
          scaleDownDelaySeconds: 10,
        },
        predictive: {
          enabled: true,
          preScaleFactor: 1.4,
        },
      },
      backend: {
        horizontal: {
          enabled: true,
          minInstances: 3,
          maxInstances: 8,
          targetUtilization: 62,
        },
        vertical: {
          enabled: true,
          maxMultiplier: 1.5,
          targetUtilization: 80,
        },
        reactive: {
          enabled: true,
          scaleUpDelaySeconds: 1.2,
          scaleDownDelaySeconds: 12,
        },
        predictive: {
          enabled: true,
          preScaleFactor: 1.75,
        },
      },
    },
    database: {
      replication: {
        enabled: true,
        readReplicas: 2,
      },
      sharding: {
        enabled: true,
        shardCount: 3,
        strategy: 'hash',
      },
    },
  };
}

export function isScalableType(type: ComponentType): type is ScalableServiceType {
  return type === 'shortener' || type === 'backend';
}

export function cloneArchitectureConfig(config: ArchitectureConfig): ArchitectureConfig {
  return structuredClone(config);
}
