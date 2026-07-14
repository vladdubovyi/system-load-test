import './styles/main.css';
import {
  SCENARIO,
  COMPONENT_DEFS,
  type ComponentType,
  type PlacedComponent,
  type ConveyorBelt,
  type Port,
} from './game/types';
import {
  SimulationEngine,
  createComponent,
  createBelt,
  getSourcePort,
  getComponentPorts,
  canConnect,
  SOURCE_ID,
} from './game/simulation';
import { URL_SHORTENER_PRESET, buildPreset } from './game/presets';
import { BoardRenderer } from './ui/board-renderer';
import { AnnotationRenderer } from './ui/annotation-renderer';
import { ConnectionPreview } from './ui/connection-preview';
import { mountReportModal } from './ui/report-modal';
import { renderConfigPalette, getChipFromEvent } from './ui/config-palette';
import {
  applyConfigChip,
  buildReferenceComponentConfigs,
  cloneComponentConfigMap,
  createEmptyComponentConfig,
  type ComponentInstanceConfig,
  type ConfigChipId,
} from './game/component-config';
import {
  createDefaultAnnotations,
  createStrokePoint,
  createTextAnnotation,
  type BoardAnnotations,
  type DrawStroke,
} from './game/board-annotations';
import {
  clampZoom,
  DEFAULT_VIEWPORT,
  screenToWorld,
  applyViewportStyles,
  type ViewportState,
} from './ui/viewport';
import {
  renderFloatingChrome,
  toolCursor,
  type BoardTool,
} from './ui/floating-toolbar';
import { initializeApp } from './game/app-init';
import { componentRegistry } from './game/component-registry';
import { mountChallengeSelector } from './ui/challenge-selector';
import type { Challenge } from './game/scenario-types';

type BoardSelection =
  | { kind: 'component'; id: string }
  | { kind: 'text'; id: string }
  | null;

interface GameState {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  annotations: BoardAnnotations;
  componentConfigs: Map<string, ComponentInstanceConfig>;
  activeTool: BoardTool;
  placementType: ComponentType | null;
  selection: BoardSelection;
  connectingFromPortId: string | null;
  configChipDrag: ConfigChipId | null;
  dragging: { kind: 'component' | 'text'; id: string; offsetX: number; offsetY: number } | null;
  panning: { startX: number; startY: number; panX: number; panY: number } | null;
  drawing: DrawStroke | null;
  pointerDragged: boolean;
  spaceHeld: boolean;
  viewport: ViewportState;
  lastPointer: { x: number; y: number };
  engine: SimulationEngine | null;
  animFrame: number | null;
  lastTick: number;
  simAccumulator: number;
  lastRunStatus: 'idle' | 'running' | 'won' | 'lost';
  displayedHud: {
    time: number;
    rps: number;
    spawned: number;
    completed: number;
    dropped: number;
  };
  currentChallenge: Challenge | null;
  availableChallenges: Challenge[];
  challengeSelectorOpen: boolean;
  simulationSpeed: 1 | 5 | 20 | 100;
  history: HistoryEntry[];
  historyIndex: number;
  maxHistory: number;
}

interface HistoryEntry {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
}

const SIM_STEP = 1 / 60;
const HUD_LERP_SPEED = 2.2;

const state: GameState = {
  components: [],
  belts: [],
  annotations: createDefaultAnnotations(),
  componentConfigs: new Map(),
  activeTool: 'hand',
  placementType: null,
  selection: null,
  connectingFromPortId: null,
  configChipDrag: null,
  dragging: null,
  panning: null,
  drawing: null,
  pointerDragged: false,
  spaceHeld: false,
  viewport: { ...DEFAULT_VIEWPORT },
  lastPointer: { x: 0, y: 0 },
  engine: null,
  animFrame: null,
  lastTick: 0,
  simAccumulator: 0,
  lastRunStatus: 'idle',
  displayedHud: { time: 0, rps: 0, spawned: 0, completed: 0, dropped: 0 },
  currentChallenge: null,
  availableChallenges: [],
  challengeSelectorOpen: false,
  simulationSpeed: 1,
  history: [],
  historyIndex: -1,
  maxHistory: 50,
};

const boardRenderer = new BoardRenderer();
const annotationRenderer = new AnnotationRenderer();
const connectionPreview = new ConnectionPreview();
const app = document.getElementById('app')!;

interface BoardSnapshot {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
}

let boardSnapshotBeforeSim: BoardSnapshot | null = null;

function invalidateBoardSnapshot(): void {
  boardSnapshotBeforeSim = null;
}

function captureBoardSnapshot(): void {
  boardSnapshotBeforeSim = {
    components: structuredClone(state.components),
    belts: structuredClone(state.belts),
    componentConfigs: cloneComponentConfigMap(state.componentConfigs),
  };
}

function onSimulationTopologyChange(): void {
  mountBoard();
  const selected = selectedComponentId();
  if (selected && !state.components.some((component) => component.id === selected)) {
    state.selection = null;
    refreshConfigPalette();
  }
}

function isSimRunning(): boolean {
  return state.engine?.getSnapshot().status === 'running';
}

function selectedComponentId(): string | null {
  return state.selection?.kind === 'component' ? state.selection.id : null;
}

function selectedComponentType(): ComponentType | null {
  if (state.selection?.kind !== 'component') return null;
  return state.components.find((c) => c.id === state.selection!.id)?.type ?? null;
}

function render(): void {
  const zoomPct = Math.round(state.viewport.zoom * 100);
  app.innerHTML = `
    <div class="canvas-app">
      ${renderFloatingChrome(state.activeTool, state.placementType, zoomPct, state.simulationSpeed)}
      ${renderConfigPalette(selectedComponentId(), selectedComponentType())}

      <div class="board-viewport" id="board-viewport">
        <div class="board-pan" id="board-pan">
          <div class="board-world" id="board-world">
            <div class="board" id="board">
              <div class="source-node" id="source-node">
                <div class="source-icon">📨</div>
                <div class="source-label">Incoming Requests</div>
                <button class="port port-out" data-port-id="${SOURCE_ID}:out" type="button" title="Drag to connect"></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  mountBoard();
  updateStatus();
  applyViewport();
  updateToolUi();
  refreshConfigPalette();
}

function refreshConfigPalette(): void {
  const palette = document.getElementById('config-palette');
  if (!palette) return;

  const isOpen = selectedComponentId() !== null;
  palette.classList.toggle('open', isOpen);
  palette.setAttribute('aria-hidden', String(!isOpen));

  const hint = palette.querySelector('.palette-selection');
  if (hint) {
    const type = selectedComponentType();
    hint.className = `palette-selection${type ? '' : ' muted'}`;
    hint.innerHTML = type
      ? `Configuring <strong>${COMPONENT_DEFS[type].label}</strong>`
      : 'Select a component to configure it';
  }
}

function applyViewport(): void {
  const pan = document.getElementById('board-pan');
  const world = document.getElementById('board-world');
  if (pan && world) applyViewportStyles(pan, world, state.viewport);
  const zoomLabel = document.getElementById('zoom-label');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.viewport.zoom * 100)}%`;
}

function clearTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function getEffectiveTool(): BoardTool {
  if (state.spaceHeld && state.activeTool !== 'pen' && state.activeTool !== 'text') {
    return 'hand';
  }
  return state.activeTool;
}

function pointInComponent(world: { x: number; y: number }, c: PlacedComponent): boolean {
  return (
    world.x >= c.x &&
    world.x <= c.x + c.width &&
    world.y >= c.y &&
    world.y <= c.y + c.height
  );
}

function selectItem(selection: BoardSelection): void {
  state.selection = selection;
  boardRenderer.updateSelection(selectedComponentId());
  annotationRenderer.updateTextSelection(
    selection?.kind === 'text' ? selection.id : null
  );
  refreshConfigPalette();
}

function findDragTarget(
  e: PointerEvent,
  world: { x: number; y: number }
): BoardSelection {
  if (state.selection?.kind === 'component') {
    const selected = state.components.find((c) => c.id === state.selection!.id);
    if (selected && pointInComponent(world, selected)) return state.selection;
  }
  if (state.selection?.kind === 'text') {
    const selected = state.annotations.texts.find((t) => t.id === state.selection!.id);
    if (
      selected &&
      world.x >= selected.x &&
      world.x <= selected.x + selected.width &&
      world.y >= selected.y &&
      world.y <= selected.y + selected.minHeight
    ) {
      return state.selection;
    }
  }

  const elements = document.elementsFromPoint(e.clientX, e.clientY);
  for (const el of elements) {
    const comp = (el as HTMLElement).closest('.component') as HTMLElement | null;
    if (comp) return { kind: 'component', id: comp.dataset.id! };
    const text = (el as HTMLElement).closest('.board-text') as HTMLElement | null;
    if (text) return { kind: 'text', id: text.dataset.textId! };
  }
  return null;
}

function startPan(e: PointerEvent, viewport: HTMLElement): void {
  state.panning = {
    startX: e.clientX,
    startY: e.clientY,
    panX: state.viewport.panX,
    panY: state.viewport.panY,
  };
  clearTextSelection();
  viewport.setPointerCapture(e.pointerId);
  updateToolUi();
}

function tryStartDrag(
  target: BoardSelection,
  world: { x: number; y: number },
  viewport: HTMLElement,
  e: PointerEvent
): boolean {
  if (!target || isSimRunning()) return false;

  if (target.kind === 'component') {
    const c = state.components.find((x) => x.id === target.id);
    if (!c) return false;
    selectItem(target);
    state.dragging = {
      kind: 'component',
      id: target.id,
      offsetX: world.x - c.x,
      offsetY: world.y - c.y,
    };
    document.querySelector(`[data-id="${target.id}"]`)?.classList.add('dragging');
    viewport.setPointerCapture(e.pointerId);
    return true;
  }

  const text = state.annotations.texts.find((t) => t.id === target.id);
  if (!text) return false;
  selectItem(target);
  state.dragging = {
    kind: 'text',
    id: target.id,
    offsetX: world.x - text.x,
    offsetY: world.y - text.y,
  };
  viewport.setPointerCapture(e.pointerId);
  return true;
}

function beginTextEdit(textId: string): void {
  annotationRenderer.beginTextEdit(textId, (content) => {
    const text = state.annotations.texts.find((t) => t.id === textId);
    if (text) text.content = content;
  });
}

function updateToolUi(): void {
  const viewport = document.getElementById('board-viewport');
  if (!viewport) return;
  viewport.style.cursor = state.panning || state.connectingFromPortId
    ? 'grabbing'
    : toolCursor(getEffectiveTool());
  viewport.classList.toggle('is-panning', Boolean(state.panning));
}

function getViewportRect(): DOMRect {
  return document.getElementById('board-viewport')!.getBoundingClientRect();
}

function eventToWorld(e: MouseEvent | PointerEvent): { x: number; y: number } {
  return screenToWorld(e.clientX, e.clientY, getViewportRect(), state.viewport);
}

function getAllPorts(): Port[] {
  const ports = [getSourcePort(state.components)];
  for (const c of state.components) {
    ports.push(...getComponentPorts(c));
  }
  return ports;
}

function getPortById(id: string): Port | undefined {
  return getAllPorts().find((p) => p.id === id);
}

function findPortAtScreen(x: number, y: number): Port | null {
  const elements = document.elementsFromPoint(x, y);
  for (const el of elements) {
    const portBtn = (el as HTMLElement).closest('.port') as HTMLElement | null;
    if (portBtn?.dataset.portId) {
      return getPortById(portBtn.dataset.portId) ?? null;
    }
  }
  return null;
}

function mountBoard(): void {
  const board = document.getElementById('board');
  if (!board) return;
  annotationRenderer.destroy();
  connectionPreview.destroy();
  annotationRenderer.mount(board);
  annotationRenderer.render(state.annotations);
  annotationRenderer.updateTextSelection(
    state.selection?.kind === 'text' ? state.selection.id : null
  );
  connectionPreview.mount(board);
  boardRenderer.mount(
    board,
    state.components,
    state.belts,
    selectedComponentId(),
    state.componentConfigs
  );
  boardRenderer.update(null, 0);
  positionSourceNode();
}

function refreshBoardVisuals(snapshot = state.engine?.getSnapshot() ?? null, dt = 0): void {
  boardRenderer.update(snapshot, dt);
  positionSourceNode();
}

function positionSourceNode(): void {
  const sourceNode = document.getElementById('source-node');
  if (!sourceNode) return;
  const port = getSourcePort(state.components);
  sourceNode.style.left = `${port.x - 36}px`;
  sourceNode.style.top = `${port.y - 72}px`;
}

function lerpHud(current: number, target: number, dt: number): number {
  const factor = 1 - Math.exp(-HUD_LERP_SPEED * dt);
  return current + (target - current) * factor;
}

function updateStatus(dt = 0): void {
  const bar = document.getElementById('status-bar');
  const stats = document.getElementById('header-stats');
  if (!bar || !stats) return;

  const snap = state.engine?.getSnapshot() ?? null;
  const running = snap?.status === 'running';

  bar.className = 'floating-status';
  if (snap?.status === 'won') bar.classList.add('won');
  if (snap?.status === 'lost') bar.classList.add('lost');
  if (snap?.spikeActive) bar.classList.add('spike');
  bar.textContent =
    snap?.message ??
    'Drag configs onto components, drag ports to connect, then press Play.';

  if (snap) {
    if (dt > 0) {
      state.displayedHud.time = lerpHud(state.displayedHud.time, snap.time, dt);
      state.displayedHud.rps = lerpHud(state.displayedHud.rps, snap.currentRps, dt);
      state.displayedHud.spawned = lerpHud(state.displayedHud.spawned, snap.totalSpawned, dt);
      state.displayedHud.completed = lerpHud(state.displayedHud.completed, snap.totalCompleted, dt);
      state.displayedHud.dropped = lerpHud(state.displayedHud.dropped, snap.totalDropped, dt);
    } else {
      state.displayedHud = {
        time: snap.time,
        rps: snap.currentRps,
        spawned: snap.totalSpawned,
        completed: snap.totalCompleted,
        dropped: snap.totalDropped,
      };
    }

    const hud = state.displayedHud;
    stats.innerHTML = `
      <div class="hud-stat"><span class="hud-label">Time</span><span class="hud-value">${hud.time.toFixed(1)}s / ${SCENARIO.duration}s</span></div>
      <div class="hud-stat"><span class="hud-label">RPS</span><span class="hud-value ${snap.spikeActive ? 'spike' : ''}">${Math.round(hud.rps)}</span></div>
      <div class="hud-stat"><span class="hud-label">Done</span><span class="hud-value">${Math.round(hud.completed).toLocaleString()}</span></div>
      <div class="hud-stat"><span class="hud-label">Dropped</span><span class="hud-value ${snap.totalDropped > 0 ? 'bad' : ''}">${Math.round(hud.dropped).toLocaleString()}</span></div>
    `;
  } else {
    stats.innerHTML = `
      <div class="hud-stat"><span class="hud-label">Scenario</span><span class="hud-value">URL Shortener</span></div>
      <div class="hud-stat"><span class="hud-label">Duration</span><span class="hud-value">${SCENARIO.duration}s</span></div>
    `;
  }

  const playBtn = document.getElementById('btn-play') as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.textContent = running ? '⏸ Pause' : '▶ Play';
    playBtn.disabled = state.components.length === 0;
  }
}

function setTool(tool: BoardTool, placementType: ComponentType | null = null): void {
  state.activeTool = tool;
  state.placementType = placementType;
  state.connectingFromPortId = null;
  connectionPreview.clear();
  clearPortHighlights();

  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tool === tool);
  });
  document.querySelectorAll('[data-component]').forEach((el) => {
    const type = (el as HTMLElement).dataset.component as ComponentType;
    el.classList.toggle('active', tool === 'component' && type === placementType);
  });

  updateToolUi();
}

function getOrCreateComponentConfig(componentId: string): ComponentInstanceConfig {
  let cfg = state.componentConfigs.get(componentId);
  if (!cfg) {
    cfg = createEmptyComponentConfig();
    state.componentConfigs.set(componentId, cfg);
  }
  return cfg;
}

function dropConfigChipOnComponent(componentId: string, chipId: ConfigChipId): void {
  const component = state.components.find((c) => c.id === componentId);
  if (!component) return;
  const cfg = getOrCreateComponentConfig(componentId);
  if (applyConfigChip(cfg, chipId, component.type)) {
    state.componentConfigs.set(componentId, cfg);
    boardRenderer.updateComponentConfigs(state.componentConfigs);
    selectItem({ kind: 'component', id: componentId });
    invalidateBoardSnapshot();
    pushHistory();
  }
}

function deleteSelection(): void {
  if (!state.selection || isSimRunning()) return;

  if (state.selection.kind === 'component') {
    const id = state.selection.id;
    state.components = state.components.filter((c) => c.id !== id);
    state.componentConfigs.delete(id);
    state.belts = state.belts.filter((b) => {
      const from = getPortById(b.fromPortId);
      const to = getPortById(b.toPortId);
      return from?.componentId !== id && to?.componentId !== id;
    });
    state.selection = null;
    mountBoard();
    invalidateBoardSnapshot();
    pushHistory();
    return;
  }

  state.annotations.texts = state.annotations.texts.filter((t) => t.id !== state.selection!.id);
  state.selection = null;
  annotationRenderer.render(state.annotations);
  pushHistory();
}

function bindEvents(): void {
  const viewport = document.getElementById('board-viewport')!;

  window.addEventListener('resize', () => boardRenderer.resizeCanvas());

  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool((btn as HTMLElement).dataset.tool as BoardTool);
    });
  });

  document.querySelectorAll('[data-component]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool('component', (btn as HTMLElement).dataset.component as ComponentType);
    });
  });

  const menu = document.getElementById('main-menu');
  document.getElementById('btn-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) menu.hidden = !menu.hidden;
  });
  document.getElementById('menu-challenge')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    openChallengeSelector();
  });
  document.getElementById('menu-preset')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    loadPreset();
  });
  document.getElementById('menu-reset')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    resetBoard();
  });
  window.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#btn-menu, #main-menu') && menu) {
      menu.hidden = true;
    }
  });

  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (isSimRunning()) stopSimulation();
    else startSimulation();
  });
  document.getElementById('btn-preset')?.addEventListener('click', loadPreset);
  document.getElementById('btn-reset')?.addEventListener('click', resetBoard);
  
  // Speed control buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseInt(btn.getAttribute('data-speed') || '1');
      state.simulationSpeed = speed as 1 | 5 | 20 | 100;
      render();
    });
  });

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    zoomAt(state.lastPointer.x, state.lastPointer.y, 1.15);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    zoomAt(state.lastPointer.x, state.lastPointer.y, 1 / 1.15);
  });
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    const rect = getViewportRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / state.viewport.zoom);
  });

  document.querySelectorAll('[data-config-chip]').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
      const chipId = getChipFromEvent(e.target);
      if (!chipId) return;
      state.configChipDrag = chipId;
      (e as DragEvent).dataTransfer?.setData('text/plain', chipId);
      if (e instanceof DragEvent) e.dataTransfer!.effectAllowed = 'copy';
    });
    chip.addEventListener('dragend', () => {
      state.configChipDrag = null;
    });
  });

  viewport.addEventListener('dragover', (e) => {
    if (!state.configChipDrag) return;
    e.preventDefault();
  });

  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    const chipId = state.configChipDrag ?? (e.dataTransfer?.getData('text/plain') as ConfigChipId);
    state.configChipDrag = null;
    if (!chipId) return;

    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of elements) {
      const comp = (el as HTMLElement).closest('.component') as HTMLElement | null;
      if (comp?.dataset.id) {
        dropConfigChipOnComponent(comp.dataset.id, chipId);
        return;
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if ((e.target as HTMLElement).isContentEditable) return;

    if (e.code === 'Space' && !state.spaceHeld) {
      e.preventDefault();
      state.spaceHeld = true;
      updateToolUi();
    }
    if (e.key === 'v' || e.key === 'V') setTool('select');
    if (e.key === 'h' || e.key === 'H') setTool('hand');
    if (e.key === 'p' || e.key === 'P') setTool('pen');
    if (e.key === 't' || e.key === 'T') setTool('text');
    if (e.key === 'Escape') {
      setTool('hand');
      selectItem(null);
      if (menu) menu.hidden = true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    }
    // Undo/Redo shortcuts
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.spaceHeld = false;
      state.panning = null;
      updateToolUi();
    }
  });

  viewport.addEventListener('selectstart', (e) => {
    if ((e.target as HTMLElement).closest('.board-text.editing')) return;
    e.preventDefault();
  });
  viewport.addEventListener('dragstart', (e) => e.preventDefault());

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false }
  );

  viewport.addEventListener('pointermove', (e) => {
    state.lastPointer = { x: e.clientX, y: e.clientY };

    if (state.connectingFromPortId) {
      const from = getPortById(state.connectingFromPortId);
      if (from) {
        connectionPreview.update(from, eventToWorld(e));
        highlightNearestPort(e.clientX, e.clientY);
      }
    }

    if (state.panning) {
      const dx = e.clientX - state.panning.startX;
      const dy = e.clientY - state.panning.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        state.pointerDragged = true;
        clearTextSelection();
      }
      state.viewport.panX = state.panning.panX + dx;
      state.viewport.panY = state.panning.panY + dy;
      applyViewport();
      return;
    }

    if (state.drawing) {
      state.pointerDragged = true;
      const world = eventToWorld(e);
      const last = state.drawing.points[state.drawing.points.length - 1];
      if (!last || Math.hypot(world.x - last.x, world.y - last.y) > 2) {
        state.drawing.points.push({ x: world.x, y: world.y });
        annotationRenderer.renderLiveStroke(state.drawing);
      }
      return;
    }

    if (!state.dragging || isSimRunning()) return;

    state.pointerDragged = true;
    const world = eventToWorld(e);

    if (state.dragging.kind === 'component') {
      const c = state.components.find((x) => x.id === state.dragging!.id);
      if (!c) return;
      c.x = world.x - state.dragging.offsetX;
      c.y = world.y - state.dragging.offsetY;
      boardRenderer.updatePositions(state.components);
      positionSourceNode();
      return;
    }

    const text = state.annotations.texts.find((t) => t.id === state.dragging!.id);
    if (text) {
      text.x = world.x - state.dragging.offsetX;
      text.y = world.y - state.dragging.offsetY;
      annotationRenderer.render(state.annotations);
      annotationRenderer.updateTextSelection(text.id);
    }
  });

  viewport.addEventListener('pointerdown', (e) => {
    const isMiddle = e.button === 1;
    const isLeft = e.button === 0;
    if (!isLeft && !isMiddle) return;
    if (isMiddle) e.preventDefault();

    state.pointerDragged = false;
    state.lastPointer = { x: e.clientX, y: e.clientY };
    const world = eventToWorld(e);

    const portBtn = (e.target as HTMLElement).closest('.port') as HTMLElement | null;
    if (portBtn && isLeft && !isSimRunning()) {
      e.stopPropagation();
      const port = getPortById(portBtn.dataset.portId!);
      if (port) {
        state.connectingFromPortId = port.id;
        highlightPort(port.id);
        connectionPreview.update(port, world);
        viewport.setPointerCapture(e.pointerId);
        updateToolUi();
      }
      return;
    }

    const effectiveTool = isMiddle ? 'hand' : getEffectiveTool();
    const dragTarget = findDragTarget(e, world);

    if (
      dragTarget &&
      (effectiveTool === 'hand' || effectiveTool === 'select' || state.selection)
    ) {
      if (tryStartDrag(dragTarget, world, viewport, e)) return;
    }

    if (effectiveTool === 'hand' || isMiddle) {
      if ((e.target as HTMLElement).closest('.board-text.editing')) return;
      startPan(e, viewport);
      return;
    }

    if (isSimRunning()) return;

    if (effectiveTool === 'pen') {
      state.drawing = createStrokePoint(world.x, world.y);
      annotationRenderer.renderLiveStroke(state.drawing);
      viewport.setPointerCapture(e.pointerId);
      return;
    }

    if (effectiveTool === 'select' && dragTarget) {
      selectItem(dragTarget);
      return;
    }
  });

  viewport.addEventListener('click', (e) => {
    if (state.pointerDragged) return;
    if (isSimRunning()) return;
    if ((e.target as HTMLElement).closest('.port')) return;

    const world = eventToWorld(e);

    if (state.activeTool === 'component' && state.placementType) {
      const comp = createComponent(
        state.placementType,
        world.x - 70,
        world.y - 36
      );
      state.components.push(comp);
      mountBoard();
      invalidateBoardSnapshot();
      selectItem({ kind: 'component', id: comp.id });
      pushHistory();
      setTool('hand');
      return;
    }

    if (state.activeTool === 'text') {
      const annotation = createTextAnnotation(world.x, world.y);
      state.annotations.texts.push(annotation);
      annotationRenderer.render(state.annotations);
      selectItem({ kind: 'text', id: annotation.id });
      setTool('hand');
      requestAnimationFrame(() => beginTextEdit(annotation.id));
      return;
    }

    if (getEffectiveTool() === 'select' || getEffectiveTool() === 'hand') {
      const target = findDragTarget(e, world);
      if (target?.kind === 'text' && !state.pointerDragged) {
        selectItem(target);
        beginTextEdit(target.id);
        return;
      }
      if (!target) selectItem(null);
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (state.connectingFromPortId) {
      finishConnection(e.clientX, e.clientY);
      state.connectingFromPortId = null;
      connectionPreview.clear();
      clearPortHighlights();
      updateToolUi();
    }

    if (state.drawing) {
      if (state.drawing.points.length > 1) {
        state.annotations.strokes.push(state.drawing);
      }
      state.drawing = null;
      annotationRenderer.render(state.annotations);
    }

    state.panning = null;
    state.dragging = null;
    document.querySelectorAll('.component.dragging').forEach((el) => el.classList.remove('dragging'));
    updateToolUi();
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  viewport.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
}

function finishConnection(screenX: number, screenY: number): void {
  const from = getPortById(state.connectingFromPortId!);
  if (!from) return;

  const to = findPortAtScreen(screenX, screenY);
  if (!to || to.id === from.id) return;

  const componentMap = new Map(state.components.map((c) => [c.id, c]));
  const fromPort = from.side === 'out' ? from : to;
  const toPort = to.side === 'in' ? to : from;

  if (fromPort.side !== 'out' || toPort.side !== 'in') return;
  if (!canConnect(fromPort, toPort, componentMap)) return;

  const exists = state.belts.some(
    (b) => b.fromPortId === fromPort.id && b.toPortId === toPort.id
  );
  if (!exists) {
    state.belts.push(createBelt(fromPort.id, toPort.id));
    mountBoard();
    invalidateBoardSnapshot();
    pushHistory();
  }
}

function highlightNearestPort(screenX: number, screenY: number): void {
  clearPortHighlights();
  const port = findPortAtScreen(screenX, screenY);
  if (port) highlightPort(port.id);
}

function highlightPort(portId: string): void {
  document.querySelector(`[data-port-id="${portId}"]`)?.classList.add('port-active');
}

function clearPortHighlights(): void {
  document.querySelectorAll('.port-active').forEach((el) => el.classList.remove('port-active'));
}

function zoomAt(screenX: number, screenY: number, factor: number): void {
  const rect = getViewportRect();
  const before = screenToWorld(screenX, screenY, rect, state.viewport);
  const newZoom = clampZoom(Math.round(state.viewport.zoom * factor * 1000) / 1000);
  state.viewport.zoom = newZoom;
  state.viewport.panX = screenX - rect.left - before.x * newZoom;
  state.viewport.panY = screenY - rect.top - before.y * newZoom;
  applyViewport();
}

function resetBoard(): void {
  stopSimulation();
  invalidateBoardSnapshot();
  state.components = [];
  state.belts = [];
  state.annotations = createDefaultAnnotations();
  state.componentConfigs = new Map();
  state.engine = null;
  state.selection = null;
  mountBoard();
  updateStatus();
  setTool('hand');
}

function loadPreset(): void {
  if (isSimRunning()) stopSimulation();
  invalidateBoardSnapshot();

  const { components, belts } = buildPreset(URL_SHORTENER_PRESET);
  state.components = components;
  state.belts = belts;
  state.annotations = createDefaultAnnotations();
  state.componentConfigs = cloneComponentConfigMap(buildReferenceComponentConfigs(components));
  state.engine = null;
  state.selection = null;
  setTool('hand');
  mountBoard();
  updateStatus();
}

function showRunReport(): void {
  if (!state.engine) return;
  mountReportModal(
    state.engine.getReport(),
    () => undefined,
    () => startSimulation()
  );
}

function startSimulation(): void {
  if (!boardSnapshotBeforeSim) {
    captureBoardSnapshot();
  }

  state.components = structuredClone(boardSnapshotBeforeSim!.components);
  state.belts = structuredClone(boardSnapshotBeforeSim!.belts);
  state.componentConfigs = cloneComponentConfigMap(boardSnapshotBeforeSim!.componentConfigs);
  state.selection = null;
  mountBoard();

  state.engine = new SimulationEngine(
    state.components,
    state.belts,
    cloneComponentConfigMap(state.componentConfigs),
    onSimulationTopologyChange
  );
  state.engine.start();
  state.lastRunStatus = 'running';
  state.lastTick = performance.now();
  state.simAccumulator = 0;
  state.displayedHud = { time: 0, rps: 0, spawned: 0, completed: 0, dropped: 0 };

  const loop = (now: number) => {
    const snap = state.engine?.getSnapshot();
    if (!state.engine || snap?.status !== 'running') {
      state.animFrame = null;
      refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0);
      updateStatus();

      if (
        snap &&
        (snap.status === 'won' || snap.status === 'lost') &&
        state.lastRunStatus === 'running'
      ) {
        state.lastRunStatus = snap.status;
        showRunReport();
      }
      return;
    }

    const frameDt = Math.min((now - state.lastTick) / 1000, 0.05);
    state.lastTick = now;
    state.simAccumulator += frameDt * state.simulationSpeed;

    while (state.simAccumulator >= SIM_STEP) {
      state.engine.tick(SIM_STEP);
      state.simAccumulator -= SIM_STEP;
    }

    refreshBoardVisuals(state.engine.getSnapshot(), frameDt);
    updateStatus(frameDt);
    state.animFrame = requestAnimationFrame(loop);
  };

  state.animFrame = requestAnimationFrame(loop);
  updateStatus();
}

function stopSimulation(): void {
  if (state.animFrame) {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = null;
  }
  const snap = state.engine?.getSnapshot();
  state.engine?.stop();
  if (snap?.status === 'running') state.lastRunStatus = 'idle';
  refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0);
  updateStatus();
}

// History management functions
function pushHistory(): void {
  // Trim future history if we're not at the end
  state.history = state.history.slice(0, state.historyIndex + 1);
  
  // Add current state
  state.history.push({
    components: structuredClone(state.components),
    belts: structuredClone(state.belts),
    componentConfigs: cloneComponentConfigMap(state.componentConfigs),
  });
  
  // Limit history size
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
}

function undo(): void {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const entry = state.history[state.historyIndex];
    state.components = structuredClone(entry.components);
    state.belts = structuredClone(entry.belts);
    state.componentConfigs = cloneComponentConfigMap(entry.componentConfigs);
    onSimulationTopologyChange();
    render();
  }
}

function redo(): void {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    const entry = state.history[state.historyIndex];
    state.components = structuredClone(entry.components);
    state.belts = structuredClone(entry.belts);
    state.componentConfigs = cloneComponentConfigMap(entry.componentConfigs);
    onSimulationTopologyChange();
    render();
  }
}

// Challenge selection functions
function openChallengeSelector(): void {
  state.challengeSelectorOpen = true;
  showChallengeSelectorModal();
}

function showChallengeSelectorModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'challenge-selector-overlay';
  overlay.id = 'challenge-overlay';
  
  const container = document.createElement('div');
  container.id = 'challenge-selector-container';
  
  document.body.appendChild(overlay);
  document.body.appendChild(container);
  
  mountChallengeSelector(container, state.availableChallenges, (challenge) => {
    selectChallenge(challenge);
  });
  
  overlay.addEventListener('click', closeChallengeSelector);
}

function closeChallengeSelector(): void {
  state.challengeSelectorOpen = false;
  document.getElementById('challenge-overlay')?.remove();
  document.getElementById('challenge-selector-container')?.remove();
}

function selectChallenge(challenge: Challenge): void {
  state.currentChallenge = challenge;
  closeChallengeSelector();
  
  // Reset board for new challenge
  state.components = [];
  state.belts = [];
  state.annotations = createDefaultAnnotations();
  state.componentConfigs = new Map();
  
  console.log(`Selected challenge: ${challenge.name}`);
  render();
}

// Initialize app with backend data
async function initApp(): Promise<void> {
  try {
    console.log('Initializing app...');
    const appData = await initializeApp();
    state.availableChallenges = appData.challenges;
    state.currentChallenge = appData.selectedChallenge;
    
    console.log(`Loaded ${appData.challenges.length} challenges from backend`);
    console.log(`Selected challenge: ${state.currentChallenge?.name}`);
  } catch (error) {
    console.error('Failed to initialize app:', error);
    // App will fall back to legacy components
  }
  
  render();
  loadPreset();
}

// Start the app
initApp();
