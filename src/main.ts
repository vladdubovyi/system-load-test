import './styles/main.css';
import {
  SCENARIO,
  COMPONENT_DEFS,
  REQUEST_COLORS,
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
import { mountReportModal } from './ui/report-modal';

interface GameState {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  selectedPalette: ComponentType | null;
  connectFromPort: Port | null;
  dragging: { id: string; offsetX: number; offsetY: number } | null;
  engine: SimulationEngine | null;
  animFrame: number | null;
  lastTick: number;
  lastHudUpdate: number;
  simAccumulator: number;
  lastRunStatus: 'idle' | 'running' | 'won' | 'lost';
  displayedHud: {
    time: number;
    rps: number;
    spawned: number;
    completed: number;
    dropped: number;
  };
}

const SIM_STEP = 1 / 60;
const HUD_INTERVAL_MS = 600;
const HUD_LERP_SPEED = 2.2;

const state: GameState = {
  components: [],
  belts: [],
  selectedPalette: null,
  connectFromPort: null,
  dragging: null,
  engine: null,
  animFrame: null,
  lastTick: 0,
  lastHudUpdate: 0,
  simAccumulator: 0,
  lastRunStatus: 'idle',
  displayedHud: { time: 0, rps: 0, spawned: 0, completed: 0, dropped: 0 },
};

const boardRenderer = new BoardRenderer();
const app = document.getElementById('app')!;

function render(): void {
  app.innerHTML = `
    <div class="layout">
      <header class="header">
        <div class="brand">
          <span class="brand-icon">🏗️</span>
          <div>
            <h1>System Design Game</h1>
            <p class="subtitle">Architect under pressure</p>
          </div>
        </div>
        <div class="header-stats" id="header-stats"></div>
        <div class="header-actions">
          <button class="btn btn-secondary" id="btn-preset" type="button">⚡ Load Preset</button>
          <button class="btn btn-secondary" id="btn-reset" type="button">Reset Board</button>
          <button class="btn btn-primary" id="btn-play" type="button">▶ Play</button>
        </div>
      </header>

      <aside class="sidebar">
        <section class="panel scenario-panel">
          <h2>${SCENARIO.title}</h2>
          <ul class="requirements">
            ${SCENARIO.requirements.map((r) => `<li>${r}</li>`).join('')}
          </ul>
          <div class="legend">
            <p class="legend-title">Request colors (celebrity URLs)</p>
            <div class="legend-colors">
              ${REQUEST_COLORS.map(
                (c, i) =>
                  `<span class="legend-dot ${[1, 2, 3].includes(i) ? 'celebrity' : ''}" style="background:${c}" title="URL type ${i + 1}"></span>`
              ).join('')}
            </div>
            <p class="legend-hint">Purple, pink & gold = viral celebrity links</p>
          </div>
        </section>

        <section class="panel palette-panel">
          <h2>Components</h2>
          <p class="panel-hint">Click to select, then click the board to place. Drag to reposition.</p>
          <div class="palette" id="palette"></div>
        </section>

        <section class="panel help-panel">
          <h2>Quick start</h2>
          <p class="panel-hint">
            New here? Click <strong>Load Preset</strong> for a reference architecture, then hit <strong>Play</strong>.
          </p>
          <h2 class="help-subheading">How to wire</h2>
          <ol class="help-steps">
            <li>Place a <strong>Load Balancer</strong> first</li>
            <li>Connect <span class="port-tag">Requests</span> → Load Balancer</li>
            <li>LB → Shortener pool (creates) & Backend pool (reads)</li>
            <li>Shortener → Database (+ Redis cache warm)</li>
            <li>Backend → Redis first (cache-aside), Database on miss</li>
            <li>Scale read services horizontally for viral traffic</li>
            <li>Click output port, then input port to add conveyor belts</li>
          </ol>
        </section>

        <div class="status-bar" id="status-bar"></div>
      </aside>

      <main class="board-wrap">
        <div class="board-toolbar">
          <span id="mode-label" class="mode-label">Place mode — select a component</span>
          <button class="btn btn-ghost" id="btn-connect" type="button">🔗 Connect Mode</button>
        </div>
        <div class="board" id="board">
          <div class="source-node" id="source-node">
            <div class="source-icon">📨</div>
            <div class="source-label">Incoming Requests</div>
            <button class="port port-out" data-port-id="${SOURCE_ID}:out" type="button" title="Output port"></button>
          </div>
        </div>
      </main>
    </div>
  `;

  renderPalette();
  bindEvents();
  mountBoard();
  updateStatus();
}

function renderPalette(): void {
  const palette = document.getElementById('palette')!;
  palette.innerHTML = (Object.keys(COMPONENT_DEFS) as ComponentType[])
    .map(
      (type) => `
      <button
        class="palette-item ${state.selectedPalette === type ? 'selected' : ''}"
        data-type="${type}"
        type="button"
      >
        <span class="palette-emoji">${COMPONENT_DEFS[type].emoji}</span>
        <span class="palette-label">${COMPONENT_DEFS[type].label}</span>
        <span class="palette-desc">${COMPONENT_DEFS[type].description}</span>
      </button>
    `
    )
    .join('');
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
  sourceNode.style.top = `${port.y - 72}px`;
}

function lerpHud(current: number, target: number, dt: number): number {
  const factor = 1 - Math.exp(-HUD_LERP_SPEED * dt);
  return current + (target - current) * factor;
}

function updateStatus(dt = 0): void {
  const bar = document.getElementById('status-bar')!;
  const stats = document.getElementById('header-stats')!;
  const snap = state.engine?.getSnapshot() ?? null;
  const running = snap?.status === 'running';

  bar.className = 'status-bar';
  if (snap?.status === 'won') bar.classList.add('won');
  if (snap?.status === 'lost') bar.classList.add('lost');
  if (snap?.spikeActive) bar.classList.add('spike');

  bar.textContent = snap?.message ?? 'Wire up your system, then press Play.';

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
      <div class="stat"><span class="stat-label">Time</span><span class="stat-value">${hud.time.toFixed(1)}s / ${SCENARIO.duration}s</span></div>
      <div class="stat"><span class="stat-label">RPS</span><span class="stat-value ${snap.spikeActive ? 'spike' : ''}">${Math.round(hud.rps)}</span></div>
      <div class="stat"><span class="stat-label">Spawned</span><span class="stat-value">${Math.round(hud.spawned).toLocaleString()}</span></div>
      <div class="stat"><span class="stat-label">Completed</span><span class="stat-value">${Math.round(hud.completed).toLocaleString()}</span></div>
      <div class="stat"><span class="stat-label">Dropped</span><span class="stat-value ${snap.totalDropped > 0 ? 'bad' : ''}">${Math.round(hud.dropped).toLocaleString()}</span></div>
    `;
  } else {
    stats.innerHTML = `
      <div class="stat"><span class="stat-label">Scenario</span><span class="stat-value">URL Shortener</span></div>
      <div class="stat"><span class="stat-label">Duration</span><span class="stat-value">${SCENARIO.duration}s</span></div>
    `;
  }

  const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
  playBtn.textContent = running ? '⏸ Pause' : '▶ Play';
  playBtn.disabled = state.components.length === 0;
}

function bindEvents(): void {
  const board = document.getElementById('board')!;
  const palette = document.getElementById('palette')!;

  window.addEventListener('resize', () => boardRenderer.resizeCanvas());

  palette.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-type]') as HTMLElement | null;
    if (!btn) return;
    state.selectedPalette = btn.dataset.type as ComponentType;
    state.connectFromPort = null;
    renderPalette();
    setModeLabel('Place mode — click the board to place');
  });

  document.getElementById('btn-connect')!.addEventListener('click', () => {
    state.selectedPalette = null;
    state.connectFromPort = null;
    renderPalette();
    setModeLabel('Connect mode — click output port, then input port');
  });

  board.addEventListener('click', (e) => {
    const portBtn = (e.target as HTMLElement).closest('.port') as HTMLElement | null;
    if (portBtn) {
      e.stopPropagation();
      handlePortClick(portBtn.dataset.portId!);
      return;
    }

    if (state.selectedPalette && !state.dragging) {
      const rect = board.getBoundingClientRect();
      const x = (e as MouseEvent).clientX - rect.left - 70;
      const y = (e as MouseEvent).clientY - rect.top - 36;
      state.components.push(createComponent(state.selectedPalette, Math.max(80, x), Math.max(60, y)));
      mountBoard();
    }
  });

  board.addEventListener('mousedown', (e) => {
    const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
    if (!comp || state.engine?.getSnapshot().status === 'running') return;
    const id = comp.dataset.id!;
    const c = state.components.find((x) => x.id === id);
    if (!c) return;
    const rect = board.getBoundingClientRect();
    state.dragging = {
      id,
      offsetX: (e as MouseEvent).clientX - rect.left - c.x,
      offsetY: (e as MouseEvent).clientY - rect.top - c.y,
    };
    comp.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging || state.engine?.getSnapshot().status === 'running') return;
    const boardEl = document.getElementById('board')!;
    const rect = boardEl.getBoundingClientRect();
    const c = state.components.find((x) => x.id === state.dragging!.id);
    if (!c) return;
    c.x = Math.max(10, Math.min(rect.width - c.width - 10, e.clientX - rect.left - state.dragging.offsetX));
    c.y = Math.max(10, Math.min(rect.height - c.height - 10, e.clientY - rect.top - state.dragging.offsetY));
    boardRenderer.updatePositions(state.components);
    positionSourceNode();
  });

  window.addEventListener('mouseup', () => {
    state.dragging = null;
  });

  document.getElementById('btn-play')!.addEventListener('click', () => {
    const snap = state.engine?.getSnapshot();
    if (snap?.status === 'running') {
      stopSimulation();
    } else {
      startSimulation();
    }
  });

  document.getElementById('btn-preset')!.addEventListener('click', () => {
    loadPreset();
  });

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    stopSimulation();
    state.components = [];
    state.belts = [];
    state.engine = null;
    mountBoard();
    updateStatus();
    setModeLabel('Place mode — select a component');
  });

  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
    if (!comp || state.engine?.getSnapshot().status === 'running') return;
    const id = comp.dataset.id!;
    state.components = state.components.filter((c) => c.id !== id);
    state.belts = state.belts.filter((b) => {
      const from = getPortById(b.fromPortId);
      const to = getPortById(b.toPortId);
      return from?.componentId !== id && to?.componentId !== id;
    });
    mountBoard();
  });
}

function handlePortClick(portId: string): void {
  const port = getPortById(portId);
  if (!port) return;

  if (!state.connectFromPort) {
    if (port.side === 'out') {
      state.connectFromPort = port;
      highlightPort(portId);
      setModeLabel(`Connect from ${port.label} — click an input port`);
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
  setModeLabel('Connect mode — click output port, then input port');
}

function highlightPort(portId: string): void {
  clearPortHighlights();
  document.querySelector(`[data-port-id="${portId}"]`)?.classList.add('port-active');
}

function clearPortHighlights(): void {
  document.querySelectorAll('.port-active').forEach((el) => el.classList.remove('port-active'));
}

function setModeLabel(text: string): void {
  const el = document.getElementById('mode-label');
  if (el) el.textContent = text;
}

function loadPreset(): void {
  if (state.engine?.getSnapshot().status === 'running') {
    stopSimulation();
  }

  const { components, belts } = buildPreset(URL_SHORTENER_PRESET);
  state.components = components;
  state.belts = belts;
  state.engine = null;
  state.selectedPalette = null;
  state.connectFromPort = null;
  renderPalette();
  mountBoard();
  updateStatus();
  setModeLabel('Preset loaded — press Play to simulate');
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
  state.engine = new SimulationEngine(state.components, state.belts);
  state.engine.start();
  state.lastRunStatus = 'running';
  state.lastTick = performance.now();
  state.lastHudUpdate = state.lastTick;
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

    if (now - state.lastHudUpdate >= HUD_INTERVAL_MS) {
      state.lastHudUpdate = now;
    }

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
