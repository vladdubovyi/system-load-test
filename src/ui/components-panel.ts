import { getAllComponentTypes, getComponentDef } from '../game/component-catalog';
import { componentRegistry } from '../game/component-registry';
import type { ComponentType } from '../game/types';

const CATEGORY_ORDER = ['networking', 'compute', 'storage', 'messaging', 'infrastructure'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  networking: 'Networking',
  compute: 'Compute',
  storage: 'Storage',
  messaging: 'Messaging',
  infrastructure: 'Infrastructure',
};

function groupComponents(types: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const type of types) {
    const category = getComponentDef(type).category || 'infrastructure';
    const list = groups.get(category) ?? [];
    list.push(type);
    groups.set(category, list);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => getComponentDef(a).label.localeCompare(getComponentDef(b).label));
  }

  return groups;
}

export function renderComponentsPanel(
  activeType: ComponentType | null,
  allowedComponents?: string[]
): string {
  const types = getAllComponentTypes();
  const allowed = allowedComponents?.length ? new Set(allowedComponents) : null;
  const groups = groupComponents(types);

  const sections = CATEGORY_ORDER.map((category) => {
    const items = groups.get(category);
    if (!items?.length) return '';

    return `
      <section class="components-panel-section">
        <h3 class="components-panel-section-title">${CATEGORY_LABELS[category] ?? category}</h3>
        <div class="components-panel-grid">
          ${items
            .map((type) => {
              const def = getComponentDef(type);
              const isAllowed = !allowed || allowed.has(type);
              const meta = componentRegistry.getComponent(type);
              return `
                <button
                  class="components-panel-item ${activeType === type ? 'active' : ''} ${isAllowed ? '' : 'is-optional'}"
                  type="button"
                  data-component="${type}"
                  title="${def.description}${isAllowed ? '' : ' (not required for this challenge)'}"
                >
                  <span class="components-panel-emoji">${def.emoji || meta?.emoji || '📦'}</span>
                  <span class="components-panel-label">${def.label}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </section>
    `;
  }).join('');

  return `
    <aside class="components-panel" id="components-panel" aria-label="Components library">
      <div class="components-panel-header">
        <h2>Components</h2>
        <p>Drag onto the board or click to place.</p>
      </div>
      <div class="components-panel-body">
        ${sections}
      </div>
    </aside>
  `;
}

export function mountComponentsPanel(
  onSelect: (type: ComponentType) => void
): void {
  document.querySelectorAll('.components-panel-item[data-component]').forEach((el) => {
    el.addEventListener('click', () => {
      const type = (el as HTMLElement).dataset.component as ComponentType;
      if (type) onSelect(type);
    });
  });
}
