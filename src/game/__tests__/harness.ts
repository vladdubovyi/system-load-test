import { CHALLENGES, COMPONENT_DEFINITIONS } from '../../../e2e/fixtures/api-data';
import { mapChallengeFromApi } from '../../api/client';
import { componentRegistry } from '../component-registry';
import type { ComponentDefinition } from '../scenario-types';
import { getActiveScenario, setActiveScenarioFromChallenge, type RuntimeScenario } from '../scenario-runtime';
import type { ComponentInstanceConfig } from '../component-config';
import { SimulationEngine } from '../simulation';
import type { ConveyorBelt, PlacedComponent, SimulationSnapshot } from '../types';

/**
 * Headless harness for whole-scenario runs. It loads the same canned
 * challenge and component data the e2e suite serves, so the engine sees the
 * capacities, traffic and flows the app would — without this, unknown
 * component types fall back to a generic capacity and every measurement is
 * wrong.
 */

export const SEEDED_SLUGS = CHALLENGES.map((c) => c.slug);

export async function installCatalog(): Promise<void> {
  await componentRegistry.initialize(COMPONENT_DEFINITIONS as unknown as ComponentDefinition[]);
}

/** Make `slug` the active scenario and return it. */
export function activateScenario(slug: string): RuntimeScenario {
  const api = CHALLENGES.find((c) => c.slug === slug);
  if (!api) throw new Error(`No canned challenge for ${slug}`);
  setActiveScenarioFromChallenge(mapChallengeFromApi(api));
  return getActiveScenario();
}

export interface RunOutcome {
  snapshot: SimulationSnapshot;
  engine: SimulationEngine;
  /** completed / spawned per request kind. */
  completionRates: Record<string, number>;
  failedComponents: number;
}

/** Run a board through the active scenario to its end with a fixed seed. */
export function runSeeded(
  components: PlacedComponent[],
  belts: ConveyorBelt[],
  componentConfigs: Map<string, ComponentInstanceConfig>,
  seed: number,
  scenario: RuntimeScenario = getActiveScenario()
): RunOutcome {
  const engine = new SimulationEngine(
    structuredClone(components),
    structuredClone(belts),
    new Map([...componentConfigs].map(([id, cfg]) => [id, structuredClone(cfg)])),
    null,
    scenario,
    seed
  );
  engine.start();
  const dt = 1 / 60;
  let snapshot = engine.tick(dt);
  const maxTicks = 60 * (scenario.duration + scenario.drainDuration) + 600;
  for (let i = 0; i < maxTicks; i++) {
    snapshot = engine.tick(dt);
    if (snapshot.status === 'won' || snapshot.status === 'lost') break;
  }

  const completionRates: Record<string, number> = {};
  for (const [kind, spawned] of Object.entries(snapshot.spawnedByKind)) {
    completionRates[kind] = spawned > 0 ? (snapshot.completedByKind[kind] ?? 0) / spawned : 1;
  }
  const failedComponents = [...snapshot.components.values()].filter((c) => c.failed).length;
  return { snapshot, engine, completionRates, failedComponents };
}
