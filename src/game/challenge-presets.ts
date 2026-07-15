import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { SOURCE_ID, createBelt } from './simulation';
import { getComponentDef } from './component-catalog';
import type { PresetBlueprint } from './presets';

function component(
  id: string,
  type: ComponentType,
  x: number,
  y: number
): { id: string; type: ComponentType; x: number; y: number } {
  return { id, type, x, y };
}

const CHALLENGE_PRESETS: Record<string, PresetBlueprint> = {
  'url-shortener': {
    id: 'url-shortener-starter',
    name: 'URL Shortener starter',
    description: 'Load balancer, write/read services, cache, and database.',
    components: [
      component('ch-lb', 'load-balancer', 520, 268),
      component('ch-writes', 'microservice', 760, 140),
      component('ch-reads', 'backend-service', 760, 396),
      component('ch-redis', 'redis', 1000, 156),
      component('ch-db', 'database', 1000, 396),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'ch-lb:in' },
      { from: 'ch-lb:out', to: 'ch-writes:in' },
      { from: 'ch-lb:out', to: 'ch-reads:in' },
      { from: 'ch-writes:out', to: 'ch-db:in' },
      { from: 'ch-writes:out', to: 'ch-redis:in' },
      { from: 'ch-reads:out', to: 'ch-redis:in' },
      { from: 'ch-reads:out', to: 'ch-db:in' },
    ],
  },
  dropbox: {
    id: 'dropbox-starter',
    name: 'File storage starter',
    description: 'Gateway, app service, metadata DB, object storage, and async worker.',
    components: [
      component('db-lb', 'load-balancer', 500, 280),
      component('db-gw', 'api-gateway', 700, 280),
      component('db-api', 'backend-service', 920, 220),
      component('db-worker', 'worker-service', 920, 380),
      component('db-meta', 'database', 1140, 220),
      component('db-blob', 'object-storage', 1140, 380),
      component('db-queue', 'message-queue', 700, 440),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'db-lb:in' },
      { from: 'db-lb:out', to: 'db-gw:in' },
      { from: 'db-gw:out', to: 'db-api:in' },
      { from: 'db-api:out', to: 'db-meta:in' },
      { from: 'db-api:out', to: 'db-blob:in' },
      { from: 'db-api:out', to: 'db-queue:in' },
      { from: 'db-queue:out', to: 'db-worker:in' },
    ],
  },
  'instagram-feed': {
    id: 'instagram-feed-starter',
    name: 'Feed system starter',
    description: 'CDN, feed API, cache, timeline store, and media storage.',
    components: [
      component('ig-lb', 'load-balancer', 480, 280),
      component('ig-cdn', 'cdn', 700, 180),
      component('ig-api', 'backend-service', 700, 360),
      component('ig-redis', 'redis', 940, 220),
      component('ig-feed', 'nosql-database', 940, 360),
      component('ig-media', 'object-storage', 1160, 290),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'ig-lb:in' },
      { from: 'ig-lb:out', to: 'ig-cdn:in' },
      { from: 'ig-lb:out', to: 'ig-api:in' },
      { from: 'ig-api:out', to: 'ig-redis:in' },
      { from: 'ig-api:out', to: 'ig-feed:in' },
      { from: 'ig-api:out', to: 'ig-media:in' },
    ],
  },
  'rate-limiter': {
    id: 'rate-limiter-starter',
    name: 'Rate limiter starter',
    description: 'Edge limiter with Redis counters and API service.',
    components: [
      component('rl-lb', 'load-balancer', 520, 280),
      component('rl-limit', 'rate-limiter', 740, 280),
      component('rl-api', 'backend-service', 960, 280),
      component('rl-redis', 'redis', 1180, 220),
      component('rl-db', 'database', 1180, 340),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'rl-lb:in' },
      { from: 'rl-lb:out', to: 'rl-limit:in' },
      { from: 'rl-limit:out', to: 'rl-api:in' },
      { from: 'rl-api:out', to: 'rl-redis:in' },
      { from: 'rl-api:out', to: 'rl-db:in' },
    ],
  },
};

export function getChallengePreset(slug: string): PresetBlueprint | null {
  return CHALLENGE_PRESETS[slug] ?? null;
}

export function buildChallengePreset(slug: string): {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
} | null {
  const blueprint = getChallengePreset(slug);
  if (!blueprint) return null;

  const components = blueprint.components.map(({ id, type, x, y }) => {
    const def = getComponentDef(type);
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
  });

  const belts = blueprint.connections.map(({ from, to }) => createBelt(from, to));
  return { components, belts };
}
