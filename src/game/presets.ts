import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { COMPONENT_DEFS } from './types';
import { SOURCE_ID, createBelt } from './simulation';

export interface PresetBlueprint {
  id: string;
  name: string;
  description: string;
  components: { id: string; type: ComponentType; x: number; y: number }[];
  connections: { from: string; to: string }[];
}

/**
 * Reference URL shortener architecture (industry best practices):
 *
 * Requests → L7 Load Balancer
 *   ├─ writes (28%) → Shortener pool (×3) → Database shards (×2) + Redis cache warm
 *   └─ reads  (72%) → Backend pool (×4)  → Redis (primary, ~96% hit) → DB on miss
 *
 * Patterns applied: read/write path separation, horizontal scaling on the hot read path,
 * distributed cache before database, and database sharding for write + miss traffic.
 */
export const URL_SHORTENER_PRESET: PresetBlueprint = {
  id: 'url-shortener-reference',
  name: 'Reference Architecture',
  description:
    'Production-style layout: scaled redirect services, Redis cache-aside, and sharded databases.',
  components: [
    { id: 'preset-lb', type: 'load-balancer', x: 100, y: 248 },
    { id: 'preset-shortener-1', type: 'shortener', x: 320, y: 40 },
    { id: 'preset-shortener-2', type: 'shortener', x: 320, y: 112 },
    { id: 'preset-shortener-3', type: 'shortener', x: 320, y: 184 },
    { id: 'preset-backend-1', type: 'backend', x: 320, y: 300 },
    { id: 'preset-backend-2', type: 'backend', x: 320, y: 388 },
    { id: 'preset-backend-3', type: 'backend', x: 320, y: 476 },
    { id: 'preset-backend-4', type: 'backend', x: 320, y: 564 },
    { id: 'preset-redis', type: 'redis', x: 600, y: 108 },
    { id: 'preset-db-1', type: 'database', x: 600, y: 300 },
    { id: 'preset-db-2', type: 'database', x: 600, y: 388 },
    { id: 'preset-db-3', type: 'database', x: 600, y: 476 },
  ],
  connections: [
    { from: `${SOURCE_ID}:out`, to: 'preset-lb:in' },
    { from: 'preset-lb:out', to: 'preset-shortener-1:in' },
    { from: 'preset-lb:out', to: 'preset-shortener-2:in' },
    { from: 'preset-lb:out', to: 'preset-shortener-3:in' },
    { from: 'preset-lb:out', to: 'preset-backend-1:in' },
    { from: 'preset-lb:out', to: 'preset-backend-2:in' },
    { from: 'preset-lb:out', to: 'preset-backend-3:in' },
    { from: 'preset-lb:out', to: 'preset-backend-4:in' },
    { from: 'preset-shortener-1:out', to: 'preset-db-1:in' },
    { from: 'preset-shortener-2:out', to: 'preset-db-2:in' },
    { from: 'preset-shortener-3:out', to: 'preset-db-3:in' },
    { from: 'preset-shortener-1:out', to: 'preset-redis:in' },
    { from: 'preset-shortener-2:out', to: 'preset-redis:in' },
    { from: 'preset-shortener-3:out', to: 'preset-redis:in' },
    { from: 'preset-backend-1:out', to: 'preset-redis:in' },
    { from: 'preset-backend-2:out', to: 'preset-redis:in' },
    { from: 'preset-backend-3:out', to: 'preset-redis:in' },
    { from: 'preset-backend-4:out', to: 'preset-redis:in' },
    { from: 'preset-backend-1:out', to: 'preset-db-1:in' },
    { from: 'preset-backend-2:out', to: 'preset-db-2:in' },
    { from: 'preset-backend-3:out', to: 'preset-db-3:in' },
    { from: 'preset-backend-4:out', to: 'preset-db-1:in' },
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
