import { beforeAll, describe, expect, it } from 'vitest';
import { activateScenario, installCatalog, runSeeded } from './harness';
import { buildChallengePreset } from '../challenge-presets';
import { buildReferenceComponentConfigs } from '../component-config';
import { EXAMPLE_POOL_LIMIT, SOURCE_ID } from '../simulation';

/**
 * Example requests for the coaching drawer (docs/specs/product-directions.md
 * §4.2): finished requests are reservoir-sampled per (kind, end state) so a
 * flood of one outcome cannot evict the examples of another, the pool is
 * capped, and sampling uses its own seeded generator — so two runs with the
 * same seed pick the same examples and the main random stream is untouched.
 */
describe('example request pool', () => {
  beforeAll(installCatalog);

  it('keeps a capped, deterministic sample per kind and end state', () => {
    const scenario = activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const configs = buildReferenceComponentConfigs(components);
    const a = runSeeded(components, belts, configs, 11, scenario);
    const b = runSeeded(components, belts, configs, 11, scenario);

    // The starter drops thousands of requests: the pool stays at its cap…
    const dropped = a.engine.getExampleRequests('read', 'dropped');
    expect(dropped.length).toBe(EXAMPLE_POOL_LIMIT);
    expect(a.snapshot.droppedByKind.read).toBeGreaterThan(EXAMPLE_POOL_LIMIT);
    // …and completed requests sit in their own bucket.
    expect(a.engine.getExampleRequests('read', 'done').length).toBe(EXAMPLE_POOL_LIMIT);
    for (const r of dropped) {
      expect(r.kind).toBe('read');
      expect(r.state).toBe('dropped');
    }
    // Same seed, same samples.
    expect(b.engine.getExampleRequests('read', 'dropped').map((r) => r.id)).toEqual(dropped.map((r) => r.id));
    // Sampling did not perturb the run itself.
    expect(b.snapshot.totalCompleted).toBe(a.snapshot.totalCompleted);
    expect(b.snapshot.totalDropped).toBe(a.snapshot.totalDropped);
  });

  it('samples violated requests when a flow cannot complete', () => {
    const scenario = activateScenario('url-shortener');
    const preset = buildChallengePreset('url-shortener')!;
    const components = preset.components.filter((c) => c.type !== 'database');
    const ids = new Set([...components.map((c) => c.id), SOURCE_ID]);
    const owner = (portId: string) => portId.slice(0, portId.lastIndexOf(':'));
    const belts = preset.belts.filter((b) => ids.has(owner(b.fromPortId)) && ids.has(owner(b.toPortId)));
    const outcome = runSeeded(components, belts, new Map(), 3, scenario);

    const violated = outcome.engine.getExampleRequests('create', 'violated');
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.length).toBeLessThanOrEqual(EXAMPLE_POOL_LIMIT);
    expect(violated.every((r) => r.events.some((e) => e.kind === 'violated'))).toBe(true);
    expect(outcome.engine.getExampleRequests('create', 'done')).toEqual([]);
  });

  it('reports the requests still in flight at the end of a run', () => {
    const scenario = activateScenario('url-shortener');
    const { components, belts } = buildChallengePreset('url-shortener')!;
    const outcome = runSeeded(components, belts, new Map(), 5, scenario);
    const live = outcome.engine.getUnfinishedRequests();
    expect(Array.isArray(live)).toBe(true);
    for (const r of live) expect(['queued', 'processing', 'traveling']).toContain(r.state);
  });
});
