import { getCapabilities, hasCapability } from './capabilities';

/**
 * Thin role adapter over the capability model (see capabilities.ts), kept so
 * existing call sites (`isComputeType`, `isStorageType`, …) stay stable.
 * Note that `isStorageType` maps to the `durable-store` capability, so it
 * deliberately excludes redis and other caches — a cache is never an
 * acceptable durable store (docs/specs/flow-correctness.md §3).
 */
export type ComponentRole =
  | 'ingress'
  | 'compute'
  | 'storage'
  | 'cache'
  | 'messaging'
  | 'networking'
  | 'other';

export function getComponentRole(type: string): ComponentRole {
  const caps = getCapabilities(type);
  if (caps.has('ingress')) return 'ingress';
  if (caps.has('traffic-filter')) return 'networking';
  if (caps.has('compute')) return 'compute';
  if (caps.has('durable-store')) return 'storage';
  if (caps.has('queue')) return 'messaging';
  if (caps.has('cache')) return 'cache';
  return 'other';
}

export function isIngressType(type: string): boolean {
  return getComponentRole(type) === 'ingress';
}

export function isComputeType(type: string): boolean {
  return getComponentRole(type) === 'compute';
}

/** Durable stores only — caches (redis, cdn) are intentionally excluded. */
export function isStorageType(type: string): boolean {
  return getComponentRole(type) === 'storage';
}

export function isCacheType(type: string): boolean {
  return hasCapability(type, 'cache');
}

/** Messaging nodes: message queue, kafka, pub/sub. */
export function isQueueType(type: string): boolean {
  return hasCapability(type, 'queue');
}
