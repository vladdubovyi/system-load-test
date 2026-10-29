import { beforeEach, describe, expect, it } from 'vitest';
import { getCapabilities, hasCapability, isCapability } from '../capabilities';
import { componentRegistry } from '../component-registry';
import type { ComponentDefinition } from '../scenario-types';

function makeDef(overrides: Partial<ComponentDefinition>): ComponentDefinition {
  return {
    id: overrides.componentType ?? 'x',
    componentType: 'x',
    label: 'X',
    category: 'infrastructure',
    defaultCapacity: 100,
    defaultQueueLimit: 50,
    monthlyCost: 10,
    emoji: '📦',
    width: 140,
    height: 72,
    description: '',
    enabled: true,
    ...overrides,
  };
}

describe('capabilities', () => {
  beforeEach(async () => {
    // Reset the singleton registry to an empty state so the built-in
    // fallback table is exercised.
    await componentRegistry.initialize([]);
  });

  it('treats redis as a cache, never a durable store', () => {
    expect(hasCapability('redis', 'cache')).toBe(true);
    expect(hasCapability('redis', 'durable-store')).toBe(false);
  });

  it('treats databases and object storage as durable stores', () => {
    for (const type of ['database', 'nosql-database', 'object-storage']) {
      expect(getCapabilities(type).has('durable-store')).toBe(true);
      expect(getCapabilities(type).has('cache')).toBe(false);
    }
  });

  it('gives the CDN both traffic-filter and cache', () => {
    const caps = getCapabilities('cdn');
    expect(caps.has('traffic-filter')).toBe(true);
    expect(caps.has('cache')).toBe(true);
    expect(caps.has('ingress')).toBe(false);
  });

  it('classifies ingress, compute and messaging types', () => {
    expect(hasCapability('load-balancer', 'ingress')).toBe(true);
    expect(hasCapability('microservice', 'compute')).toBe(true);
    expect(hasCapability('shortener', 'compute')).toBe(true);
    expect(hasCapability('kafka', 'queue')).toBe(true);
  });

  it('prefers capabilities declared on the registry definition', async () => {
    await componentRegistry.initialize([
      makeDef({
        componentType: 'tiered-store',
        category: 'compute',
        capabilities: ['durable-store', 'cache'],
      }),
    ]);
    const caps = getCapabilities('tiered-store');
    expect(caps.has('durable-store')).toBe(true);
    expect(caps.has('cache')).toBe(true);
    expect(caps.has('compute')).toBe(false);
  });

  it('ignores unknown capability strings from the backend', async () => {
    await componentRegistry.initialize([
      makeDef({
        componentType: 'weird',
        category: 'storage',
        capabilities: ['quantum-link'],
      }),
    ]);
    // All declared values are invalid → falls through to the category.
    expect(getCapabilities('weird').has('durable-store')).toBe(true);
  });

  it('falls back to the built-in table before the registry category', async () => {
    // Backend may categorize redis as generic "storage"; the per-type table must win.
    await componentRegistry.initialize([
      makeDef({ componentType: 'redis', category: 'storage' }),
    ]);
    expect(hasCapability('redis', 'durable-store')).toBe(false);
    expect(hasCapability('redis', 'cache')).toBe(true);
  });

  it('uses the registry category for unknown types', async () => {
    await componentRegistry.initialize([
      makeDef({ componentType: 'graph-db', category: 'storage' }),
    ]);
    expect(hasCapability('graph-db', 'durable-store')).toBe(true);
  });

  it('returns an empty set for fully unknown types', () => {
    expect(getCapabilities('does-not-exist').size).toBe(0);
  });

  it('validates capability strings', () => {
    expect(isCapability('durable-store')).toBe(true);
    expect(isCapability('storage')).toBe(false);
  });
});
