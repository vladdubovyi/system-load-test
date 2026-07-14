import './styles/main.css';
import {
  SCENARIO,
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
import { mountReportModal } from './ui/report-modal';
import {
  cloneArchitectureConfig,
  createDefaultArchitectureConfig,
  createReferenceArchitectureConfig,
  mountConfigPanel,
} from './ui/config-panel';
import type { ArchitectureConfig } from './game/architecture-config';
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

interface GameState {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  annotations: BoardAnnotations;
  activeTool: BoardTool;
  selectedComponent: ComponentType | null;
  connectFromPort: Port | null;
  dragging: { kind: 'component' | 'text'; id: string; offsetX: number; offsetY: number } | null;
  panning: { startX: number; startY: number; panX: number; panY: number } | null;
  drawing: DrawStroke | null;
  erasing: boolean;
  pointerDragged: boolean;
  spaceHeld: boolean;
  viewport: ViewportState;
  configOpen: boolean;
  engine: SimulationEngine | null;
  animFrame: number | null;
  lastTick: number;
  simAccumulator: number;
  lastRunStatus: 'idle' | 'running' | 'won' | 'lost';
  architectureConfig: ArchitectureConfig;
  displayedHud: {
    time: number;
    rps: number;
    spawned: number;
    completed: number;
    dropped: number;
  };
}

const SIM_STEP = 1 / 60;
const HUD_LERP_SPEED = 2.2;
const ERASER_RADIUS = 18;

const state: GameState = {
  components: [],
  belts: [],
  annotations: createDefaultAnnotations(),
  activeTool: 'hand',
  selectedComponent: null,
  connectFromPort: null,
  dragging: null,
  panning: null,
  drawing: null,
  erasing: false,
  pointerDragged: false,
  spaceHeld: false,
  viewport: { ...DEFAULT_VIEWPORT },
  configOpen: false,
  engine: null,
  animFrame: null,
  lastTick: 0,
  simAccumulator: 0,
  lastRunStatus: 'idle',
  architectureConfig: createDefaultArchitectureConfig(),
  displayedHud: { time: 0, rps: 0, spawned: 0, completed: 0, dropped: 0 },
};

const boardRenderer = new BoardRenderer();
const annotationRenderer = new AnnotationRenderer();
const app = document.getElementById('app')!;

function isSimRunning(): boolean {
  return state.engine?.getSnapshot().status === 'running';
}

function render(): void {
  const zoomPct = Math.round(state.viewport.zoom * 100);
  app.innerHTML = `
    <div class="canvas-app">
      ${renderFloatingChrome(state.activeTool, state.selectedComponent, zoomPct, state.configOpen)}

      <div class="config-drawer ${state.configOpen ? 'open' : ''}" id="config-drawer">
        <div class="config-drawer-header">
          <h2>Configurations</h2>
          <button class="drawer-close" id="btn-config-close" type="button" aria-label="Close">×</button>
        </div>
        <div id="config-panel-root"></div>
      </div>
      <div class="config-backdrop ${state.configOpen ? 'open' : ''}" id="config-backdrop"></div>

      <div class="board-viewport" id="board-viewport">
        <div class="board-world" id="board-world">
          <div class="board" id="board">
            <div class="source-node" id="source-node">
              <div class="source-icon">📨</div>
              <div class="source-label">Incoming Requests</div>
              <button class="port port-out" data-port-id="${SOURCE_ID}:out" type="button" title="Output port"></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  mountConfigPanelUi();
  mountBoard();
  updateStatus();
  applyViewport();
  updateToolUi();
}

function mountConfigPanelUi(): void {
  const root = document.getElementById('config-panel-root');
  if (!root) return;
  mountConfigPanel(root, state.architectureConfig, (config) => {
    state.architectureConfig = cloneArchitectureConfig(config);
  });
}

function applyViewport(): void {
  const world = document.getElementById('board-world');
  if (world) {
    applyViewportStyles(world, state.viewport);
  }
  const zoomLabel = document.getElementById('zoom-label');
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(state.viewport.zoom * 100)}%`;
  }
}

function clearTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function getEffectiveTool(): BoardTool {
  if (
    state.spaceHeld &&
    state.activeTool !== 'pen' &&
    state.activeTool !== 'text' &&
    state.activeTool !== 'eraser'
  ) {
    return 'hand';
  }
  return state.activeTool;
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

function tryStartComponentDrag(
  e: PointerEvent,
  viewport: HTMLElement,
  world: { x: number; y: number }
): boolean {
  const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
  if (!comp || isSimRunning()) return false;

  const id = comp.dataset.id!;
  const c = state.components.find((x) => x.id === id);
  if (!c) return false;

  state.dragging = {
    kind: 'component',
    id,
    offsetX: world.x - c.x,
    offsetY: world.y - c.y,
  };
  comp.classList.add('dragging');
  clearTextSelection();
  viewport.setPointerCapture(e.pointerId);
  return true;
}

function tryStartTextDrag(
  e: PointerEvent,
  viewport: HTMLElement,
  world: { x: number; y: number }
): boolean {
  const textEl = (e.target as HTMLElement).closest('.board-text') as HTMLElement | null;
  if (!textEl || isSimRunning() || textEl.classList.contains('editing')) return false;

  const id = textEl.dataset.textId!;
  const text = state.annotations.texts.find((t) => t.id === id);
  if (!text) return false;

  state.dragging = {
    kind: 'text',
    id,
    offsetX: world.x - text.x,
    offsetY: world.y - text.y,
  };
  clearTextSelection();
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
  const effectiveTool = getEffectiveTool();
  viewport.style.cursor = state.panning ? 'grabbing' : toolCursor(effectiveTool);
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

function mountBoard(): void {
  const board = document.getElementById('board');
  if (!board) return;
  annotationRenderer.destroy();
  annotationRenderer.mount(board);
  annotationRenderer.render(state.annotations);
  boardRenderer.mount(board, state.components, state.belts);
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
  bar.textContent = snap?.message ?? 'Wire components, configure scaling, then press Play.';

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

function setTool(tool: BoardTool, componentType: ComponentType | null = null): void {
  state.activeTool = tool;
  state.selectedComponent = componentType;
  state.connectFromPort = null;
  clearPortHighlights();

  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tool === tool);
  });
  document.querySelectorAll('[data-component]').forEach((el) => {
    const type = (el as HTMLElement).dataset.component as ComponentType;
    el.classList.toggle('active', tool === 'component' && type === componentType);
  });

  updateToolUi();
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
    if (!menu) return;
    menu.hidden = !menu.hidden;
  });

  document.getElementById('menu-preset')?.addEventListener('click', () => {
    menu!.hidden = true;
    loadPreset();
  });
  document.getElementById('menu-reset')?.addEventListener('click', () => {
    menu!.hidden = true;
    resetBoard();
  });
  document.getElementById('menu-config')?.addEventListener('click', () => {
    menu!.hidden = true;
    openConfig();
  });

  window.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#btn-menu, #main-menu')) {
      if (menu) menu.hidden = true;
    }
  });

  const openConfig = (): void => {
    state.configOpen = true;
    document.getElementById('config-drawer')?.classList.add('open');
    document.getElementById('config-backdrop')?.classList.add('open');
    document.getElementById('btn-config')?.setAttribute('aria-expanded', 'true');
  };

  document.getElementById('btn-config')?.addEventListener('click', openConfig);

  const closeConfig = (): void => {
    state.configOpen = false;
    document.getElementById('config-drawer')?.classList.remove('open');
    document.getElementById('config-backdrop')?.classList.remove('open');
    document.getElementById('btn-config')?.setAttribute('aria-expanded', 'false');
  };

  document.getElementById('btn-config-close')?.addEventListener('click', closeConfig);
  document.getElementById('config-backdrop')?.addEventListener('click', closeConfig);

  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (state.engine?.getSnapshot().status === 'running') stopSimulation();
    else startSimulation();
  });

  document.getElementById('btn-preset')?.addEventListener('click', loadPreset);
  document.getElementById('btn-reset')?.addEventListener('click', resetBoard);

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    const rect = getViewportRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    zoomAt(cx, cy, 1.15);
  });

  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    const rect = getViewportRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    zoomAt(cx, cy, 1 / 1.15);
  });

  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    state.viewport.zoom = 1;
    applyViewport();
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
    if (e.key === 'c' || e.key === 'C') setTool('connect');
    if (e.key === 'e' || e.key === 'E') setTool('eraser');
    if (e.key === 'Escape') {
      setTool('hand');
      closeConfig();
      if (menu) menu.hidden = true;
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
    const target = e.target as HTMLElement;
    if (target.closest('.board-text.editing')) return;
    e.preventDefault();
  });

  viewport.addEventListener('dragstart', (e) => e.preventDefault());

  viewport.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isSimRunning()) return;

    const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
    if (comp) {
      const id = comp.dataset.id!;
      state.components = state.components.filter((c) => c.id !== id);
      state.belts = state.belts.filter((b) => {
        const from = getPortById(b.fromPortId);
        const to = getPortById(b.toPortId);
        return from?.componentId !== id && to?.componentId !== id;
      });
      mountBoard();
      return;
    }

    const textEl = (e.target as HTMLElement).closest('.board-text') as HTMLElement | null;
    if (textEl) {
      const id = textEl.dataset.textId!;
      state.annotations.texts = state.annotations.texts.filter((t) => t.id !== id);
      annotationRenderer.render(state.annotations);
    }
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false }
  );

  viewport.addEventListener('pointerdown', (e) => {
    const isMiddle = e.button === 1;
    const isLeft = e.button === 0;
    if (!isLeft && !isMiddle) return;

    if (isMiddle) e.preventDefault();

    state.pointerDragged = false;
    const world = eventToWorld(e);
    const effectiveTool = isMiddle ? 'hand' : getEffectiveTool();

    if (effectiveTool === 'hand') {
      if (isLeft && tryStartComponentDrag(e, viewport, world)) return;
      if (isLeft && tryStartTextDrag(e, viewport, world)) return;

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

    if (effectiveTool === 'eraser') {
      state.erasing = true;
      eraseAtScreen(e.clientX, e.clientY);
      viewport.setPointerCapture(e.pointerId);
      return;
    }

    if (effectiveTool === 'select') {
      if (tryStartTextDrag(e, viewport, world)) return;
      if (tryStartComponentDrag(e, viewport, world)) return;
    }
  });

  viewport.addEventListener('click', (e) => {
    if (state.pointerDragged) return;

    const portBtn = (e.target as HTMLElement).closest('.port') as HTMLElement | null;
    if (portBtn) {
      e.stopPropagation();
      handlePortClick(portBtn.dataset.portId!);
      return;
    }

    if (isSimRunning()) return;
    if ((e.target as HTMLElement).closest('.board-text')) return;

    const world = eventToWorld(e);

    if (state.activeTool === 'component' && state.selectedComponent) {
      state.components.push(
        createComponent(
          state.selectedComponent,
          Math.max(20, world.x - 70),
          Math.max(20, world.y - 36)
        )
      );
      mountBoard();
      return;
    }

    if (state.activeTool === 'text') {
      const annotation = createTextAnnotation(world.x, world.y);
      state.annotations.texts.push(annotation);
      annotationRenderer.render(state.annotations);
      setTool('hand');
      requestAnimationFrame(() => beginTextEdit(annotation.id));
    }
  });

  viewport.addEventListener('pointermove', (e) => {
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

    if (state.erasing && (e.buttons & 1) === 1) {
      state.pointerDragged = true;
      eraseAtScreen(e.clientX, e.clientY);
      return;
    }

    if (!state.dragging || isSimRunning()) return;

    state.pointerDragged = true;
    const world = eventToWorld(e);

    if (state.dragging.kind === 'component') {
      const c = state.components.find((x) => x.id === state.dragging!.id);
      if (!c) return;
      c.x = Math.max(10, world.x - state.dragging.offsetX);
      c.y = Math.max(10, world.y - state.dragging.offsetY);
      boardRenderer.updatePositions(state.components);
      positionSourceNode();
      return;
    }

    const text = state.annotations.texts.find((t) => t.id === state.dragging!.id);
    if (text) {
      text.x = world.x - state.dragging.offsetX;
      text.y = world.y - state.dragging.offsetY;
      annotationRenderer.render(state.annotations);
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (state.dragging?.kind === 'text' && !state.pointerDragged && !isSimRunning()) {
      beginTextEdit(state.dragging.id);
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
    state.erasing = false;
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

function zoomAt(screenX: number, screenY: number, factor: number): void {
  const rect = getViewportRect();
  const before = screenToWorld(screenX, screenY, rect, state.viewport);
  state.viewport.zoom = clampZoom(state.viewport.zoom * factor);
  state.viewport.panX = screenX - rect.left - before.x * state.viewport.zoom;
  state.viewport.panY = screenY - rect.top - before.y * state.viewport.zoom;
  applyViewport();
}

function eraseAtScreen(screenX: number, screenY: number): void {
  const rect = getViewportRect();
  const world = screenToWorld(screenX, screenY, rect, state.viewport);
  const radius = ERASER_RADIUS / state.viewport.zoom;

  const beforeStrokes = state.annotations.strokes.length;
  state.annotations.strokes = state.annotations.strokes.filter((stroke) => {
    return !stroke.points.some((p) => Math.hypot(p.x - world.x, p.y - world.y) < radius);
  });

  const textHit = state.annotations.texts.find((text) => {
    return (
      world.x >= text.x &&
      world.x <= text.x + text.width &&
      world.y >= text.y &&
      world.y <= text.y + text.minHeight
    );
  });

  if (textHit) {
    state.annotations.texts = state.annotations.texts.filter((t) => t.id !== textHit.id);
  }

  if (state.annotations.strokes.length !== beforeStrokes || textHit) {
    annotationRenderer.render(state.annotations);
  }
}

function handlePortClick(portId: string): void {
  if (state.activeTool !== 'connect' && !state.connectFromPort) {
    setTool('connect');
  }

  const port = getPortById(portId);
  if (!port) return;

  if (!state.connectFromPort) {
    if (port.side === 'out') {
      state.connectFromPort = port;
      highlightPort(portId);
    }
    return;
  }

  if (port.side === 'in' && port.id !== state.connectFromPort.id) {
    const componentMap = new Map(state.components.map((c) => [c.id, c]));
    if (canConnect(state.connectFromPort, port, componentMap)) {
      const exists = state.belts.some(
        (b) => b.fromPortId === state.connectFromPort!.id && b.toPortId === port.id
      );
      if (!exists) {
        state.belts.push(createBelt(state.connectFromPort.id, port.id));
        mountBoard();
      }
    }
  }

  state.connectFromPort = null;
  clearPortHighlights();
}

function highlightPort(portId: string): void {
  clearPortHighlights();
  document.querySelector(`[data-port-id="${portId}"]`)?.classList.add('port-active');
}

function clearPortHighlights(): void {
  document.querySelectorAll('.port-active').forEach((el) => el.classList.remove('port-active'));
}

function resetBoard(): void {
  stopSimulation();
  state.components = [];
  state.belts = [];
  state.annotations = createDefaultAnnotations();
  state.engine = null;
  state.architectureConfig = createDefaultArchitectureConfig();
  mountConfigPanelUi();
  mountBoard();
  updateStatus();
  setTool('hand');
}

function loadPreset(): void {
  if (isSimRunning()) stopSimulation();

  const { components, belts } = buildPreset(URL_SHORTENER_PRESET);
  state.components = components;
  state.belts = belts;
  state.annotations = createDefaultAnnotations();
  state.architectureConfig = createReferenceArchitectureConfig();
  mountConfigPanelUi();
  state.engine = null;
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
  state.engine = new SimulationEngine(
    state.components,
    state.belts,
    state.architectureConfig
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
    state.simAccumulator += frameDt;

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
  if (snap?.status === 'running') {
    state.lastRunStatus = 'idle';
  }
  refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0);
  updateStatus();
}

render();
loadPreset();
