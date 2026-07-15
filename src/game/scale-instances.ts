import type { ComponentType, ConveyorBelt, PlacedComponent } from './types';
import { COMPONENT_DEFS } from './types';
import { isScalableType } from './architecture-config';

const SOURCE_ID = '__source__';

function makeBelt(fromPortId: string, toPortId: string): ConveyorBelt {
  const isIngress = fromPortId.startsWith(SOURCE_ID);
  return {
    id: `belt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
  const def = COMPONENT_DEFS[primary.type];

  return {
    id: `${primary.type}-inst-${primary.id}-${instanceIndex}-${Date.now().toString(36)}`,
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
  const loadBalancer = components.find((component) => component.type === 'load-balancer');

  if (loadBalancer) {
    newBelts.push(makeBelt(`${loadBalancer.id}:out`, `${instance.id}:in`));
  }

  const primaryOutPortId = `${primary.id}:out`;
  for (const belt of belts) {
    if (belt.fromPortId === primaryOutPortId) {
      newBelts.push(makeBelt(`${instance.id}:out`, belt.toPortId));
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

  return [...candidates].sort(
    (a, b) => queuedCount(a.id) - queuedCount(b.id) || a.id.localeCompare(b.id)
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
