import type { ComponentType, PlacedComponent } from './types';
import type {
  AutoScalingConfig,
  DatabaseConfig,
  ArchitectureConfig,
} from './architecture-config';
import {
  createDefaultAutoScaling,
  createDefaultArchitectureConfig,
  createReferenceArchitectureConfig,
  isScalableType,
} from './architecture-config';

export type ConfigChipId =
  | 'horizontal-scaling'
  | 'vertical-scaling'
  | 'reactive-scaling'
  | 'predictive-scaling'
  | 'db-replication'
  | 'db-sharding';

export interface ComponentInstanceConfig {
  autoScaling?: AutoScalingConfig;
  database?: DatabaseConfig;
}

export interface ConfigChipDef {
  id: ConfigChipId;
  label: string;
  emoji: string;
  description: string;
  forTypes: ComponentType[];
}

export const CONFIG_CHIPS: ConfigChipDef[] = [
  {
    id: 'horizontal-scaling',
    label: 'Horizontal scaling',
    emoji: '↔️',
    description: 'Add/remove instances by load',
    forTypes: ['shortener', 'backend'],
  },
  {
    id: 'vertical-scaling',
    label: 'Vertical scaling',
    emoji: '↕️',
    description: 'Increase per-instance capacity',
    forTypes: ['shortener', 'backend'],
  },
  {
    id: 'reactive-scaling',
    label: 'Reactive scaling',
    emoji: '⚡',
    description: 'Scale on real-time utilization',
    forTypes: ['shortener', 'backend'],
  },
  {
    id: 'predictive-scaling',
    label: 'Predictive scaling',
    emoji: '📈',
    description: 'Pre-scale before traffic spikes',
    forTypes: ['shortener', 'backend'],
  },
  {
    id: 'db-replication',
    label: 'Read replication',
    emoji: '📚',
    description: 'Offload reads to replicas',
    forTypes: ['database'],
  },
  {
    id: 'db-sharding',
    label: 'Sharding',
    emoji: '🧩',
    description: 'Partition data across shards',
    forTypes: ['database'],
  },
];

export function createEmptyComponentConfig(): ComponentInstanceConfig {
  return {};
}

export function cloneComponentConfig(config: ComponentInstanceConfig): ComponentInstanceConfig {
  return structuredClone(config);
}

export function cloneComponentConfigMap(
  map: Map<string, ComponentInstanceConfig>
): Map<string, ComponentInstanceConfig> {
  return new Map([...map.entries()].map(([id, cfg]) => [id, cloneComponentConfig(cfg)]));
}

function ensureAutoScaling(config: ComponentInstanceConfig): AutoScalingConfig {
  if (!config.autoScaling) {
    config.autoScaling = createDefaultAutoScaling();
  }
  return config.autoScaling;
}

function ensureDatabase(config: ComponentInstanceConfig): DatabaseConfig {
  if (!config.database) {
    config.database = createDefaultArchitectureConfig().database;
  }
  return config.database;
}

export function applyConfigChip(
  config: ComponentInstanceConfig,
  chipId: ConfigChipId,
  componentType: ComponentType
): boolean {
  const chip = CONFIG_CHIPS.find((c) => c.id === chipId);
  if (!chip || !chip.forTypes.includes(componentType)) return false;

  const reference = createReferenceArchitectureConfig();

  switch (chipId) {
    case 'horizontal-scaling': {
      const auto = ensureAutoScaling(config);
      auto.horizontal = { ...reference.autoScaling[componentType as 'shortener' | 'backend'].horizontal, enabled: true };
      return true;
    }
    case 'vertical-scaling': {
      const auto = ensureAutoScaling(config);
      auto.vertical = { ...reference.autoScaling[componentType as 'shortener' | 'backend'].vertical, enabled: true };
      return true;
    }
    case 'reactive-scaling': {
      const auto = ensureAutoScaling(config);
      auto.reactive = { ...reference.autoScaling[componentType as 'shortener' | 'backend'].reactive, enabled: true };
      return true;
    }
    case 'predictive-scaling': {
      const auto = ensureAutoScaling(config);
      auto.predictive = { ...reference.autoScaling[componentType as 'shortener' | 'backend'].predictive, enabled: true };
      return true;
    }
    case 'db-replication': {
      const db = ensureDatabase(config);
      db.replication = { ...reference.database.replication, enabled: true };
      return true;
    }
    case 'db-sharding': {
      const db = ensureDatabase(config);
      db.sharding = { ...reference.database.sharding, enabled: true };
      return true;
    }
    default:
      return false;
  }
}

export function getAutoScalingForComponent(
  component: PlacedComponent,
  configs: Map<string, ComponentInstanceConfig>
): AutoScalingConfig | null {
  if (!isScalableType(component.type)) return null;
  return configs.get(component.id)?.autoScaling ?? null;
}

export function getDatabaseConfigForComponent(
  component: PlacedComponent,
  configs: Map<string, ComponentInstanceConfig>
): DatabaseConfig | null {
  if (component.type !== 'database') return null;
  return configs.get(component.id)?.database ?? null;
}

/** Build legacy aggregate config for report compatibility checks. */
export function aggregateArchitectureConfig(
  components: PlacedComponent[],
  configs: Map<string, ComponentInstanceConfig>
): ArchitectureConfig {
  const aggregate = createDefaultArchitectureConfig();

  for (const component of components) {
    const cfg = configs.get(component.id);
    if (!cfg) continue;

    if (component.type === 'shortener' && cfg.autoScaling) {
      aggregate.autoScaling.shortener = structuredClone(cfg.autoScaling);
    }
    if (component.type === 'backend' && cfg.autoScaling) {
      aggregate.autoScaling.backend = structuredClone(cfg.autoScaling);
    }
    if (component.type === 'database' && cfg.database) {
      aggregate.database = structuredClone(cfg.database);
    }
  }

  return aggregate;
}

export function buildReferenceComponentConfigs(
  components: PlacedComponent[]
): Map<string, ComponentInstanceConfig> {
  const reference = createReferenceArchitectureConfig();
  const map = new Map<string, ComponentInstanceConfig>();

  for (const component of components) {
    if (component.type === 'shortener') {
      map.set(component.id, {
        autoScaling: structuredClone(reference.autoScaling.shortener),
      });
    } else if (component.type === 'backend') {
      map.set(component.id, {
        autoScaling: structuredClone(reference.autoScaling.backend),
      });
    } else if (component.type === 'database') {
      map.set(component.id, {
        database: structuredClone(reference.database),
      });
    }
  }

  return map;
}

export interface ConfigBadge {
  emoji: string;
  label: string;
}

export function getActiveConfigBadges(
  _component: PlacedComponent,
  config: ComponentInstanceConfig | undefined
): ConfigBadge[] {
  if (!config) return [];
  const badges: ConfigBadge[] = [];

  if (config.autoScaling) {
    const a = config.autoScaling;
    if (a.horizontal.enabled) badges.push({ emoji: '↔️', label: 'H-scale' });
    if (a.vertical.enabled) badges.push({ emoji: '↕️', label: 'V-scale' });
    if (a.reactive.enabled) badges.push({ emoji: '⚡', label: 'Reactive' });
    if (a.predictive.enabled) badges.push({ emoji: '📈', label: 'Predictive' });
  }

  if (config.database) {
    const d = config.database;
    if (d.replication.enabled) {
      badges.push({
        emoji: '📚',
        label: `${d.replication.readReplicas} replica${d.replication.readReplicas > 1 ? 's' : ''}`,
      });
    }
    if (d.sharding.enabled) {
      badges.push({
        emoji: '🧩',
        label: `${d.sharding.shardCount} shards`,
      });
    }
  }

  return badges;
}

export function renderConfigBadgesHtml(
  component: PlacedComponent,
  config: ComponentInstanceConfig | undefined
): string {
  const badges = getActiveConfigBadges(component, config);
  if (badges.length === 0) return '';
  return `<div class="component-config-badges">${badges
    .map(
      (b) =>
        `<span class="component-config-badge" title="${b.label}"><span class="component-config-badge-emoji">${b.emoji}</span>${b.label}</span>`
    )
    .join('')}</div>`;
}
