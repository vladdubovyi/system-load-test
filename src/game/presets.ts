import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { COMPONENT_DEFS } from './types';
import { SOURCE_ID, createBelt } from './simulation';
import type { ArchitectureConfig } from './architecture-config';

export interface PresetBlueprint {
  id: string;
  name: string;
  description: string;
  components: { id: string; type: ComponentType; x: number; y: number }[];
  connections: { from: string; to: string }[];
  architectureConfig?: ArchitectureConfig;
}

/**
 * Reference URL shortener architecture (industry best practices):
 *
 * Requests → L7 Load Balancer
 *   ├─ writes (28%) → Shortener (+ auto-scale) → Database (+ sharding/replication) + Redis
 *   └─ reads  (72%) → Backend (+ auto-scale)  → Redis (primary) → DB on miss
 *
 * Scaling, replication, and sharding are enabled via the Configure tab — not duplicate nodes.
 */
export const URL_SHORTENER_PRESET: PresetBlueprint = {
  id: 'url-shortener-reference',
  name: 'Reference Architecture',
  description:
    'Single logical services with auto-scaling, Redis cache-aside, DB replication, and sharding.',
  components: [
    { id: 'preset-lb', type: 'load-balancer', x: 520, y: 268 },
    { id: 'preset-shortener', type: 'shortener', x: 760, y: 128 },
    { id: 'preset-backend', type: 'backend', x: 760, y: 388 },
    { id: 'preset-redis', type: 'redis', x: 1000, y: 152 },
    { id: 'preset-db', type: 'database', x: 1000, y: 388 },
  ],
  connections: [
    { from: `${SOURCE_ID}:out`, to: 'preset-lb:in' },
    { from: 'preset-lb:out', to: 'preset-shortener:in' },
    { from: 'preset-lb:out', to: 'preset-backend:in' },
    { from: 'preset-shortener:out', to: 'preset-db:in' },
    { from: 'preset-shortener:out', to: 'preset-redis:in' },
    { from: 'preset-backend:out', to: 'preset-redis:in' },
    { from: 'preset-backend:out', to: 'preset-db:in' },
  ],
};

function createPresetComponent(
  id: string,
  type: ComponentType,
  x: number,
  y: number
): PlacedComponent {
  const def = COMPONENT_DEFS[type];
  return {
    id,
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

export function buildPreset(
  blueprint: PresetBlueprint = URL_SHORTENER_PRESET
): { components: PlacedComponent[]; belts: ConveyorBelt[] } {
  const components = blueprint.components.map(({ id, type, x, y }) =>
    createPresetComponent(id, type, x, y)
  );

  const belts = blueprint.connections.map(({ from, to }) => createBelt(from, to));

  return { components, belts };
}
