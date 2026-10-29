import { describe, expect, it } from 'vitest';
import { getActiveScenario, setActiveScenarioFromChallenge } from '../scenario-runtime';
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
