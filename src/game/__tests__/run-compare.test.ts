import { beforeAll, describe, expect, it } from 'vitest';
import { activateScenario, installCatalog, runSeeded } from './harness';
import { buildChallengePreset, buildChallengeReference } from '../challenge-presets';
import { buildReferenceComponentConfigs } from '../component-config';
import { createDefaultAnnotations } from '../board-annotations';
import { compareReports, summarizeBoardChanges } from '../run-compare';

/**
 * Same-seed A/B comparison (docs/specs/product-directions.md §4.3): pure
 * helpers that align two reports row by row and word the board changes
 * between two designs.
 */
describe('run comparison', () => {
  beforeAll(installCatalog);

  it('words the board changes between the starter and the reference', () => {
    activateScenario('rate-limiter');
    const starter = buildChallengePreset('rate-limiter')!;
    const reference = buildChallengeReference('rate-limiter')!;
    const lines = summarizeBoardChanges(
      { ...starter, componentConfigs: buildReferenceComponentConfigs(starter.components), annotations: createDefaultAnnotations() },
      { components: reference.components, belts: reference.belts, componentConfigs: reference.componentConfigs, annotations: createDefaultAnnotations() }
    );
    // The reference adds a second Redis and auto-scales the API. (The
    // starter's database is already tuned — buildReferenceComponentConfigs
    // gives it the reference chips — so no database line appears.)
    expect(lines.some((l) => /\+1 Redis Cache/.test(l))).toBe(true);
    expect(lines.some((l) => /Backend Service:.*H-scale/.test(l))).toBe(true);
    expect(lines.some((l) => /SQL Database/.test(l))).toBe(false);
    // Identical boards have nothing to say.
    expect(summarizeBoardChanges(
      { ...starter, componentConfigs: new Map(), annotations: createDefaultAnnotations() },
      { ...starter, componentConfigs: new Map(), annotations: createDefaultAnnotations() }
    )).toEqual([]);
  });

  it('aligns objectives, flow stats and headline metrics of two runs', () => {
    const scenario = activateScenario('url-shortener');
    const starter = buildChallengePreset('url-shortener')!;
    const reference = buildChallengeReference('url-shortener')!;
    const a = runSeeded(starter.components, starter.belts, buildReferenceComponentConfigs(starter.components), 4242, scenario).engine.getReport();
    const b = runSeeded(reference.components, reference.belts, reference.componentConfigs, 4242, scenario).engine.getReport();

    const cmp = compareReports(a, b);
    expect(cmp.sameSeed).toBe(true);
    const creates = cmp.objectives.find((o) => o.id === 'completion:create')!;
    expect(creates.a?.met).toBe(false);
    expect(creates.b?.met).toBe(true);
    expect(cmp.flows.map((f) => f.kind).sort()).toEqual(['create', 'read']);
    const score = cmp.metrics.find((m) => m.id === 'score')!;
    expect(score.a).toBe(String(a.score));
    expect(score.b).toBe(String(b.score));
    // Different seeds are flagged, not compared.
    const c = runSeeded(starter.components, starter.belts, buildReferenceComponentConfigs(starter.components), 7, scenario).engine.getReport();
    expect(compareReports(a, c).sameSeed).toBe(false);
  });
});
