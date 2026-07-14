import type { ComponentDefinition } from './scenario-types';
import { COMPONENT_DEFS as LEGACY_DEFS } from './types';

export class ComponentRegistry {
  private components: Map<string, ComponentDefinition> = new Map();
  private initialized = false;

  /**
   * Load component definitions from backend or use legacy definitions
   */
  async initialize(definitions?: ComponentDefinition[]): Promise<void> {
    if (this.initialized && !definitions) {
      return;
    }

    this.components.clear();

    if (definitions) {
      // Use backend-loaded definitions
      for (const def of definitions) {
        this.components.set(def.componentType, def);
      }
    } else {
      // Fallback to legacy hardcoded definitions
      // Convert legacy format to new format
      Object.entries(LEGACY_DEFS).forEach(([type, def]) => {
        this.components.set(type, {
          id: type,
          componentType: type,
          label: def.label,
          category: this.getCategoryForType(type),
          defaultCapacity: def.capacity,
          defaultQueueLimit: def.queueLimit,
          monthlyCost: def.monthlyCost,
          emoji: def.emoji,
          width: def.width,
          height: def.height,
          description: def.description,
          enabled: true,
        });
      });
    }

    this.initialized = true;
  }

  /**
   * Get component definition by type
   */
  getComponent(type: string): ComponentDefinition | undefined {
    return this.components.get(type);
  }

  /**
   * Get all component types
   */
  getAllTypes(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Get all component definitions
   */
  getAllComponents(): ComponentDefinition[] {
    return Array.from(this.components.values());
  }

  /**
   * Get components by category
   */
  getComponentsByCategory(category: string): ComponentDefinition[] {
    return Array.from(this.components.values()).filter(c => c.category === category);
  }

  /**
   * Check if a component type exists
   */
  hasComponent(type: string): boolean {
    return this.components.has(type);
  }

  /**
   * Get component definition in legacy format for backward compatibility
   */
  getLegacyDef(type: string): {
    label: string;
    width: number;
    height: number;
    capacity: number;
    queueLimit: number;
    description: string;
    emoji: string;
    monthlyCost: number;
  } | undefined {
    const def = this.components.get(type);
    if (!def) return undefined;

    return {
      label: def.label,
      width: def.width,
      height: def.height,
      capacity: def.defaultCapacity,
      queueLimit: def.defaultQueueLimit,
      description: def.description,
      emoji: def.emoji,
      monthlyCost: def.monthlyCost,
    };
  }

  private getCategoryForType(type: string): 'networking' | 'compute' | 'storage' | 'messaging' | 'infrastructure' {
    if (type === 'load-balancer') return 'networking';
    if (type === 'shortener' || type === 'backend') return 'compute';
    if (type === 'database' || type === 'redis') return 'storage';
    return 'infrastructure';
  }
}

// Singleton instance
export const componentRegistry = new ComponentRegistry();
