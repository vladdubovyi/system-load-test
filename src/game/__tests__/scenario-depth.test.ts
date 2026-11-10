import { beforeAll, describe, expect, it } from 'vitest';
import { buildChallengePreset } from '../challenge-presets';
import { validateScenarioDocument } from '../flows';
import { EMPTY_COUNTS, evaluateObjectives } from '../objectives';
import { getActiveScenario, setActiveScenarioOverride, type RuntimeScenario } from '../scenario-runtime';
import { SimulationEngine } from '../simulation';
import type { ConveyorBelt, PlacedComponent } from '../types';
import { activateScenario, installCatalog } from './harness';

/**
 * Scenario depth, D2 phase 1 (docs/specs/product-directions.md §3.3–§3.4):
 * scripted failure phases fire on simulation time against the first
 * matching component; traffic phases ramp the base rate. Both are scenario
 * data, so two engines with the same seed still agree tick for tick.
 */
const DB_OUTAGE = {
  id: 'db-outage',
  label: 'Database outage',
  atSeconds: 3,
  target: { capability: 'durable-store' as const },
  type: 'shutdown' as const,
  durationSeconds: 12,
};

function engineFor(scenario: RuntimeScenario, board: { components: PlacedComponent[]; belts: ConveyorBelt[] }, seed = 7) {
  const engine = new SimulationEngine(
    structuredClone(board.components),
    structuredClone(board.belts),
    new Map(),
    null,
    scenario,
    seed
  );
  engine.start();
  return engine;
}

function runTo(engine: SimulationEngine, seconds: number) {
  let snap = engine.getSnapshot();
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks && snap.status === 'running'; i++) snap = engine.tick(1 / 60);
  return snap;
}

describe('scripted failure phases', () => {
  let board: { components: PlacedComponent[]; belts: ConveyorBelt[] };

  beforeAll(async () => {
    await installCatalog();
    activateScenario('url-shortener');
    board = buildChallengePreset('url-shortener')!;
  });

  it('fires at its time against the first matching component and ends on schedule', () => {
    setActiveScenarioOverride({ failureScenarios: [DB_OUTAGE] });
    const engine = engineFor(getActiveScenario(), board);
    let snap = runTo(engine, 2.5);
    expect(snap.scriptedFailures[0]).toMatchObject({ id: 'db-outage', fired: false, active: false });

    snap = runTo(engine, 1);
    const phase = snap.scriptedFailures[0];
    expect(phase.fired).toBe(true);
    expect(phase.active).toBe(true);
    expect(phase.componentLabel).toBe('SQL Database');
    expect(phase.until).toBeCloseTo(3 + 12, 0);
    const db = engine.getSnapshot().components;
    expect(db.size).toBeGreaterThan(0);

    snap = runTo(engine, 13);
    expect(snap.scriptedFailures[0].active).toBe(false);
    expect(snap.status).toBe('running');
  });

  it('skips a phase whose selector matches nothing, without failing the run', () => {
    setActiveScenarioOverride({
      failureScenarios: [{ ...DB_OUTAGE, id: 'cdn', label: 'CDN outage', target: { componentType: 'cdn' } }],
    });
    const engine = engineFor(getActiveScenario(), board);
    const snap = runTo(engine, 5);
    expect(snap.scriptedFailures[0]).toMatchObject({ fired: true, skipped: true, active: false, componentLabel: null });
    expect(snap.status).toBe('running');
  });

  it('does not count the drill target as a broken service', () => {
    setActiveScenarioOverride({ failureScenarios: [DB_OUTAGE] });
    const engine = engineFor(getActiveScenario(), board);
    const snap = runTo(engine, 10);
    expect(snap.components.get('ch-db')?.failed).not.toBe(true);
  });

  it('is deterministic: same seed, same scripted scenario, same numbers', () => {
    setActiveScenarioOverride({
      failureScenarios: [DB_OUTAGE],
      trafficPhases: [{ atSeconds: 0, baseRps: 60 }, { atSeconds: 30, baseRps: 500 }],
    });
    const a = runTo(engineFor(getActiveScenario(), board, 11), 60);
    const b = runTo(engineFor(getActiveScenario(), board, 11), 60);
    expect([a.totalSpawned, a.totalCompleted, a.totalDropped, a.totalViolated]).toEqual([
      b.totalSpawned,
      b.totalCompleted,
      b.totalDropped,
      b.totalViolated,
    ]);
    expect(a.scriptedFailures).toEqual(b.scriptedFailures);
  });
});

describe('traffic phases in the engine', () => {
  beforeAll(async () => {
    await installCatalog();
    activateScenario('url-shortener');
  });

  it('a ramp spawns more than the flat base over the same window', () => {
    const board = buildChallengePreset('url-shortener')!;
    setActiveScenarioOverride(null);
    const flat = runTo(engineFor(getActiveScenario(), board, 5), 30);
    setActiveScenarioOverride({ trafficPhases: [{ atSeconds: 0, baseRps: 200 }, { atSeconds: 30, baseRps: 800 }] });
    const ramped = runTo(engineFor(getActiveScenario(), board, 5), 30);
    expect(ramped.totalSpawned).toBeGreaterThan(flat.totalSpawned * 1.5);
  });
});

describe('scripted-failure objective and document validation', () => {
  it('adds a survive-the-drills row only when phases exist, met when nothing else failed', () => {
    const none = evaluateObjectives(undefined, EMPTY_COUNTS);
    expect(none.map((o) => o.id)).not.toContain('scripted-failures');

    const survived = evaluateObjectives(undefined, {
      ...EMPTY_COUNTS,
      scriptedPhases: [{ id: 'db', label: 'Database outage', type: 'shutdown', atSeconds: 3, durationSeconds: 12, componentLabel: 'SQL Database', skipped: false, failedDuring: [] }],
    });
    expect(survived.find((o) => o.id === 'scripted-failures')?.met).toBe(true);

    const collapsed = evaluateObjectives(undefined, {
      ...EMPTY_COUNTS,
      scriptedPhases: [{ id: 'db', label: 'Database outage', type: 'shutdown', atSeconds: 3, durationSeconds: 12, componentLabel: 'SQL Database', skipped: false, failedDuring: ['Redis Cache'] }],
    });
    const row = collapsed.find((o) => o.id === 'scripted-failures');
    expect(row?.met).toBe(false);
    expect(row?.cause).toContain('Redis Cache');

    const off = evaluateObjectives({ surviveScriptedFailures: false }, { ...EMPTY_COUNTS, scriptedPhases: [{ id: 'db', label: 'x', type: 'shutdown', atSeconds: 1, durationSeconds: 1, componentLabel: null, skipped: true, failedDuring: [] }] });
    expect(off.map((o) => o.id)).not.toContain('scripted-failures');
  });

  it('rejects malformed phases and timelines', () => {
    expect(validateScenarioDocument({ failureScenarios: [{ ...DB_OUTAGE, target: {} }] })).toContainEqual(expect.stringMatching(/target/));
    expect(validateScenarioDocument({ failureScenarios: [{ ...DB_OUTAGE, type: 'explode' as never }] })).toContainEqual(expect.stringMatching(/type/));
    expect(validateScenarioDocument({ failureScenarios: [{ ...DB_OUTAGE, durationSeconds: 0 }] })).toContainEqual(expect.stringMatching(/durationSeconds/));
    expect(validateScenarioDocument({ failureScenarios: [DB_OUTAGE, DB_OUTAGE] })).toContainEqual(expect.stringMatching(/duplicate/));
    expect(validateScenarioDocument({ trafficPhases: [{ atSeconds: -1 }] })).toContainEqual(expect.stringMatching(/atSeconds/));
    expect(validateScenarioDocument({ trafficPhases: [{ atSeconds: 0, baseRps: 0 }] })).toContainEqual(expect.stringMatching(/baseRps/));
    expect(validateScenarioDocument({ failureScenarios: [DB_OUTAGE], trafficPhases: [{ atSeconds: 0, baseRps: 40 }] })).toEqual([]);
  });
});
