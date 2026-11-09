import { describe, expect, it } from 'vitest';
import { createInstanceBelts, createScaleInstance, pickDespawnInstance } from '../scale-instances';
import type { ConveyorBelt, PlacedComponent } from '../types';

function comp(id: string, type: string, scaleGroupId?: string): PlacedComponent {
  return { id, type, x: 0, y: 0, width: 120, height: 72, label: type, capacity: 100, queueLimit: 50, scaleGroupId };
}

function belt(id: string, from: string, to: string): ConveyorBelt {
  return { id, fromPortId: `${from}:out`, toPortId: `${to}:in`, capacity: 1000 };
}

describe('scale instances', () => {
  it('wires a new instance from whatever feeds the primary, not only the load balancer', () => {
    // LB → Gateway → API → DB: the instance must hang off the gateway, or
    // the flow (whose next step after ingress is the gateway) never reaches it.
    const lb = comp('lb', 'load-balancer');
    const gw = comp('gw', 'api-gateway');
    const api = comp('api', 'backend-service');
    const db = comp('db', 'database');
    const components = [lb, gw, api, db];
    const belts = [belt('b1', 'lb', 'gw'), belt('b2', 'gw', 'api'), belt('b3', 'api', 'db')];

    const instance = createScaleInstance(api, 1);
    const wired = createInstanceBelts(api, instance, components, belts);

    expect(wired.map((b) => [b.fromPortId, b.toPortId])).toEqual([
      ['gw:out', `${instance.id}:in`],
      [`${instance.id}:out`, 'db:in'],
    ]);
  });

  it('mirrors every upstream when several components feed the primary', () => {
    const lb = comp('lb', 'load-balancer');
    const cdn = comp('cdn', 'cdn');
    const api = comp('api', 'backend-service');
    const components = [lb, cdn, api];
    const belts = [belt('b1', 'lb', 'cdn'), belt('b2', 'lb', 'api'), belt('b3', 'cdn', 'api')];

    const instance = createScaleInstance(api, 1);
    const wired = createInstanceBelts(api, instance, components, belts);

    expect(wired.map((b) => b.fromPortId).sort()).toEqual(['cdn:out', 'lb:out']);
  });

  it('falls back to the load balancer when nothing feeds the primary yet', () => {
    const lb = comp('lb', 'load-balancer');
    const api = comp('api', 'backend-service');
    const instance = createScaleInstance(api, 1);

    const wired = createInstanceBelts(api, instance, [lb, api], []);

    expect(wired.map((b) => [b.fromPortId, b.toPortId])).toEqual([['lb:out', `${instance.id}:in`]]);
  });

  it('gives every instance a unique id, however fast they are created', () => {
    const api = comp('api', 'backend-service');
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      // The same index on purpose: an index is reused after a scale-in.
      ids.add(createScaleInstance(api, 1).id);
    }
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.startsWith('backend-service-inst-api-')).toBe(true);
  });

  it('despawns the idlest instance, breaking ties by board order rather than id', () => {
    const primary = comp('api', 'backend-service');
    // Ids chosen so alphabetical order disagrees with board order.
    const older = comp('zzz-inst', 'backend-service', 'api');
    const newer = comp('aaa-inst', 'backend-service', 'api');
    const components = [primary, older, newer];

    // Both idle: the newest goes first, regardless of id text.
    expect(pickDespawnInstance(components, 'api', () => 0)?.id).toBe('aaa-inst');
    // Queue depth still wins over recency.
    expect(pickDespawnInstance(components, 'api', (id) => (id === 'aaa-inst' ? 5 : 0))?.id).toBe('zzz-inst');
    // No extras: nothing to remove.
    expect(pickDespawnInstance([primary], 'api')).toBeNull();
  });
});
