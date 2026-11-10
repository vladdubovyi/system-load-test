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
};

export const TEST_USER = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: null as string | null,
};

export const TEST_PASSWORD = 'correct-horse-battery';
export const TEST_TOKEN = 'e2e-jwt-token';
