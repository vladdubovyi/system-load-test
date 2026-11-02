import type { ComponentType, PlacedComponent } from './types';
import type { TagDefinition } from './flow-types';
import { selectorMatches, tagLabel } from './flows';
import { getActiveScenario } from './scenario-runtime';
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
  /** Whether this chip can be dropped on a component of the given type. */
  appliesTo: (type: ComponentType) => boolean;
}

export const CONFIG_CHIPS: ConfigChipDef[] = [
  {
    id: 'horizontal-scaling',
    label: 'Horizontal scaling',
    emoji: '↔️',
    description: 'Add/remove instances by load',
    appliesTo: isScalableType,
  },
  {
    id: 'vertical-scaling',
    label: 'Vertical scaling',
    emoji: '↕️',
    description: 'Increase per-instance capacity',
    appliesTo: isScalableType,
  },
  {
    id: 'reactive-scaling',
    label: 'Reactive scaling',
    emoji: '⚡',
    description: 'Scale on real-time utilization',
    appliesTo: isScalableType,
  },
  {
    id: 'predictive-scaling',
    label: 'Predictive scaling',
    emoji: '📈',
    description: 'Pre-scale before traffic spikes',
    appliesTo: isScalableType,
  },
  {
    id: 'db-replication',
    label: 'Read replication',
    emoji: '📚',
    description: 'Offload reads to replicas',
    appliesTo: (type) => type === 'database',
  },
  {
    id: 'db-sharding',
    label: 'Sharding',
    emoji: '🧩',
    description: 'Partition data across shards',
    appliesTo: (type) => type === 'database',
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

/**
 * Auto-scaling template for a component type. The reference architecture only
 * describes the two legacy service types, so every other compute tier reuses
 * the backend profile.
 */
function referenceAutoScalingFor(
  reference: ArchitectureConfig,
  componentType: ComponentType
): AutoScalingConfig {
  return componentType === 'shortener'
    ? reference.autoScaling.shortener
    : reference.autoScaling.backend;
}

export function applyConfigChip(
  config: ComponentInstanceConfig,
  chipId: ConfigChipId,
  componentType: ComponentType
): boolean {
  const chip = CONFIG_CHIPS.find((c) => c.id === chipId);
  if (!chip || !chip.appliesTo(componentType)) return false;

  const reference = createReferenceArchitectureConfig();
  const template = referenceAutoScalingFor(reference, componentType);

  switch (chipId) {
    case 'horizontal-scaling': {
      const auto = ensureAutoScaling(config);
      auto.horizontal = { ...template.horizontal, enabled: true };
      return true;
    }
    case 'vertical-scaling': {
      const auto = ensureAutoScaling(config);
      auto.vertical = { ...template.vertical, enabled: true };
      return true;
    }
    case 'reactive-scaling': {
      const auto = ensureAutoScaling(config);
      auto.reactive = { ...template.reactive, enabled: true };
      return true;
    }
    case 'predictive-scaling': {
      const auto = ensureAutoScaling(config);
      auto.predictive = { ...template.predictive, enabled: true };
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

    if (cfg.autoScaling && isScalableType(component.type)) {
      const slot = component.type === 'shortener' ? 'shortener' : 'backend';
      aggregate.autoScaling[slot] = structuredClone(cfg.autoScaling);
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

  // Only the legacy reference architecture ships pre-tuned auto-scaling.
  // Challenge starters are authored without it on purpose — configuring
  // scaling is part of the exercise.
  for (const component of components) {
    if (component.type === 'shortener' || component.type === 'backend') {
      map.set(component.id, {
        autoScaling: structuredClone(referenceAutoScalingFor(reference, component.type)),
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
    if (a.horizontal.enabled && a.horizontal.startupTimeSeconds > 0) {
      badges.push({ emoji: '🚀', label: `${a.horizontal.startupTimeSeconds}s boot` });
    }
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
  const tagDefs = getActiveScenario().tags;
  const tagBadges = (component.tags ?? []).map((tagId) => ({
    emoji: '🏷',
    label: tagLabel(tagId, tagDefs),
  }));
  if (badges.length === 0 && tagBadges.length === 0) return '';
  const render = (b: ConfigBadge, extraClass = ''): string =>
    `<span class="component-config-badge${extraClass}" title="${b.label}"><span class="component-config-badge-emoji">${b.emoji}</span>${b.label}</span>`;
  return `<div class="component-config-badges">${[
    ...badges.map((b) => render(b)),
    ...tagBadges.map((b) => render(b, ' component-tag-badge')),
  ].join('')}</div>`;
}

/**
 * Toggle a scenario role on a component, returning the updated copy, or null
 * when the role's `appliesTo` selector excludes this component type. Pure:
 * board history keeps references to component objects, so callers must
 * swap the copy into the board rather than mutate in place.
 */
export function toggleComponentTag(
  component: PlacedComponent,
  tag: TagDefinition
): PlacedComponent | null {
  if (tag.appliesTo && !selectorMatches(tag.appliesTo, component.type)) return null;
  const current = component.tags ?? [];
  const tags = current.includes(tag.id)
    ? current.filter((id) => id !== tag.id)
    : [...current, tag.id];
  const { tags: _previous, ...rest } = component;
  return tags.length > 0 ? { ...rest, tags } : rest;
}
