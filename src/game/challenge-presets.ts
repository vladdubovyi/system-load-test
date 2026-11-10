import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { SOURCE_ID, createBelt } from './simulation';
import { getComponentDef } from './component-catalog';
import type { PresetBlueprint } from './presets';
import {
  applyConfigChip,
  createEmptyComponentConfig,
  type ComponentInstanceConfig,
  type ConfigChipId,
} from './component-config';

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
      // Cache misses chain onward from Redis to the database (flow-correctness).
      { from: 'ch-redis:out', to: 'ch-db:in' },
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
      // The async upload path lands processed files in blob storage.
      { from: 'db-worker:out', to: 'db-blob:in' },
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
      // Edge-cache misses continue from the CDN to the feed service.
      { from: 'ig-cdn:out', to: 'ig-api:in' },
      { from: 'ig-api:out', to: 'ig-redis:in' },
      { from: 'ig-api:out', to: 'ig-feed:in' },
      { from: 'ig-api:out', to: 'ig-media:in' },
      // Cache misses chain onward from Redis to the feed store.
      { from: 'ig-redis:out', to: 'ig-feed:in' },
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
      // Counter-cache misses chain onward from Redis to the database.
      { from: 'rl-redis:out', to: 'rl-db:in' },
    ],
  },
  'chat-messaging': {
    id: 'chat-messaging-starter',
    name: 'Chat messaging starter',
    description: 'Chat API with a conversation cache, a message store, and an async fan-out worker.',
    components: [
      component('cm-lb', 'load-balancer', 520, 280),
      component('cm-api', 'backend-service', 760, 280),
      component('cm-redis', 'redis', 1000, 160),
      component('cm-store', 'nosql-database', 1000, 400),
      component('cm-queue', 'message-queue', 760, 480),
      component('cm-worker', 'worker-service', 1000, 540),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'cm-lb:in' },
      { from: 'cm-lb:out', to: 'cm-api:in' },
      { from: 'cm-api:out', to: 'cm-redis:in' },
      { from: 'cm-api:out', to: 'cm-store:in' },
      // Cache misses chain onward from Redis to the message store.
      { from: 'cm-redis:out', to: 'cm-store:in' },
      { from: 'cm-api:out', to: 'cm-queue:in' },
      { from: 'cm-queue:out', to: 'cm-worker:in' },
      // The fan-out worker persists what it processed.
      { from: 'cm-worker:out', to: 'cm-store:in' },
    ],
  },
  'ticket-booking': {
    id: 'ticket-booking-starter',
    name: 'Ticket booking starter',
    description: 'Booking API with a seat-map cache in front of the relational database.',
    components: [
      component('tb-lb', 'load-balancer', 520, 280),
      component('tb-api', 'backend-service', 760, 280),
      component('tb-redis', 'redis', 1000, 180),
      component('tb-db', 'database', 1000, 380),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'tb-lb:in' },
      { from: 'tb-lb:out', to: 'tb-api:in' },
      { from: 'tb-api:out', to: 'tb-redis:in' },
      { from: 'tb-api:out', to: 'tb-db:in' },
      // Seat-map cache misses chain onward from Redis to the database.
      { from: 'tb-redis:out', to: 'tb-db:in' },
    ],
  },
  'search-autocomplete': {
    id: 'search-autocomplete-starter',
    name: 'Search autocomplete starter',
    description: 'Suggest API with a prefix cache over the search index, and an async indexing pipeline.',
    components: [
      component('sa-lb', 'load-balancer', 520, 280),
      component('sa-api', 'backend-service', 760, 280),
      component('sa-redis', 'redis', 1000, 160),
      component('sa-search', 'search-service', 1000, 400),
      component('sa-queue', 'message-queue', 760, 480),
      component('sa-worker', 'worker-service', 1000, 540),
    ],
    connections: [
      { from: `${SOURCE_ID}:out`, to: 'sa-lb:in' },
      { from: 'sa-lb:out', to: 'sa-api:in' },
      { from: 'sa-api:out', to: 'sa-redis:in' },
      { from: 'sa-api:out', to: 'sa-search:in' },
      // Prefix-cache misses chain onward from Redis to the index.
      { from: 'sa-redis:out', to: 'sa-search:in' },
      { from: 'sa-api:out', to: 'sa-queue:in' },
      { from: 'sa-queue:out', to: 'sa-worker:in' },
      // The indexing worker writes into the search index.
      { from: 'sa-worker:out', to: 'sa-search:in' },
    ],
  },
};

/**
 * A reference solution: a board plus the configuration chips dropped on it.
 * Each challenge has one (interview-platform.md §8). It is the design the
 * objective floors are calibrated against, so it must meet every objective
 * on every seed — `calibration.test.ts` holds it to that.
 */
export interface ReferenceBlueprint extends PresetBlueprint {
  /** Config chips per component id, applied in order. */
  chips: Record<string, ConfigChipId[]>;
}

/**
 * Calibrated 2026-11-06 against the starters above with seeded runs
 * (interview-platform.md §8). Each reference keeps the starter's topology
 * and adds what the exercise is about: auto-scaling on every compute tier,
 * replication and sharding on the SQL database, and for the rate limiter a
 * second counter cache — scaling the API alone pushes 5x spikes straight
 * into one Redis, which fails.
 */
const COMPUTE: ConfigChipId[] = [
  'horizontal-scaling',
  'vertical-scaling',
  'reactive-scaling',
  'predictive-scaling',
];
const SQL: ConfigChipId[] = ['db-replication', 'db-sharding'];

function reference(
  slug: string,
  description: string,
  chips: Record<string, ConfigChipId[]>,
  extra: {
    components?: { id: string; type: ComponentType; x: number; y: number }[];
    connections?: { from: string; to: string }[];
  } = {}
): ReferenceBlueprint {
  const starter = CHALLENGE_PRESETS[slug];
  return {
    id: `${slug}-reference`,
    name: `${starter.name.replace(/ starter$/, '')} reference`,
    description,
    components: [...starter.components, ...(extra.components ?? [])],
    connections: [...starter.connections, ...(extra.connections ?? [])],
    chips,
  };
}

const CHALLENGE_REFERENCES: Record<string, ReferenceBlueprint> = {
  'url-shortener': reference(
    'url-shortener',
    'Starter topology with auto-scaled write and read services and a replicated, sharded database.',
    { 'ch-writes': COMPUTE, 'ch-reads': COMPUTE, 'ch-db': SQL }
  ),
  dropbox: reference(
    'dropbox',
    'Starter topology with auto-scaled API and worker tiers and a replicated, sharded metadata database.',
    { 'db-api': COMPUTE, 'db-worker': COMPUTE, 'db-meta': SQL }
  ),
  'instagram-feed': reference(
    'instagram-feed',
    'Starter topology with an auto-scaled feed service behind the CDN.',
    { 'ig-api': COMPUTE }
  ),
  'rate-limiter': reference(
    'rate-limiter',
    'Starter topology with an auto-scaled API tier and a second Redis for counters, so spikes never overload one cache.',
    { 'rl-api': COMPUTE, 'rl-db': SQL },
    {
      components: [component('rl-redis-2', 'redis', 1180, 120)],
      connections: [
        { from: 'rl-api:out', to: 'rl-redis-2:in' },
        { from: 'rl-redis-2:out', to: 'rl-db:in' },
      ],
    }
  ),
  'chat-messaging': reference(
    'chat-messaging',
    'Starter topology with an auto-scaled chat API and fan-out worker, and the message store sharded across two NoSQL nodes — spikes of sends would overrun one.',
    { 'cm-api': COMPUTE, 'cm-worker': COMPUTE },
    {
      components: [component('cm-store-2', 'nosql-database', 1240, 400)],
      connections: [
        { from: 'cm-api:out', to: 'cm-store-2:in' },
        { from: 'cm-redis:out', to: 'cm-store-2:in' },
        { from: 'cm-worker:out', to: 'cm-store-2:in' },
      ],
    }
  ),
  'ticket-booking': reference(
    'ticket-booking',
    'Starter topology with an auto-scaled booking API and a replicated, sharded database for the rush.',
    { 'tb-api': COMPUTE, 'tb-db': SQL }
  ),
  'search-autocomplete': reference(
    'search-autocomplete',
    'Starter topology with an auto-scaled suggest API and indexing worker.',
    { 'sa-api': COMPUTE, 'sa-worker': COMPUTE }
  ),
};

export function getChallengePreset(slug: string): PresetBlueprint | null {
  return CHALLENGE_PRESETS[slug] ?? null;
}

export function getChallengeReference(slug: string): ReferenceBlueprint | null {
  return CHALLENGE_REFERENCES[slug] ?? null;
}

function materialize(blueprint: PresetBlueprint): {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
} {
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

export function buildChallengePreset(slug: string): {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
} | null {
  const blueprint = getChallengePreset(slug);
  return blueprint ? materialize(blueprint) : null;
}

export function buildChallengeReference(slug: string): {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
} | null {
  const blueprint = getChallengeReference(slug);
  if (!blueprint) return null;

  const { components, belts } = materialize(blueprint);
  const componentConfigs = new Map<string, ComponentInstanceConfig>();
  for (const component of components) {
    const chips = blueprint.chips[component.id] ?? [];
    if (chips.length === 0) continue;
    const config = createEmptyComponentConfig();
    for (const chip of chips) {
      applyConfigChip(config, chip, component.type);
    }
    componentConfigs.set(component.id, config);
  }
  return { components, belts, componentConfigs };
}
