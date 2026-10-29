import { beforeAll, describe, expect, it, vi } from 'vitest';

// auth-store reads localStorage at module load; stub it before importing.
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

function makeApiItem(scenarioConfig: Record<string, unknown>) {
  return {
    id: 'ch-1',
    name: 'URL Shortener',
    slug: 'url-shortener',
    description: 'desc',
    difficulty: 'medium',
    createdAt: '2026-01-01T00:00:00Z',
    allowedComponents: ['load-balancer', 'database'],
    scenario: {
      id: 'sc-1',
      durationSeconds: 45,
      baseRps: 200,
      spikeMultiplier: 3.2,
      spikeChance: 0.08,
      scenarioConfig,
      scoringWeights: { availability: 40 },
    },
  };
}

describe('mapChallengeFromApi', () => {
  it('maps flows and objectives out of scenarioConfig', async () => {
    const { mapChallengeFromApi } = await import('../client');
    const flows = [
      {
        kind: 'create',
        steps: [{ id: 'persist', require: { capability: 'durable-store' }, terminal: true }],
      },
    ];
    const objectives = { minCompletionRate: { create: 0.95 }, maxViolationRate: 0 };

    const challenge = mapChallengeFromApi(
      makeApiItem({
        drainDuration: 12,
        requirements: ['r1'],
        pattern: 'spike',
        requestTypes: { read: 0.7, create: 0.3 },
        characteristics: { hotDataRatio: 0.9 },
        flows,
        objectives,
      })
    );

    expect(challenge.scenario.flows).toEqual(flows);
    expect(challenge.scenario.objectives).toEqual(objectives);
    expect(challenge.scenario.drainDuration).toBe(12);
    expect(challenge.scenario.traffic.requestTypes).toEqual({ read: 0.7, create: 0.3 });
    expect(challenge.scenario.scoringPriorities).toEqual({ availability: 40 });
  });

  it('applies defaults when scenarioConfig omits the new fields', async () => {
    const { mapChallengeFromApi } = await import('../client');
    const challenge = mapChallengeFromApi(makeApiItem({}));

    expect(challenge.scenario.flows).toBeUndefined();
    expect(challenge.scenario.objectives).toBeUndefined();
    expect(challenge.scenario.drainDuration).toBe(10);
    expect(challenge.scenario.traffic.pattern).toBe('constant');
    expect(challenge.scenario.requirements).toEqual([]);
  });

  it('survives a missing scenarioConfig entirely', async () => {
    const { mapChallengeFromApi } = await import('../client');
    const item = makeApiItem({});
    delete (item.scenario as any).scenarioConfig;
    const challenge = mapChallengeFromApi(item);
    expect(challenge.scenario.flows).toBeUndefined();
    expect(challenge.scenario.duration).toBe(45);
  });
});
