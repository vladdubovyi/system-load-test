import '../styles/main.css';
import {
  type ComponentType,
  type PlacedComponent,
  type ConveyorBelt,
  type Port,
  type Request,
} from '../game/types';
import {
  SimulationEngine,
  createComponent,
  createBelt,
  getSourcePort,
  getComponentPorts,
  canConnect,
  connectionRejectionReason,
  SOURCE_ID,
 describeFailure } from '../game/simulation';
import { lintBoard } from '../game/flow-validator';
import { showLintPanel, hideLintPanel } from '../ui/lint-panel';
import { showBoardToast, dismissBoardToast } from '../ui/toast';
import { buildPreset, URL_SHORTENER_PRESET } from '../game/presets';
import { buildChallengePreset, buildChallengeReference } from '../game/challenge-presets';
import { parseSeed, randomSeed } from '../game/rng';
import { getComponentDef } from '../game/component-catalog';
import {
  getActiveScenario,
  setActiveScenarioFromChallenge,
  setActiveTrafficOverride,
  setRunFlowBundle,
} from '../game/scenario-runtime';
import { mapChallengeFromApi } from '../api/client';
import {
  MAX_FRAGMENT_CHARS,
  boardFragment,
  decodeSnapshot,
  encodeSnapshot,
  parseSnapshotFile,
  serializeSnapshot,
  snapshotFileName,
  type BoardSnapshotV1,
  type ReplayEvent,
  type RunReplayV1,
} from '../share/snapshot';
import { BoardRenderer } from '../ui/board-renderer';
import { AnnotationRenderer } from '../ui/annotation-renderer';
import { ConnectionPreview } from '../ui/connection-preview';
import { mountReportModal } from '../ui/report-modal';
import { renderConfigPalette, getChipFromEvent, getTagChipFromEvent } from '../ui/config-palette';
import { mountScenarioEditor } from '../ui/scenario-editor';
import {
  getActiveScenarioDocument,
  getActiveScenarioOverride,
  setActiveScenarioOverride,
} from '../game/scenario-runtime';
import { describeSelector } from '../game/flows';
import { renderComponentsPanel, mountComponentsPanel } from '../ui/components-panel';
import {
  applyConfigChip,
  buildReferenceComponentConfigs,
  cloneComponentConfigMap,
  createEmptyComponentConfig,
  toggleComponentTag,
  type ComponentInstanceConfig,
  type ConfigChipId,
} from '../game/component-config';
import {
  createDefaultAnnotations,
  createStrokePoint,
  createTextAnnotation,
  type BoardAnnotations,
  type DrawStroke,
} from '../game/board-annotations';
import {
  clampZoom,
  DEFAULT_VIEWPORT,
  screenToWorld,
  applyViewportStyles,
  type ViewportState,
} from '../ui/viewport';
import {
  getScaleGroupMembers,
  isScalePrimary,
} from '../game/scale-instances';
import { applyBoardLayout, layoutScaleGroupMembers } from '../game/board-layout';
import {
  renderFloatingChrome,
  toolCursor,
  type BoardTool,
} from '../ui/floating-toolbar';
import { initializeApp } from '../game/app-init';
import { mountTrafficConfigPanel } from '../ui/traffic-config-panel';
import { mountFailureInjectionPanel } from '../ui/failure-injection-panel';
import {
  mountRequestInspector,
  unmountRequestInspector,
  updateRequestInspector,
  isRequestInspectorMounted,
} from '../ui/request-inspector';
import type { Challenge, TrafficProfile } from '../game/scenario-types';
import {
  applyDiff,
  diffBoards,
  invertDiff,
  isEmptyDiff,
  snapshotBoard,
  type BoardDiff,
  type BoardState,
} from '../game/board-diff';
import type { ScenarioDocument } from '../game/flow-types';
import { navigate } from '../router';
import {
  RoomClient,
  boardToEntities,
  changesToDiff,
  diffToChanges,
  entitiesToBoard,
  roomErrorMessage,
  type BoardChanged,
  type ParticipantInfo,
  type RoomClientEvents,
  type RoomJoined,
  type RunEvent,
  type RunEventKind,
  type RunStarted,
  type RunTick,
  type TickStamp,
  type RoomSettings,
  type WireEntity,
  DEFAULT_ROOM_SETTINGS,
  effectiveLintVisible,
  effectiveReportVisibility,
} from '../rooms/room-client';
import { clearHostNotes, getHostNotes, toggleHostNotes } from '../rooms/host-notes';
import type { ObjectiveResult, SimulationReport, SimulationSnapshot } from '../game/types';
import {
  clearRemoteCursors,
  closeRoomDialog,
  hideRoomBanner,
  isRoomDialogOpen,
  openRoomDialog,
  remountRemoteCursors,
  removeRemoteCursor,
  renderPresencePanel,
  renderPublicScenarioBanner,
  showJoinInputError,
  showRemoteCursor,
  showRoomBanner,
  showHeldReportNotice,
  hideHeldReportNotice,
  updateRoomDialog,
  type RoomDialogCallbacks,
  type RoomViewModel,
} from '../rooms/room-ui';
import {
  formatJoinCode,
  normalizeJoinCode,
  roomFragment,
  siteBase,
  type RoomCredential,
} from '../rooms/join-codes';

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
  /** Scenario role chip being dragged from the palette, if any. */
  tagChipDrag: string | null;
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
  trafficConfigOpen: boolean;
  customTrafficConfig: TrafficProfile | null;
  failureInjectionOpen: boolean;
  /** True while a running simulation is frozen; the engine keeps its state. */
  paused: boolean;
  /** Request currently being traced in the inspector. */
  tracedRequestId: number | null;
  /**
   * Traffic seed pinned through `?seed=` in the URL (interview-platform.md
   * §8): every run in this tab uses it. Null means a fresh seed per run.
   */
  pinnedSeed: number | null;
  /** Seed of the most recent run, so the report can replay it exactly. */
  lastSeed: number | null;
}

/**
 * One undoable gesture, stored as a per-entity diff (interview-platform.md
 * §5.2) rather than a board snapshot. Undo applies the inverse diff; redo
 * applies it forward. The same diffs will become room sync messages.
 */
interface HistoryEntry {
  diff: BoardDiff;
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
  tagChipDrag: null,
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
  trafficConfigOpen: false,
  customTrafficConfig: null,
  failureInjectionOpen: false,
  paused: false,
  tracedRequestId: null,
  pinnedSeed: null,
  lastSeed: null,
};

const boardRenderer = new BoardRenderer();
const annotationRenderer = new AnnotationRenderer();
const connectionPreview = new ConnectionPreview();
let mountContainer: HTMLElement | null = null;

let clipboard: {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  configs: Map<string, ComponentInstanceConfig>;
} | null = null;

interface BoardSnapshot {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
}

let boardSnapshotBeforeSim: BoardSnapshot | null = null;

/**
 * The board as of the last committed gesture. `pushHistory` diffs the live
 * board against it, and undo/redo start from it so runtime-only changes (a
 * finished run's scale instances) never leak into the undo stack.
 */
let lastCommittedBoard: BoardState | null = null;

function liveBoard(): BoardState {
  return {
    components: state.components,
    belts: state.belts,
    componentConfigs: state.componentConfigs,
    annotations: state.annotations,
  };
}

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
  if (!mountContainer) return;
  const zoomPct = Math.round(state.viewport.zoom * 100);
  mountContainer.innerHTML = `
    <div class="canvas-app">
      ${renderComponentsPanel(state.placementType, state.currentChallenge?.allowedComponents)}
      <div class="canvas-workspace">
        ${renderFloatingChrome(
          state.activeTool,
          state.placementType,
          zoomPct,
          state.simulationSpeed,
          state.currentChallenge?.name
        )}
        ${renderConfigPalette(selectedComponentId(), selectedComponentType(), getActiveScenario().tags ?? [])}

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
    </div>
  `;

  bindEvents();
  mountComponentsPanel((type) => setTool('component', type));
  mountBoard();
  updateStatus();
  applyViewport();
  updateToolUi();
  refreshConfigPalette();
  renderRoomChrome();
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
      ? `Configuring <strong>${getComponentDef(type).label}</strong>`
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
  if (!canEditBoard()) {
    selectItem(target);
    ensureCanEdit();
    return false;
  }

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
    // Creating a note and typing into it commit together as one gesture.
    pushHistory();
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
  boardRenderer.setTracedRequest(tracedRequest());
  boardRenderer.update(null, 0);
  positionSourceNode();
  remountRemoteCursors();
}

/**
 * The traced request object is pinned here so it stays inspectable even after
 * the engine evicts it from its bounded finished-request archive. The engine
 * mutates the same object in place, so reading it each frame stays live.
 */
let tracedRequestRef: Request | null = null;

function tracedRequest(): Request | null {
  if (state.tracedRequestId === null || !state.engine) return null;
  if (tracedRequestRef && tracedRequestRef.id === state.tracedRequestId) return tracedRequestRef;
  tracedRequestRef = state.engine.getRequest(state.tracedRequestId);
  return tracedRequestRef;
}

function refreshBoardVisuals(
  snapshot = state.engine?.getSnapshot() ?? null,
  dt = 0,
  interpSeconds = 0
): void {
  boardRenderer.update(snapshot, dt, interpSeconds);
  positionSourceNode();
  refreshRequestInspector();
}

function refreshRequestInspector(): void {
  if (!isRequestInspectorMounted()) return;
  const request = tracedRequest();
  updateRequestInspector(request, {
    now: state.engine?.getTime() ?? 0,
    paused: state.paused,
    running: isSimRunning(),
    hideFlowDetails: flowDetailsHidden(),
  });
}

function traceRequest(id: number): void {
  if (!state.engine) return;
  const request = state.engine.getRequest(id);
  if (!request) return;
  state.tracedRequestId = id;
  tracedRequestRef = request;
  boardRenderer.setTracedRequest(request);

  if (!isRequestInspectorMounted()) {
    const host = document.querySelector('.canvas-workspace') as HTMLElement | null;
    if (host) mountRequestInspector(host, closeRequestTrace);
  }
  refreshBoardVisuals(state.engine.getSnapshot(), 0, state.paused ? 0 : state.simAccumulator);
}

function closeRequestTrace(): void {
  state.tracedRequestId = null;
  tracedRequestRef = null;
  boardRenderer.setTracedRequest(null);
  unmountRequestInspector();
  if (state.engine) {
    refreshBoardVisuals(state.engine.getSnapshot(), 0, 0);
  }
  const viewport = document.getElementById('board-viewport');
  viewport?.classList.remove('is-over-request');
}

function positionSourceNode(): void {
  const sourceNode = document.getElementById('source-node');
  if (!sourceNode) return;
  const port = getSourcePort(state.components);
  sourceNode.style.left = `${port.x - 36}px`;
  sourceNode.style.top = `${port.y - 72}px`;
}

/**
 * Scripted failure phases (product-directions.md §3.3): while a drill is
 * active the workspace shows what the script took down and for how long.
 * Participants in interview mode see it too — the drill is public data.
 */
function renderScriptedBanner(snap: SimulationSnapshot | null): void {
  const active = snap?.status === 'running' ? snap.scriptedFailures.find((p) => p.active) : undefined;
  let banner = document.getElementById('scripted-banner');
  if (!active || !snap) {
    banner?.remove();
    return;
  }
  if (!banner) {
    const workspace = document.querySelector('.canvas-workspace');
    if (!workspace) return;
    banner = document.createElement('div');
    banner.id = 'scripted-banner';
    banner.className = 'room-banner scripted-banner';
    banner.setAttribute('role', 'status');
    workspace.appendChild(banner);
  }
  const left = Math.max(0, Math.ceil((active.until ?? snap.time) - snap.time));
  banner.textContent = `⚡ ${active.label}: ${active.componentLabel ?? ''} ${describeFailure(active.type)} — ${left}s left`;
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

  const paused = running && state.paused;

  bar.className = 'floating-status';
  if (snap?.status === 'won') bar.classList.add('won');
  if (snap?.status === 'lost') bar.classList.add('lost');
  if (snap?.spikeActive && !paused) bar.classList.add('spike');
  if (paused) bar.classList.add('paused');
  bar.textContent = paused
    ? '⏸ Paused — click any request dot to trace its journey, then Resume to follow it live.'
    : snap?.message ??
      'Drag configs onto components, drag ports to connect, then press Play.';

  document.querySelector('.canvas-app')?.classList.toggle('sim-paused', paused);
  renderScriptedBanner(snap);

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
    const scenario = getActiveScenario();
    stats.innerHTML = `
      <div class="hud-stat"><span class="hud-label">Time</span><span class="hud-value">${hud.time.toFixed(1)}s / ${scenario.duration}s</span></div>
      <div class="hud-stat"><span class="hud-label">RPS</span><span class="hud-value ${snap.spikeActive ? 'spike' : ''}">${Math.round(hud.rps)}</span></div>
      <div class="hud-stat"><span class="hud-label">Done</span><span class="hud-value">${Math.round(hud.completed).toLocaleString()}</span></div>
      <div class="hud-stat"><span class="hud-label">Dropped</span><span class="hud-value ${snap.totalDropped > 0 ? 'bad' : ''}">${Math.round(hud.dropped).toLocaleString()}</span></div>
    `;
  } else {
    const scenario = getActiveScenario();
    stats.innerHTML = `
      <div class="hud-stat"><span class="hud-label">Scenario</span><span class="hud-value">${scenario.title}</span></div>
      <div class="hud-stat"><span class="hud-label">Duration</span><span class="hud-value">${scenario.duration}s</span></div>
    `;
  }

  const playBtn = document.getElementById('btn-play') as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.textContent = !running ? '▶ Play' : state.paused ? '▶ Resume' : '⏸ Pause';
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
  document.querySelectorAll('.components-panel-item[data-component]').forEach((el) => {
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
  if (!ensureCanEdit()) return;
  const cfg = getOrCreateComponentConfig(componentId);
  if (applyConfigChip(cfg, chipId, component.type)) {
    state.componentConfigs.set(componentId, cfg);
    boardRenderer.updateComponentConfigs(state.componentConfigs);
    selectItem({ kind: 'component', id: componentId });
    invalidateBoardSnapshot();
    pushHistory();
  }
}

/** Drag sources in the palette: configuration chips and scenario role chips. */
function bindChipDrag(): void {
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
  document.querySelectorAll('[data-tag-chip]').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
      const tagId = getTagChipFromEvent(e.target);
      if (!tagId) return;
      state.tagChipDrag = tagId;
      (e as DragEvent).dataTransfer?.setData('text/plain', `tag:${tagId}`);
      if (e instanceof DragEvent) e.dataTransfer!.effectAllowed = 'copy';
    });
    chip.addEventListener('dragend', () => {
      state.tagChipDrag = null;
    });
  });
}

/**
 * Re-render the palette wholesale (the scenario's roles may have changed)
 * and rebind its drag sources.
 */
function rerenderConfigPalette(): void {
  const palette = document.getElementById('config-palette');
  if (!palette) return;
  palette.outerHTML = renderConfigPalette(
    selectedComponentId(),
    selectedComponentType(),
    getActiveScenario().tags ?? []
  );
  bindChipDrag();
}

/** Assign (or remove) a scenario role on a component; refuses ineligible types with a toast. */
function dropTagOnComponent(componentId: string, tagId: string): void {
  if (isSimRunning()) return;
  if (!ensureCanEdit()) return;
  const component = state.components.find((c) => c.id === componentId);
  const tag = (getActiveScenario().tags ?? []).find((t) => t.id === tagId);
  if (!component || !tag) return;

  const updated = toggleComponentTag(component, tag);
  if (!updated) {
    const allowed = tag.appliesTo ? describeSelector(tag.appliesTo) : 'a matching component';
    showBoardToast(`"${tag.label}" can only be assigned to ${allowed} — not ${component.label}.`);
    return;
  }

  state.components = state.components.map((c) => (c.id === componentId ? updated : c));
  mountBoard();
  selectItem({ kind: 'component', id: componentId });
  invalidateBoardSnapshot();
  pushHistory();
}

// Scenario editor (docs/specs/flow-authoring.md §3.1). For open-mode room
// participants it is a read-only document view (interview-platform.md §4.1);
// interview-mode participants cannot open it at all.
function openScenarioEditor(): void {
  if (room !== null && room.role === 'participant' && room.settings.mode === 'interview') return;
  const readOnly = room !== null && room.role === 'participant';
  closeScenarioEditor();
  const container = document.createElement('div');
  container.id = 'scenario-editor-container';
  document.body.appendChild(container);

  const afterScenarioChange = (): void => {
    rerenderConfigPalette();
    hideLintPanel();
    invalidateBoardSnapshot();
    updateStatus();
    // The public-scenario banner (§6.1) follows whether an override exists.
    renderRoomChrome();
  };

  mountScenarioEditor(
    container,
    getActiveScenarioDocument(),
    { overridden: getActiveScenarioOverride() !== null, readOnly },
    {
      onApply: (doc) => {
        setActiveScenarioOverride(doc);
        roomPublishScenario(doc);
        afterScenarioChange();
      },
      onReset: () => {
        setActiveScenarioOverride(null);
        roomPublishScenario(null);
        afterScenarioChange();
      },
      onClose: closeScenarioEditor,
    }
  );
}

function closeScenarioEditor(): void {
  document.getElementById('scenario-editor-container')?.remove();
}

function deleteSelection(): void {
  if (!state.selection || isSimRunning()) return;
  if (!ensureCanEdit()) return;

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
    refreshConfigPalette();
    invalidateBoardSnapshot();
    updateStatus();
    pushHistory();
    return;
  }

  state.annotations.texts = state.annotations.texts.filter((t) => t.id !== state.selection!.id);
  state.selection = null;
  annotationRenderer.render(state.annotations);
  pushHistory();
}

/**
 * Window-level listeners from the current `bindEvents` call. `render()`
 * rebuilds the DOM and rebinds, so the previous set is aborted first;
 * otherwise every re-render stacked another copy of the keyboard shortcuts
 * and one Ctrl+Z undid several gestures.
 */
let windowListeners: AbortController | null = null;

function bindEvents(): void {
  const viewport = document.getElementById('board-viewport')!;
  windowListeners?.abort();
  windowListeners = new AbortController();
  const { signal } = windowListeners;

  window.addEventListener('resize', () => boardRenderer.resizeCanvas(), { signal });

  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool((btn as HTMLElement).dataset.tool as BoardTool);
    });
  });

  const menu = document.getElementById('main-menu');
  document.getElementById('btn-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) menu.hidden = !menu.hidden;
  });
  document.getElementById('menu-challenge')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    window.location.assign('/challenges');
  });
  document.getElementById('menu-preset')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    loadChallengeStarter();
  });
  document.getElementById('menu-reset')?.addEventListener('click', () => {
    if (menu) menu.hidden = true;
    resetBoard();
  });
  window.addEventListener(
    'click',
    (e) => {
      if (!(e.target as HTMLElement).closest('#btn-menu, #main-menu') && menu) {
        menu.hidden = true;
      }
    },
    { signal }
  );

  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (room) {
      if (!ensureCanRun()) return;
      if (!isSimRunning()) requestRoomRun();
      else sendRoomRunEvent(state.paused ? 'resume' : 'pause');
      return;
    }
    if (!isSimRunning()) startSimulation();
    else if (state.paused) resumeSimulation();
    else pauseSimulation();
  });
  document.getElementById('btn-traffic')?.addEventListener('click', openTrafficConfig);
  document.getElementById('btn-scenario')?.addEventListener('click', openScenarioEditor);
  document.getElementById('btn-failure')?.addEventListener('click', openFailureInjection);
  document.getElementById('btn-preset')?.addEventListener('click', loadChallengeStarter);
  document.getElementById('btn-reference')?.addEventListener('click', loadChallengeReference);
  document.getElementById('btn-reset')?.addEventListener('click', resetBoard);
  document.getElementById('btn-share')?.addEventListener('click', openRoomDialogNow);
  document.getElementById('btn-notes')?.addEventListener('click', toggleHostNotes);
  
  // Speed control buttons
  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const speed = parseInt(btn.getAttribute('data-speed') || '1') as 1 | 5 | 20 | 100;
      // During a room run speed is room-wide (§4.4): it travels as an event.
      if (inRoomRun() && isSimRunning()) {
        if (ensureCanRun()) sendRoomRunEvent('speed', { speed });
        return;
      }
      applySpeed(speed);
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

  bindChipDrag();

  viewport.addEventListener('dragover', (e) => {
    if (!state.configChipDrag && !state.tagChipDrag) return;
    e.preventDefault();
  });

  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    const tagId = state.tagChipDrag;
    const chipId =
      state.configChipDrag ??
      (tagId ? null : (e.dataTransfer?.getData('text/plain') as ConfigChipId | null));
    state.configChipDrag = null;
    state.tagChipDrag = null;
    if (!chipId && !tagId) return;

    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of elements) {
      const comp = (el as HTMLElement).closest('.component') as HTMLElement | null;
      if (comp?.dataset.id) {
        if (tagId) dropTagOnComponent(comp.dataset.id, tagId);
        else if (chipId) dropConfigChipOnComponent(comp.dataset.id, chipId);
        return;
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (signal.aborted) return;
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
      if (state.tracedRequestId !== null) {
        closeRequestTrace();
        return;
      }
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
    // Copy/Paste shortcuts
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault();
      copySelection();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      pasteSelection();
    }
  }, { signal });

  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Space') {
        state.spaceHeld = false;
        state.panning = null;
        updateToolUi();
      }
    },
    { signal }
  );

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
    if (room) {
      const cursorWorld = eventToWorld(e);
      roomSendCursor(cursorWorld.x, cursorWorld.y);
    }

    if (isSimRunning() && state.paused && !state.panning) {
      const world = eventToWorld(e);
      const hit = boardRenderer.hitTestRequest(world.x, world.y, 10 / state.viewport.zoom);
      viewport.classList.toggle('is-over-request', hit !== null);
    } else if (viewport.classList.contains('is-over-request')) {
      viewport.classList.remove('is-over-request');
    }

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
      const newX = world.x - state.dragging.offsetX;
      const newY = world.y - state.dragging.offsetY;

      if (isScalePrimary(c)) {
        const members = getScaleGroupMembers(state.components, c.id);
        if (members.length > 1) {
          c.scaleAnchorX = newX;
          c.scaleAnchorY = newY;
          layoutScaleGroupMembers(members);
          applyBoardLayout(state.components);
        } else {
          c.x = newX;
          c.y = newY;
          c.scaleAnchorX = newX;
          c.scaleAnchorY = newY;
        }
      } else {
        c.x = newX;
        c.y = newY;
      }

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
      if (!ensureCanEdit()) return;
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
    if (isSimRunning()) {
      const world = eventToWorld(e);
      const hit = boardRenderer.hitTestRequest(world.x, world.y, 12 / state.viewport.zoom);
      if (hit !== null) traceRequest(hit);
      return;
    }
    if ((e.target as HTMLElement).closest('.port')) return;

    const world = eventToWorld(e);

    if (state.activeTool === 'component' && state.placementType) {
      if (!ensureCanEdit()) {
        setTool('hand');
        return;
      }
      const comp = createComponent(
        state.placementType,
        world.x - 70,
        world.y - 36
      );
      state.components.push(comp);
      mountBoard();
      invalidateBoardSnapshot();
      selectItem({ kind: 'component', id: comp.id });
      updateStatus();
      pushHistory();
      setTool('hand');
      return;
    }

    if (state.activeTool === 'text') {
      if (!ensureCanEdit()) {
        setTool('hand');
        return;
      }
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
    // A drag or a pen stroke is one gesture; it is committed on release.
    const gestureEnded = Boolean(state.dragging || state.drawing);
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
    if (gestureEnded && !isSimRunning()) {
      invalidateBoardSnapshot();
      pushHistory();
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
  if (!ensureCanEdit()) return;

  const componentMap = new Map(state.components.map((c) => [c.id, c]));
  const fromPort = from.side === 'out' ? from : to;
  const toPort = to.side === 'in' ? to : from;

  if (fromPort.side !== 'out' || toPort.side !== 'in') {
    showBoardToast('Connect an output port to an input port.');
    return;
  }
  if (!canConnect(fromPort, toPort, componentMap)) {
    showBoardToast(connectionRejectionReason(fromPort, toPort, componentMap));
    return;
  }

  const exists = state.belts.some(
    (b) => b.fromPortId === fromPort.id && b.toPortId === toPort.id
  );
  if (!exists) {
    state.belts.push(createBelt(fromPort.id, toPort.id));
    dismissBoardToast();
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
  installBoard(
    {
      components: [],
      belts: [],
      componentConfigs: new Map(),
      annotations: createDefaultAnnotations(),
    },
    { broadcast: true }
  );
}

/**
 * Start undo history from the board as just loaded: the baseline every
 * later gesture is diffed against, with nothing to undo yet.
 */
function seedHistory(): void {
  state.history = [];
  state.historyIndex = -1;
  lastCommittedBoard = snapshotBoard(liveBoard());
}

function loadChallengeStarter(): void {
  const slug = state.currentChallenge?.slug;
  const challengePreset = slug ? buildChallengePreset(slug) : null;
  const { components, belts } = challengePreset ?? buildPreset(URL_SHORTENER_PRESET);
  replaceBoard(components, belts, buildReferenceComponentConfigs(components));
}

/**
 * The challenge's reference solution (interview-platform.md §8): a board
 * that meets every objective, for players who want to see one answer.
 */
function loadChallengeReference(): void {
  const slug = state.currentChallenge?.slug;
  const reference = slug ? buildChallengeReference(slug) : null;
  if (!reference) {
    loadChallengeStarter();
    return;
  }
  replaceBoard(reference.components, reference.belts, reference.componentConfigs);
}

function replaceBoard(
  components: PlacedComponent[],
  belts: ConveyorBelt[],
  componentConfigs: Map<string, ComponentInstanceConfig>
): void {
  installBoard(
    {
      components,
      belts,
      componentConfigs: cloneComponentConfigMap(componentConfigs),
      annotations: createDefaultAnnotations(),
    },
    { broadcast: true }
  );
}

function showRunReport(): void {
  if (!state.engine) return;
  const report = state.engine.getReport();
  if (room && !participantSeesReport()) {
    room.heldReport = report;
    showHeldReportNotice();
    return;
  }
  presentReport(report);
}

/**
 * Example requests behind a failed objective (product-directions.md §4.2):
 * violated requests when the kind died on a flow step, dropped ones when it
 * was shed under load, otherwise whatever was still in flight at the end.
 */
function exampleRequestsFor(objective: ObjectiveResult): Request[] {
  const engine = state.engine;
  if (!engine) return [];
  const snap = engine.getSnapshot();
  const forKind = (kind: string): Request[] => {
    const violated = snap.violatedByKind[kind] ?? 0;
    const dropped = snap.droppedByKind[kind] ?? 0;
    if (violated > 0 && violated >= dropped) return engine.getExampleRequests(kind, 'violated');
    if (dropped > 0) return engine.getExampleRequests(kind, 'dropped');
    return engine.getUnfinishedRequests(kind);
  };
  if (objective.id.startsWith('completion:')) {
    return forKind(objective.id.slice('completion:'.length));
  }
  if (objective.id === 'violations') {
    const kind = Object.entries(snap.violatedByKind).sort((a, b) => b[1] - a[1])[0]?.[0];
    return kind ? engine.getExampleRequests(kind, 'violated') : [];
  }
  // Survival and drill objectives: what the broken components dropped.
  return Object.keys(snap.droppedByKind).flatMap((kind) => engine.getExampleRequests(kind, 'dropped'));
}

function presentReport(report: SimulationReport): void {
  const hostHolds =
    room?.role === 'host' && effectiveReportVisibility(room.settings) === 'hostOnly' && !room.reportReleased;
  // The board as it stands when the report appears *is* the board as run
  // (scale instances are already dropped); capture it so a link copied later
  // still reproduces this run even if the board is edited afterwards.
  const runSnapshot = buildSnapshot('run', report.seed);
  const runFile = runFileFor(report, runSnapshot);
  mountReportModal(
    report,
    () => renderRoomChrome(),
    () => (room ? requestRoomRun() : startSimulation()),
    () => (room ? requestRoomRun(report.seed) : startSimulation(report.seed)),
    {
      pdfExtras: roomPdfExtras,
      onRelease: hostHolds ? () => void releaseHeldReport() : undefined,
      onCopyRunLink: () => void copySnapshotLink(runSnapshot),
      onExportRun: () => exportSnapshotFile(runFile),
      examplesFor: exampleRequestsFor,
      hideFlowDetails: flowDetailsHidden(),
    }
  );
  renderRoomChrome();
}

/**
 * Start a run. The seed decides every random draw the engine makes (spec
 * §8): an explicit one replays a run, the pinned one makes a tab
 * reproducible, and otherwise each run gets a fresh seed.
 */
function startSimulation(seed?: number): void {
  if (!boardSnapshotBeforeSim) {
    captureBoardSnapshot();
  }

  state.components = structuredClone(boardSnapshotBeforeSim!.components);
  state.belts = structuredClone(boardSnapshotBeforeSim!.belts);
  state.componentConfigs = cloneComponentConfigMap(boardSnapshotBeforeSim!.componentConfigs);
  state.selection = null;
  mountBoard();

  // Design-time flow lint (spec §7): warnings only — the run proceeds, and
  // requests that cannot take a required step fail as flow violations.
  const lintScenario = getActiveScenario();
  const lintIssues = lintBoard(lintScenario.flows ?? [], state.components, state.belts, {
    requestTypes: lintScenario.requestTypes,
    tags: lintScenario.tags,
  });
  const workspace = document.querySelector('.canvas-workspace') as HTMLElement | null;
  const lintAllowed = !room || room.role === 'host' || effectiveLintVisible(room.settings);
  if (workspace && lintIssues.length > 0 && lintAllowed) {
    showLintPanel(workspace, lintIssues);
  } else {
    hideLintPanel();
  }

  const runSeed = seed ?? state.pinnedSeed ?? randomSeed();
  state.lastSeed = runSeed;
  soloTick = 0;
  pendingReplay = room ? [] : [...(replayEvents ?? [])];
  if (!room) lastRunEvents = replayEvents ? [...replayEvents] : [];
  state.engine = new SimulationEngine(
    state.components,
    state.belts,
    cloneComponentConfigMap(state.componentConfigs),
    onSimulationTopologyChange,
    getActiveScenario(),
    runSeed
  );
  state.engine.start();
  state.lastRunStatus = 'running';
  state.paused = false;
  closeRequestTrace();
  state.lastTick = performance.now();
  state.simAccumulator = 0;
  state.displayedHud = { time: 0, rps: 0, spawned: 0, completed: 0, dropped: 0 };

  runSimulationLoop();
  updateStatus();
}

function runSimulationLoop(): void {
  if (state.animFrame !== null) {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = null;
  }

  const loop = (now: number) => {
    const snap = state.engine?.getSnapshot();
    if (!state.engine || snap?.status !== 'running') {
      state.animFrame = null;
      refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0, 0);
      updateStatus();

      if (
        snap &&
        (snap.status === 'won' || snap.status === 'lost') &&
        state.lastRunStatus === 'running'
      ) {
        state.lastRunStatus = snap.status;
        showRunReport();
      }
      if (roomRun) finishRoomRun(snap?.status === 'won' || snap?.status === 'lost' ? snap.status : 'idle');
      if (room?.staleDuringRun) void resyncBoard();
      return;
    }

    if (state.paused) {
      state.animFrame = null;
      return;
    }

    const frameDt = Math.min((now - state.lastTick) / 1000, 0.05);
    state.lastTick = now;
    state.simAccumulator += frameDt * state.simulationSpeed;

    if (roomRun) {
      const behind = roomRun.targetTick - roomRun.tick;
      if (!roomRun.controller && behind > ROOM_CATCHUP_THRESHOLD) {
        // Fell behind the controller (background tab, slow machine, joined
        // mid-run): catch up without rendering the frames in between.
        let budget = Math.min(behind, ROOM_CATCHUP_PER_FRAME);
        while (budget-- > 0 && stepRoomTick()) {
          /* fast-forward */
        }
        state.simAccumulator = 0;
      } else {
        while (state.simAccumulator >= SIM_STEP) {
          if (!stepRoomTick()) {
            state.simAccumulator = 0;
            break;
          }
          state.simAccumulator -= SIM_STEP;
        }
      }
      reportRoomTick();
      if (state.paused || !roomRun) {
        state.animFrame = null;
        refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0, 0);
        updateStatus();
        if (!roomRun && state.engine && state.engine.getSnapshot().status !== 'running') {
          state.animFrame = requestAnimationFrame(loop);
        }
        return;
      }
    } else {
      while (state.simAccumulator >= SIM_STEP) {
        // Replaying a run file (§2.6): interventions apply at their ticks,
        // before the tick, exactly as a room run applies them.
        if (pendingReplay.length > 0) applyReplayEventsAt(soloTick);
        if (!state.engine || !isSimRunning()) break;
        state.engine.tick(SIM_STEP);
        soloTick++;
        state.simAccumulator -= SIM_STEP;
      }
      if (!state.engine) {
        state.animFrame = null;
        return;
      }
    }

    // Leftover accumulator is simulation time not yet ticked; the renderer
    // advances traveling requests by it so motion is smooth between ticks.
    refreshBoardVisuals(state.engine.getSnapshot(), frameDt, state.simAccumulator);
    updateStatus(frameDt);
    state.animFrame = requestAnimationFrame(loop);
  };

  state.animFrame = requestAnimationFrame(loop);
}

function pauseSimulation(): void {
  if (inRoomRun()) {
    sendRoomRunEvent('pause');
    return;
  }
  if (!isSimRunning() || state.paused) return;
  state.paused = true;
  if (state.animFrame !== null) {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = null;
  }
  refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0, 0);
  updateStatus();
}

function resumeSimulation(): void {
  if (inRoomRun()) {
    sendRoomRunEvent('resume');
    return;
  }
  if (!isSimRunning() || !state.paused) return;
  state.paused = false;
  state.lastTick = performance.now();
  state.simAccumulator = 0;
  runSimulationLoop();
  updateStatus();
}

function stopSimulation(): void {
  if (state.animFrame) {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = null;
  }
  const snap = state.engine?.getSnapshot();
  state.engine?.stop();
  state.paused = false;
  if (snap?.status === 'running') state.lastRunStatus = 'idle';
  refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0, 0);
  updateStatus();
  if (roomRun) finishRoomRun('idle');
  if (room?.staleDuringRun) void resyncBoard();
}

// Copy/Paste functions
function copySelection(): void {
  if (!state.selection || state.selection.kind !== 'component') return;
  
  const selectedId = state.selection.id;
  const selectedComponent = state.components.find(c => c.id === selectedId);
  if (!selectedComponent) return;
  
  clipboard = {
    components: [selectedComponent],
    belts: state.belts.filter(b => {
      const fromParts = b.fromPortId.split(':');
      const toParts = b.toPortId.split(':');
      return fromParts[0] === selectedId || toParts[0] === selectedId;
    }).filter(b => {
      // Only include belts that connect to other selected components
      const fromParts = b.fromPortId.split(':');
      const toParts = b.toPortId.split(':');
      return fromParts[0] === selectedId && toParts[0] === selectedId;
    }),
    configs: state.componentConfigs.has(selectedId)
      ? new Map([[selectedId, state.componentConfigs.get(selectedId)!]])
      : new Map(),
  };
}

function pasteSelection(): void {
  if (!ensureCanEdit()) return;
  if (!clipboard || clipboard.components.length === 0) return;
  
  const idMap = new Map<string, string>();
  const newComponents: PlacedComponent[] = [];
  
  // Clone components with new IDs and offset position
  for (const comp of clipboard.components) {
    const newId = `${comp.type}-${crypto.randomUUID()}`;
    idMap.set(comp.id, newId);
    
    newComponents.push({
      ...comp,
      id: newId,
      x: comp.x + 40,
      y: comp.y + 40,
    });
  }
  
  // Clone belts with remapped IDs
  const newBelts: ConveyorBelt[] = [];
  for (const belt of clipboard.belts) {
    const fromParts = belt.fromPortId.split(':');
    const toParts = belt.toPortId.split(':');
    const newFromId = idMap.get(fromParts[0]);
    const newToId = idMap.get(toParts[0]);
    
    if (newFromId && newToId) {
      newBelts.push({
        ...belt,
        id: `belt-${crypto.randomUUID()}`,
        fromPortId: `${newFromId}:${fromParts[1]}`,
        toPortId: `${newToId}:${toParts[1]}`,
      });
    }
  }
  
  // Clone configs with remapped IDs
  for (const [oldId, config] of clipboard.configs) {
    const newId = idMap.get(oldId);
    if (newId) {
      state.componentConfigs.set(newId, structuredClone(config));
    }
  }
  
  // Add to state
  state.components.push(...newComponents);
  state.belts.push(...newBelts);
  
  // Select the pasted component
  if (newComponents.length > 0) {
    selectItem({ kind: 'component', id: newComponents[0].id });
  }
  
  mountBoard();
  invalidateBoardSnapshot();
  updateStatus();
  pushHistory();
}

/**
 * Scale instances the engine spawned during the last run live in the board
 * arrays until the next Play restores the pre-run board. An edit in between
 * must not commit them as real components (nor send them to a room).
 */
function discardRunArtifacts(): void {
  if (isSimRunning()) return;
  const instances = new Set(
    state.components.filter((c) => c.scaleGroupId && c.scaleGroupId !== c.id).map((c) => c.id)
  );
  if (instances.size === 0) return;
  state.components = state.components.filter((c) => !instances.has(c.id));
  state.belts = state.belts.filter((b) => {
    const from = b.fromPortId.slice(0, b.fromPortId.lastIndexOf(':'));
    const to = b.toPortId.slice(0, b.toPortId.lastIndexOf(':'));
    return !instances.has(from) && !instances.has(to);
  });
  for (const id of instances) state.componentConfigs.delete(id);
}

// History management: one entry per gesture, stored as a per-entity diff.
function pushHistory(): void {
  if (!lastCommittedBoard) {
    lastCommittedBoard = snapshotBoard(liveBoard());
    return;
  }
  discardRunArtifacts();
  const diff = diffBoards(lastCommittedBoard, liveBoard());
  if (isEmptyDiff(diff)) return;
  roomSend(diff);
  if (!importingSnapshot) replayEvents = null;

  // Trim redo entries if we're not at the end
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({ diff });

  // Limit history size
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  lastCommittedBoard = snapshotBoard(liveBoard());
}

function undo(): void {
  if (isSimRunning()) return;
  if (state.historyIndex < 0) return;
  if (!ensureCanEdit()) return;
  const entry = state.history[state.historyIndex];
  state.historyIndex--;
  applyHistoryDiff(invertDiff(entry.diff));
}

function redo(): void {
  if (isSimRunning()) return;
  if (state.historyIndex >= state.history.length - 1) return;
  if (!ensureCanEdit()) return;
  state.historyIndex++;
  applyHistoryDiff(state.history[state.historyIndex].diff);
}

/**
 * Apply an undo or redo diff on top of the last committed board. Entities
 * that no longer match what the diff expects are skipped — in a room that is
 * what keeps one person's undo from erasing another's work (§5.2); solo, the
 * only other writer is the engine, whose run-time instances are discarded by
 * starting from the committed board.
 */
function applyHistoryDiff(diff: BoardDiff): void {
  const base = lastCommittedBoard ?? liveBoard();
  const { board } = applyDiff(base, diff, { skipConflicts: true });
  roomSend(diffBoards(base, board));
  state.components = board.components;
  state.belts = board.belts;
  state.componentConfigs = board.componentConfigs;
  state.annotations = board.annotations;
  lastCommittedBoard = snapshotBoard(board);

  if (
    state.selection?.kind === 'text' &&
    !state.annotations.texts.some((t) => t.id === state.selection!.id)
  ) {
    state.selection = null;
  }
  invalidateBoardSnapshot();
  onSimulationTopologyChange();
  render();
}

// Challenge selection modal removed — use /challenges page instead.

function closeChallengeSelector(): void {
  state.challengeSelectorOpen = false;
  document.getElementById('challenge-overlay')?.remove();
  document.getElementById('challenge-selector-container')?.remove();
}

// Traffic configuration functions
function openTrafficConfig(): void {
  if (!ensureCanRun()) return;
  state.trafficConfigOpen = true;
  showTrafficConfigPanel();
}

function showTrafficConfigPanel(): void {
  const container = document.createElement('div');
  container.id = 'traffic-config-container';
  container.className = 'modal-container';
  
  document.body.appendChild(container);
  
  // Get current or default traffic config
  const phases = getActiveScenario().trafficPhases;
  const base = state.customTrafficConfig || state.currentChallenge?.scenario.traffic || {
    baseRps: 200,
    pattern: 'constant' as const,
    spikeMultiplier: 3.2,
    spikeChance: 0.08,
  };
  // Phases come from the scenario (§3.4) and are shown read-only.
  const traffic: TrafficProfile = { ...base, phases: phases ?? base.phases };

  mountTrafficConfigPanel(
    container,
    traffic,
    (newTraffic) => applyTrafficConfig(newTraffic),
    () => closeTrafficConfig(),
    () => applyTrafficConfig(null)
  );
}

/**
 * Push a Traffic-panel profile into the active scenario so the next run uses
 * it. A running simulation keeps the parameters it started with; the HUD and
 * problem frame update immediately so the change is visible before Play.
 */
function applyTrafficConfig(traffic: TrafficProfile | null, options: { fromRoom?: boolean } = {}): void {
  state.customTrafficConfig = traffic;
  setActiveTrafficOverride(traffic);
  annotationRenderer.updateProblemFrame();
  updateStatus();
  // Everyone in a room runs the same traffic (§4.4 needs identical inputs).
  if (room && !options.fromRoom) {
    void room.client.setTrafficOverride(traffic).catch((error) => showBoardToast(roomErrorMessage(error)));
  }
}

function closeTrafficConfig(): void {
  state.trafficConfigOpen = false;
  document.getElementById('traffic-config-container')?.remove();
}

// Failure injection functions
function openFailureInjection(): void {
  if (!ensureCanRun()) return;
  if (!isSimRunning()) {
    alert('Start the simulation first before injecting failures!');
    return;
  }
  
  state.failureInjectionOpen = true;
  showFailureInjectionPanel();
}

function showFailureInjectionPanel(): void {
  const container = document.createElement('div');
  container.id = 'failure-injection-container';
  container.className = 'modal-container';
  
  document.body.appendChild(container);
  
  mountFailureInjectionPanel(
    container,
    state.components,
    (failure) => {
      if (inRoomRun()) {
        sendRoomRunEvent('failure', {
          componentId: failure.componentId,
          type: failure.type,
          duration: failure.duration,
        });
        return;
      }
      if (state.engine) {
        state.engine.injectFailure(failure.componentId, failure.type, failure.duration);
      }
    },
    () => closeFailureInjection()
  );
}

function closeFailureInjection(): void {
  state.failureInjectionOpen = false;
  document.getElementById('failure-injection-container')?.remove();
}

// ── Rooms (docs/specs/interview-platform.md §3, §5) ────────────────────────
//
// A room session mirrors committed gestures to the hub and applies everyone
// else's. The undo stack stays per person: remote changes update the
// committed baseline directly and never enter `state.history`.

interface RoomSession {
  client: RoomClient;
  role: 'host' | 'participant';
  connectionId: string;
  name: string;
  /** Formatted join code; participants learn it from the link they used. */
  joinCode: string | null;
  hostSecret: string | null;
  /** Null for interview-mode participants: the slug is withheld (§6.1). */
  scenarioSlug: string | null;
  version: number;
  participants: ParticipantInfo[];
  /** Remote changes arrived during a local run; refetch the board when it ends. */
  staleDuringRun: boolean;
  credential: RoomCredential;
  settings: RoomSettings;
  penHolder: string | null;
  penRequests: string[];
  reportReleased: boolean;
  /** The last run's report, held back from participants until released (§4). */
  heldReport: SimulationReport | null;
}

let room: RoomSession | null = null;
let roomBusy = false;
let roomError: string | null = null;
/** The open → interview warning is showing; offer a fresh room (§4.2). */
let roomFreshOffer = false;
let lastCursorSentAt = 0;
const CURSOR_INTERVAL_MS = 50;

function roomViewModel(): RoomViewModel {
  return {
    status: room ? room.role : roomBusy ? 'busy' : 'none',
    joinCode: room?.joinCode ?? null,
    hostSecret: room?.hostSecret ?? null,
    name: room?.name ?? null,
    connectionId: room?.connectionId ?? null,
    participants: room?.participants ?? [],
    error: roomError,
    settings: room?.settings ?? DEFAULT_ROOM_SETTINGS,
    penHolder: room?.penHolder ?? null,
    penRequests: room?.penRequests ?? [],
    reportHeld:
      room?.role === 'host' &&
      state.lastRunStatus !== 'running' &&
      state.lastRunStatus !== 'idle' &&
      !room.reportReleased &&
      effectiveReportVisibility(room.settings) === 'hostOnly',
    offerFreshRoom: roomFreshOffer && room?.role === 'host',
    hasRunSeed: state.lastSeed !== null,
  };
}

/**
 * Interview mode, participant side, lint off (§6.2): the request inspector
 * must not render violation wording or step-level flow detail.
 */
function flowDetailsHidden(): boolean {
  return (
    room !== null &&
    room.role === 'participant' &&
    room.settings.mode === 'interview' &&
    !effectiveLintVisible(room.settings)
  );
}

/** Whether this client may change the board right now (§4.3 pen rule). */
function canEditBoard(): boolean {
  if (!room) return true;
  if (room.settings.pen === 'shared') return true;
  return room.penHolder === room.connectionId;
}

/** Explain a refused edit; true when editing is allowed. */
function ensureCanEdit(): boolean {
  if (canEditBoard()) return true;
  const holder = room?.participants.find((p) => p.connectionId === room?.penHolder);
  showBoardToast(holder ? `${holder.name} holds the pen.` : 'Nobody holds the pen; ask the host for it.');
  return false;
}

/** Whether this client may start or steer runs and change traffic (§4, "Who can run"). */
function canRun(): boolean {
  return !room || room.settings.whoCanRun === 'anyone' || room.role === 'host';
}

function ensureCanRun(): boolean {
  if (canRun()) return true;
  showBoardToast('Only the host can control runs in this room.');
  return false;
}

function participantSeesReport(): boolean {
  if (!room || room.role === 'host') return true;
  return effectiveReportVisibility(room.settings) === 'everyone' || room.reportReleased;
}

async function updateRoomSettings(settings: RoomSettings): Promise<void> {
  if (!room || room.role !== 'host') return;
  const before = room.settings;
  room.settings = settings;
  renderRoomChrome();
  try {
    await room.client.updateSettings(settings);
    if (before.mode === 'open' && settings.mode === 'interview' && room.participants.length > 1) {
      roomError = "Participants who joined in open mode have already seen this scenario's internals.";
      roomFreshOffer = true;
      renderRoomChrome();
    }
    if (settings.mode === 'interview' && effectiveLintVisible(settings) && !effectiveLintVisible(before)) {
      showBoardToast('Participants will now see required flow steps as design hints.');
    }
  } catch (error) {
    if (room) room.settings = before;
    roomError = roomErrorMessage(error);
    renderRoomChrome();
  }
}

function roomPdfExtras() {
  return {
    notes: getHostNotes(),
    scenario: getActiveScenarioDocument(),
    board: {
      components: state.components.map((c) => ({ label: c.label, type: c.type })),
      beltCount: state.belts.length,
      textCount: state.annotations.texts.length,
      strokeCount: state.annotations.strokes.length,
    },
    roomCode: room?.joinCode ?? null,
  };
}

function roomDialogCallbacks(): RoomDialogCallbacks {
  return {
    onShare: () => void createRoomSession(),
    onJoin: (input) => {
      const code = normalizeJoinCode(input);
      if (!code) {
        showJoinInputError('Enter the 8-character code or paste the participant link.');
        return;
      }
      closeRoomDialog();
      navigate(`/sandbox${roomFragment({ kind: 'join', code })}`);
    },
    onRotateCode: () => void rotateJoinCode(),
    onRotateHost: () => void rotateHostLink(),
    onLeave: () => void leaveRoomSession(),
    onClose: () => {
      roomError = null;
      roomFreshOffer = false;
      closeRoomDialog();
    },
    onSettings: (settings) => void updateRoomSettings(settings),
    onAssignPen: (connectionId) => {
      if (!room) return;
      room.penRequests = room.penRequests.filter((id) => id !== connectionId);
      void room.client.assignPen(connectionId).catch((error) => showBoardToast(roomErrorMessage(error)));
    },
    onRequestPen: () => {
      if (!room) return;
      void room.client.requestPen().catch((error) => showBoardToast(roomErrorMessage(error)));
      showBoardToast('Asked the host for the pen.');
    },
    onReleaseReport: () => void releaseHeldReport(),
    onFreshRoom: () => void startFreshInterviewRoom(),
    onCopySnapshot: (kind) => void copySnapshotLink(buildSnapshot(kind, state.lastSeed)),
    onExportSnapshot: () => exportSnapshotFile(buildSnapshot('board', null)),
    onImportSnapshot: (file) => void importSnapshotFile(file),
  };
}

/**
 * §4.2: participants who joined in open mode have seen the scenario's
 * internals, and clients cannot be trusted to forget. Leave this room and
 * open a new one — new code, new host link — around the same board, already
 * in interview mode.
 */
async function startFreshInterviewRoom(): Promise<void> {
  if (!room || room.role !== 'host') return;
  const settings: RoomSettings = { ...room.settings, mode: 'interview' };
  roomError = null;
  roomFreshOffer = false;
  await leaveRoomSession();
  await createRoomSession();
  if (room) await updateRoomSettings(settings);
}

async function releaseHeldReport(): Promise<void> {
  if (!room || room.role !== 'host') return;
  try {
    await room.client.releaseReport();
    room.reportReleased = true;
    renderRoomChrome();
  } catch (error) {
    showBoardToast(roomErrorMessage(error));
  }
}

function openRoomDialogNow(): void {
  openRoomDialog(roomViewModel(), roomDialogCallbacks());
}

/** Presence panel, Share button and host-only chrome, after any room change. */
function renderRoomChrome(): void {
  const model = roomViewModel();
  renderPresencePanel(model, openRoomDialogNow);
  updateRoomDialog(model);
  const share = document.getElementById('btn-share');
  if (share) {
    share.textContent = room ? `🔗 Room ${room.joinCode ?? ''}`.trim() : '🔗 Share';
    share.classList.toggle('in-room', room !== null);
  }
  // §4.1: only the host edits the scenario; open-mode participants get a
  // read-only view, interview-mode participants cannot open it at all.
  const scenario = document.getElementById('btn-scenario');
  if (scenario) {
    scenario.hidden =
      room !== null && room.role === 'participant' && room.settings.mode === 'interview';
    const viewer = room?.role === 'participant';
    scenario.textContent = viewer ? '📄 Scenario' : '✎ Scenario';
    scenario.title = viewer
      ? 'Read the scenario document the host applied'
      : "Edit this challenge's flows, objectives and roles";
  }
  const reference = document.getElementById('btn-reference');
  if (reference) reference.hidden = room?.role === 'participant';
  const notes = document.getElementById('btn-notes');
  if (notes) notes.hidden = room?.role !== 'host';
  const runControls = canRun();
  for (const id of ['btn-traffic', 'btn-failure']) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('is-restricted', !runControls);
  }
  // §6.1: an unedited catalog scenario is public; the host sees that until
  // the first Apply makes it theirs.
  renderPublicScenarioBanner(
    room !== null &&
      room.role === 'host' &&
      room.settings.mode === 'interview' &&
      getActiveScenarioOverride() === null
  );
}

function roomEvents(): RoomClientEvents {
  return {
    onBoardChanged: handleRemoteBoardChange,
    onPresence: (participants) => {
      if (!room) return;
      const gone = room.participants.filter((p) => !participants.some((q) => q.connectionId === p.connectionId));
      gone.forEach((p) => removeRemoteCursor(p.connectionId));
      room.participants = participants;
      renderRoomChrome();
    },
    onCursor: (connectionId, x, y) => {
      const who = room?.participants.find((p) => p.connectionId === connectionId);
      if (who) showRemoteCursor(connectionId, who.name, x, y);
    },
    onScenarioChanged: (projection) => {
      if (!room || room.role === 'host') return;
      room.scenarioSlug = projection.scenarioSlug;
      installScenarioProjection(projection);
    },
    onTrafficChanged: (traffic) => applyTrafficConfig(traffic, { fromRoom: true }),
    onRunStarted: (started) => beginRoomRun(started),
    onRunTick: handleRoomRunTick,
    onRunEvent: handleRoomRunEvent,
    onRunEnded: handleRoomRunEnded,
    onRunControllerChanged: handleRoomControllerChanged,
    onSettingsChanged: (settings, penHolder) => {
      if (!room) return;
      room.settings = settings;
      room.penHolder = penHolder;
      renderRoomChrome();
    },
    onPenChanged: (penHolder) => {
      if (!room) return;
      room.penHolder = penHolder;
      room.penRequests = room.penRequests.filter((id) => id !== penHolder);
      if (penHolder === room.connectionId && room.settings.pen === 'single') showBoardToast('You have the pen.');
      renderRoomChrome();
    },
    onPenRequested: (connectionId, name) => {
      if (!room || room.role !== 'host') return;
      if (!room.penRequests.includes(connectionId)) room.penRequests.push(connectionId);
      showBoardToast(`${name} is asking for the pen.`);
      renderRoomChrome();
    },
    onReportReleased: () => {
      if (!room) return;
      room.reportReleased = true;
      renderRoomChrome();
      if (room.role === 'participant' && room.heldReport) {
        hideHeldReportNotice();
        presentReport(room.heldReport);
        room.heldReport = null;
      }
    },
    onEnded: (reason) => endRoomSession(reason),
    onClosed: () => endRoomSession('connection-lost'),
    onReconnected: () => void rejoinAfterReconnect(),
  };
}

function setRoomFragment(credential: RoomCredential | null): void {
  const url = `${window.location.pathname}${window.location.search}${credential ? roomFragment(credential) : ''}`;
  window.history.replaceState({}, '', url);
}

/** Share: open a room around the current board and become its host (§3.1). */
async function createRoomSession(): Promise<void> {
  if (room || roomBusy) return;
  roomBusy = true;
  roomError = null;
  renderRoomChrome();
  const client = new RoomClient(roomEvents());
  try {
    await client.connect();
    const scenarioSlug = state.currentChallenge?.slug ?? 'url-shortener';
    const created = await client.createRoom({
      scenarioSlug,
      scenarioOverride: getActiveScenarioOverride(),
      trafficOverride: state.customTrafficConfig,
      board: boardToEntities(liveBoard()),
    });
    room = {
      client,
      role: 'host',
      connectionId: created.connectionId,
      name: created.name,
      joinCode: created.joinCode,
      hostSecret: created.hostSecret,
      scenarioSlug,
      version: created.version,
      participants: created.participants,
      staleDuringRun: false,
      credential: { kind: 'host', secret: created.hostSecret },
      settings: DEFAULT_ROOM_SETTINGS,
      penHolder: null,
      penRequests: [],
      reportReleased: false,
      heldReport: null,
    };
    hideRoomBanner();
    setRoomFragment(room.credential);
    replayEvents = null;
  } catch (error) {
    roomError = roomErrorMessage(error);
    await client.dispose();
  }
  roomBusy = false;
  renderRoomChrome();
  if (!isRoomDialogOpen()) openRoomDialogNow();
}

/** Open the connection and join with a code or a host secret. Null on failure, with the reason in `roomError`. */
async function joinRoomSession(credential: RoomCredential): Promise<RoomJoined | null> {
  const client = new RoomClient(roomEvents());
  try {
    await client.connect();
    const joined =
      credential.kind === 'join'
        ? await client.joinByCode(credential.code)
        : await client.joinAsHost(credential.secret);
    room = {
      client,
      role: joined.role === 'Host' ? 'host' : 'participant',
      connectionId: joined.connectionId,
      name: joined.name,
      joinCode: joined.joinCode ?? (credential.kind === 'join' ? formatJoinCode(credential.code) : null),
      hostSecret: credential.kind === 'host' ? credential.secret : null,
      scenarioSlug: joined.scenarioSlug,
      version: joined.version,
      participants: joined.participants,
      staleDuringRun: false,
      credential,
      settings: joined.settings,
      penHolder: joined.penHolder,
      penRequests: [],
      reportReleased: joined.reportReleased,
      heldReport: null,
    };
    roomError = null;
    replayEvents = null;
    return joined;
  } catch (error) {
    roomError = roomErrorMessage(error);
    await client.dispose();
    return null;
  }
}

/**
 * Apply one scenario projection (§6.1): the stripped catalog entry for an
 * interview-mode participant, or the slug-identified catalog scenario plus
 * the room's override for everyone else.
 */
function installScenarioProjection(projection: {
  scenarioSlug: string | null;
  challenge: unknown | null;
  scenarioOverride: ScenarioDocument | null;
}): void {
  if (projection.challenge) {
    state.currentChallenge = mapChallengeFromApi(projection.challenge);
    setActiveScenarioFromChallenge(state.currentChallenge);
  } else if (projection.scenarioSlug && state.currentChallenge?.slug !== projection.scenarioSlug) {
    const match = state.availableChallenges.find((c) => c.slug === projection.scenarioSlug);
    if (match) {
      state.currentChallenge = match;
      setActiveScenarioFromChallenge(match);
    }
  }
  // Selecting a challenge clears the overrides; restore the room's.
  setActiveScenarioOverride(projection.scenarioOverride);
  setActiveTrafficOverride(state.customTrafficConfig);
  // A read-only scenario view would now show a stale (or, after a switch to
  // interview mode, a withheld) document; close it (§4.1).
  closeScenarioEditor();
  rerenderConfigPalette();
  hideLintPanel();
  invalidateBoardSnapshot();
  annotationRenderer.updateProblemFrame();
  updateStatus();
}

/** Put the room's board and scenario on this client without broadcasting. */
function installRoomBoard(joined: RoomJoined): void {
  installScenarioProjection(joined);
  applyTrafficConfig(joined.trafficOverride, { fromRoom: true });
  rerenderConfigPalette();
  hideLintPanel();
  installBoard(entitiesToBoard(joined.board), { broadcast: false });
  updateStatus();
  if (joined.run) {
    // Joined mid-run: replay from tick 0 up to the controller's clock.
    beginRoomRun(joined.run, { lastTick: joined.run.lastTick, events: joined.run.events });
  }
}

async function resyncBoard(): Promise<void> {
  if (!room) return;
  try {
    const snapshot = await room.client.requestBoard();
    if (!room) return;
    room.version = snapshot.version;
    room.staleDuringRun = false;
    installBoard(entitiesToBoard(snapshot.board), { broadcast: false });
    updateStatus();
  } catch (error) {
    showBoardToast(roomErrorMessage(error));
  }
}

async function rejoinAfterReconnect(): Promise<void> {
  if (!room) return;
  const credential = room.credential;
  const old = room;
  try {
    const joined =
      credential.kind === 'join'
        ? await old.client.joinByCode(credential.code)
        : await old.client.joinAsHost(credential.secret);
    old.connectionId = joined.connectionId;
    old.name = joined.name;
    old.participants = joined.participants;
    old.version = joined.version;
    old.settings = joined.settings;
    old.penHolder = joined.penHolder;
    old.reportReleased = joined.reportReleased;
    installRoomBoard(joined);
    renderRoomChrome();
  } catch {
    endRoomSession('connection-lost');
  }
}

/** Mirror a committed local gesture to the room. */
function roomSend(diff: BoardDiff): void {
  if (!room || isEmptyDiff(diff)) return;
  void room.client.applyDiff(room.version, diffToChanges(diff)).catch((error) => {
    showBoardToast(roomErrorMessage(error));
  });
}

function roomSendCursor(x: number, y: number): void {
  if (!room) return;
  const now = performance.now();
  if (now - lastCursorSentAt < CURSOR_INTERVAL_MS) return;
  lastCursorSentAt = now;
  room.client.moveCursor(Math.round(x), Math.round(y));
}

/** Commit a text edit in progress so a board rebuild cannot lose it. */
function finishActiveTextEdit(): void {
  const editing = document.querySelector<HTMLElement>('.board-text.editing');
  editing?.dispatchEvent(new FocusEvent('blur'));
}

function handleRemoteBoardChange(message: BoardChanged): void {
  if (!room) return;
  if (message.version <= room.version) return;
  if (message.version !== room.version + 1) {
    room.version = message.version;
    void resyncBoard();
    return;
  }
  room.version = message.version;
  if (message.origin === room.connectionId) return;
  if (isSimRunning()) {
    room.staleDuringRun = true;
    return;
  }

  finishActiveTextEdit();
  // An entity under the local pointer keeps its local value until release;
  // last-writer-wins settles it when that gesture commits.
  const held = state.dragging?.id ?? null;
  const incoming = changesToDiff(message.changes, liveBoard());
  const forLive = { changes: incoming.changes.filter((c) => c.id !== held) };
  const applied = applyDiff(liveBoard(), forLive).board;
  state.components = applied.components;
  state.belts = applied.belts;
  state.componentConfigs = applied.componentConfigs;
  state.annotations = applied.annotations;
  if (lastCommittedBoard) {
    lastCommittedBoard = applyDiff(
      lastCommittedBoard,
      changesToDiff(message.changes, lastCommittedBoard)
    ).board;
  }

  if (
    state.selection?.kind === 'text' &&
    !state.annotations.texts.some((t) => t.id === state.selection!.id)
  ) {
    state.selection = null;
  }
  invalidateBoardSnapshot();
  onSimulationTopologyChange();
  refreshConfigPalette();
  updateStatus();
}

function endRoomSession(reason: string): void {
  if (!room) return;
  const wasHost = room.role === 'host';
  const client = room.client;
  room = null;
  roomRun = null;
  setRunFlowBundle(null);
  void client.dispose();
  clearRemoteCursors();
  setRoomFragment(null);
  closeRoomDialog();
  renderRoomChrome();
  // §3.4: the board is still here; a host can open a new room around it.
  showRoomBanner(
    reason,
    wasHost ? () => void createRoomSession() : null,
    hideRoomBanner
  );
}

async function leaveRoomSession(): Promise<void> {
  if (!room) return;
  const client = room.client;
  room = null;
  roomRun = null;
  setRunFlowBundle(null);
  roomFreshOffer = false;
  clearRemoteCursors();
  setRoomFragment(null);
  closeRoomDialog();
  renderRoomChrome();
  await client.leaveRoom();
  await client.dispose();
}

async function rotateJoinCode(): Promise<void> {
  if (!room || room.role !== 'host') return;
  try {
    room.joinCode = await room.client.rotateJoinCode();
    renderRoomChrome();
  } catch (error) {
    roomError = roomErrorMessage(error);
    renderRoomChrome();
  }
}

async function rotateHostLink(): Promise<void> {
  if (!room || room.role !== 'host') return;
  try {
    const secret = await room.client.rotateHostLink();
    room.hostSecret = secret;
    room.credential = { kind: 'host', secret };
    setRoomFragment(room.credential);
    renderRoomChrome();
  } catch (error) {
    roomError = roomErrorMessage(error);
    renderRoomChrome();
  }
}

/** The host's scenario edits are the room's scenario (§4.1). */
function roomPublishScenario(doc: ScenarioDocument | null): void {
  if (!room || room.role !== 'host') return;
  void room.client.setScenarioOverride(doc).catch((error) => showBoardToast(roomErrorMessage(error)));
}

/**
 * Replace the whole board. Used for Reset, Starter, Reference and for boards
 * that arrive from a room. In a room the replacement is itself a gesture and
 * is mirrored unless it came from the room.
 */
function installBoard(board: BoardState, options: { broadcast: boolean; asGesture?: boolean }): void {
  if (options.broadcast && inRoomRun() && isSimRunning()) {
    // The board is locked for everyone during a run; Reset and friends stop it first.
    if (!ensureCanRun()) return;
    sendRoomRunEvent('stop');
    showBoardToast('The board is locked during the run. Stopping the run for everyone.');
    return;
  }
  if (options.broadcast && room && !ensureCanEdit()) return;
  if (isSimRunning()) stopSimulation();
  closeRequestTrace();
  hideLintPanel();
  invalidateBoardSnapshot();

  const previous = lastCommittedBoard;
  state.components = board.components;
  state.belts = board.belts;
  state.annotations = board.annotations;
  state.componentConfigs = board.componentConfigs;
  state.engine = null;
  state.selection = null;
  setTool('hand');
  mountBoard();
  annotationRenderer.updateProblemFrame();
  updateStatus();
  // A replaced board invalidates any armed replay (product-directions §2.6);
  // an import that carries one re-arms it after this returns.
  replayEvents = null;
  if (options.asGesture) {
    // An import is one undoable gesture: pushHistory diffs against the
    // committed board, records it, and mirrors it to the room.
    pushHistory();
    return;
  }
  seedHistory();
  if (options.broadcast && previous) {
    roomSend(diffBoards(previous, liveBoard()));
  }
}

// ── Runs in rooms (docs/specs/interview-platform.md §4.4) ──────────────────
//
// Every client runs the simulation itself from the same seed, board and
// event sequence. The controller's clock is the only clock: it stamps each
// control event with the tick it applies at and reports its tick about four
// times a second; nobody else advances past the last tick they heard.

const ROOM_REPORT_INTERVAL_MS = 250;
const ROOM_EVENT_LEAD_TICKS = 15;
const ROOM_CATCHUP_THRESHOLD = 90;
const ROOM_CATCHUP_PER_FRAME = 1200;

interface RoomRunState {
  seed: number;
  controller: boolean;
  controllerConnectionId: string;
  /** Ticks this client has applied to its engine. */
  tick: number;
  /** Non-controllers never tick past this; Infinity for the controller. */
  targetTick: number;
  events: Map<number, RunEvent>;
  /** Controller: stamps not yet reported. */
  pendingStamps: TickStamp[];
  lastReportAt: number;
  /** The server already announced the end; do not announce it again. */
  serverEnded: boolean;
  /** Every event applied so far, in order — the run file's intervention log (§2.6). */
  applied: ReplayEvent[];
}

let roomRun: RoomRunState | null = null;
/** The last finished run's interventions, for exporting after the run (§2.6). */
let lastRunEvents: ReplayEvent[] = [];

function inRoomRun(): boolean {
  return room !== null && roomRun !== null;
}

/** Play in a room: ask the server to fix seed and version for everyone. */
function requestRoomRun(seed?: number): void {
  if (!room) return;
  if (state.components.length === 0) return;
  void room.client.startRun(seed ?? room.settings.seed ?? state.pinnedSeed ?? null).catch((error) => {
    showBoardToast(roomErrorMessage(error));
  });
}

function beginRoomRun(started: RunStarted, resume?: { lastTick: number; events: RunEvent[] }): void {
  if (!room) return;
  if (isSimRunning()) stopSimulation();
  const controller = started.controllerConnectionId === room.connectionId;
  roomRun = {
    seed: started.seed,
    controller,
    controllerConnectionId: started.controllerConnectionId,
    tick: 0,
    targetTick: controller ? Number.POSITIVE_INFINITY : (resume?.lastTick ?? 0),
    events: new Map((resume?.events ?? []).map((e) => [e.seq, e])),
    pendingStamps: [],
    lastReportAt: 0,
    serverEnded: false,
    applied: [],
  };
  hideRoomBanner();
  // §6.2: the opaque flow bundle drives the engine for this run only. It is
  // null for hosts and open-mode rooms, whose scenario already has flows.
  setRunFlowBundle(started.flows ?? null);
  startSimulation(started.seed);
}

/** Send a control request; the controller stamps it and everyone applies it at that tick. */
function sendRoomRunEvent(kind: RunEventKind, payload: unknown | null = null): void {
  if (!room) return;
  void room.client.sendRunEvent(kind, payload).catch((error) => showBoardToast(roomErrorMessage(error)));
}

function stampRoomEvent(event: RunEvent): void {
  if (!roomRun || !roomRun.controller || event.applyAtTick !== null) return;
  // Paused: nobody is advancing, so the event applies right where everyone stands.
  const applyAt = state.paused ? roomRun.tick : roomRun.tick + ROOM_EVENT_LEAD_TICKS;
  event.applyAtTick = applyAt;
  roomRun.pendingStamps.push({ seq: event.seq, applyAtTick: applyAt });
}

function handleRoomRunEvent(event: RunEvent): void {
  if (!roomRun) return;
  const known = roomRun.events.get(event.seq);
  if (known) {
    if (known.applyAtTick === null && event.applyAtTick !== null) known.applyAtTick = event.applyAtTick;
  } else {
    roomRun.events.set(event.seq, { ...event });
  }
  const held = roomRun.events.get(event.seq)!;
  stampRoomEvent(held);
  if (roomRun.controller) reportRoomTick(true);
  // Paused clients have no loop to reach the tick; apply what is due now.
  if (state.paused) applyRoomEventsAt(roomRun.tick);
}

function handleRoomRunTick(tick: RunTick): void {
  if (!roomRun || roomRun.controller) return;
  for (const stamp of tick.stamps) {
    const evt = roomRun.events.get(stamp.seq);
    if (evt && evt.applyAtTick === null) evt.applyAtTick = stamp.applyAtTick;
  }
  if (tick.tick > roomRun.targetTick) roomRun.targetTick = tick.tick;
  if (state.paused) applyRoomEventsAt(roomRun.tick);
  else if (state.animFrame === null && isSimRunning()) runSimulationLoop();
}

/** Apply, in order, every event stamped at `tick` that has not been applied yet. */
function applyRoomEventsAt(tick: number): void {
  if (!roomRun || !state.engine) return;
  const due = [...roomRun.events.values()]
    .filter((e) => e.applyAtTick !== null && e.applyAtTick <= tick)
    .sort((a, b) => a.seq - b.seq);
  for (const evt of due) {
    roomRun.events.delete(evt.seq);
    roomRun.applied.push({ seq: evt.seq, kind: evt.kind, payload: evt.payload, applyAtTick: evt.applyAtTick! });
    applyRoomEvent(evt);
    if (!roomRun) return;
  }
}

function applyRoomEvent(evt: RunEvent): void {
  switch (evt.kind) {
    case 'pause':
      if (isSimRunning() && !state.paused) {
        state.paused = true;
        if (state.animFrame !== null) {
          cancelAnimationFrame(state.animFrame);
          state.animFrame = null;
        }
        if (roomRun?.controller) reportRoomTick(true);
        refreshBoardVisuals(state.engine?.getSnapshot() ?? null, 0, 0);
        updateStatus();
      }
      return;
    case 'resume':
      if (isSimRunning() && state.paused) {
        state.paused = false;
        state.lastTick = performance.now();
        state.simAccumulator = 0;
        runSimulationLoop();
        updateStatus();
      }
      return;
    case 'speed': {
      const speed = Number((evt.payload as { speed?: number } | null)?.speed);
      if (speed === 1 || speed === 5 || speed === 20 || speed === 100) applySpeed(speed);
      return;
    }
    case 'failure': {
      const f = evt.payload as { componentId?: string; type?: string; duration?: number } | null;
      if (!f?.componentId || !f.type || !state.engine) return;
      state.engine.injectFailure(
        f.componentId,
        f.type as 'shutdown' | 'latency' | 'capacity' | 'partition',
        Number(f.duration) || 10
      );
      return;
    }
    case 'stop':
      if (isSimRunning()) stopSimulation();
      return;
  }
}

/** One engine tick inside a room run. False when blocked by a pause or the controller's clock. */
function stepRoomTick(): boolean {
  if (!roomRun || !state.engine) return false;
  applyRoomEventsAt(roomRun.tick);
  if (!roomRun || state.paused || !isSimRunning()) return false;
  if (!roomRun.controller && roomRun.tick >= roomRun.targetTick) return false;
  state.engine.tick(SIM_STEP);
  roomRun.tick++;
  return true;
}

function reportRoomTick(force = false): void {
  if (!room || !roomRun || !roomRun.controller) return;
  const now = performance.now();
  if (!force && now - roomRun.lastReportAt < ROOM_REPORT_INTERVAL_MS && roomRun.pendingStamps.length === 0) return;
  roomRun.lastReportAt = now;
  const stamps = roomRun.pendingStamps;
  roomRun.pendingStamps = [];
  room.client.reportTick(roomRun.tick, stamps);
}

/** The engine left `running`: tell the room if we are the controller, then forget the run. */
function finishRoomRun(status: 'won' | 'lost' | 'idle'): void {
  if (!roomRun) return;
  // The opaque flow bundle is discarded with the run (§6.2); the report was
  // already computed by the engine that consumed it.
  setRunFlowBundle(null);
  const run = roomRun;
  roomRun = null;
  lastRunEvents = run.applied;
  if (!room || run.serverEnded) return;
  if (run.controller) {
    room.client.reportTick(run.tick, run.pendingStamps);
    void room.client.endRun(status === 'idle' ? 'stopped' : 'finished').catch(() => undefined);
  }
}

function handleRoomRunEnded(reason: 'finished' | 'stopped' | 'interrupted'): void {
  if (!roomRun) return;
  roomRun.serverEnded = true;
  if (reason === 'finished') {
    // Let a lagging client run to its own end and its own report.
    roomRun.targetTick = Number.POSITIVE_INFINITY;
    if (!roomRun.controller && state.animFrame === null && isSimRunning() && !state.paused) runSimulationLoop();
    return;
  }
  if (reason === 'interrupted') showBoardToast('Run interrupted: the person driving the run left.');
  if (isSimRunning()) stopSimulation();
  setRunFlowBundle(null);
  roomRun = null;
}

function handleRoomControllerChanged(controllerConnectionId: string, lastTick: number): void {
  if (!room || !roomRun) return;
  roomRun.controllerConnectionId = controllerConnectionId;
  if (controllerConnectionId !== room.connectionId) return;
  roomRun.controller = true;
  roomRun.targetTick = Number.POSITIVE_INFINITY;
  // Stamp whatever is waiting, after every tick the others may already hold.
  const floor = Math.max(roomRun.tick, lastTick);
  for (const evt of [...roomRun.events.values()].sort((a, b) => a.seq - b.seq)) {
    if (evt.applyAtTick === null) {
      evt.applyAtTick = floor + ROOM_EVENT_LEAD_TICKS;
      roomRun.pendingStamps.push({ seq: evt.seq, applyAtTick: evt.applyAtTick });
    }
  }
  reportRoomTick(true);
  if (state.animFrame === null && isSimRunning() && !state.paused) runSimulationLoop();
}

function applySpeed(speed: 1 | 5 | 20 | 100): void {
  state.simulationSpeed = speed;
  document.querySelectorAll('.speed-btn').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-speed') === String(speed));
  });
}

// ── Portable snapshots (docs/specs/product-directions.md §2) ────────────────

/**
 * Load a `#board=` snapshot: scenario, overrides, traffic, board, and — for
 * run links — the pinned seed. A snapshot that fails to decode leaves the
 * sandbox exactly as a plain visit would, with one toast; the fragment is
 * cleared only on success, so a refresh of a bad link explains itself again.
 */
async function mountFromSnapshot(token: string, fallbackSlug?: string): Promise<void> {
  let snapshot: BoardSnapshotV1 | null = null;
  let problem = '';
  try {
    snapshot = await decodeSnapshot(token);
  } catch (error) {
    problem = error instanceof Error ? error.message : 'That board link could not be read.';
  }
  if (!snapshot) {
    await initSandbox(fallbackSlug, true);
    showBoardToast(problem);
    return;
  }
  await initSandbox(snapshot.scenarioSlug ?? fallbackSlug, false);
  setActiveScenarioOverride(snapshot.scenario ?? null);
  applyTrafficConfig(snapshot.traffic ?? null);
  installBoard(entitiesToBoard(snapshot.board as WireEntity[]), { broadcast: false });
  if (snapshot.kind === 'run' && snapshot.seed) {
    state.pinnedSeed = snapshot.seed;
  }
  rerenderConfigPalette();
  updateStatus();
  // The snapshot is loaded; later edits belong to this tab, not the link.
  setRoomFragment(null);
}

/**
 * Interventions armed from a run file (§2.6), applied by the solo loop at
 * their ticks. Only engine-affecting kinds are replayed: pause, resume and
 * speed are wall-clock controls that never changed the original run's
 * results. Any board change disarms the replay — it would no longer
 * reproduce anything.
 */
let replayEvents: ReplayEvent[] | null = null;
let pendingReplay: ReplayEvent[] = [];
let soloTick = 0;
/** True while an import's own pushHistory runs, so it does not disarm the replay it is about to arm. */
let importingSnapshot = false;

function applyReplayEventsAt(tick: number): void {
  while (pendingReplay.length > 0 && pendingReplay[0].applyAtTick <= tick) {
    const evt = pendingReplay.shift()!;
    if (evt.kind !== 'failure' && evt.kind !== 'stop') continue;
    applyRoomEvent({ seq: evt.seq, kind: evt.kind, payload: evt.payload, from: 'replay', applyAtTick: evt.applyAtTick });
    if (!state.engine || !isSimRunning()) return;
  }
}

/** Save text as a download; nothing leaves the browser except to the user's disk. */
function downloadTextFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSnapshotFile(snapshot: BoardSnapshotV1 | RunReplayV1): void {
  downloadTextFile(snapshotFileName(snapshot.kind, snapshot.scenarioSlug), serializeSnapshot(snapshot));
}

/** The last run as a run file: the board as run, its seed, and every intervention. */
function runFileFor(report: SimulationReport, board: BoardSnapshotV1): RunReplayV1 {
  const events = roomRun?.applied ?? lastRunEvents;
  const run: RunReplayV1 = { ...board, kind: 'run', seed: report.seed };
  if (events.length > 0) run.events = events.map((e) => ({ ...e }));
  return run;
}

/**
 * Import a board or run file (§2.5). Solo, it replaces the board as one undo
 * step and installs the file's scenario, traffic and (for a run) seed and
 * interventions. In a room it is an ordinary gesture — refused without the
 * pen, mirrored as one diff with it — and only the host's import changes the
 * room's scenario; traffic follows the who-can-run rule.
 */
async function importSnapshotFile(file: File): Promise<void> {
  let snapshot: BoardSnapshotV1 | RunReplayV1;
  try {
    snapshot = parseSnapshotFile(await file.text());
  } catch (error) {
    showBoardToast(error instanceof Error ? error.message : 'That file is not a BreakIT board file.');
    return;
  }
  if (inRoomRun() && isSimRunning()) {
    showBoardToast('Stop the run before importing a board.');
    return;
  }
  if (room && !ensureCanEdit()) return;

  if (!room || room.role === 'host') {
    setActiveScenarioOverride(snapshot.scenario ?? null);
    roomPublishScenario(snapshot.scenario ?? null);
  }
  if (!room || canRun()) applyTrafficConfig(snapshot.traffic ?? null);

  importingSnapshot = true;
  try {
    installBoard(entitiesToBoard(snapshot.board as WireEntity[]), { broadcast: true, asGesture: true });
  } finally {
    importingSnapshot = false;
  }
  rerenderConfigPalette();

  let what = 'Board imported.';
  if (!room && snapshot.kind === 'run' && snapshot.seed) {
    state.pinnedSeed = snapshot.seed;
    const events = 'events' in snapshot ? (snapshot.events ?? []) : [];
    replayEvents = events.length > 0 ? events : null;
    what = replayEvents
      ? 'Run imported — press Play to replay it, interventions included.'
      : 'Run imported — press Play to replay it with the same seed.';
  }
  showBoardToast(what);
  renderRoomChrome();
}

/** The current tab's state as a snapshot document. */
function buildSnapshot(kind: 'board' | 'run', seed: number | null, board = liveBoard()): BoardSnapshotV1 {
  const snapshot: BoardSnapshotV1 = {
    v: 1,
    kind,
    scenarioSlug: room ? room.scenarioSlug : (state.currentChallenge?.slug ?? null),
    board: boardToEntities(board),
  };
  const scenario = getActiveScenarioOverride();
  if (scenario) snapshot.scenario = scenario;
  if (state.customTrafficConfig) snapshot.traffic = state.customTrafficConfig;
  if (kind === 'run' && seed !== null) snapshot.seed = seed;
  return snapshot;
}

/** Encode, size-check and copy a snapshot link; every outcome is a toast. */
async function copySnapshotLink(snapshot: BoardSnapshotV1): Promise<void> {
  if (snapshot.kind === 'run' && snapshot.seed === undefined) {
    showBoardToast('Run the simulation first — a run link carries its seed.');
    return;
  }
  const fragment = boardFragment(await encodeSnapshot(snapshot));
  if (fragment.length > MAX_FRAGMENT_CHARS) {
    showBoardToast('This board is too large for a link.');
    return;
  }
  try {
    await navigator.clipboard.writeText(`${siteBase()}${fragment}`);
    showBoardToast('Link copied — anyone who opens it gets this exact board.');
  } catch {
    showBoardToast('Could not reach the clipboard. Copy the address after opening the link yourself.');
  }
}

export interface SandboxMountOptions {
  container: HTMLElement;
  challengeSlug?: string;
  loadReferencePreset?: boolean;
  /** Join a room on mount (`#join=` or `#host=` in the URL, §3.2). */
  room?: RoomCredential;
  /** Load a `#board=` snapshot on mount (product-directions.md §2); ignored in a room. */
  snapshotToken?: string;
}

export async function mountSandboxApp(options: SandboxMountOptions): Promise<void> {
  mountContainer = options.container;
  if (options.room) {
    // The room decides the scenario, so join before the challenge loads.
    const joined = await joinRoomSession(options.room);
    await initSandbox(joined?.scenarioSlug ?? options.challengeSlug, false);
    if (joined) {
      installRoomBoard(joined);
      renderRoomChrome();
    } else {
      loadChallengeStarter();
      setRoomFragment(null);
      openRoomDialogNow();
    }
  } else if (options.snapshotToken) {
    await mountFromSnapshot(options.snapshotToken, options.challengeSlug);
  } else {
    await initSandbox(options.challengeSlug, options.loadReferencePreset ?? true);
  }
  if (import.meta.env.DEV) {
    // Dev-only hooks for driving the sandbox from automation/devtools.
    (window as unknown as { __breakitDebug?: unknown }).__breakitDebug = {
      state,
      boardRenderer,
      startSimulation,
      pauseSimulation,
      resumeSimulation,
      traceRequest,
      closeRequestTrace,
    };
  }
}

export function destroySandboxApp(): void {
  if (room) {
    const client = room.client;
    room = null;
    roomRun = null;
    void client.leaveRoom().then(() => client.dispose());
  }
  setRunFlowBundle(null);
  roomBusy = false;
  roomError = null;
  roomFreshOffer = false;
  clearRemoteCursors();
  clearHostNotes();
  closeRoomDialog();
  hideRoomBanner();
  hideHeldReportNotice();
  windowListeners?.abort();
  windowListeners = null;
  if (state.animFrame !== null) {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = null;
  }
  state.engine = null;
  state.paused = false;
  state.tracedRequestId = null;
  unmountRequestInspector();
  hideLintPanel();
  dismissBoardToast();
  closeChallengeSelector();
  closeTrafficConfig();
  closeFailureInjection();
  closeScenarioEditor();
  document.getElementById('challenge-overlay')?.remove();
  document.getElementById('challenge-selector-container')?.remove();
  document.getElementById('traffic-config-container')?.remove();
  document.getElementById('failure-injection-container')?.remove();
  if (mountContainer) {
    mountContainer.innerHTML = '';
  }
  mountContainer = null;
}

async function initSandbox(challengeSlug?: string, loadReferencePreset = true): Promise<void> {
  state.pinnedSeed = parseSeed(new URLSearchParams(window.location.search).get('seed'));
  state.lastSeed = null;
  try {
    console.log('Initializing sandbox...');
    const appData = await initializeApp(challengeSlug);
    state.availableChallenges = appData.challenges;
    state.currentChallenge = appData.selectedChallenge;
    setActiveScenarioFromChallenge(state.currentChallenge);

    console.log(`Loaded ${appData.challenges.length} challenges from backend`);
    console.log(`Selected challenge: ${state.currentChallenge?.name}`);
  } catch (error) {
    console.error('Failed to initialize sandbox:', error);
  }

  render();
  if (loadReferencePreset) {
    loadChallengeStarter();
  } else {
    resetBoard();
    annotationRenderer.updateProblemFrame();
  }
}
