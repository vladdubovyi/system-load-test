import { COMPONENT_DEFS, type ComponentType } from '../game/types';

export type BoardTool = 'select' | 'hand' | 'pen' | 'text' | 'component';

const MAIN_TOOLS: { id: BoardTool; icon: string; label: string; shortcut?: string }[] = [
  { id: 'select', icon: '↖', label: 'Select', shortcut: 'V' },
  { id: 'hand', icon: '✋', label: 'Hand', shortcut: 'H' },
  { id: 'pen', icon: '✏️', label: 'Draw', shortcut: 'P' },
  { id: 'text', icon: 'T', label: 'Text', shortcut: 'T' },
];

export function renderFloatingChrome(
  activeTool: BoardTool,
  placementType: ComponentType | null,
  zoomPct: number,
  simulationSpeed: 1 | 5 | 20 | 100 = 1
): string {
  const componentTypes = Object.keys(COMPONENT_DEFS) as ComponentType[];

  return `
    <div class="canvas-chrome">
      <div class="chrome-top-left">
        <button class="chrome-menu-btn" id="btn-menu" type="button" title="Menu" aria-label="Menu" aria-haspopup="true">☰</button>
        <div class="main-menu-dropdown" id="main-menu" hidden>
          <button class="menu-item" id="menu-challenge" type="button">🎯 Choose Challenge</button>
          <div class="menu-divider"></div>
          <button class="menu-item" id="menu-preset" type="button">⚡ Load preset</button>
          <button class="menu-item" id="menu-reset" type="button">Reset board</button>
          <div class="menu-divider"></div>
          <p class="menu-hint">H hand · V select · P draw · T text</p>
          <p class="menu-hint">Middle-click or Space+drag to pan · Scroll to zoom</p>
        </div>
        <div class="chrome-brand">
          <span class="chrome-brand-icon">🏗️</span>
          <span class="chrome-brand-name">System Design Game</span>
        </div>
      </div>

      <div class="floating-toolbar main-toolbar" role="toolbar" aria-label="Drawing tools">
        ${MAIN_TOOLS.map(
          (tool) => `
          <button
            class="tool-btn ${activeTool === tool.id ? 'active' : ''}"
            data-tool="${tool.id}"
            type="button"
            title="${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}"
            aria-label="${tool.label}"
            aria-pressed="${activeTool === tool.id}"
          >
            <span class="tool-icon">${tool.icon}</span>
          </button>
        `
        ).join('<span class="tool-divider"></span>')}
      </div>

      <div class="floating-toolbar component-toolbar" role="toolbar" aria-label="Components">
        ${componentTypes
          .map(
            (type) => `
          <button
            class="component-tool-btn ${activeTool === 'component' && placementType === type ? 'active' : ''}"
            data-component="${type}"
            type="button"
            title="${COMPONENT_DEFS[type].label}"
            aria-label="${COMPONENT_DEFS[type].label}"
          >
            <span class="component-tool-emoji">${COMPONENT_DEFS[type].emoji}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <div class="chrome-top-right">
        <button class="chrome-action-btn" id="btn-preset" type="button">⚡ Preset</button>
        <button class="chrome-action-btn" id="btn-reset" type="button">Reset</button>
        <div class="speed-controls">
          <button class="speed-btn ${simulationSpeed === 1 ? 'active' : ''}" data-speed="1" type="button">1x</button>
          <button class="speed-btn ${simulationSpeed === 5 ? 'active' : ''}" data-speed="5" type="button">5x</button>
          <button class="speed-btn ${simulationSpeed === 20 ? 'active' : ''}" data-speed="20" type="button">20x</button>
          <button class="speed-btn ${simulationSpeed === 100 ? 'active' : ''}" data-speed="100" type="button">100x</button>
        </div>
        <button class="chrome-action-btn chrome-action-primary" id="btn-play" type="button">▶ Play</button>
      </div>

      <div class="floating-hud" id="header-stats"></div>

      <div class="floating-status" id="status-bar"></div>

      <div class="zoom-controls">
        <button class="zoom-btn" id="btn-zoom-out" type="button" title="Zoom out">−</button>
        <span class="zoom-label" id="zoom-label">${zoomPct}%</span>
        <button class="zoom-btn" id="btn-zoom-in" type="button" title="Zoom in">+</button>
        <button class="zoom-btn" id="btn-zoom-reset" type="button" title="Reset zoom">100%</button>
      </div>

      <div class="canvas-hint" id="canvas-hint">
        Scroll to zoom · Middle-click or Space+drag to pan · Click text to edit
      </div>
    </div>
  `;
}

export function toolCursor(tool: BoardTool): string {
  switch (tool) {
    case 'hand':
      return 'grab';
    case 'pen':
      return 'crosshair';
    case 'text':
      return 'text';
    case 'component':
      return 'copy';
    default:
      return 'default';
  }
}
