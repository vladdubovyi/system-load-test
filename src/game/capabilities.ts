import { componentRegistry } from './component-registry';

/**
 * Semantic capabilities a component type offers. Flow specs select on these
 * instead of raw component types, so "a durable store" can be satisfied by a
 * SQL database, a NoSQL database or object storage — but never by a cache.
 */
export type Capability =
  | 'ingress' // accepts traffic from the outside (LB, API gateway, reverse proxy)
  | 'traffic-filter' // shapes or filters traffic in front of compute (rate limiter, DNS, CDN)
  | 'compute' // application logic
  | 'durable-store' // survives restarts: database, nosql, object storage
  | 'cache' // fast but volatile: redis, cdn
  | 'queue'; // messaging: message queue, kafka, pub/sub

const CAPABILITY_VALUES: readonly Capability[] = [
  'ingress',
  'traffic-filter',
  'compute',
  'durable-store',
  'cache',
  'queue',
];

export function isCapability(value: string): value is Capability {
  return (CAPABILITY_VALUES as readonly string[]).includes(value);
}

/**
 * Built-in capabilities per component type, used when the backend definition
 * does not declare its own. Redis is deliberately `cache` only — it is never
 * an acceptable durable store.
 */
const FALLBACK_CAPABILITIES: Record<string, readonly Capability[]> = {
  'load-balancer': ['ingress'],
  'api-gateway': ['ingress'],
  'reverse-proxy': ['ingress'],
  'rate-limiter': ['traffic-filter'],
  dns: ['traffic-filter'],
  cdn: ['traffic-filter', 'cache'],
  shortener: ['compute'],
  backend: ['compute'],
  'backend-service': ['compute'],
  microservice: ['compute'],
  'worker-service': ['compute'],
  'serverless-function': ['compute'],
  database: ['durable-store'],
  'nosql-database': ['durable-store'],
  'object-storage': ['durable-store'],
  redis: ['cache'],
  'message-queue': ['queue'],
  kafka: ['queue'],
  'pub-sub': ['queue'],
};

/** Last-resort mapping for registry types unknown to the fallback table. */
const CATEGORY_CAPABILITIES: Record<string, readonly Capability[]> = {
  networking: ['ingress'],
  compute: ['compute'],
  storage: ['durable-store'],
  messaging: ['queue'],
  infrastructure: [],
};

/**
 * Resolve the capability set for a component type. Precedence:
 * 1. `capabilities` declared on the backend component definition,
 * 2. the built-in per-type fallback table,
 * 3. the component's registry category.
 */
export function getCapabilities(type: string): ReadonlySet<Capability> {
  const def = componentRegistry.getComponent(type);
  const declared = def?.capabilities?.filter(isCapability) ?? [];
  if (declared.length > 0) return new Set(declared);

  const fallback = FALLBACK_CAPABILITIES[type];
  if (fallback) return new Set(fallback);

  return new Set(CATEGORY_CAPABILITIES[def?.category ?? ''] ?? []);
}

export function hasCapability(type: string, capability: Capability): boolean {
  return getCapabilities(type).has(capability);
}
