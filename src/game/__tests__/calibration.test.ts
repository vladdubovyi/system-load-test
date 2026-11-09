import { beforeAll, describe, expect, it } from 'vitest';
import { SEEDED_SLUGS, activateScenario, installCatalog, runSeeded } from './harness';
import { buildChallengePreset, buildChallengeReference } from '../challenge-presets';
import { buildReferenceComponentConfigs } from '../component-config';
import { allObjectivesMet, evaluateObjectives, type RunCounts } from '../objectives';

/**
 * Scoring calibration (docs/specs/interview-platform.md §8). For every
 * seeded challenge, across several seeds:
 *
 * - the **starter** is a correct design (no flow violations, no failed
 *   components) that does **not** meet its completion floors — it is where
 *   the exercise begins, not a passing answer;
 * - the **reference** solution meets every objective.
 *
 * If a change to the engine, a scenario or a starter moves either side of
 * that line, this is the test that says so. Re-measure before adjusting
 * floors: `runSeeded` prints nothing, but `completionRates` is right there.
 */

const SEEDS = [1, 2, 3, 4];

function counts(outcome: ReturnType<typeof runSeeded>): RunCounts {
  const s = outcome.snapshot;
  const report = outcome.engine.getReport();
  return {
    totalSpawned: s.totalSpawned,
    totalViolated: s.totalViolated,
    spawnedByKind: s.spawnedByKind,
    completedByKind: s.completedByKind,
    violatedByKind: s.violatedByKind,
    droppedByKind: s.droppedByKind,
    violationsByStep: s.violationsByStep,
    dropReasons: {},
    brokenServices: report.brokenServices.map((c) => c.label),
  };
}

describe('objective calibration', () => {
  beforeAll(installCatalog);

  for (const slug of SEEDED_SLUGS) {
    describe(slug, () => {
      it('the starter is correct but misses at least one completion floor on every seed', { timeout: 120_000 }, () => {
        const scenario = activateScenario(slug);
        expect(scenario.objectives?.minCompletionRate).toBeDefined();
        const { components, belts } = buildChallengePreset(slug)!;
        const configs = buildReferenceComponentConfigs(components);

        for (const seed of SEEDS) {
          const outcome = runSeeded(components, belts, configs, seed);
          const results = evaluateObjectives(scenario.objectives, counts(outcome));

          expect(outcome.snapshot.totalViolated, `seed ${seed}: violations`).toBe(0);
          expect(outcome.failedComponents, `seed ${seed}: failed components`).toBe(0);
          expect(outcome.snapshot.status, `seed ${seed}: status`).toBe('lost');
          const completion = results.filter((r) => r.id.startsWith('completion:'));
          expect(
            completion.some((r) => !r.met),
            `seed ${seed}: starter passed every floor — ${JSON.stringify(outcome.completionRates)}`
          ).toBe(true);
        }
      });

      it('the reference solution meets every objective on every seed', { timeout: 120_000 }, () => {
        const scenario = activateScenario(slug);
        const reference = buildChallengeReference(slug);
        expect(reference, 'every seeded challenge has a reference').not.toBeNull();

        for (const seed of SEEDS) {
          const outcome = runSeeded(reference!.components, reference!.belts, reference!.componentConfigs, seed);
          const results = evaluateObjectives(scenario.objectives, counts(outcome));

          expect(outcome.snapshot.totalViolated, `seed ${seed}: violations`).toBe(0);
          expect(outcome.failedComponents, `seed ${seed}: failed components`).toBe(0);
          expect(
            allObjectivesMet(results),
            `seed ${seed}: ${results
              .filter((r) => !r.met)
              .map((r) => `${r.label} ${r.actual}`)
              .join('; ')} — ${JSON.stringify(outcome.completionRates)}`
          ).toBe(true);
          expect(outcome.snapshot.status, `seed ${seed}: status`).toBe('won');
        }
      });

      it('every reference chip applies to the component it is dropped on', () => {
        const reference = buildChallengeReference(slug)!;
        const ids = new Set(reference.components.map((c) => c.id));
        for (const id of reference.componentConfigs.keys()) {
          expect(ids.has(id), `config for unknown component ${id}`).toBe(true);
        }
        expect(reference.componentConfigs.size).toBeGreaterThan(0);
      });
    });
  }
});
