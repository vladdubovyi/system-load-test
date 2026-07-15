import { componentRegistry } from './component-registry';

export type ComponentRole = 'ingress' | 'compute' | 'storage' | 'messaging' | 'networking' | 'other';

const INGRESS_TYPES = new Set([
  'load-balancer',
  'api-gateway',
  'reverse-proxy',
  'cdn',
  'dns',
  'rate-limiter',
]);

const COMPUTE_TYPES = new Set([
  'shortener',
  'backend',
  'backend-service',
  'microservice',
  'worker-service',
  'serverless-function',
]);

const STORAGE_TYPES = new Set([
  'database',
  'redis',
  'nosql-database',
  'object-storage',
]);

const MESSAGING_TYPES = new Set(['message-queue', 'kafka', 'pub-sub']);

export function getComponentRole(type: string): ComponentRole {
  if (INGRESS_TYPES.has(type)) {
    return type === 'load-balancer' || type === 'api-gateway' || type === 'reverse-proxy'
      ? 'ingress'
      : 'networking';
  }
  if (COMPUTE_TYPES.has(type)) return 'compute';
  if (STORAGE_TYPES.has(type)) return 'storage';
  if (MESSAGING_TYPES.has(type)) return 'messaging';

  const category = componentRegistry.getComponent(type)?.category;
  switch (category) {
    case 'networking':
      return 'ingress';
    case 'compute':
      return 'compute';
    case 'storage':
      return 'storage';
    case 'messaging':
      return 'messaging';
    default:
      return 'other';
  }
}

export function isIngressType(type: string): boolean {
  return getComponentRole(type) === 'ingress';
}

export function isComputeType(type: string): boolean {
  return getComponentRole(type) === 'compute';
}

export function isStorageType(type: string): boolean {
  return getComponentRole(type) === 'storage';
}

export function isCacheType(type: string): boolean {
  return type === 'redis' || type === 'cdn';
}
