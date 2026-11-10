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
  minCompletionRate: { create: 0.99, read: 0.99 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Feed loads are expected to be served overwhelmingly from the edge, so the
 * read floor is high; writes contend for the service tier and get a lower
 * one. Dropping the CDN or a durable store misses these immediately.
 */
export const INSTAGRAM_FEED_OBJECTIVES: Objectives = {
  minCompletionRate: { feedLoad: 0.95, post: 0.95, like: 0.95 },
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
  minCompletionRate: { upload: 0.95, download: 0.95, metadata: 0.95 },
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
 * Floors are calibrated so that the starter does not pass and the reference
 * solution (challenge-presets.ts) does, on every seed
 * (interview-platform.md §8; measured 2026-11-06 with seeded runs):
 *
 * | scenario       | starter completes | reference completes | floor |
 * | url-shortener  | 0.78 – 0.98       | 1.00                | 0.99  |
 * | instagram-feed | like/post 0.60–0.79, feedLoad ≈ 1.0 | ≥ 0.99 | 0.95 |
 * | dropbox        | 0.51 – 0.69       | 1.00                | 0.95  |
 * | rate-limiter   | 0.20 – 0.40       | 1.00                | 0.95  |
 *
 * The same numbers live in backend/.../FlowDefinitions.cs; change both.
 * `calibration.test.ts` fails if either side of the line moves.
 */
export const RATE_LIMITER_OBJECTIVES: Objectives = {
  minCompletionRate: { check: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Chat messaging (product-directions.md §3.2): sends land in a durable
 * message store, optionally buffered through a queue and a fan-out worker;
 * history fetches are read-heavy and cacheable.
 */
export const CHAT_MESSAGING_FLOWS: FlowSpec[] = [
  {
    kind: 'send',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Chat API' },
      { id: 'enqueue', require: { capability: 'queue' }, optional: true, label: 'Fan-out queue' },
      { id: 'worker', require: { capability: 'compute' }, optional: true, label: 'Fan-out worker' },
      { id: 'store', require: { capability: 'durable-store' }, terminal: true, label: 'Persist message' },
    ],
  },
  {
    kind: 'fetch',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Chat API' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Conversation cache',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'db-read', require: { capability: 'durable-store' }, terminal: true, label: 'History lookup (cache miss)' },
          ],
        },
      },
      { id: 'db-direct', require: { capability: 'durable-store' }, terminal: true, label: 'History lookup' },
    ],
  },
];

/**
 * Ticket booking (§3.2): every reservation must reach the relational database
 * — a reserve that lands anywhere else is a violation. Browsing may be cached.
 */
export const TICKET_BOOKING_FLOWS: FlowSpec[] = [
  {
    kind: 'browse',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Booking API' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Seat map cache',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'db-read', require: { componentType: 'database' }, terminal: true, label: 'Seat map lookup (cache miss)' },
          ],
        },
      },
      { id: 'db-direct', require: { componentType: 'database' }, terminal: true, label: 'Seat map lookup' },
    ],
  },
  {
    kind: 'reserve',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Booking API' },
      { id: 'lock', require: { componentType: 'database' }, terminal: true, label: 'Reserve seat (row lock)' },
    ],
  },
];

/**
 * Search autocomplete (§3.2): suggestions come from the search index, ideally
 * through a hot-prefix cache; index updates travel an async pipeline into
 * the same index.
 */
export const SEARCH_AUTOCOMPLETE_FLOWS: FlowSpec[] = [
  {
    kind: 'suggest',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Suggest API' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Prefix cache',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'search-miss', require: { componentType: 'search-service' }, terminal: true, label: 'Index query (cache miss)' },
          ],
        },
      },
      { id: 'search-direct', require: { componentType: 'search-service' }, terminal: true, label: 'Index query' },
    ],
  },
  {
    kind: 'index',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Suggest API' },
      { id: 'enqueue', require: { capability: 'queue' }, optional: true, label: 'Index queue' },
      { id: 'worker', require: { capability: 'compute' }, optional: true, label: 'Indexing worker' },
      { id: 'write', require: { componentType: 'search-service' }, terminal: true, label: 'Index document' },
    ],
  },
];

/** Floors for the D2 scenarios: calibrated 2026-11-10 (see product-directions.md §3.2a). */
export const CHAT_MESSAGING_OBJECTIVES: Objectives = {
  minCompletionRate: { send: 0.95, fetch: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

export const TICKET_BOOKING_OBJECTIVES: Objectives = {
  minCompletionRate: { browse: 0.95, reserve: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

export const SEARCH_AUTOCOMPLETE_OBJECTIVES: Objectives = {
  minCompletionRate: { suggest: 0.95, index: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

/**
 * Ride dispatch (§3.2, phase 3): location pings are lossy telemetry that land
 * in a hot position cache (optionally via a stream and a worker); matches are
 * strict reads that may be served from the same cache and fall back to the
 * trip store.
 */
export const RIDE_DISPATCH_FLOWS: FlowSpec[] = [
  {
    kind: 'locationUpdate',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Dispatch API' },
      { id: 'stream', require: { capability: 'queue' }, optional: true, label: 'Location stream' },
      { id: 'worker', require: { capability: 'compute' }, optional: true, label: 'Location worker' },
      { id: 'position', require: { capability: 'cache' }, terminal: true, label: 'Driver position cache' },
    ],
  },
  {
    kind: 'match',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Dispatch API' },
      {
        id: 'nearby',
        require: { capability: 'cache' },
        optional: true,
        label: 'Nearby-driver lookup',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'trip-read', require: { capability: 'durable-store' }, terminal: true, label: 'Trip store lookup (cache miss)' },
          ],
        },
      },
      { id: 'trip-direct', require: { capability: 'durable-store' }, terminal: true, label: 'Trip store lookup' },
    ],
  },
];

/**
 * Notification fan-out (§3.2, phase 3): an event must be logged to a queue
 * and fanned out by a worker into a delivery channel — skipping the buffer
 * is a violation. Status reads are cacheable.
 */
export const NOTIFICATION_FANOUT_FLOWS: FlowSpec[] = [
  {
    kind: 'event',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Notification API' },
      { id: 'log', require: { capability: 'queue' }, label: 'Event log' },
      { id: 'worker', require: { capability: 'compute' }, label: 'Delivery worker' },
      { id: 'channel', require: { capability: 'queue' }, terminal: true, label: 'Delivery channel' },
    ],
  },
  {
    kind: 'status',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'service', require: { capability: 'compute' }, label: 'Notification API' },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        label: 'Status cache',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'status-read', require: { capability: 'durable-store' }, terminal: true, label: 'Status lookup (cache miss)' },
          ],
        },
      },
      { id: 'status-direct', require: { capability: 'durable-store' }, terminal: true, label: 'Status lookup' },
    ],
  },
];

/**
 * Payment webhooks (§3.2, phase 3): every request passes a traffic filter
 * first; webhooks may settle through a queue and a worker, charges may check
 * an idempotency cache; everything accepted is recorded in the relational
 * ledger.
 */
export const PAYMENT_WEBHOOK_FLOWS: FlowSpec[] = [
  {
    kind: 'webhook',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'limiter', require: { capability: 'traffic-filter' }, label: 'Rate limiter' },
      { id: 'service', require: { capability: 'compute' }, label: 'Payments API' },
      { id: 'enqueue', require: { capability: 'queue' }, optional: true, label: 'Webhook queue' },
      { id: 'worker', require: { capability: 'compute' }, optional: true, label: 'Settlement worker' },
      { id: 'ledger', require: { componentType: 'database' }, terminal: true, label: 'Record in ledger' },
    ],
  },
  {
    kind: 'charge',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' }, label: 'Ingress' },
      { id: 'limiter', require: { capability: 'traffic-filter' }, label: 'Rate limiter' },
      { id: 'service', require: { capability: 'compute' }, label: 'Payments API' },
      {
        id: 'idempotency',
        require: { capability: 'cache' },
        optional: true,
        label: 'Idempotency key',
        branch: {
          probability: 'cacheHitRatio',
          onHit: 'complete',
          onMiss: [
            { id: 'charge-write', require: { componentType: 'database' }, terminal: true, label: 'Write charge (new key)' },
          ],
        },
      },
      { id: 'charge-direct', require: { componentType: 'database' }, terminal: true, label: 'Write charge' },
    ],
  },
];

/** Floors for the phase-3 scenarios: calibrated 2026-11-10 (see product-directions.md §3.2b). */
export const RIDE_DISPATCH_OBJECTIVES: Objectives = {
  // Location pings are lossy by design; matches are not.
  minCompletionRate: { locationUpdate: 0.9, match: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

export const NOTIFICATION_FANOUT_OBJECTIVES: Objectives = {
  minCompletionRate: { event: 0.95, status: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

export const PAYMENT_WEBHOOK_OBJECTIVES: Objectives = {
  minCompletionRate: { webhook: 0.95, charge: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

const FLOWS_BY_SLUG: Record<string, FlowSpec[]> = {
  'ride-dispatch': RIDE_DISPATCH_FLOWS,
  'notification-fanout': NOTIFICATION_FANOUT_FLOWS,
  'payment-webhook': PAYMENT_WEBHOOK_FLOWS,
  'chat-messaging': CHAT_MESSAGING_FLOWS,
  'ticket-booking': TICKET_BOOKING_FLOWS,
  'search-autocomplete': SEARCH_AUTOCOMPLETE_FLOWS,
  'url-shortener': URL_SHORTENER_FLOWS,
  'instagram-feed': INSTAGRAM_FEED_FLOWS,
  dropbox: DROPBOX_FLOWS,
  'rate-limiter': RATE_LIMITER_FLOWS,
};

const OBJECTIVES_BY_SLUG: Record<string, Objectives> = {
  'ride-dispatch': RIDE_DISPATCH_OBJECTIVES,
  'notification-fanout': NOTIFICATION_FANOUT_OBJECTIVES,
  'payment-webhook': PAYMENT_WEBHOOK_OBJECTIVES,
  'chat-messaging': CHAT_MESSAGING_OBJECTIVES,
  'ticket-booking': TICKET_BOOKING_OBJECTIVES,
  'search-autocomplete': SEARCH_AUTOCOMPLETE_OBJECTIVES,
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
