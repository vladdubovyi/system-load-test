/**
 * Canned API payloads in the exact JSON shape the ASP.NET backend returns
 * (see backend/.../ChallengesController.cs and ChallengeSeeder.cs). The
 * frontend maps these with `mapChallengeFromApi`, so keeping the backend
 * shape here exercises the real mapping code.
 */

export interface ApiComponentDefinition {
  id: string;
  componentType: string;
  label: string;
  category: 'networking' | 'compute' | 'storage' | 'messaging' | 'infrastructure';
  defaultCapacity: number;
  defaultQueueLimit: number;
  monthlyCost: number;
  emoji: string;
  description: string;
  width: number;
  height: number;
  enabled: boolean;
  /** Semantic capabilities (docs/specs/flow-authoring.md §2.2); optional like the backend's. */
  capabilities?: string[];
}

function def(
  componentType: string,
  label: string,
  category: ApiComponentDefinition['category'],
  defaultCapacity: number,
  defaultQueueLimit: number,
  monthlyCost: number,
  emoji: string,
  description: string,
  width = 140
): ApiComponentDefinition {
  return {
    id: `cmp-${componentType}`,
    componentType,
    label,
    category,
    defaultCapacity,
    defaultQueueLimit,
    monthlyCost,
    emoji,
    description,
    width,
    height: 72,
    enabled: true,
  };
}

/** Mirrors ChallengeSeeder.SeedComponentDefinitions (subset used by the challenges). */
export const COMPONENT_DEFINITIONS: ApiComponentDefinition[] = [
  def('load-balancer', 'Load Balancer', 'networking', 800, 120, 120, '⚖️', 'Distributes incoming traffic across multiple servers'),
  def('api-gateway', 'API Gateway', 'networking', 1000, 150, 150, '🚪', 'Central entry point for API requests'),
  def('cdn', 'CDN', 'networking', 5000, 200, 200, '🌐', 'Content Delivery Network for caching static assets globally', 120),
  def('backend-service', 'Backend Service', 'compute', 220, 90, 200, '🔧', 'Application server handling business logic', 150),
  def('microservice', 'Microservice', 'compute', 180, 80, 180, '⚙️', 'Independent service handling specific business capability', 150),
  def('worker-service', 'Worker Service', 'compute', 150, 200, 160, '👷', 'Background worker for async job processing', 150),
  def('database', 'SQL Database', 'storage', 140, 60, 350, '🗄️', 'Relational database (PostgreSQL, MySQL)', 130),
  def('redis', 'Redis Cache', 'storage', 900, 150, 90, '⚡', 'In-memory data store for caching', 130),
  def('nosql-database', 'NoSQL Database', 'storage', 180, 80, 300, '💾', 'Document/key-value store (MongoDB, DynamoDB)', 150),
  def('object-storage', 'Object Storage', 'storage', 1000, 200, 50, '☁️', 'Blob storage for files and large objects (S3, Azure Blob)', 150),
  def('message-queue', 'Message Queue', 'messaging', 300, 500, 120, '📬', 'Generic message queue for async communication', 150),
  def('kafka', 'Kafka', 'messaging', 500, 1000, 250, '🔀', 'Distributed event streaming platform', 130),
  def('rate-limiter', 'Rate Limiter', 'infrastructure', 2000, 50, 60, '🚦', 'Controls request rate to prevent abuse'),
  def('auth-service', 'Auth Service', 'infrastructure', 800, 100, 180, '🔐', 'Authentication and authorization service', 150),
  def('search-service', 'Search Service', 'storage', 300, 100, 250, '🔎', 'Full-text search engine (Elasticsearch)', 150),
  def('pubsub', 'Pub/Sub', 'messaging', 600, 1000, 150, '📣', 'Publish/subscribe delivery channel (SNS, Pub/Sub)', 150),
];

export interface ApiChallenge {
  id: string;
  name: string;
  slug: string;
  description: string;
  overviewContent: string;
  videoUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  createdAt: string;
  scenario: {
    id: string;
    durationSeconds: number;
    baseRps: number;
    spikeMultiplier: number;
    spikeChance: number;
    readRatio: number;
    scenarioConfig: Record<string, unknown>;
    scoringWeights: Record<string, number>;
  };
  allowedComponents: string[];
}

/** Mirrors ChallengeSeeder.SeedChallenges. */
export const CHALLENGES: ApiChallenge[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'URL Shortener',
    slug: 'url-shortener',
    description: 'Design a high-traffic URL shortening service like bit.ly',
    overviewContent:
      'URL shorteners are a classic system design interview question.\n**What interviewers look for**\n- Caching hot links\n- Horizontal scaling behind a load balancer',
    videoUrl: 'https://www.youtube.com/watch?v=J9u85GqdRM8',
    difficulty: 'medium',
    createdAt: '2026-01-01T00:00:00Z',
    scenario: {
      id: 'sc-url-shortener',
      durationSeconds: 45,
      baseRps: 200,
      spikeMultiplier: 3.2,
      spikeChance: 0.08,
      readRatio: 0.72,
      scenarioConfig: {
        requirements: [
          'Very high sustained load — millions of redirects per day',
          'Traffic spikes during viral events (celebrity links)',
          'Mixed request types: creates (shorten) and reads (redirect)',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { read: 0.72, create: 0.28 },
        // hotDataRatio is explicit (not left to the slug-keyed frontend
        // fallback) so interview-mode projections, which withhold the slug,
        // keep the same cache hit ratio. Mirrors ChallengeSeeder.cs.
        characteristics: { celebrityShare: 0.82, hotDataRatio: 0.97 },
        hints: [
          { id: 'reads-first', after: 'always', text: 'Reads dwarf writes here. Put the cache on the read path and let misses chain on to the database.' },
          { id: 'which-queue', after: 'loss', text: 'Watch which queue fills first under a spike — the service tier or the database — and scale the one that saturates.' },
          { id: 'persist', after: 'violation', text: 'Creates must reach a durable store. A cache can be warmed on the way, but it cannot persist anything.' },
        ],
      },
      scoringWeights: { availability: 40, latency: 30, scalability: 20, cost: 10 },
    },
    allowedComponents: ['load-balancer', 'microservice', 'backend-service', 'database', 'redis', 'rate-limiter'],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'File Storage Service (Dropbox)',
    slug: 'dropbox',
    description: 'Design a cloud file storage and synchronization service',
    overviewContent: 'File storage systems test your understanding of durability.',
    videoUrl: 'https://www.youtube.com/watch?v=U0xTu6E2CT8',
    difficulty: 'hard',
    createdAt: '2026-01-02T00:00:00Z',
    scenario: {
      id: 'sc-dropbox',
      durationSeconds: 60,
      baseRps: 300,
      spikeMultiplier: 2.0,
      spikeChance: 0.05,
      readRatio: 0.5,
      scenarioConfig: {
        requirements: ['Store files up to 2GB', 'Ensure data durability (no data loss)'],
        drainDuration: 15,
        pattern: 'gradual',
        requestTypes: { upload: 0.2, download: 0.5, metadata: 0.3 },
        characteristics: { fileSize: '10MB-500MB', avgFileSize: 50 },
        hints: [
          { id: 'split-paths', after: 'always', text: 'Keep metadata (relational) and blobs (object storage) on separate paths — they scale differently.' },
          { id: 'absorb-uploads', after: 'loss', text: 'Uploads pile up on the API during bursts. Let the queue and worker absorb them and drain at their own pace.' },
          { id: 'blob-home', after: 'violation', text: 'Blobs end in object storage and metadata in the database. A worker that writes nowhere finishes nothing.' },
        ],
      },
      scoringWeights: { durability: 35, storageEfficiency: 25, bandwidth: 20, cost: 20 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'database',
      'nosql-database',
      'object-storage',
      'redis',
      'message-queue',
      'worker-service',
    ],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Instagram Feed',
    slug: 'instagram-feed',
    description: 'Design a social media feed generation system',
    overviewContent: 'Feed systems are read-heavy and latency-sensitive.',
    videoUrl: 'https://www.youtube.com/watch?v=KmAyPUv1YTI',
    difficulty: 'hard',
    createdAt: '2026-01-03T00:00:00Z',
    scenario: {
      id: 'sc-instagram-feed',
      durationSeconds: 50,
      baseRps: 400,
      spikeMultiplier: 4.0,
      spikeChance: 0.12,
      readRatio: 0.95,
      scenarioConfig: {
        requirements: ['Extremely high read volume', 'Fast feed generation (< 200ms)'],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { feedLoad: 0.85, post: 0.05, like: 0.1 },
        characteristics: { hotDataRatio: 0.9 },
        hints: [
          { id: 'edge-first', after: 'always', text: 'Feed loads should mostly be served from the edge. Size the service tier for what the CDN misses, not for everything.' },
          { id: 'feed-service', after: 'loss', text: 'The feed service is what spikes overload. Give it headroom with auto-scaling before adding anything else.' },
          { id: 'writes-durable', after: 'violation', text: 'Posts and likes must land in a durable store, not in a cache.' },
        ],
      },
      scoringWeights: { latency: 35, availability: 30, throughput: 25, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'cdn',
      'backend-service',
      'database',
      'nosql-database',
      'redis',
      'object-storage',
      'kafka',
      'worker-service',
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Rate Limiter',
    slug: 'rate-limiter',
    description: 'Design a distributed rate limiting service',
    overviewContent: 'Rate limiters protect APIs from abuse.',
    videoUrl: 'https://youtu.be/FU4WlWF_SIQ',
    difficulty: 'easy',
    createdAt: '2026-01-04T00:00:00Z',
    scenario: {
      id: 'sc-rate-limiter',
      durationSeconds: 40,
      baseRps: 300,
      spikeMultiplier: 5.0,
      spikeChance: 0.15,
      readRatio: 1.0,
      scenarioConfig: {
        requirements: ['Block requests exceeding rate limits', 'Handle burst traffic'],
        drainDuration: 5,
        pattern: 'spike',
        requestTypes: { check: 1.0 },
        characteristics: {},
        hints: [
          { id: 'limiter-first', after: 'always', text: 'Every check passes the limiter first; the API comes after it, never beside it.' },
          { id: 'second-counter', after: 'loss', text: 'One Redis takes every counter lookup during a 5× spike. A second counter cache halves the pressure.' },
          { id: 'no-bypass', after: 'violation', text: 'A check that skips the limiter is a violation — the limiter is the whole lesson.' },
        ],
      },
      scoringWeights: { latency: 40, accuracy: 30, throughput: 20, cost: 10 },
    },
    allowedComponents: ['load-balancer', 'rate-limiter', 'backend-service', 'redis', 'database'],
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Chat Messaging',
    slug: 'chat-messaging',
    description: 'Design a real-time messaging backend with fan-out and history',
    overviewContent: 'Messaging systems test fan-out writes, ordering and read-your-own-writes.',
    videoUrl: '',
    difficulty: 'medium',
    createdAt: '2026-01-05T00:00:00Z',
    scenario: {
      id: 'sc-chat-messaging',
      durationSeconds: 45,
      baseRps: 220,
      spikeMultiplier: 3.0,
      spikeChance: 0.08,
      readRatio: 0.6,
      scenarioConfig: {
        requirements: [
          'Sends must land in a durable message store',
          'Fan-out to recipients may be asynchronous — buffer it',
          'Conversation history reads dominate; cache hot conversations',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { send: 0.4, fetch: 0.6 },
        characteristics: { celebrityShare: 0.3, hotDataRatio: 0.9 },
        hints: [
          { id: 'persist-sends', after: 'always', text: 'Sends must persist; fan-out can be asynchronous through a queue and a worker.' },
          { id: 'shard-store', after: 'loss', text: 'One NoSQL node cannot absorb 3× send bursts. Shard the message store across two nodes.' },
          { id: 'cache-not-store', after: 'violation', text: 'A message that ends in the cache was never persisted.' },
        ],
      },
      scoringWeights: { availability: 35, latency: 35, scalability: 20, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'microservice',
      'worker-service',
      'redis',
      'nosql-database',
      'message-queue',
      'kafka',
    ],
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Ticket Booking',
    slug: 'ticket-booking',
    description: 'Design a ticketing system that survives the on-sale rush without overselling',
    overviewContent: 'Booking systems test contention on hot rows and traffic that ramps in minutes.',
    videoUrl: '',
    difficulty: 'hard',
    createdAt: '2026-01-06T00:00:00Z',
    scenario: {
      id: 'sc-ticket-booking',
      durationSeconds: 50,
      baseRps: 150,
      spikeMultiplier: 1.5,
      spikeChance: 0.04,
      readRatio: 0.8,
      scenarioConfig: {
        requirements: [
          'Every reservation must hit the relational database — no overselling',
          'Browsing is read-heavy and cacheable',
          'Traffic ramps to nearly 4× when the sale opens, then settles',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { browse: 0.8, reserve: 0.2 },
        characteristics: { celebrityShare: 0.5, hotDataRatio: 0.85 },
        hints: [
          { id: 'lock-row', after: 'always', text: 'Browsing may be cached; a reservation must lock a row in the relational database.' },
          { id: 'before-the-rush', after: 'loss', text: 'The on-sale ramp nearly quadruples load at 25 seconds. Scale the API before it, not after.' },
          { id: 'oversell', after: 'violation', text: 'A reservation that lands anywhere but the database can oversell the seat.' },
        ],
        trafficPhases: [
          { atSeconds: 0, baseRps: 150 },
          { atSeconds: 15, baseRps: 150 },
          { atSeconds: 25, baseRps: 550 },
          { atSeconds: 40, baseRps: 250 },
        ],
      },
      scoringWeights: { durability: 40, availability: 30, latency: 20, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'microservice',
      'redis',
      'database',
      'message-queue',
      'worker-service',
    ],
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Search Autocomplete',
    slug: 'search-autocomplete',
    description: 'Design a typeahead service: every keystroke is a query',
    overviewContent: 'Autocomplete is read-heavy and latency-bound; indexing is an async pipeline.',
    videoUrl: '',
    difficulty: 'medium',
    createdAt: '2026-01-07T00:00:00Z',
    scenario: {
      id: 'sc-search-autocomplete',
      durationSeconds: 45,
      baseRps: 380,
      spikeMultiplier: 2.5,
      spikeChance: 0.1,
      readRatio: 0.9,
      scenarioConfig: {
        requirements: [
          'Suggestions come from the search index, ideally via a hot-prefix cache',
          'Index updates arrive asynchronously and must reach the search index',
          'Keystroke traffic is bursty: expect 2.5× spikes',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { suggest: 0.9, index: 0.1 },
        characteristics: { celebrityShare: 0.2, hotDataRatio: 0.95 },
        hints: [
          { id: 'prefix-cache', after: 'always', text: 'Keystrokes hit the prefix cache first; the index answers the misses.' },
          { id: 'suggest-tier', after: 'loss', text: 'Scale the suggest tier — keystroke bursts are 2.5× and latency is the product.' },
          { id: 'index-path', after: 'violation', text: 'Index updates must reach the search index. A queue with no worker behind it is a dead end.' },
        ],
      },
      scoringWeights: { latency: 45, availability: 30, scalability: 15, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'microservice',
      'worker-service',
      'redis',
      'search-service',
      'message-queue',
      'kafka',
    ],
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Ride Dispatch',
    slug: 'ride-dispatch',
    description: 'Design a dispatch backend: lossy location pings, strict driver matching, and a rush hour',
    overviewContent: 'Dispatch separates lossy telemetry writes from matches that must complete, and plans for a ramp.',
    videoUrl: '',
    difficulty: 'hard',
    createdAt: '2026-01-08T00:00:00Z',
    scenario: {
      id: 'sc-ride-dispatch',
      durationSeconds: 50,
      baseRps: 220,
      spikeMultiplier: 2.0,
      spikeChance: 0.06,
      readRatio: 0.3,
      scenarioConfig: {
        requirements: [
          'Location pings land in a hot position cache — a stale position is tolerable, a lost match is not',
          'Matches read the position cache and fall back to the trip store',
          'Rush hour more than doubles the load for a quarter of a minute',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { locationUpdate: 0.7, match: 0.3 },
        characteristics: { celebrityShare: 0.1, hotDataRatio: 0.9 },
        hints: [
          { id: 'two-paths', after: 'always', text: 'Location pings are lossy telemetry; matches are not. Design the two paths differently.' },
          { id: 'rush-hour', after: 'loss', text: 'Rush hour arrives at 22 seconds and one dispatch API cannot carry 480 rps. Auto-scale it.' },
          { id: 'positions-cache', after: 'violation', text: 'Positions live in the cache; matches read it and fall back to the trip store.' },
        ],
        trafficPhases: [
          { atSeconds: 0, baseRps: 220 },
          { atSeconds: 12, baseRps: 220 },
          { atSeconds: 22, baseRps: 480 },
          { atSeconds: 38, baseRps: 300 },
        ],
      },
      scoringWeights: { availability: 35, latency: 35, scalability: 20, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'microservice',
      'worker-service',
      'redis',
      'nosql-database',
      'database',
      'message-queue',
      'kafka',
    ],
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Notification Fan-out',
    slug: 'notification-fanout',
    description: 'Design an async notification pipeline that keeps delivering when a worker degrades',
    overviewContent: 'A notification pipeline is pure asynchrony; the question is what a degraded worker does.',
    videoUrl: '',
    difficulty: 'medium',
    createdAt: '2026-01-09T00:00:00Z',
    scenario: {
      id: 'sc-notification-fanout',
      durationSeconds: 50,
      baseRps: 150,
      spikeMultiplier: 2.0,
      spikeChance: 0.06,
      readRatio: 0.15,
      scenarioConfig: {
        requirements: [
          'Every event is logged to a queue before a worker fans it out to a delivery channel',
          'Status reads are cacheable and must stay fast while the pipeline strains',
          'At 15 s the delivery worker runs at half capacity for 12 s — deliveries must still arrive',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { event: 0.85, status: 0.15 },
        characteristics: { celebrityShare: 0.2, hotDataRatio: 0.9 },
        hints: [
          { id: 'log-first', after: 'always', text: 'Log every event to the queue before any worker touches it.' },
          { id: 'second-worker', after: 'loss', text: 'A half-capacity worker at 15 seconds stalls delivery. A second worker on the same log keeps it flowing.' },
          { id: 'buffer-contract', after: 'violation', text: 'Skipping the log is a violation: the buffer is the contract, not an optimization.' },
        ],
        failureScenarios: [
          {
            id: 'worker-degraded',
            label: 'Worker degraded',
            atSeconds: 15,
            target: { componentType: 'worker-service' },
            type: 'capacity',
            durationSeconds: 12,
          },
        ],
      },
      scoringWeights: { availability: 40, latency: 25, scalability: 25, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'backend-service',
      'microservice',
      'worker-service',
      'kafka',
      'message-queue',
      'pubsub',
      'redis',
      'nosql-database',
    ],
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Payment Webhooks',
    slug: 'payment-webhook',
    description: 'Design webhook ingestion for a payments provider: rate-limited, idempotent, ledger-backed',
    overviewContent: 'Webhooks arrive in storms and retry what you drop: admission control and idempotency.',
    videoUrl: '',
    difficulty: 'hard',
    createdAt: '2026-01-10T00:00:00Z',
    scenario: {
      id: 'sc-payment-webhook',
      durationSeconds: 45,
      baseRps: 240,
      spikeMultiplier: 2.0,
      spikeChance: 0.06,
      readRatio: 0.35,
      scenarioConfig: {
        requirements: [
          'Every request passes a rate limiter before it reaches the API',
          'Webhooks and charges are recorded in the relational ledger; a cache may hold idempotency keys',
          'Webhook storms double the load, and at 20 s one ledger node runs at half capacity for 10 s',
        ],
        drainDuration: 10,
        pattern: 'spike',
        requestTypes: { webhook: 0.65, charge: 0.35 },
        characteristics: { celebrityShare: 0.3, hotDataRatio: 0.8 },
        hints: [
          { id: 'front-door', after: 'always', text: 'The rate limiter is the front door for every request — webhooks and charges alike.' },
          { id: 'ledger-headroom', after: 'loss', text: 'The ledger is the bottleneck. Split it across two replicated, sharded nodes so a degraded one is headroom, not an outage.' },
          { id: 'ledger-home', after: 'violation', text: 'Webhooks and charges end in the relational ledger — never in a cache or a queue.' },
        ],
        failureScenarios: [
          {
            id: 'ledger-degraded',
            label: 'Ledger degraded',
            atSeconds: 20,
            target: { componentType: 'database' },
            type: 'capacity',
            durationSeconds: 10,
          },
        ],
      },
      scoringWeights: { durability: 40, availability: 30, latency: 20, cost: 10 },
    },
    allowedComponents: [
      'load-balancer',
      'api-gateway',
      'rate-limiter',
      'backend-service',
      'microservice',
      'worker-service',
      'message-queue',
      'kafka',
      'redis',
      'database',
    ],
  },
];

/**
 * What `buildChallengePreset(slug)` in src/game/challenge-presets.ts lays out
 * when the sandbox opens or the user clicks "Starter".
 */
export const STARTER_PRESETS: Record<string, { components: number; belts: number; labels: string[] }> = {
  'url-shortener': {
    components: 5,
    // Includes the Redis → SQL Database belt that carries cache misses.
    belts: 8,
    labels: ['Load Balancer', 'Microservice', 'Backend Service', 'Redis Cache', 'SQL Database'],
  },
  dropbox: {
    components: 7,
    // Includes the Worker Service → Object Storage belt that lands the async
    // upload path (flow-authoring §4).
    belts: 8,
    labels: ['Load Balancer', 'API Gateway', 'Backend Service', 'Worker Service', 'SQL Database', 'Object Storage', 'Message Queue'],
  },
  'instagram-feed': {
    components: 6,
    // Includes the CDN → service (edge-cache miss) and Redis → NoSQL
    // (cache miss) belts.
    belts: 8,
    labels: ['Load Balancer', 'CDN', 'Backend Service', 'Redis Cache', 'NoSQL Database', 'Object Storage'],
  },
  'rate-limiter': {
    components: 5,
    // Includes the Redis → SQL Database belt that carries cache misses.
    belts: 6,
    labels: ['Load Balancer', 'Rate Limiter', 'Backend Service', 'Redis Cache', 'SQL Database'],
  },
  'chat-messaging': {
    components: 6,
    // Includes the Redis → NoSQL (cache miss) and Worker → NoSQL (fan-out) belts.
    belts: 8,
    labels: ['Load Balancer', 'Backend Service', 'Redis Cache', 'NoSQL Database', 'Message Queue', 'Worker Service'],
  },
  'ticket-booking': {
    components: 4,
    // Includes the Redis → SQL Database belt that carries cache misses.
    belts: 5,
    labels: ['Load Balancer', 'Backend Service', 'Redis Cache', 'SQL Database'],
  },
  'search-autocomplete': {
    components: 6,
    // Includes the Redis → Search (cache miss) and Worker → Search (index) belts.
    belts: 8,
    labels: ['Load Balancer', 'Backend Service', 'Redis Cache', 'Search Service', 'Message Queue', 'Worker Service'],
  },
  'ride-dispatch': {
    components: 4,
    // Includes the Redis → NoSQL belt that carries nearby-driver cache misses.
    belts: 5,
    labels: ['Load Balancer', 'Backend Service', 'Redis Cache', 'NoSQL Database'],
  },
  'notification-fanout': {
    components: 7,
    // API → Kafka → Worker → Pub/Sub, plus the cached status path with its miss belt.
    belts: 8,
    labels: ['Load Balancer', 'Backend Service', 'Kafka', 'Worker Service', 'Pub/Sub', 'Redis Cache', 'NoSQL Database'],
  },
  'payment-webhook': {
    components: 7,
    // Limiter → API; settlement via queue and worker; charges direct and via the idempotency cache.
    belts: 9,
    labels: ['Load Balancer', 'Rate Limiter', 'Backend Service', 'Message Queue', 'Worker Service', 'Redis Cache', 'SQL Database'],
  },
};

export const TEST_USER = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: null as string | null,
};

export const TEST_PASSWORD = 'correct-horse-battery';
export const TEST_TOKEN = 'e2e-jwt-token';
