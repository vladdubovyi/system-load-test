import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { getComponentDef } from './component-catalog';
import { isScalableType } from './architecture-config';

const SOURCE_ID = '__source__';

function makeBelt(fromPortId: string, toPortId: string): ConveyorBelt {
  const isIngress = fromPortId.startsWith(SOURCE_ID);
  return {
    id: `belt-${crypto.randomUUID()}`,
    fromPortId,
    toPortId,
    capacity: isIngress ? 2000 : 1000,
  };
}

export function isScalePrimary(component: PlacedComponent): boolean {
  return (
    isScalableType(component.type) &&
    (!component.scaleGroupId || component.scaleGroupId === component.id)
  );
}

export function getScalePrimaryId(component: PlacedComponent): string {
  return component.scaleGroupId ?? component.id;
}

export function getScaleGroupMembers(
  components: PlacedComponent[],
  primaryId: string
): PlacedComponent[] {
  return components.filter(
    (component) => component.id === primaryId || component.scaleGroupId === primaryId
  );
}

export function createScaleInstance(
  primary: PlacedComponent,
  instanceIndex: number
): PlacedComponent {
  const def = getComponentDef(primary.type);

  // Random, never index- or clock-derived: an index can be reused after a
  // scale-in, and two instances created in one millisecond once collided.
  void instanceIndex;
  return {
    id: `${primary.type}-inst-${primary.id}-${crypto.randomUUID()}`,
    type: primary.type,
    x: primary.x,
    y: primary.y,
    width: def.width,
    height: def.height,
    label: def.label,
    capacity: def.capacity,
    queueLimit: def.queueLimit,
    scaleGroupId: primary.id,
  };
}

export function createInstanceBelts(
  primary: PlacedComponent,
  instance: PlacedComponent,
  components: PlacedComponent[],
  belts: ConveyorBelt[]
): ConveyorBelt[] {
  const newBelts: ConveyorBelt[] = [];
  const primaryInPortId = `${primary.id}:in`;
  const primaryOutPortId = `${primary.id}:out`;

  // Mirror the primary's own wiring. Instances used to hang off the load
  // balancer regardless of what fed the primary, so a service behind a
  // gateway or a rate limiter scaled out to instances that never saw a
  // request — the flow's next step was the gateway, and only the primary
  // was reachable from it.
  for (const belt of belts) {
    if (belt.toPortId === primaryInPortId) {
      newBelts.push(makeBelt(belt.fromPortId, `${instance.id}:in`));
    } else if (belt.fromPortId === primaryOutPortId) {
      newBelts.push(makeBelt(`${instance.id}:out`, belt.toPortId));
    }
  }

  if (!belts.some((belt) => belt.toPortId === primaryInPortId)) {
    // Nothing feeds the primary yet; fall back to the load balancer so the
    // instance is at least reachable.
    const loadBalancer = components.find((component) => component.type === 'load-balancer');
    if (loadBalancer) {
      newBelts.push(makeBelt(`${loadBalancer.id}:out`, `${instance.id}:in`));
    }
  }

  return newBelts;
}

export function removeInstanceBelts(
  instanceId: string,
  belts: ConveyorBelt[]
): ConveyorBelt[] {
  const inPortId = `${instanceId}:in`;
  const outPortId = `${instanceId}:out`;
  return belts.filter(
    (belt) => belt.fromPortId !== inPortId && belt.fromPortId !== outPortId && belt.toPortId !== inPortId && belt.toPortId !== outPortId
  );
}

export function pickDespawnInstance(
  components: PlacedComponent[],
  primaryId: string,
  queuedCount: (componentId: string) => number = () => 0
): PlacedComponent | null {
  const extras = getScaleGroupMembers(components, primaryId).filter(
    (component) => component.id !== primaryId
  );
  if (extras.length === 0) return null;

  const idle = extras.filter((component) => queuedCount(component.id) === 0);
  const candidates = idle.length > 0 ? idle : extras;

  // Ties break on board order (newest instance first), never on the id:
  // ids are random, and a seeded run must make the same choice on every
  // client (interview-platform.md §8).
  const order = new Map(components.map((component, index) => [component.id, index]));
  return [...candidates].sort(
    (a, b) => queuedCount(a.id) - queuedCount(b.id) || order.get(b.id)! - order.get(a.id)!
  )[0]!;
}

export function countReadyInstances(
  components: PlacedComponent[],
  primaryId: string,
  isReady: (componentId: string) => boolean
): number {
  return getScaleGroupMembers(components, primaryId).filter((component) =>
    isReady(component.id)
  ).length;
}

export function scalableServiceTypes(): ComponentType[] {
  return ['shortener', 'backend'];
}
