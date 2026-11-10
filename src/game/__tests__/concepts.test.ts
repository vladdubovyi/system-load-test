import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { activateScenario, installCatalog } from './harness';
import { buildChallengePreset } from '../challenge-presets';
import { lintBoard } from '../flow-validator';
import { validateScenarioDocument } from '../flows';
import { applicableHints, conceptFor, conceptForViolation } from '../concepts';
import {
  getActiveScenario,
  getActiveScenarioDocument,
  setActiveScenarioFromChallenge,
  setActiveScenarioOverride,
} from '../scenario-runtime';
import type { ScenarioHint } from '../flow-types';

/**
 * Hints and concept cards (docs/specs/product-directions.md §4.4): every lint
 * rule resolves to a card, violations map to the same cards by the selector
 * they could not satisfy, hints are validated and layered like the rest of
 * the scenario document, and the ladder shows only what applies to the run.
 */
describe('concept cards', () => {
  beforeAll(installCatalog);

  it('gives every lint issue a rule that resolves to a card', () => {
    const scenario = activateScenario('url-shortener');
    const preset = buildChallengePreset('url-shortener')!;
    const withoutDb = preset.components.filter((c) => c.type !== 'database');
    const issues = lintBoard(scenario.flows!, withoutDb, preset.belts, { requestTypes: scenario.requestTypes, tags: scenario.tags });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.ruleId, issue.message).toBeTruthy();
      expect(conceptFor(issue.ruleId), `no card for ${issue.ruleId}`).not.toBeNull();
    }
    expect(issues.some((i) => i.ruleId === 'missing:durable-store')).toBe(true);
    expect(conceptFor('missing:durable-store')!.title).toMatch(/durable store/i);

    // Board-level rules too: a kind with traffic but no flow, and nothing wired to the source.
    const noFlow = lintBoard(scenario.flows!, preset.components, preset.belts, { requestTypes: { ...scenario.requestTypes, ghost: 0.1 } });
    expect(noFlow.some((i) => i.ruleId === 'no-flow' && conceptFor('no-flow'))).toBe(true);
    const unwired = lintBoard(scenario.flows!, preset.components, [], {});
    expect(unwired.some((i) => i.ruleId === 'no-entry' && conceptFor('no-entry'))).toBe(true);
  });

  it('maps a violated step to the card for the capability it needed', () => {
    expect(conceptForViolation({ capability: 'durable-store' })!.id).toBe('missing:durable-store');
    expect(conceptForViolation({ capability: 'traffic-filter' })!.id).toBe('missing:traffic-filter');
    expect(conceptForViolation({ componentType: 'database' })!.id).toBe('missing-type:database');
    expect(conceptForViolation(null)!.id).toBe('flow-ended');
  });
});

describe('scenario hints', () => {
  const LADDER: ScenarioHint[] = [
    { id: 'h1', after: 'always', text: 'Start with the write path.' },
    { id: 'h2', after: 'loss', text: 'Where do requests pile up?' },
    { id: 'h3', after: 'violation', text: 'A cache cannot persist a write.' },
  ];

  afterEach(() => {
    setActiveScenarioOverride(null);
    setActiveScenarioFromChallenge(null);
  });

  it('validates the ladder', () => {
    expect(validateScenarioDocument({ hints: LADDER })).toEqual([]);
    expect(validateScenarioDocument({ hints: [{ id: 'x', after: 'sometimes' as never, text: 'y' }] }).length).toBeGreaterThan(0);
    expect(validateScenarioDocument({ hints: [{ id: '', after: 'loss', text: 'y' }] }).length).toBeGreaterThan(0);
    expect(validateScenarioDocument({ hints: 'nope' as never }).length).toBeGreaterThan(0);
  });

  it('layers like the rest of the document', () => {
    setActiveScenarioFromChallenge(null);
    setActiveScenarioOverride({ hints: LADDER });
    expect(getActiveScenario().hints).toEqual(LADDER);
    expect(getActiveScenarioDocument().hints).toEqual(LADDER);
  });

  it('shows only the hints that apply to the run', () => {
    expect(applicableHints(LADDER, { lost: false, violated: false }).map((h) => h.id)).toEqual(['h1']);
    expect(applicableHints(LADDER, { lost: true, violated: false }).map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(applicableHints(LADDER, { lost: true, violated: true }).map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
    expect(applicableHints(undefined, { lost: true, violated: true })).toEqual([]);
  });
});
