import { CONFIG_CHIPS, type ConfigChipId } from '../game/component-config';
import type { ComponentType } from '../game/types';
import type { TagDefinition } from '../game/flow-types';
import { getComponentDef } from '../game/component-catalog';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Scenario-defined roles (docs/specs/flow-authoring.md §2.3) as draggable
 * chips, shown only when the active scenario declares any.
 */
function renderTagChips(tags: readonly TagDefinition[]): string {
  if (tags.length === 0) return '';
  const chips = tags
    .map(
      (tag) => `
    <button
      class="config-chip tag-chip"
      type="button"
      data-tag-chip="${escapeHtml(tag.id)}"
      draggable="true"
      title="${escapeHtml(tag.description ?? tag.label)}"
    >
      <span class="config-chip-emoji">🏷</span>
      <span class="config-chip-label">${escapeHtml(tag.label)}</span>
    </button>
  `
    )
    .join('');
  return `
        <h4 class="config-palette-subtitle">Roles</h4>
        <div class="config-chip-list config-tag-list">
          ${chips}
        </div>
        <p class="config-palette-hint">Drag a role onto a component so flows can single it out.</p>
  `;
}

export function renderConfigPalette(
  selectedComponentId: string | null,
  selectedComponentType: ComponentType | null,
  tags: readonly TagDefinition[] = []
): string {
  const isOpen = selectedComponentId !== null;
  const chips = CONFIG_CHIPS.map(
    (chip) => `
    <button
      class="config-chip"
      type="button"
      data-config-chip="${chip.id}"
      draggable="true"
      title="${chip.description}"
    >
      <span class="config-chip-emoji">${chip.emoji}</span>
      <span class="config-chip-label">${chip.label}</span>
    </button>
  `
  ).join('');

  const selectionHint = selectedComponentId
    ? `<p class="palette-selection">Configuring <strong>${getComponentDef(selectedComponentType!).label}</strong></p>`
    : `<p class="palette-selection muted">Select a component to configure it</p>`;

  return `
    <aside class="config-palette ${isOpen ? 'open' : ''}" id="config-palette" aria-label="Configuration palette" aria-hidden="${!isOpen}">
      <div class="config-palette-body">
        <h3 class="config-palette-title">Configurations</h3>
        ${selectionHint}
        <div class="config-chip-list">
          ${chips}
        </div>
        <p class="config-palette-hint">Drag a config onto the selected component.</p>
        ${renderTagChips(tags)}
      </div>
    </aside>
  `;
}

export function getChipFromEvent(target: EventTarget | null): ConfigChipId | null {
  const el = (target as HTMLElement | null)?.closest('[data-config-chip]') as HTMLElement | null;
  return (el?.dataset.configChip as ConfigChipId) ?? null;
}

export function getTagChipFromEvent(target: EventTarget | null): string | null {
  const el = (target as HTMLElement | null)?.closest('[data-tag-chip]') as HTMLElement | null;
  return el?.dataset.tagChip ?? null;
}
