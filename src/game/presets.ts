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
 * Reference URL shortener architecture:
 *
 * Requests → Load Balancer
 *   ├─ creates  → Shortener → Database (+ Redis cache warm)
 *   └─ reads    → Backend   → Redis (hit) / Database (miss)
 */
export const URL_SHORTENER_PRESET: PresetBlueprint = {
  id: 'url-shortener-reference',
  name: 'Reference Architecture',
  description:
    'Load-balanced read/write paths with Redis absorbing celebrity redirect traffic.',
  components: [
    { id: 'preset-lb', type: 'load-balancer', x: 168, y: 244 },
    { id: 'preset-shortener', type: 'shortener', x: 392, y: 108 },
    { id: 'preset-backend', type: 'backend', x: 392, y: 368 },
    { id: 'preset-redis', type: 'redis', x: 648, y: 132 },
    { id: 'preset-db', type: 'database', x: 648, y: 352 },
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
