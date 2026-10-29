import { beforeEach, describe, expect, it } from 'vitest';
import { componentRegistry } from '../component-registry';
import { allSteps, selectorMatches, validateFlowSpec, validateFlows } from '../flows';
import { URL_SHORTENER_FLOWS, URL_SHORTENER_OBJECTIVES } from '../flow-presets';
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
    expect(URL_SHORTENER_OBJECTIVES.minCompletionRate).toEqual({ create: 0.95, read: 0.95 });
    expect(URL_SHORTENER_OBJECTIVES.maxViolationRate).toBe(0);
    expect(URL_SHORTENER_OBJECTIVES.noComponentFailures).toBe(true);
  });
});
