import { describe, expect, it } from 'vitest';
import { renderReportModal } from '../report-modal';
import { renderConfigBadgesHtml } from '../../game/component-config';
import { setActiveScenarioFromChallenge, setActiveScenarioOverride } from '../../game/scenario-runtime';
import type { SimulationReport, PlacedComponent } from '../../game/types';

/**
 * Request kinds, flow step ids and tag labels are authored through the
 * scenario editor and served to every player. Anything that interpolates
 * them into innerHTML must escape them, or an allowlisted author can plant
 * stored XSS.
 */
const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

function report(overrides: Partial<SimulationReport>): SimulationReport {
  return {
    outcome: 'won',
    duration: 45,
    score: 90,
    grade: 'A',
    totalCost: 0,
    wastedCost: 0,
    components: [],
    brokenServices: [],
    scaledServices: [],
    wastedResources: [],
    totalSpawned: 10,
    totalCompleted: 10,
    totalDropped: 0,
    totalViolated: 0,
    successRate: 100,
    objectives: [],
    objectivesMet: true,
    flowStats: [],
    peakRps: 0,
    spikeEvents: 0,
    availabilityPct: 100,
    recommendations: [],
    ...overrides,
  };
}

describe('authored strings are escaped before reaching innerHTML', () => {
  it('report modal escapes request kinds, objective text and recommendations', () => {
    const html = renderReportModal(
      report({
        flowStats: [{ kind: PAYLOAD, spawned: 1, completed: 1, dropped: 0, violated: 0, completionRate: 100 }],
        objectives: [
          {
            id: `completion:${PAYLOAD}`,
            label: `${PAYLOAD} completion rate`,
            target: '≥ 50%',
            actual: '100%',
            met: false,
            cause: `Most requests died at step "${PAYLOAD}"`,
          },
        ],
        recommendations: [`Fix ${PAYLOAD}`],
      })
    );

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;');
  });

  it('component badges escape authored tag labels', () => {
    setActiveScenarioFromChallenge(null);
    setActiveScenarioOverride({ tags: [{ id: 'evil', label: PAYLOAD }] });
    const component: PlacedComponent = {
      id: 'c1',
      type: 'microservice',
      x: 0,
      y: 0,
      width: 120,
      height: 72,
      label: 'Service',
      capacity: 100,
      queueLimit: 10,
      tags: ['evil'],
    };

    const html = renderConfigBadgesHtml(component, undefined);
    setActiveScenarioOverride(null);

    expect(html).toContain('component-tag-badge');
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img');
  });
});
