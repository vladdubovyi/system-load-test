import { describe, expect, it } from 'vitest';
import { lintBoard } from '../flow-validator';
import { SOURCE_ID } from '../simulation';
import {
  URL_SHORTENER_FLOWS,
  INSTAGRAM_FEED_FLOWS,
  DROPBOX_FLOWS,
  RATE_LIMITER_FLOWS,
} from '../flow-presets';
import { buildChallengePreset } from '../challenge-presets';
import type { FlowSpec } from '../flow-types';
import type { ConveyorBelt, PlacedComponent } from '../types';

/**
 * Static flow lint: tiny boards checked against flow specs without running
 * the engine. The lint must agree with the interpreter — anything it flags
 * would violate at run time, and clean boards must stay unflagged.
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

/** The URL shortener starter shape: LB fanning out to two services. */
function shortenerBoard(): {
  lb: PlacedComponent;
  writes: PlacedComponent;
  reads: PlacedComponent;
  redis: PlacedComponent;
  db: PlacedComponent;
  belts: ConveyorBelt[];
} {
  const lb = comp('load-balancer', 'Load Balancer');
  const writes = comp('microservice', 'Microservice');
  const reads = comp('backend-service', 'Backend Service');
  const redis = comp('redis', 'Redis Cache');
  const db = comp('database', 'SQL Database');
  const belts = [
    belt('source', lb),
    belt(lb, writes),
    belt(lb, reads),
    belt(writes, db),
    belt(writes, redis),
    belt(reads, redis),
    belt(reads, db),
    belt(redis, db),
  ];
  return { lb, writes, reads, redis, db, belts };
}

describe('lintBoard', () => {
  it('passes the URL shortener starter board', () => {
    const { lb, writes, reads, redis, db, belts } = shortenerBoard();
    expect(lintBoard(URL_SHORTENER_FLOWS, [lb, writes, reads, redis, db], belts)).toEqual([]);
  });

  it('passes the Instagram starter board (edge cache branch with empty onMiss)', () => {
    const lb = comp('load-balancer');
    const cdn = comp('cdn');
    const api = comp('backend-service');
    const redis = comp('redis');
    const feed = comp('nosql-database');
    const media = comp('object-storage');
    const belts = [
      belt('source', lb),
      belt(lb, cdn),
      belt(lb, api),
      belt(cdn, api),
      belt(api, redis),
      belt(api, feed),
      belt(api, media),
      belt(redis, feed),
    ];
    expect(lintBoard(INSTAGRAM_FEED_FLOWS, [lb, cdn, api, redis, feed, media], belts)).toEqual([]);
  });

  it('reports every service a missing durable store strands, for both flows', () => {
    const { lb, writes, reads, redis, belts } = shortenerBoard();
    const components = [lb, writes, reads, redis];
    const kept = belts.filter(
      (b) => !b.toPortId.startsWith('database') && !b.fromPortId.startsWith('database')
    );
    const issues = lintBoard(URL_SHORTENER_FLOWS, components, kept);

    // Creates get stuck at both compute services; reads get stuck at the
    // cache (the miss has nowhere to go).
    const persistIssues = issues.filter((i) => i.kind === 'create' && i.stepId === 'persist');
    expect(persistIssues.map((i) => i.componentIds[0]).sort()).toEqual(
      [writes.id, reads.id].sort()
    );
    const missIssue = issues.find((i) => i.kind === 'read' && i.stepId === 'db-read');
    expect(missIssue?.componentIds).toEqual([redis.id]);
    expect(missIssue?.message).toContain('durable store');
    expect(missIssue?.message).toContain('Redis Cache');
    expect(missIssue?.message).toContain('nothing is connected');
  });

  it('flags a cache whose misses have no onward path, even when a database exists', () => {
    const { lb, writes, reads, redis, db, belts } = shortenerBoard();
    const kept = belts.filter((b) => b.fromPortId !== `${redis.id}:out`);
    const issues = lintBoard(URL_SHORTENER_FLOWS, [lb, writes, reads, redis, db], kept);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'read', stepId: 'db-read', componentIds: [redis.id] });
    expect(issues[0].message).toContain('after "Redis Cache"');
  });

  it('does not flag a board without the optional cache', () => {
    const { lb, writes, reads, redis, db, belts } = shortenerBoard();
    const kept = belts.filter(
      (b) =>
        !b.fromPortId.startsWith(redis.id) && !b.toPortId.startsWith(redis.id)
    );
    expect(lintBoard(URL_SHORTENER_FLOWS, [lb, writes, reads, db], kept)).toEqual([]);
  });

  it('reports an unwired source as a board-level problem', () => {
    const { lb, writes, reads, redis, db, belts } = shortenerBoard();
    const kept = belts.filter((b) => !b.fromPortId.startsWith(SOURCE_ID));
    const issues = lintBoard(URL_SHORTENER_FLOWS, [lb, writes, reads, redis, db], kept);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBeNull();
    expect(issues[0].message).toContain('Incoming Requests');
  });

  it('follows every wire out of the source, not just the first', () => {
    // A second load balancer with no onward belt receives real traffic (the
    // engine spawns uniformly over source belts) and strands every request.
    const { lb, writes, reads, redis, db, belts } = shortenerBoard();
    const extra = comp('load-balancer', 'Spare LB');
    const issues = lintBoard(
      URL_SHORTENER_FLOWS,
      [lb, writes, reads, redis, db, extra],
      [...belts, belt('source', extra)]
    );

    const stuck = issues.filter((i) => i.stepId === 'service');
    expect(stuck.map((i) => i.kind).sort()).toEqual(['create', 'read']);
    expect(stuck.every((i) => i.componentIds[0] === extra.id)).toBe(true);
    expect(stuck[0].message).toContain('after "Spare LB"');
    expect(stuck[0].message).toContain('nothing is connected');
  });

  it('reports a flow that arrives somewhere it cannot use', () => {
    // Source wired straight into a service: the required ingress step never
    // matches, so every request would violate immediately.
    const svc = comp('microservice', 'Microservice');
    const db = comp('database');
    const issues = lintBoard(
      URL_SHORTENER_FLOWS,
      [svc, db],
      [belt('source', svc), belt(svc, db)]
    );
    const arriveIssues = issues.filter((i) => i.stepId === 'ingress');
    expect(arriveIssues.length).toBeGreaterThan(0);
    expect(arriveIssues[0].message).toContain('ingress');
    expect(arriveIssues[0].message).toContain('Microservice');
  });

  it('never lints boards for scenarios without flows', () => {
    const lonely = comp('redis');
    expect(lintBoard([], [lonely], [])).toEqual([]);
  });

  it('resolves returnTo legs at the caller instead of failing reachability', () => {
    const flow: FlowSpec = {
      kind: 'rpc',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        { id: 'svc-a', require: { componentType: 'microservice' } },
        { id: 'lookup', require: { capability: 'durable-store' }, returnTo: 'svc-a' },
        { id: 'svc-b', require: { componentType: 'backend-service' }, terminal: true },
      ],
    };
    const lb = comp('load-balancer');
    const svcA = comp('microservice', 'Service A');
    const svcB = comp('backend-service', 'Service B');
    const db = comp('database');

    // With the A → B belt the round trip works; the DB needs no belt back.
    const good = [belt('source', lb), belt(lb, svcA), belt(svcA, db), belt(svcA, svcB)];
    expect(lintBoard([flow], [lb, svcA, svcB, db], good)).toEqual([]);

    // Without it the flow resumes at Service A and gets stuck on svc-b there.
    const bad = [belt('source', lb), belt(lb, svcA), belt(svcA, db)];
    const issues = lintBoard([flow], [lb, svcA, svcB, db], bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'rpc', stepId: 'svc-b', componentIds: [svcA.id] });
  });

  it('surfaces structural spec problems as board-level issues', () => {
    const broken: FlowSpec = { kind: 'ghost', steps: [] };
    const lb = comp('load-balancer');
    const issues = lintBoard([broken], [lb], [belt('source', lb)]);
    expect(issues.some((i) => i.kind === null && i.message.includes('no steps'))).toBe(true);
  });
});

describe('lint: flow authoring (Phase 5)', () => {
  it('reports request kinds that carry traffic but have no flow', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    const belts = [belt('source', lb), belt(lb, svc), belt(svc, db)];
    const issues = lintBoard(URL_SHORTENER_FLOWS, [lb, svc, db], belts, {
      requestTypes: { read: 0.5, create: 0.3, analytics: 0.2, unused: 0 },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('analytics');
    expect(issues[0].message).toContain('"analytics" has no flow');
  });

  it('phrases tag steps by their label and honours tags on components', () => {
    const lb = comp('load-balancer');
    const svc = comp('microservice');
    const db = comp('database');
    const flow: FlowSpec = {
      kind: 'create',
      steps: [
        { id: 'ingress', require: { capability: 'ingress' } },
        { id: 'service', require: { tag: 'write-service' } },
        { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
      ],
    };
    const belts = [belt('source', lb), belt(lb, svc), belt(svc, db)];
    const tags = [{ id: 'write-service', label: 'Write service' }];

    const untagged = lintBoard([flow], [lb, svc, db], belts, { tags });
    expect(untagged).toHaveLength(1);
    expect(untagged[0].message).toContain('tagged "Write service"');
    expect(untagged[0].message).toMatch(/load.balancer/i);

    svc.tags = ['write-service'];
    expect(lintBoard([flow], [lb, svc, db], belts, { tags })).toEqual([]);
  });

  it('the Dropbox and Rate Limiter starters lint clean against their flows', () => {
    for (const [slug, flows] of [
      ['dropbox', DROPBOX_FLOWS],
      ['rate-limiter', RATE_LIMITER_FLOWS],
    ] as const) {
      const preset = buildChallengePreset(slug)!;
      expect(lintBoard(flows, preset.components, preset.belts), slug).toEqual([]);
    }
  });

  it('a Dropbox queue with no worker is a dead end for uploads', () => {
    const preset = buildChallengePreset('dropbox')!;
    const components = preset.components.filter((c) => c.type !== 'worker-service');
    const belts = preset.belts.filter((b) => !b.fromPortId.startsWith('db-worker') && !b.toPortId.startsWith('db-worker'));
    const issues = lintBoard(DROPBOX_FLOWS, components, belts);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('upload');
    expect(issues[0].message).toMatch(/message.queue/i);
  });

  it('a rate-limiter design that bypasses the limiter cannot run the check flow', () => {
    const preset = buildChallengePreset('rate-limiter')!;
    const components = preset.components.filter((c) => c.type !== 'rate-limiter');
    const belts = preset.belts
      .filter((b) => !b.fromPortId.startsWith('rl-limit') && !b.toPortId.startsWith('rl-limit'))
      .concat({ id: 'bypass', fromPortId: 'rl-lb:out', toPortId: 'rl-api:in', capacity: 5000 });
    const issues = lintBoard(RATE_LIMITER_FLOWS, components, belts);
    expect(issues.some((i) => i.message.includes('traffic filter'))).toBe(true);
  });
});
