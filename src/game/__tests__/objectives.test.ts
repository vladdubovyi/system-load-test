import { describe, expect, it } from 'vitest';
import { EMPTY_COUNTS, allObjectivesMet, evaluateObjectives, type RunCounts } from '../objectives';
import type { Objectives } from '../flow-types';

function counts(overrides: Partial<RunCounts>): RunCounts {
  return { ...EMPTY_COUNTS, ...overrides };
}

describe('evaluateObjectives', () => {
  it('judges a scenario without objectives on component failures alone', () => {
    const results = evaluateObjectives(undefined, counts({ totalSpawned: 100 }));

    expect(results.map((r) => r.id)).toEqual(['failures']);
    expect(results[0].met).toBe(true);
    expect(allObjectivesMet(results)).toBe(true);
  });

  it('fails the survival objective and names the broken components', () => {
    const results = evaluateObjectives(
      undefined,
      counts({ totalSpawned: 100, brokenServices: ['SQL Database'] })
    );

    expect(results[0].met).toBe(false);
    expect(results[0].cause).toContain('SQL Database');
    expect(allObjectivesMet(results)).toBe(false);
  });

  it('checks each request kind against its own completion floor', () => {
    const objectives: Objectives = { minCompletionRate: { create: 0.9, read: 0.5 } };
    const results = evaluateObjectives(
      objectives,
      counts({
        totalSpawned: 200,
        spawnedByKind: { create: 100, read: 100 },
        completedByKind: { create: 80, read: 90 },
      })
    );

    const create = results.find((r) => r.id === 'completion:create')!;
    const read = results.find((r) => r.id === 'completion:read')!;

    expect(create.met).toBe(false);
    expect(create.actual).toContain('80.0%');
    expect(create.target).toContain('90.0%');
    expect(read.met).toBe(true);
    expect(read.cause).toBeUndefined();
  });

  it('treats a kind that never spawned as met rather than as a 0% failure', () => {
    const results = evaluateObjectives(
      { minCompletionRate: { ghost: 0.9 } },
      counts({ totalSpawned: 10 })
    );

    const ghost = results.find((r) => r.id === 'completion:ghost')!;
    expect(ghost.met).toBe(true);
    expect(ghost.actual).toBe('no requests of this kind');
  });

  it('defaults the violation ceiling to zero when objectives are declared', () => {
    const results = evaluateObjectives(
      { minCompletionRate: {} },
      counts({ totalSpawned: 100, totalViolated: 1 })
    );

    const violations = results.find((r) => r.id === 'violations')!;
    expect(violations.met).toBe(false);
    expect(violations.target).toBe('≤ 0.0%');
  });

  it('honours an explicit violation allowance', () => {
    const results = evaluateObjectives(
      { maxViolationRate: 0.05 },
      counts({ totalSpawned: 100, totalViolated: 4 })
    );

    expect(results.find((r) => r.id === 'violations')!.met).toBe(true);
  });

  it('blames the dominant flow step when a completion objective fails', () => {
    const results = evaluateObjectives(
      { minCompletionRate: { create: 0.9 } },
      counts({
        totalSpawned: 100,
        totalViolated: 60,
        spawnedByKind: { create: 100 },
        completedByKind: { create: 10 },
        violationsByStep: { 'create:warm': 5, 'create:persist': 55 },
      })
    );

    const create = results.find((r) => r.id === 'completion:create')!;
    expect(create.cause).toContain('persist');
    expect(create.cause).not.toContain('warm');

    // The violation objective reports the same dominant step across kinds.
    expect(results.find((r) => r.id === 'violations')!.cause).toContain('persist');
  });

  it('falls back to the dominant drop reason when nothing was violated', () => {
    const results = evaluateObjectives(
      { minCompletionRate: { read: 0.9 } },
      counts({
        totalSpawned: 100,
        spawnedByKind: { read: 100 },
        completedByKind: { read: 40 },
        dropReasons: { 'read:SQL Database: queue full': 50, 'read:link is congested': 10 },
      })
    );

    const read = results.find((r) => r.id === 'completion:read')!;
    expect(read.cause).toContain('SQL Database: queue full');
    expect(read.cause).toContain('50');
  });

  it('omits the survival objective when a scenario opts out', () => {
    const results = evaluateObjectives(
      { noComponentFailures: false },
      counts({ totalSpawned: 10, brokenServices: ['Redis Cache'] })
    );

    expect(results.map((r) => r.id)).toEqual(['violations']);
    expect(allObjectivesMet(results)).toBe(true);
  });
});
