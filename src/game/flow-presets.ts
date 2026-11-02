import type { FlowSpec, Objectives } from './flow-types';

/**
 * Built-in flow specs per challenge slug, used until challenges carry flows
 * in their backend ScenarioConfig (Phase 5). A challenge's own
 * `scenario.flows` always wins over these.
 */

export const URL_SHORTENER_FLOWS: FlowSpec[] = [
  {
    kind: 'create',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Shortening service' },
      {
        id: 'persist',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Persist mapping',
      },
      // Write-through: warming the cache is good practice but never required.
      { id: 'warm', require: { capability: 'cache' }, optional: true, label: 'Warm cache' },
    ],
  },
  {
    kind: 'read',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Redirect service' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Cache lookup',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            {
              id: 'db-read',
              require: { capability: 'durable-store' },
              terminal: true,
              label: 'Database lookup (cache miss)',
            },
          ],
        },
      },
      // No-cache designs go straight to the database on every read.
      {
        id: 'db-direct',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Database lookup',
      },
    ],
  },
];

/**
 * Completion floors are deliberately a *minimum bar*, not the excellence bar
 * (that lives in report.ts): the shipped starter sheds some spike traffic by
 * design, and the lesson it teaches is improvement, not instant failure. The
 * sharp objective here is the violation ceiling — a cache standing in for the
 * database fails outright no matter how much load it absorbs.
 */
export const URL_SHORTENER_OBJECTIVES: Objectives = {
  minCompletionRate: { create: 0.6, read: 0.6 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Feed loads are expected to be served overwhelmingly from the edge, so the
 * read floor is high; writes contend for the service tier and get a lower
 * one. Dropping the CDN or a durable store misses these immediately.
 */
export const INSTAGRAM_FEED_OBJECTIVES: Objectives = {
  minCompletionRate: { feedLoad: 0.85, post: 0.5, like: 0.5 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Instagram feed: the CDN is an edge cache that serves hot feed loads
 * outright and forwards misses to the service tier; service-level misses
 * chain through Redis into a durable feed store. Writes (posts, likes)
 * bypass the caches and must land in a durable store.
 */
export const INSTAGRAM_FEED_FLOWS: FlowSpec[] = [
  {
    kind: 'feedLoad',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      {
        id: 'edge',
        require: { componentType: 'cdn' },
        optional: true,
        label: 'Edge cache (CDN)',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          // A miss simply continues with the remaining steps at the service.
          onMiss: [],
        },
      },
      { id: 'service', require: { capability: 'compute' }, label: 'Feed service' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Feed cache lookup',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            {
              id: 'feed-db-read',
              require: { capability: 'durable-store' },
              terminal: true,
              label: 'Feed store lookup (cache miss)',
            },
          ],
        },
      },
      {
        id: 'feed-db',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Feed store lookup',
      },
    ],
  },
  {
    kind: 'post',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Feed service' },
      {
        id: 'store',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Persist post',
      },
    ],
  },
  {
    kind: 'like',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Feed service' },
      {
        id: 'count',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Persist like',
      },
    ],
  },
];

/**
 * File storage: uploads land in object storage either directly or through
 * the async queue → worker path; downloads may be served from a cache;
 * metadata lives in the relational store. The gateway behind the load
 * balancer is a second, optional ingress hop. See flow-authoring §4.
 */
export const DROPBOX_FLOWS: FlowSpec[] = [
  {
    kind: 'upload',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'gateway', require: { capability: 'ingress' }, optional: true, label: 'API gateway' },
      { id: 'service', require: { capability: 'compute' }, label: 'Upload service' },
      { id: 'enqueue', require: { capability: 'queue' }, optional: true, label: 'Queue for processing' },
      { id: 'worker', require: { capability: 'compute' }, optional: true, label: 'Processing worker' },
      {
        id: 'store',
        require: { componentType: 'object-storage' },
        terminal: true,
        label: 'Store file blob',
      },
    ],
  },
  {
    kind: 'download',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'gateway', require: { capability: 'ingress' }, optional: true, label: 'API gateway' },
      { id: 'service', require: { capability: 'compute' }, label: 'Download service' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Content cache',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            {
              id: 'blob-read',
              require: { componentType: 'object-storage' },
              terminal: true,
              label: 'Fetch blob (cache miss)',
            },
          ],
        },
      },
      {
        id: 'blob-direct',
        require: { componentType: 'object-storage' },
        terminal: true,
        label: 'Fetch blob',
      },
    ],
  },
  {
    kind: 'metadata',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'gateway', require: { capability: 'ingress' }, optional: true, label: 'API gateway' },
      { id: 'service', require: { capability: 'compute' }, label: 'Metadata service' },
      {
        id: 'meta-db',
        require: { componentType: 'database' },
        terminal: true,
        label: 'Metadata lookup',
      },
    ],
  },
];

/** Starter measures 0.53–0.65 per kind; floors follow the Phase 4 minimum-bar rule. */
export const DROPBOX_OBJECTIVES: Objectives = {
  minCompletionRate: { upload: 0.4, download: 0.4, metadata: 0.4 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Rate limiter: every check must pass through the limiter — that is the
 * whole lesson — then the API consults Redis counters, falling through to
 * the database on a miss.
 */
export const RATE_LIMITER_FLOWS: FlowSpec[] = [
  {
    kind: 'check',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'limiter', require: { capability: 'traffic-filter' }, label: 'Rate limiter' },
      { id: 'service', require: { capability: 'compute' }, label: 'API service' },
      {
        id: 'counters',
        require: { capability: 'cache' },
        optional: true,
        label: 'Counter lookup',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            {
              id: 'db-read',
              require: { capability: 'durable-store' },
              terminal: true,
              label: 'Limit lookup (cache miss)',
            },
          ],
        },
      },
      {
        id: 'db-direct',
        require: { capability: 'durable-store' },
        terminal: true,
        label: 'Limit lookup',
      },
    ],
  },
];

/**
 * The starter sheds most of its 5x spikes (measured 0.26–0.47), so the floor
 * is low; the real objective here is zero violations — every check must pass
 * through the limiter.
 */
export const RATE_LIMITER_OBJECTIVES: Objectives = {
  minCompletionRate: { check: 0.2 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

const FLOWS_BY_SLUG: Record<string, FlowSpec[]> = {
  'url-shortener': URL_SHORTENER_FLOWS,
  'instagram-feed': INSTAGRAM_FEED_FLOWS,
  dropbox: DROPBOX_FLOWS,
  'rate-limiter': RATE_LIMITER_FLOWS,
};

const OBJECTIVES_BY_SLUG: Record<string, Objectives> = {
  'url-shortener': URL_SHORTENER_OBJECTIVES,
  'instagram-feed': INSTAGRAM_FEED_OBJECTIVES,
  dropbox: DROPBOX_OBJECTIVES,
  'rate-limiter': RATE_LIMITER_OBJECTIVES,
};

export function getPresetFlows(slug: string): FlowSpec[] | undefined {
  return FLOWS_BY_SLUG[slug];
}

export function getPresetObjectives(slug: string): Objectives | undefined {
  return OBJECTIVES_BY_SLUG[slug];
}
