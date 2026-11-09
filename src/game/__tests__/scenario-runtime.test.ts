import { afterEach, describe, expect, it } from 'vitest';
import {
  getActiveScenario,
  getActiveScenarioDocument,
  setActiveScenarioFromChallenge,
  setActiveScenarioOverride,
  setRunFlowBundle,
} from '../scenario-runtime';
import type { FlowSpec } from '../flow-types';

/**
 * The opaque run flow bundle (docs/specs/interview-platform.md §6.2): layered
 * over everything so the engine can route, invisible to the authorable
 * document so no UI renders it, discarded when cleared.
 */
describe('run flow bundle', () => {
  const BUNDLE: FlowSpec[] = [
    { kind: 'read', steps: [{ id: 'svc', require: { capability: 'compute' } }] },
  ];

  afterEach(() => {
    setRunFlowBundle(null);
    setActiveScenarioFromChallenge(null);
  });

  it('overrides the active flows while set and restores them when cleared', () => {
    setActiveScenarioFromChallenge(null);
    const before = getActiveScenario().flows;
    expect(before).toBeDefined();
    expect(before).not.toEqual(BUNDLE);

    setRunFlowBundle(BUNDLE);
    expect(getActiveScenario().flows).toEqual(BUNDLE);
    // Objectives and the rest of the scenario are untouched.
    expect(getActiveScenario().objectives).toBeDefined();

    setRunFlowBundle(null);
    expect(getActiveScenario().flows).toEqual(before);
  });

  it('wins over an applied scenario override', () => {
    setActiveScenarioFromChallenge(null);
    const overrideFlows: FlowSpec[] = [
      { kind: 'create', steps: [{ id: 'in', require: { capability: 'ingress' } }] },
    ];
    setActiveScenarioOverride({ flows: overrideFlows });
    expect(getActiveScenario().flows).toEqual(overrideFlows);

    setRunFlowBundle(BUNDLE);
    expect(getActiveScenario().flows).toEqual(BUNDLE);
  });

  it('never leaks into the authorable scenario document', () => {
    setActiveScenarioFromChallenge(null);
    setActiveScenarioOverride({ requestTypes: { read: 1 } });
    setRunFlowBundle(BUNDLE);
    // An interview participant's override has no flows; the document mirrors
    // that, bundle or not (§6.2: "never rendered by any UI").
    expect(getActiveScenarioDocument().flows).not.toEqual(BUNDLE);
  });

  it('treats an empty bundle as none', () => {
    setActiveScenarioFromChallenge(null);
    const before = getActiveScenario().flows;
    setRunFlowBundle([]);
    expect(getActiveScenario().flows).toEqual(before);
  });
});
