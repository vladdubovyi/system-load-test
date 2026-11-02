import { describe, expect, it, vi } from 'vitest';
import {
  getActiveScenario,
  getActiveScenarioDocument,
  setActiveScenarioFromChallenge,
  setActiveScenarioOverride,
} from '../scenario-runtime';
import { DROPBOX_FLOWS, RATE_LIMITER_FLOWS } from '../flow-presets';
import { URL_SHORTENER_FLOWS, URL_SHORTENER_OBJECTIVES } from '../flow-presets';
import type { Challenge } from '../scenario-types';
import type { FlowSpec } from '../flow-types';

function makeChallenge(overrides: {
  slug?: string;
  flows?: FlowSpec[];
  requestTypes?: Record<string, number>;
}): Challenge {
  return {
    id: 'c1',
    name: 'Test Challenge',
    slug: overrides.slug ?? 'custom-challenge',
    description: 'desc',
    difficulty: 'medium',
    createdAt: new Date().toISOString(),
    allowedComponents: [],
    scenario: {
      id: 's1',
      title: 'Test',
      description: 'desc',
      requirements: [],
      duration: 30,
      drainDuration: 5,
      traffic: {
        baseRps: 100,
        pattern: 'constant',
        requestTypes: overrides.requestTypes,
      },
      allowedComponents: [],
      scoringPriorities: {},
      flows: overrides.flows,
    },
  };
}

describe('scenario runtime plumbing', () => {
  it('defaults to the URL Shortener preset flows and objectives', () => {
    setActiveScenarioFromChallenge(null);
    const scenario = getActiveScenario();
    expect(scenario.flows).toEqual(URL_SHORTENER_FLOWS);
    expect(scenario.objectives).toEqual(URL_SHORTENER_OBJECTIVES);
    expect(scenario.requestTypes.read).toBeCloseTo(scenario.readRatio);
    expect(scenario.requestTypes.create).toBeCloseTo(1 - scenario.readRatio);
  });

  it('carries challenge-defined flows through verbatim', () => {
    const flows: FlowSpec[] = [
      {
        kind: 'upload',
        steps: [{ id: 'store', require: { capability: 'durable-store' }, terminal: true }],
      },
    ];
    setActiveScenarioFromChallenge(makeChallenge({ flows }));
    expect(getActiveScenario().flows).toEqual(flows);
  });

  it('falls back to preset flows by slug when the challenge has none', () => {
    setActiveScenarioFromChallenge(makeChallenge({ slug: 'url-shortener' }));
    const scenario = getActiveScenario();
    expect(scenario.flows).toEqual(URL_SHORTENER_FLOWS);
    expect(scenario.objectives).toEqual(URL_SHORTENER_OBJECTIVES);
  });

  it('leaves flows undefined for unknown slugs without flows (legacy routing)', () => {
    setActiveScenarioFromChallenge(makeChallenge({ slug: 'mystery' }));
    expect(getActiveScenario().flows).toBeUndefined();
  });

  it('carries requestTypes through and keeps readRatio in sync', () => {
    setActiveScenarioFromChallenge(
      makeChallenge({ requestTypes: { read: 0.6, create: 0.3, upload: 0.1 } })
    );
    const scenario = getActiveScenario();
    expect(scenario.requestTypes).toEqual({ read: 0.6, create: 0.3, upload: 0.1 });
    expect(scenario.readRatio).toBeCloseTo(0.6);
  });

  it('derives requestTypes from the slug fallback readRatio when absent', () => {
    setActiveScenarioFromChallenge(makeChallenge({ slug: 'url-shortener' }));
    const scenario = getActiveScenario();
    expect(scenario.requestTypes.read).toBeCloseTo(0.72);
    expect(scenario.requestTypes.create).toBeCloseTo(0.28);
  });
});

describe('traffic overrides (Traffic panel)', () => {
  it('layers a custom traffic profile over the active challenge', async () => {
    const { setActiveTrafficOverride } = await import('../scenario-runtime');
    setActiveScenarioFromChallenge(makeChallenge({ requestTypes: { read: 0.6, create: 0.4 } }));
    expect(getActiveScenario().baseRps).toBe(100);

    setActiveTrafficOverride({
      baseRps: 1000,
      pattern: 'spike',
      spikeMultiplier: 2,
      spikeChance: 0,
      requestTypes: { read: 0.9, create: 0.1 },
    });

    const scenario = getActiveScenario();
    expect(scenario.baseRps).toBe(1000);
    expect(scenario.spikeMultiplier).toBe(2);
    expect(scenario.spikeChance).toBe(0);
    expect(scenario.readRatio).toBeCloseTo(0.9);
    expect(scenario.requestTypes).toEqual({ read: 0.9, create: 0.1 });
    // Non-traffic fields are untouched.
    expect(scenario.duration).toBe(30);
    expect(scenario.title).toBe('Test Challenge');
  });

  it('clearing the override restores the challenge traffic', async () => {
    const { setActiveTrafficOverride } = await import('../scenario-runtime');
    setActiveScenarioFromChallenge(makeChallenge({}));
    setActiveTrafficOverride({ baseRps: 999, pattern: 'constant' });
    expect(getActiveScenario().baseRps).toBe(999);

    setActiveTrafficOverride(null);
    expect(getActiveScenario().baseRps).toBe(100);
  });

  it('switching challenge drops any previous override', async () => {
    const { setActiveTrafficOverride } = await import('../scenario-runtime');
    setActiveScenarioFromChallenge(makeChallenge({}));
    setActiveTrafficOverride({ baseRps: 999, pattern: 'constant' });

    setActiveScenarioFromChallenge(makeChallenge({ slug: 'other' }));
    expect(getActiveScenario().baseRps).toBe(100);
  });
});

describe('scenario override (authoring)', () => {
  const create: FlowSpec = {
    kind: 'create',
    steps: [{ id: 'persist', require: { capability: 'durable-store' }, terminal: true }],
  };

  it('layers an applied document over the challenge and clears on challenge change', () => {
    setActiveScenarioFromChallenge(makeChallenge({ slug: 'url-shortener' }));
    setActiveScenarioOverride({
      requestTypes: { create: 1 },
      flows: [create],
      tags: [{ id: 'w', label: 'Writer' }],
    });

    const active = getActiveScenario();
    expect(active.flows).toEqual([create]);
    expect(active.requestTypes).toEqual({ create: 1 });
    expect(active.tags).toEqual([{ id: 'w', label: 'Writer' }]);
    // Objectives were not overridden, so the challenge's (preset) ones remain.
    expect(active.objectives).toEqual(URL_SHORTENER_OBJECTIVES);

    setActiveScenarioFromChallenge(makeChallenge({ slug: 'url-shortener' }));
    expect(getActiveScenario().flows).toEqual(URL_SHORTENER_FLOWS);
    expect(getActiveScenario().tags).toBeUndefined();
  });

  it('exposes the editable document with preset fallbacks resolved', () => {
    setActiveScenarioFromChallenge(makeChallenge({ slug: 'url-shortener', requestTypes: { read: 0.6, create: 0.4 } }));
    const doc = getActiveScenarioDocument();
    expect(doc.flows).toEqual(URL_SHORTENER_FLOWS);
    expect(doc.objectives).toEqual(URL_SHORTENER_OBJECTIVES);
    expect(doc.requestTypes).toEqual({ read: 0.6, create: 0.4 });
    expect(doc.tags).toEqual([]);
    // A copy, not the live preset.
    (doc.flows as FlowSpec[])[0].kind = 'mutated';
    expect(URL_SHORTENER_FLOWS[0].kind).toBe('create');
  });

  it('falls back to the preset when a challenge ships invalid flows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setActiveScenarioFromChallenge(
      makeChallenge({ slug: 'url-shortener', flows: [{ kind: 'create', steps: [] }] })
    );
    expect(getActiveScenario().flows).toEqual(URL_SHORTENER_FLOWS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('every seeded challenge has preset flows', () => {
    for (const [slug, flows] of [
      ['dropbox', DROPBOX_FLOWS],
      ['rate-limiter', RATE_LIMITER_FLOWS],
    ] as const) {
      setActiveScenarioFromChallenge(makeChallenge({ slug }));
      expect(getActiveScenario().flows, slug).toEqual(flows);
      expect(getActiveScenario().objectives?.maxViolationRate, slug).toBe(0);
    }
  });
});
