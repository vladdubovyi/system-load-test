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

export const URL_SHORTENER_OBJECTIVES: Objectives = {
  minCompletionRate: { create: 0.95, read: 0.95 },
  maxViolationRate: 0,
  noComponentFailures: true,
};

const FLOWS_BY_SLUG: Record<string, FlowSpec[]> = {
  'url-shortener': URL_SHORTENER_FLOWS,
};

const OBJECTIVES_BY_SLUG: Record<string, Objectives> = {
  'url-shortener': URL_SHORTENER_OBJECTIVES,
};

export function getPresetFlows(slug: string): FlowSpec[] | undefined {
  return FLOWS_BY_SLUG[slug];
}

export function getPresetObjectives(slug: string): Objectives | undefined {
  return OBJECTIVES_BY_SLUG[slug];
}
