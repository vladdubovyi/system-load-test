import { componentRegistry } from './component-registry';
import { COMPONENT_DEFS } from './types';

export interface ComponentDefView {
  label: string;
  width: number;
  height: number;
  capacity: number;
  queueLimit: number;
  description: string;
  emoji: string;
  monthlyCost: number;
  category: string;
}

export function getComponentDef(type: string): ComponentDefView {
  const fromRegistry = componentRegistry.getLegacyDef(type);
  if (fromRegistry) {
    const meta = componentRegistry.getComponent(type);
    return {
      ...fromRegistry,
      category: meta?.category ?? 'infrastructure',
    };
  }

  const legacy = COMPONENT_DEFS[type as keyof typeof COMPONENT_DEFS];
  if (legacy) {
    return {
      ...legacy,
      category:
        type === 'load-balancer'
          ? 'networking'
          : type === 'database' || type === 'redis'
            ? 'storage'
            : 'compute',
    };
  }

  return {
    label: type,
    width: 140,
    height: 72,
    capacity: 200,
    queueLimit: 100,
    description: type,
    emoji: '📦',
    monthlyCost: 100,
    category: 'infrastructure',
  };
}

export function getAllComponentTypes(): string[] {
  const registryTypes = componentRegistry.getAllComponents().map((c) => c.componentType);
  if (registryTypes.length > 0) {
    return registryTypes.sort((a, b) => a.localeCompare(b));
  }
  return Object.keys(COMPONENT_DEFS).sort();
}
