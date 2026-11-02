import { beforeEach, describe, expect, it } from 'vitest';
import { componentRegistry } from '../component-registry';
import {
  allSteps,
  selectorMatches,
  stripNulls,
  validateFlowSpec,
  validateFlows,
  validateScenarioDocument,
} from '../flows';
import {
  INSTAGRAM_FEED_FLOWS,
  URL_SHORTENER_FLOWS,
  URL_SHORTENER_OBJECTIVES,
  getPresetObjectives,
} from '../flow-presets';
import type { FlowSpec } from '../flow-types';

describe('selectorMatches', () => {
  beforeEach(async () => {
    await componentRegistry.initialize([]);
  });

  it('matches on capability', () => {
    expect(selectorMatches({ capability: 'cache' }, 'redis')).toBe(true);
    expect(selectorMatches({ capability: 'durable-store' }, 'redis')).toBe(false);
    expect(selectorMatches({ capability: 'durable-store' }, 'database')).toBe(true);
  });

  it('matches on exact component type', () => {
    expect(selectorMatches({ componentType: 'shortener' }, 'shortener')).toBe(true);
    expect(selectorMatches({ componentType: 'shortener' }, 'backend')).toBe(false);
  });

  it('requires all given criteria to match', () => {
    expect(selectorMatches({ capability: 'compute', componentType: 'shortener' }, 'shortener')).toBe(true);
    expect(selectorMatches({ capability: 'cache', componentType: 'shortener' }, 'shortener')).toBe(false);
  });

  it('never matches an empty selector', () => {
    expect(selectorMatches({}, 'database')).toBe(false);
  });

  it('never matches tag selectors until tags ship (Phase 5)', () => {
    expect(selectorMatches({ tag: 'write-service' }, 'shortener')).toBe(false);
    expect(selectorMatches({ capability: 'compute', tag: 'write-service' }, 'shortener')).toBe(false);
  });
});

describe('validateFlowSpec', () => {
  const okFlow: FlowSpec = {
    kind: 'create',
    steps: [
      { id: 'in', require: { capability: 'ingress' } },
      { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
    ],
  };

  it('accepts a minimal valid flow', () => {
    expect(validateFlowSpec(okFlow)).toEqual([]);
  });

  it('rejects a flow with no steps', () => {
    expect(validateFlowSpec({ kind: 'x', steps: [] })).toHaveLength(1);
  });

  it('rejects duplicate step ids, including inside branches', () => {
    const spec: FlowSpec = {
      kind: 'read',
      steps: [
        { id: 'a', require: { capability: 'compute' } },
        {
          id: 'b',
          require: { capability: 'cache' },
          branch: {
            probability: 0.9,
            onHit: 'complete',
            onMiss: [{ id: 'a', require: { capability: 'durable-store' }, terminal: true }],
          },
        },
      ],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('duplicate step id "a"');
  });

  it('rejects empty selectors', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [{ id: 'a', require: {}, terminal: true }],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('empty selector');
  });

  it('rejects a step that is both terminal and optional', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [{ id: 'a', require: { capability: 'durable-store' }, terminal: true, optional: true }],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('terminal and optional');
  });

  it('rejects out-of-range branch probabilities', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [
        {
          id: 'a',
          require: { capability: 'cache' },
          branch: { probability: 1.2, onHit: 'complete', onMiss: [] },
        },
      ],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('probability 1.2');
  });

  it('rejects returnTo pointing at an unknown step', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [{ id: 'a', require: { capability: 'compute' }, terminal: true, returnTo: 'nope' }],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('unknown step "nope"');
  });

  it('rejects flows that can never complete', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [{ id: 'a', require: { capability: 'compute' } }],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('can never complete');
  });

  it('accepts completion via a branch onHit', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [
        {
          id: 'a',
          require: { capability: 'cache' },
          branch: {
            probability: 'cacheHitRatio',
            onHit: 'complete',
            onMiss: [{ id: 'b', require: { capability: 'durable-store' }, terminal: true }],
          },
        },
      ],
    };
    expect(validateFlowSpec(spec)).toEqual([]);
  });

  it('requires steps after a terminal step to be optional', () => {
    const spec: FlowSpec = {
      kind: 'x',
      steps: [
        { id: 'a', require: { capability: 'durable-store' }, terminal: true },
        { id: 'b', require: { capability: 'cache' } },
      ],
    };
    expect(validateFlowSpec(spec).join(' ')).toContain('follows terminal step "a"');
  });
});

describe('validateFlows', () => {
  it('rejects duplicate request kinds', () => {
    const spec: FlowSpec = {
      kind: 'read',
      steps: [{ id: 'a', require: { capability: 'compute' }, terminal: true }],
    };
    const problems = validateFlows([spec, { ...spec, steps: [{ ...spec.steps[0], id: 'b' }] }]);
    expect(problems.join(' ')).toContain('Multiple flows declare the request kind "read"');
  });
});

describe('URL Shortener preset', () => {
  it('is structurally valid', () => {
    expect(validateFlows(URL_SHORTENER_FLOWS)).toEqual([]);
  });

  it('covers create and read kinds', () => {
    expect(URL_SHORTENER_FLOWS.map((f) => f.kind).sort()).toEqual(['create', 'read']);
  });

  it('requires creates to end in a durable store, with cache only optional', () => {
    const create = URL_SHORTENER_FLOWS.find((f) => f.kind === 'create')!;
    const terminals = allSteps(create).filter((s) => s.terminal);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].require.capability).toBe('durable-store');
    const cacheSteps = allSteps(create).filter((s) => s.require.capability === 'cache');
    expect(cacheSteps.every((s) => s.optional)).toBe(true);
  });

  it('lets reads complete from cache only via a hit, with every miss ending in a durable store', () => {
    const read = URL_SHORTENER_FLOWS.find((f) => f.kind === 'read')!;
    const cacheStep = read.steps.find((s) => s.require.capability === 'cache')!;
    expect(cacheStep.optional).toBe(true);
    expect(cacheStep.branch?.onHit).toBe('complete');
    const missTerminals = cacheStep.branch!.onMiss.filter((s) => s.terminal);
    expect(missTerminals.map((s) => s.require.capability)).toEqual(['durable-store']);
    // Cache-less designs still have a durable path.
    expect(read.steps.some((s) => s.terminal && s.require.capability === 'durable-store')).toBe(true);
  });

  it('ships objectives that gate on completion and violations', () => {
    // Completion floors are a minimum bar the shipped starter clears while
    // shedding spike traffic; correctness is the strict one.
    expect(URL_SHORTENER_OBJECTIVES.minCompletionRate).toEqual({ create: 0.6, read: 0.6 });
    expect(URL_SHORTENER_OBJECTIVES.maxViolationRate).toBe(0);
    expect(URL_SHORTENER_OBJECTIVES.noComponentFailures).toBe(true);
  });
});

describe('Instagram feed preset', () => {
  it('is structurally valid', () => {
    expect(validateFlows(INSTAGRAM_FEED_FLOWS)).toEqual([]);
  });

  it('holds edge-served reads to a higher floor than contended writes', () => {
    const objectives = getPresetObjectives('instagram-feed')!;
    expect(objectives.minCompletionRate!.feedLoad).toBeGreaterThan(
      objectives.minCompletionRate!.post
    );
    expect(objectives.maxViolationRate).toBe(0);
  });

  it('covers the challenge request kinds', () => {
    expect(INSTAGRAM_FEED_FLOWS.map((f) => f.kind).sort()).toEqual(['feedLoad', 'like', 'post']);
  });

  it('serves feed loads from the CDN edge, with misses continuing to the service', () => {
    const feed = INSTAGRAM_FEED_FLOWS.find((f) => f.kind === 'feedLoad')!;
    const edge = feed.steps.find((s) => s.id === 'edge')!;
    expect(edge.require.componentType).toBe('cdn');
    expect(edge.optional).toBe(true);
    expect(edge.branch?.onHit).toBe('complete');
    // An edge miss injects nothing: the flow falls through to the service.
    expect(edge.branch?.onMiss).toEqual([]);
  });

  it('requires writes to end in a durable store with no cache shortcut', () => {
    for (const kind of ['post', 'like']) {
      const spec = INSTAGRAM_FEED_FLOWS.find((f) => f.kind === kind)!;
      const terminals = allSteps(spec).filter((s) => s.terminal);
      expect(terminals).toHaveLength(1);
      expect(terminals[0].require.capability).toBe('durable-store');
      expect(allSteps(spec).some((s) => s.require.capability === 'cache')).toBe(false);
    }
  });
});

describe('selectorMatches with tags', () => {
  beforeEach(async () => {
    await componentRegistry.initialize([]);
  });

  it('matches a tag criterion only on components carrying the tag', () => {
    expect(selectorMatches({ tag: 'write-service' }, { type: 'backend', tags: ['write-service'] })).toBe(true);
    expect(selectorMatches({ tag: 'write-service' }, { type: 'backend', tags: ['read-service'] })).toBe(false);
    expect(selectorMatches({ tag: 'write-service' }, { type: 'backend' })).toBe(false);
    // A bare type string carries no tags.
    expect(selectorMatches({ tag: 'write-service' }, 'backend')).toBe(false);
  });

  it('ANDs the tag with the other criteria', () => {
    const tagged = { type: 'redis', tags: ['primary'] };
    expect(selectorMatches({ tag: 'primary', capability: 'cache' }, tagged)).toBe(true);
    expect(selectorMatches({ tag: 'primary', capability: 'durable-store' }, tagged)).toBe(false);
  });
});

describe('stripNulls', () => {
  it('removes null members recursively but keeps falsy values and arrays', () => {
    const input = {
      kind: 'create',
      steps: [
        { id: 'a', require: { capability: 'ingress', componentType: null, tag: null }, optional: null, terminal: false },
        { id: 'b', require: { capability: 'compute' }, branch: null, returnTo: null },
      ],
      weight: 0,
    };
    expect(stripNulls(input)).toEqual({
      kind: 'create',
      steps: [
        { id: 'a', require: { capability: 'ingress' }, terminal: false },
        { id: 'b', require: { capability: 'compute' } },
      ],
      weight: 0,
    });
  });

  it('makes a System.Text.Json-style selector matchable again', async () => {
    await componentRegistry.initialize([]);
    const raw = { capability: 'compute', componentType: null, tag: null } as unknown as { capability: 'compute' };
    expect(selectorMatches(raw, 'backend')).toBe(false);
    expect(selectorMatches(stripNulls(raw), 'backend')).toBe(true);
  });
});

describe('validateScenarioDocument', () => {
  const create: FlowSpec = {
    kind: 'create',
    steps: [{ id: 'persist', require: { capability: 'durable-store' }, terminal: true }],
  };

  it('accepts a consistent document', () => {
    expect(
      validateScenarioDocument({
        requestTypes: { create: 1 },
        flows: [create],
        objectives: { minCompletionRate: { create: 0.5 }, maxViolationRate: 0 },
        tags: [{ id: 'w', label: 'Writer' }],
      })
    ).toEqual([]);
  });

  it('reports traffic kinds that have no flow', () => {
    const problems = validateScenarioDocument({ requestTypes: { create: 0.5, analytics: 0.5 }, flows: [create] });
    expect(problems).toEqual([expect.stringContaining('"analytics" has no flow')]);
  });

  it('reports objectives for kinds that do not exist', () => {
    const problems = validateScenarioDocument({
      requestTypes: { create: 1 },
      flows: [create],
      objectives: { minCompletionRate: { ghost: 0.5 } },
    });
    expect(problems).toEqual([expect.stringContaining('"ghost"')]);
  });

  it('reports tag selectors that reference undeclared tags and unknown capabilities', () => {
    const problems = validateScenarioDocument({
      requestTypes: { create: 1 },
      flows: [
        {
          kind: 'create',
          steps: [
            { id: 's', require: { tag: 'write-service' } },
            { id: 'p', require: { capability: 'blob' as never }, terminal: true },
          ],
        },
      ],
      tags: [],
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('selects tag "write-service"'),
        expect.stringContaining('unknown capability "blob"'),
      ])
    );
  });

  it('rejects malformed tags and out-of-range rates', () => {
    const problems = validateScenarioDocument({
      flows: [create],
      objectives: { maxViolationRate: 1.5, minCompletionRate: { create: -1 } },
      tags: [{ id: '', label: 'x' } as never, { id: 'a', label: 'A' }, { id: 'a', label: 'A again' }],
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('maxViolationRate'),
        expect.stringContaining('Completion floor for "create"'),
        expect.stringContaining('Every tag needs a string "id"'),
        expect.stringContaining('Duplicate tag id "a"'),
      ])
    );
  });

  it('still surfaces per-flow structural problems', () => {
    const problems = validateScenarioDocument({ flows: [{ kind: 'create', steps: [] }] });
    expect(problems.some((p) => p.includes('has no steps'))).toBe(true);
  });
});
