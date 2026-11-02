import { describe, expect, it } from 'vitest';
import { SimulationEngine, SOURCE_ID } from '../simulation';
import type { RuntimeScenario } from '../scenario-runtime';
import type { FlowSpec } from '../flow-types';
import type { ConveyorBelt, PlacedComponent, SimulationSnapshot } from '../types';
import type { ComponentInstanceConfig } from '../component-config';

/**
 * Headless flow-interpreter tests: tiny boards, a controlled scenario, and a
 * full run to the end. Branch probabilities are pinned to 0 or 1 so the
 * outcomes are deterministic.
 */

let nextId = 0;

function comp(type: string, label = type): PlacedComponent {
  nextId += 1;
  return {
    id: `${type}-${nextId}`,
    type,
    x: 100 * nextId,
    y: 100,
    width: 120,
    height: 72,
    label,
    capacity: 1000,
    queueLimit: 200,
  };
}

function belt(from: PlacedComponent | 'source', to: PlacedComponent): ConveyorBelt {
  nextId += 1;
  return {
    id: `belt-${nextId}`,
    fromPortId: from === 'source' ? `${SOURCE_ID}:out` : `${from.id}:out`,
    toPortId: `${to.id}:in`,
    capacity: 5000,
  };
}

function scenario(overrides: Partial<RuntimeScenario>): RuntimeScenario {
  return {
    id: 'test',
    slug: 'test',
    title: 'Test scenario',
    description: 'test',
    duration: 3,
    drainDuration: 2,
    requirements: [],
    baseRps: 60,
    spikeMultiplier: 1,
    spikeChance: 0,
    readRatio: 0.5,
    celebrityShare: 0,
    cacheHitRatio: 0.5,
    requestTypes: { create: 1 },
    ...overrides,
  };
}

function runToEnd(
  components: PlacedComponent[],
  belts: ConveyorBelt[],
  sc: RuntimeScenario,
  configs: Map<string, ComponentInstanceConfig> = new Map()
): { engine: SimulationEngine; snapshot: SimulationSnapshot } {
  const engine = new SimulationEngine(components, belts, configs, null, sc);
  engine.start();
  const dt = 1 / 60;
  let snapshot = engine.tick(dt);
  for (let i = 0; i < 60 * (sc.duration + sc.drainDuration) + 120; i++) {
    snapshot = engine.tick(dt);
    if (snapshot.status === 'won' || snapshot.status === 'lost') break;
  }
  return { engine, snapshot };
}

const CREATE_FLOW: FlowSpec = {
  kind: 'create',
  steps: [
    { id: 'ingress', require: { capability: 'ingress' } },
    { id: 'service', require: { capability: 'compute' } },
    { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
  ],
};

function readFlow(probability: number | 'cacheHitRatio'): FlowSpec {
  return {
    kind: 'read',
    steps: [
      { id: 'ingress', require: { capability: 'ingress' } },
      { id: 'service', require: { capability: 'compute' } },
      {
        id: 'cache',
        require: { capability: 'cache' },
        optional: true,
        branch: {
          probability,
          onHit: 'complete',
          onMiss: [
            { id: 'db-read', require: { capability: 'durable-store' }, terminal: true },
          ],
        },
      },
      { id: 'db-direct', require: { capability: 'durable-store' }, terminal: true },
    ],
  };
}

describe('flow interpreter', () => {
  it('completes a create flow only at the durable store, never the cache', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    const redis = comp('redis');
    const { snapshot } = runToEnd(
      [lb, svc, db, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, db), belt(svc, redis)],
      scenario({ requestTypes: { create: 1 }, flows: [CREATE_FLOW] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['create']).toBeGreaterThan(0);
    expect(snapshot.components.get(db.id)!.processed).toBeGreaterThan(0);
    // The cache never participates in the create path (no warm step here).
    expect(snapshot.components.get(redis.id)!.processed).toBe(0);
  });

  it('violates creates when only a cache is reachable, with an explanatory reason', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice', 'URL Shortener Service');
    const redis = comp('redis', 'Redis Cache');
    const { engine, snapshot } = runToEnd(
      [lb, svc, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, redis)],
      scenario({ requestTypes: { create: 1 }, flows: [CREATE_FLOW] })
    );

    expect(snapshot.totalViolated).toBeGreaterThan(0);
    expect(snapshot.completedByKind['create'] ?? 0).toBe(0);
    expect(snapshot.violationsByStep['create:persist']).toBe(snapshot.totalViolated);
    // Violations fail requests, not the run.
    expect(snapshot.status).toBe('won');

    const first = engine.getRequest(1)!;
    expect(first.state).toBe('violated');
    const violation = first.events.find((e) => e.kind === 'violated');
    expect(violation?.detail).toContain('create needed a durable store');
    expect(violation?.detail).toContain('URL Shortener Service');
    expect(violation?.detail).toContain('Redis Cache');
  });

  it('skips the optional cache step when no cache is connected', () => {
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lb, svc, db],
      [belt('source', lb), belt(lb, svc), belt(svc, db)],
      scenario({ requestTypes: { read: 1 }, flows: [readFlow(1)] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['read']).toBeGreaterThan(0);
    expect(snapshot.components.get(db.id)!.processed).toBeGreaterThan(0);
  });

  it('completes cache hits at the cache without touching the database', () => {
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const redis = comp('redis');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lb, svc, redis, db],
      [belt('source', lb), belt(lb, svc), belt(svc, redis), belt(redis, db), belt(svc, db)],
      scenario({ requestTypes: { read: 1 }, flows: [readFlow(1)] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['read']).toBeGreaterThan(0);
    expect(snapshot.components.get(redis.id)!.processed).toBeGreaterThan(0);
    expect(snapshot.components.get(db.id)!.processed).toBe(0);
  });

  it('chains cache misses through the cache into the durable store', () => {
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const redis = comp('redis');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lb, svc, redis, db],
      [belt('source', lb), belt(lb, svc), belt(svc, redis), belt(redis, db)],
      // probability 'cacheHitRatio' resolves against the scenario: 0 = always miss.
      scenario({ requestTypes: { read: 1 }, flows: [readFlow('cacheHitRatio')], cacheHitRatio: 0 })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['read']).toBeGreaterThan(0);
    expect(snapshot.components.get(redis.id)!.processed).toBeGreaterThan(0);
    expect(snapshot.components.get(db.id)!.processed).toBeGreaterThan(0);
  });

  it('violates cache misses that have no onward path from the cache', () => {
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const redis = comp('redis');
    const { snapshot } = runToEnd(
      [lb, svc, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, redis)],
      scenario({ requestTypes: { read: 1 }, flows: [readFlow(0)] })
    );

    expect(snapshot.totalViolated).toBeGreaterThan(0);
    expect(snapshot.violationsByStep['read:db-read']).toBe(snapshot.totalViolated);
    expect(snapshot.completedByKind['read'] ?? 0).toBe(0);
  });

  it('violates at the ingress when the next required step is unreachable', () => {
    const lb = comp('load-balancer');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lb, db],
      [belt('source', lb), belt(lb, db)],
      scenario({ requestTypes: { create: 1 }, flows: [CREATE_FLOW] })
    );

    expect(snapshot.totalViolated).toBeGreaterThan(0);
    expect(snapshot.violationsByStep['create:service']).toBe(snapshot.totalViolated);
  });

  it('executes returnTo as a reverse leg and resumes the flow at the caller', () => {
    const lb = comp('load-balancer');
    const svcA = comp('microservice', 'Service A');
    const svcB = comp('backend-service', 'Service B');
    const db = comp('database');
    const flow: FlowSpec = {
      kind: 'rpc',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        { id: 'svc-a', require: { componentType: 'microservice' } },
        { id: 'lookup', require: { capability: 'durable-store' }, returnTo: 'svc-a' },
        { id: 'svc-b', require: { componentType: 'backend-service' }, terminal: true },
      ],
    };
    const { engine, snapshot } = runToEnd(
      [lb, svcA, svcB, db],
      [belt('source', lb), belt(lb, svcA), belt(svcA, db), belt(svcA, svcB)],
      scenario({ requestTypes: { rpc: 1 }, flows: [flow] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['rpc']).toBeGreaterThan(0);
    expect(snapshot.components.get(svcB.id)!.processed).toBeGreaterThan(0);

    const first = engine.getRequest(1)!;
    expect(first.state).toBe('done');
    const kinds = first.events.map((e) => e.kind);
    // The database is visited, the request returns to Service A, and only
    // then flows on to Service B where it completes.
    expect(kinds).toContain('returned');
    const returned = first.events.find((e) => e.kind === 'returned')!;
    expect(returned.componentLabel).toBe('Service A');
    expect(kinds.indexOf('returned')).toBeGreaterThan(
      first.events.findIndex((e) => e.componentLabel === db.label && e.kind === 'processed')
    );
    expect(kinds.indexOf('completed')).toBeGreaterThan(kinds.indexOf('returned'));
  });

  it('violates kinds without a flow spec on arrival instead of guessing a route', () => {
    // The legacy heuristics are gone (flow-authoring §5): traffic the
    // scenario defines no flow for is a configuration error, surfaced per
    // request with a message that names the kind.
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const redis = comp('redis');
    const { snapshot, engine } = runToEnd(
      [lb, svc, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, redis)],
      scenario({ requestTypes: { check: 1 }, flows: undefined, cacheHitRatio: 1 })
    );

    expect(snapshot.completedByKind['check'] ?? 0).toBe(0);
    // Every request that reached a component was violated there; the rest
    // were still travelling from the source when the clock ran out.
    expect(snapshot.violatedByKind['check']).toBeGreaterThan(0);
    expect(snapshot.violatedByKind['check'] + snapshot.activeRequests.length).toBe(
      snapshot.spawnedByKind['check']
    );
    // Nothing ever queued: the cache saw no traffic.
    expect(snapshot.components.get(redis.id)!.processed).toBe(0);
    const finished = (engine as unknown as { finishedRequests: { events: { kind: string; detail?: string }[] }[] })
      .finishedRequests;
    const reason = finished.flatMap((r) => r.events).find((e) => e.kind === 'violated')?.detail;
    expect(reason).toContain('"check" has no flow');
  });

  it('lets a tag step select one component among several of the same type', () => {
    const lb = comp('load-balancer');
    const writes = comp('microservice', 'Writes');
    const reads = comp('microservice', 'Reads');
    const db = comp('database');
    writes.tags = ['write-service'];
    const taggedCreate: FlowSpec = {
      kind: 'create',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        { id: 'service', require: { tag: 'write-service' } },
        { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
      ],
    };
    const { snapshot } = runToEnd(
      [lb, writes, reads, db],
      [belt('source', lb), belt(lb, writes), belt(lb, reads), belt(writes, db), belt(reads, db)],
      scenario({ requestTypes: { create: 1 }, flows: [taggedCreate] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['create']).toBeGreaterThan(0);
    // The ingress only ever routes to the tagged service.
    expect(snapshot.components.get(writes.id)!.processed).toBeGreaterThan(0);
    expect(snapshot.components.get(reads.id)!.processed).toBe(0);
  });

  it('names the tag in the violation reason when no component carries it', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    const taggedCreate: FlowSpec = {
      kind: 'create',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        { id: 'service', require: { tag: 'write-service' } },
        { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
      ],
    };
    const { snapshot, engine } = runToEnd(
      [lb, svc, db],
      [belt('source', lb), belt(lb, svc), belt(svc, db)],
      scenario({
        requestTypes: { create: 1 },
        flows: [taggedCreate],
        tags: [{ id: 'write-service', label: 'Write service' }],
      })
    );

    expect(snapshot.violatedByKind['create']).toBeGreaterThan(0);
    const finished = (engine as unknown as { finishedRequests: { events: { kind: string; detail?: string }[] }[] })
      .finishedRequests;
    const reason = finished
      .flatMap((r) => r.events)
      .find((e) => e.kind === 'violated')?.detail;
    expect(reason).toContain('tagged "Write service"');
  });

  it('falls through to the following steps when a branch miss injects nothing', () => {
    // Instagram's CDN edge step: onMiss is empty, so a miss simply continues
    // with the remaining flow at the next hop.
    const lb = comp('load-balancer');
    const cdn = comp('cdn');
    const svc = comp('backend-service');
    const db = comp('nosql-database');
    const flow: FlowSpec = {
      kind: 'feedLoad',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        {
          id: 'edge',
          require: { componentType: 'cdn' },
          optional: true,
          branch: { probability: 0, onHit: 'complete', onMiss: [] },
        },
        { id: 'service', require: { capability: 'compute' } },
        { id: 'feed-db', require: { capability: 'durable-store' }, terminal: true },
      ],
    };
    const { snapshot } = runToEnd(
      [lb, cdn, svc, db],
      [belt('source', lb), belt(lb, cdn), belt(cdn, svc), belt(svc, db)],
      scenario({ requestTypes: { feedLoad: 1 }, flows: [flow] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.completedByKind['feedLoad']).toBeGreaterThan(0);
    // Every request was processed at the CDN (the branch node) and completed
    // in the durable store, never at the CDN itself.
    expect(snapshot.components.get(cdn.id)!.processed).toBeGreaterThan(0);
    expect(snapshot.components.get(db.id)!.processed).toBeGreaterThan(0);
  });

  it('spreads spawned requests over every belt wired to the source', () => {
    const lbA = comp('load-balancer', 'LB A');
    const lbB = comp('load-balancer', 'LB B');
    const svcA = comp('microservice');
    const svcB = comp('backend-service');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lbA, lbB, svcA, svcB, db],
      [
        belt('source', lbA),
        belt('source', lbB),
        belt(lbA, svcA),
        belt(lbB, svcB),
        belt(svcA, db),
        belt(svcB, db),
      ],
      scenario({ requestTypes: { create: 1 }, flows: [CREATE_FLOW] })
    );

    expect(snapshot.totalViolated).toBe(0);
    expect(snapshot.components.get(svcA.id)!.processed).toBeGreaterThan(0);
    expect(snapshot.components.get(svcB.id)!.processed).toBeGreaterThan(0);
    // Nothing is lost at the source: both wires have headroom.
    expect(snapshot.totalDropped).toBe(0);
  });

  it('spawns request kinds from the scenario requestTypes weights', () => {
    const lb = comp('load-balancer');
    const svc = comp('backend-service');
    const db = comp('database');
    const { snapshot } = runToEnd(
      [lb, svc, db],
      [belt('source', lb), belt(lb, svc), belt(svc, db)],
      scenario({
        requestTypes: { create: 0.5, read: 0.5 },
        flows: [CREATE_FLOW, readFlow(1)],
      })
    );

    expect(snapshot.spawnedByKind['create']).toBeGreaterThan(0);
    expect(snapshot.spawnedByKind['read']).toBeGreaterThan(0);
    expect(snapshot.completedByKind['create']).toBeGreaterThan(0);
    expect(snapshot.completedByKind['read']).toBeGreaterThan(0);
    expect(snapshot.totalViolated).toBe(0);
  });
});

describe('predictive scaling traffic share', () => {
  function predictiveConfig(): ComponentInstanceConfig {
    return {
      autoScaling: {
        horizontal: {
          enabled: true,
          minInstances: 1,
          maxInstances: 10,
          targetUtilization: 65,
          startupTimeSeconds: 0,
        },
        vertical: { enabled: false, maxMultiplier: 1, targetUtilization: 80 },
        reactive: { enabled: false, scaleUpDelaySeconds: 999, scaleDownDelaySeconds: 999 },
        predictive: { enabled: true, preScaleFactor: 1 },
      },
    };
  }

  /** Spike to exactly 1000 rps on the first tick and report the group size. */
  function instancesDuringSpike(flows?: FlowSpec[]): number {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    svc.capacity = 200;
    const configs = new Map([[svc.id, predictiveConfig()]]);
    const sc = scenario({
      baseRps: 100,
      spikeMultiplier: 10,
      spikeChance: 1000, // triggers immediately
      readRatio: 0.72,
      requestTypes: { create: 1 },
      flows,
    });
    const engine = new SimulationEngine(
      [lb, svc, db],
      [belt('source', lb), belt(lb, svc), belt(svc, db)],
      configs,
      null,
      sc
    );
    engine.start();
    let snap = engine.tick(1 / 60);
    for (let i = 0; i < 30; i++) snap = engine.tick(1 / 60);
    return snap.scaling.get(svc.id)!.instances;
  }

  it('derives the spike share from flows when the scenario defines them', () => {
    // The only compute group serves 100% of flowed traffic:
    // ceil(1000 rps / 200 capacity) = 5 instances.
    expect(instancesDuringSpike([CREATE_FLOW])).toBe(5);
  });

  it('gives no predictive share to traffic that has no flow', () => {
    // Without a flow the kind is never routed, so there is nothing to
    // pre-scale for: the group stays at its single instance.
    expect(instancesDuringSpike(undefined)).toBe(1);
  });
});

describe('objective-driven win and lose', () => {
  it('wins when the design survives and meets its objectives', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    const { snapshot, engine } = runToEnd(
      [lb, svc, db],
      [belt('source', lb), belt(lb, svc), belt(svc, db)],
      scenario({
        // A longer run so the tail of requests still in flight at the
        // cut-off stays a small share of the completion rate.
        duration: 15,
        drainDuration: 4,
        requestTypes: { create: 1 },
        flows: [CREATE_FLOW],
        objectives: { minCompletionRate: { create: 0.9 }, maxViolationRate: 0 },
      })
    );

    expect(snapshot.status).toBe('won');
    const report = engine.getReport();
    expect(report.objectivesMet).toBe(true);
    expect(report.objectives.every((objective) => objective.met)).toBe(true);
  });

  it('loses a surviving run that misses its completion floor', () => {
    // No durable store: every create is violated, so completion is 0%.
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const redis = comp('redis');
    const { snapshot, engine } = runToEnd(
      [lb, svc, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, redis)],
      scenario({
        requestTypes: { create: 1 },
        flows: [CREATE_FLOW],
        objectives: { minCompletionRate: { create: 0.9 }, maxViolationRate: 0 },
      })
    );

    expect(snapshot.status).toBe('lost');
    // Lost on objectives, not on survival: nothing overloaded.
    expect([...snapshot.components.values()].every((state) => !state.failed)).toBe(true);
    expect(snapshot.message).toContain('objective');

    const report = engine.getReport();
    expect(report.objectivesMet).toBe(false);
    expect(report.objectives.find((o) => o.id === 'completion:create')!.met).toBe(false);
    expect(report.objectives.find((o) => o.id === 'failures')!.met).toBe(true);
    expect(report.flowStats.find((s) => s.kind === 'create')!.violated).toBeGreaterThan(0);
  });

  it('still wins a flow-violating run when the scenario sets no objectives', () => {
    // Back-compat: without objectives the only win condition is survival.
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const redis = comp('redis');
    const { snapshot } = runToEnd(
      [lb, svc, redis],
      [belt('source', lb), belt(lb, svc), belt(svc, redis)],
      scenario({ requestTypes: { create: 1 }, flows: [CREATE_FLOW] })
    );

    expect(snapshot.totalViolated).toBeGreaterThan(0);
    expect(snapshot.status).toBe('won');
  });
});
