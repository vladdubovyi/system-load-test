import { CONFIG_CHIPS, type ConfigChipId } from '../game/component-config';
import type { ComponentType } from '../game/types';
import { COMPONENT_DEFS } from '../game/types';

export function renderConfigPalette(
  selectedComponentId: string | null,
  selectedComponentType: ComponentType | null
): string {
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
    ? `<p class="palette-selection">Selected: <strong>${COMPONENT_DEFS[selectedComponentType!]?.label ?? 'Component'}</strong></p>`
    : `<p class="palette-selection muted">Select a component to inspect configs</p>`;

  return `
    <aside class="config-palette" id="config-palette" aria-label="Configuration palette">
      <div class="config-palette-tab">Configs</div>
      <div class="config-palette-body">
        <h3 class="config-palette-title">Drag onto components</h3>
        ${selectionHint}
        <div class="config-chip-list">
          ${chips}
        </div>
        <p class="config-palette-hint">Drop scaling on services, replication/sharding on databases.</p>
      </div>
    </aside>
  `;
}

export function getChipFromEvent(target: EventTarget | null): ConfigChipId | null {
  const el = (target as HTMLElement | null)?.closest('[data-config-chip]') as HTMLElement | null;
  return (el?.dataset.configChip as ConfigChipId) ?? null;
}
