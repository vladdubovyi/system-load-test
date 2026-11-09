import { beforeAll, describe, expect, it } from 'vitest';
import { activateScenario, installCatalog, runSeeded } from './harness';
import { buildChallengePreset, buildChallengeReference } from '../challenge-presets';
import { buildReferenceComponentConfigs } from '../component-config';
import type { SimulationSnapshot } from '../types';

/**
 * Seeded determinism (docs/specs/interview-platform.md §8): the same board
 * and seed produce the same run, draw for draw, on any client. The room
 * model depends on it — every participant simulates locally and must see
 * the same traffic.
 */

/** The parts of a snapshot that a divergent random stream would change. */
function fingerprint(snapshot: SimulationSnapshot) {
  return {
    status: snapshot.status,
    time: snapshot.time,
    totalSpawned: snapshot.totalSpawned,
    totalCompleted: snapshot.totalCompleted,
    totalDropped: snapshot.totalDropped,
    totalViolated: snapshot.totalViolated,
    spawnedByKind: snapshot.spawnedByKind,
    completedByKind: snapshot.completedByKind,
    droppedByKind: snapshot.droppedByKind,
    components: [...snapshot.components.entries()].map(([id, c]) => [id, c.processed, c.dropped, c.failed]),
    scaling: [...snapshot.scaling.entries()].map(([id, s]) => [id, s.instances, s.verticalMultiplier]),
  };
}

describe('seeded determinism', () => {
  beforeAll(installCatalog);

  it('replays the same run for the same seed on the starter board', { timeout: 60_000 }, () => {
    activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const configs = buildReferenceComponentConfigs(components);

    const a = runSeeded(components, belts, configs, 4242);
    const b = runSeeded(components, belts, configs, 4242);

    expect(fingerprint(b.snapshot)).toEqual(fingerprint(a.snapshot));
    expect(b.engine.getSeed()).toBe(4242);
    expect(a.snapshot.seed).toBe(4242);
    // The report is built from the same counters, so it matches too.
    const ra = a.engine.getReport();
    const rb = b.engine.getReport();
    expect({ ...rb, components: rb.components }).toEqual({ ...ra, components: ra.components });
    expect(ra.seed).toBe(4242);
  });

  it('replays the same run even when auto-scaling creates and removes instances', { timeout: 60_000 }, () => {
    // Scale instances get random ids; nothing about the run may depend on
    // them (despawn order used to sort by id).
    activateScenario('rate-limiter');
    const reference = buildChallengeReference('rate-limiter')!;

    const a = runSeeded(reference.components, reference.belts, reference.componentConfigs, 11);
    const b = runSeeded(reference.components, reference.belts, reference.componentConfigs, 11);

    const scaledOut = [...a.snapshot.scaling.values()].some((s) => s.instances > 1);
    expect(scaledOut, 'the reference should have scaled out during the run').toBe(true);
    const fa = fingerprint(a.snapshot);
    const fb = fingerprint(b.snapshot);
    // Instance ids differ between runs by design; compare everything else,
    // and the per-component tallies by position.
    expect({ ...fb, components: fb.components.map((c) => c.slice(1)), scaling: fb.scaling.map((s) => s.slice(1)) })
      .toEqual({ ...fa, components: fa.components.map((c) => c.slice(1)), scaling: fa.scaling.map((s) => s.slice(1)) });
  });

  it('different seeds give different runs', { timeout: 60_000 }, () => {
    activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const configs = buildReferenceComponentConfigs(components);

    const a = runSeeded(components, belts, configs, 1);
    const b = runSeeded(components, belts, configs, 2);

    expect(fingerprint(b.snapshot)).not.toEqual(fingerprint(a.snapshot));
  });

  it('a restarted engine replays its own seed', { timeout: 60_000 }, () => {
    activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const configs = buildReferenceComponentConfigs(components);

    const first = runSeeded(components, belts, configs, 77);
    const engine = first.engine;
    engine.reset();
    engine.start();
    const dt = 1 / 60;
    let snapshot = engine.tick(dt);
    for (let i = 0; i < 60 * 60; i++) {
      snapshot = engine.tick(dt);
      if (snapshot.status !== 'running') break;
    }
    expect(fingerprint(snapshot)).toEqual(fingerprint(first.snapshot));
  });

  it('draws a fresh non-zero seed when none is given', { timeout: 60_000 }, () => {
    activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const a = runSeeded(components, belts, new Map(), undefined as unknown as number);
    expect(a.engine.getSeed()).toBeGreaterThan(0);
  });
});
