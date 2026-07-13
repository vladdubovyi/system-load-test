import './styles/main.css';
import {
  SCENARIO,
  COMPONENT_DEFS,
  REQUEST_COLORS,
  type ComponentType,
  type PlacedComponent,
  type ConveyorBelt,
  type Port,
  type SimulationSnapshot,
} from './game/types';
import {
  SimulationEngine,
  createComponent,
  createBelt,
  getSourcePort,
  getComponentPorts,
  canConnect,
  loadColor,
  SOURCE_ID,
} from './game/simulation';

interface GameState {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  selectedPalette: ComponentType | null;
  connectFromPort: Port | null;
  dragging: { id: string; offsetX: number; offsetY: number } | null;
  engine: SimulationEngine | null;
  snapshot: SimulationSnapshot | null;
  animFrame: number | null;
  lastTick: number;
}

const state: GameState = {
  components: [],
  belts: [],
  selectedPalette: null,
  connectFromPort: null,
  dragging: null,
  engine: null,
  snapshot: null,
  animFrame: null,
  lastTick: 0,
};

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
          <h2>How to wire</h2>
          <ol class="help-steps">
            <li>Place a <strong>Load Balancer</strong> first</li>
            <li>Connect <span class="port-tag">Requests</span> → Load Balancer</li>
            <li>LB → Shortener (creates) & Backend (reads)</li>
            <li>Shortener → Database (+ Redis optional)</li>
            <li>Backend → Redis (cache) → done, or Database on miss</li>
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
          <svg class="belts-layer" id="belts-svg"></svg>
          <div class="components-layer" id="components-layer"></div>
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
  refreshBoard();
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

function refreshBoard(): void {
  const layer = document.getElementById('components-layer')!;
  const snapshot = state.snapshot;

  layer.innerHTML = state.components
    .map((c) => {
      const compState = snapshot?.components.get(c.id);
      const load = compState?.load ?? 0;
      const failed = compState?.failed ?? false;
      const def = COMPONENT_DEFS[c.type];
      const loadPct = Math.min(load, 100);

      return `
        <div
          class="component ${failed ? 'failed' : ''} ${state.dragging?.id === c.id ? 'dragging' : ''}"
          data-id="${c.id}"
          style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;--load:${loadPct}"
        >
          <div class="component-glow"></div>
          <div class="component-inner">
            <span class="component-emoji">${def.emoji}</span>
            <span class="component-name">${def.label}</span>
            ${compState ? `<span class="component-load">${Math.round(load)}%</span>` : ''}
          </div>
          <button class="port port-in" data-port-id="${c.id}:in" type="button" title="Input"></button>
          <button class="port port-out" data-port-id="${c.id}:out" type="button" title="Output"></button>
          ${
            failed
              ? '<div class="fail-badge">FAILED</div>'
              : load >= 85
                ? '<div class="warn-badge">HOT</div>'
                : ''
          }
        </div>
      `;
    })
    .join('');

  renderBelts();
  renderRequestParticles();
  positionSourceNode();
}

function positionSourceNode(): void {
  const sourceNode = document.getElementById('source-node');
  if (!sourceNode) return;
  const port = getSourcePort(state.components);
  sourceNode.style.top = `${port.y - 72}px`;
}

function beltPath(from: Port, to: Port): string {
  const dx = to.x - from.x;
  const cx1 = from.x + dx * 0.45;
  const cx2 = to.x - dx * 0.45;
  return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
}

function renderBelts(): void {
  const svg = document.getElementById('belts-svg')!;
  const snapshot = state.snapshot;
  const portMap = new Map(getAllPorts().map((p) => [p.id, p]));

  const beltsHtml = state.belts
    .map((belt) => {
      const from = portMap.get(belt.fromPortId);
      const to = portMap.get(belt.toPortId);
      if (!from || !to) return '';

      const beltState = snapshot?.belts.get(belt.id);
      const load = beltState?.load ?? 0;
      const color = loadColor(load);
      const path = beltPath(from, to);
      const pathId = `path-${belt.id}`;

      return `
        <g class="belt-group" data-belt-id="${belt.id}">
          <path class="belt-track" d="${path}" />
          <path class="belt-fill" d="${path}" style="stroke:${color};--belt-load:${Math.min(load, 100)}" />
          <path id="${pathId}" d="${path}" fill="none" stroke="transparent" stroke-width="12" />
        </g>
      `;
    })
    .join('');

  svg.innerHTML = `<defs>
    <linearGradient id="beltGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="var(--belt-color, #38bdf8)" stop-opacity="0.3" />
      <stop offset="100%" stop-color="var(--belt-color, #38bdf8)" stop-opacity="1" />
    </linearGradient>
  </defs>${beltsHtml}`;
}

function renderRequestParticles(): void {
  const svg = document.getElementById('belts-svg')!;
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const portMap = new Map(getAllPorts().map((p) => [p.id, p]));
  const existing = svg.querySelectorAll('.request-particle');
  existing.forEach((el) => el.remove());

  for (const req of snapshot.activeRequests) {
    if (req.state !== 'traveling' || !req.beltId) continue;
    const belt = state.belts.find((b) => b.id === req.beltId);
    if (!belt) continue;
    const from = portMap.get(belt.fromPortId);
    const to = portMap.get(belt.toPortId);
    if (!from || !to) continue;

    const t = req.progress;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * -18;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', `request-particle ${req.celebrity ? 'celebrity' : ''}`);
    circle.setAttribute('cx', String(x));
    circle.setAttribute('cy', String(y));
    circle.setAttribute('r', req.celebrity ? '6' : '4');
    circle.setAttribute('fill', REQUEST_COLORS[req.colorIndex]);
    if (req.celebrity) {
      circle.setAttribute('filter', 'url(#glow)');
    }
    svg.appendChild(circle);
  }

  if (!svg.querySelector('#glow')) {
    const defs = svg.querySelector('defs') ?? svg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), svg.firstChild);
    defs.innerHTML += `
      <filter id="glow">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    `;
  }
}

function updateStatus(): void {
  const bar = document.getElementById('status-bar')!;
  const stats = document.getElementById('header-stats')!;
  const snap = state.snapshot;
  const running = snap?.status === 'running';

  bar.className = 'status-bar';
  if (snap?.status === 'won') bar.classList.add('won');
  if (snap?.status === 'lost') bar.classList.add('lost');
  if (snap?.spikeActive) bar.classList.add('spike');

  bar.textContent = snap?.message ?? 'Wire up your system, then press Play.';

  if (snap) {
    stats.innerHTML = `
      <div class="stat"><span class="stat-label">Time</span><span class="stat-value">${snap.time.toFixed(1)}s / ${SCENARIO.duration}s</span></div>
      <div class="stat"><span class="stat-label">RPS</span><span class="stat-value ${snap.spikeActive ? 'spike' : ''}">${Math.round(snap.currentRps)}</span></div>
      <div class="stat"><span class="stat-label">Spawned</span><span class="stat-value">${snap.totalSpawned}</span></div>
      <div class="stat"><span class="stat-label">Completed</span><span class="stat-value">${snap.totalCompleted}</span></div>
      <div class="stat"><span class="stat-label">Dropped</span><span class="stat-value ${snap.totalDropped > 0 ? 'bad' : ''}">${snap.totalDropped}</span></div>
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
      refreshBoard();
    }
  });

  board.addEventListener('mousedown', (e) => {
    const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
    if (!comp || state.snapshot?.status === 'running') return;
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
    if (!state.dragging || state.snapshot?.status === 'running') return;
    const board = document.getElementById('board')!;
    const rect = board.getBoundingClientRect();
    const c = state.components.find((x) => x.id === state.dragging!.id);
    if (!c) return;
    c.x = Math.max(10, Math.min(rect.width - c.width - 10, e.clientX - rect.left - state.dragging.offsetX));
    c.y = Math.max(10, Math.min(rect.height - c.height - 10, e.clientY - rect.top - state.dragging.offsetY));
    refreshBoard();
  });

  window.addEventListener('mouseup', () => {
    state.dragging = null;
  });

  document.getElementById('btn-play')!.addEventListener('click', () => {
    if (state.snapshot?.status === 'running') {
      stopSimulation();
    } else {
      startSimulation();
    }
  });

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    stopSimulation();
    state.components = [];
    state.belts = [];
    state.engine = null;
    state.snapshot = null;
    refreshBoard();
    updateStatus();
    setModeLabel('Place mode — select a component');
  });

  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const comp = (e.target as HTMLElement).closest('.component') as HTMLElement | null;
    if (!comp || state.snapshot?.status === 'running') return;
    const id = comp.dataset.id!;
    state.components = state.components.filter((c) => c.id !== id);
    state.belts = state.belts.filter((b) => {
      const from = getPortById(b.fromPortId);
      const to = getPortById(b.toPortId);
      return from?.componentId !== id && to?.componentId !== id;
    });
    refreshBoard();
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
      }
    }
  }

  state.connectFromPort = null;
  clearPortHighlights();
  refreshBoard();
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

function startSimulation(): void {
  state.engine = new SimulationEngine(state.components, state.belts);
  state.engine.start();
  state.snapshot = state.engine.getSnapshot();
  state.lastTick = performance.now();

  const loop = (now: number) => {
    if (!state.engine || state.snapshot?.status !== 'running') {
      state.animFrame = null;
      refreshBoard();
      updateStatus();
      return;
    }
    const dt = Math.min((now - state.lastTick) / 1000, 0.05);
    state.lastTick = now;
    state.snapshot = state.engine.tick(dt);
    refreshBoard();
    updateStatus();
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
  state.engine?.stop();
  if (state.engine) {
    state.snapshot = state.engine.getSnapshot();
  }
  updateStatus();
}

render();
