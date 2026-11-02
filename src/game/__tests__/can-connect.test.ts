import { describe, expect, it } from 'vitest';
import { canConnect, connectionRejectionReason, SOURCE_ID } from '../simulation';
import type { PlacedComponent, Port } from '../types';

/**
 * The connection rules the board enforces while wiring. Every belt a starter
 * ships must also be drawable by hand, otherwise deleting it is irreversible.
 */

function comp(type: string, label = type): PlacedComponent {
  return {
    id: `${type}-1`,
    type,
    x: 0,
    y: 0,
    width: 120,
    height: 72,
    label,
    capacity: 100,
    queueLimit: 50,
  };
}

function port(componentId: string, side: 'in' | 'out'): Port {
  return { id: `${componentId}:${side}`, componentId, side, label: side, x: 0, y: 0 };
}

function wire(from: PlacedComponent | 'source', to: PlacedComponent) {
  const components = [to, ...(from === 'source' ? [] : [from])];
  const map = new Map(components.map((c) => [c.id, c]));
  const fromPort = port(from === 'source' ? SOURCE_ID : from.id, 'out');
  const toPort = port(to.id, 'in');
  return {
    allowed: canConnect(fromPort, toPort, map),
    reason: connectionRejectionReason(fromPort, toPort, map),
  };
}

describe('canConnect', () => {
  it('lets compute hand work to a queue and a queue feed a worker', () => {
    const api = comp('backend-service');
    const queue = comp('message-queue');
    const worker = comp('worker-service');
    expect(wire(api, queue).allowed).toBe(true);
    expect(wire(queue, worker).allowed).toBe(true);
  });

  it('still rejects queues wired to storage or ingress', () => {
    const queue = comp('message-queue', 'Message Queue');
    expect(wire(queue, comp('database', 'SQL Database')).allowed).toBe(false);
    expect(wire(queue, comp('load-balancer')).allowed).toBe(false);
    expect(wire(queue, comp('database', 'SQL Database')).reason).toContain('Message Queue can only feed');
  });

  it('explains rejections in terms of the source component', () => {
    expect(wire('source', comp('database', 'SQL Database')).reason).toMatch(/load balancer or API gateway/);
    expect(wire(comp('load-balancer', 'Load Balancer'), comp('database')).reason).toContain('compute services');
    expect(wire(comp('backend-service', 'Backend Service'), comp('load-balancer')).reason).toContain(
      'message queue'
    );
  });
});
