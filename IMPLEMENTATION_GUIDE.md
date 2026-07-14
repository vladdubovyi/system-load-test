# Implementation Guide - Completing the MVP

This guide provides step-by-step instructions for completing the remaining MVP features.

## Current Status

### ✅ Complete

1. **Backend API** (100%)
   - ASP.NET Core 8.0 with PostgreSQL
   - 4 challenges, 23 components seeded
   - All endpoints working
   - Running on `http://localhost:5063`

2. **Component Library** (100%)
   - 23 component definitions in backend
   - Component registry system created
   - Backward compatibility maintained

3. **Scenario Framework** (100%)
   - Flexible scenario types defined
   - Challenge model with traffic profiles
   - App initialization module created

### 🔨 Partially Complete

4. **API Integration** (80%)
   - API client: ✅ Created
   - Component registry: ✅ Created
   - Challenge selector UI: ✅ Created
   - Integration into main.ts: ❌ Pending

### ⏳ Not Started

5. Traffic configuration UI
6. Failure injection
7. Speed controls
8. Canvas enhancements (undo/redo, multi-select, copy/paste)

---

## Step 1: Complete API Integration

### Files to Modify

#### A. `src/main.ts`

**Add imports:**
```typescript
import { initializeApp } from './game/app-init';
import { componentRegistry } from './game/component-registry';
import { mountChallengeSelector } from './ui/challenge-selector';
import type { Challenge } from './game/scenario-types';
```

**Add to GameState:**
```typescript
interface GameState {
  // ... existing fields ...
  
  // Add these:
  currentChallenge: Challenge | null;
  availableChallenges: Challenge[];
  challengeSelectorOpen: boolean;
}
```

**Initialize state:**
```typescript
const state: GameState = {
  // ... existing fields ...
  
  currentChallenge: null,
  availableChallenges: [],
  challengeSelectorOpen: false,
};
```

**Add initialization function:**
```typescript
async function initApp(): Promise<void> {
  try {
    const appData = await initializeApp();
    state.availableChallenges = appData.challenges;
    state.currentChallenge = appData.selectedChallenge;
    
    console.log(`Loaded ${appData.challenges.length} challenges`);
    console.log(`Selected challenge: ${state.currentChallenge?.name}`);
  } catch (error) {
    console.error('Failed to initialize app:', error);
    // App will fall back to legacy components
  }
  
  render();
}
```

**Update app startup (at bottom of file):**
```typescript
// Replace: render(); loadPreset();
// With:
initApp().then(() => {
  // Optional: load preset if desired
});
```

**Add challenge selector functions:**
```typescript
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
  
  console.log(`Selected challenge: ${challenge.name}`);
  render();
}
```

#### B. `src/ui/floating-toolbar.ts`

**Add "Choose Challenge" button to menu:**

Find the menu section and add:
```typescript
<button class="menu-item" id="menu-challenge" type="button">🎯 Choose Challenge</button>
```

#### C. `src/main.ts` - Event Handlers

**Add event handler in `bindEvents()`:**
```typescript
function bindEvents(): void {
  // ... existing bindings ...
  
  // Add this:
  document.getElementById('menu-challenge')?.addEventListener('click', () => {
    closeMenu();
    openChallengeSelector();
  });
}
```

### Testing

1. Start backend: `cd backend/SystemDesignSimulator.Api && dotnet run`
2. Start frontend: `npm run dev`
3. Open `http://localhost:5173`
4. Click Menu (☰) → Choose Challenge
5. Select a challenge from the modal
6. Verify challenge name appears in console

---

## Step 2: Traffic Configuration UI

### Create `src/ui/traffic-config-panel.ts`

```typescript
import type { TrafficProfile } from '../game/scenario-types';

export function renderTrafficConfigPanel(traffic: TrafficProfile): string {
  return `
    <div class="config-panel traffic-config">
      <h3>Traffic Configuration</h3>
      
      <div class="config-field">
        <label>Base RPS</label>
        <input type="number" id="traffic-base-rps" value="${traffic.baseRps}" min="10" max="10000" step="10" />
      </div>
      
      <div class="config-field">
        <label>Pattern</label>
        <select id="traffic-pattern">
          <option value="constant" ${traffic.pattern === 'constant' ? 'selected' : ''}>Constant</option>
          <option value="spike" ${traffic.pattern === 'spike' ? 'selected' : ''}>Spikes</option>
          <option value="gradual" ${traffic.pattern === 'gradual' ? 'selected' : ''}>Gradual</option>
          <option value="random" ${traffic.pattern === 'random' ? 'selected' : ''}>Random</option>
        </select>
      </div>
      
      ${traffic.spikeMultiplier ? `
        <div class="config-field">
          <label>Spike Multiplier</label>
          <input type="number" id="traffic-spike-mult" value="${traffic.spikeMultiplier}" min="1" max="10" step="0.1" />
        </div>
      ` : ''}
      
      <div class="config-actions">
        <button id="btn-apply-traffic">Apply</button>
        <button id="btn-reset-traffic">Reset to Default</button>
      </div>
    </div>
  `;
}
```

### Add to Chrome

Add button in `floating-toolbar.ts`:
```typescript
<button class="chrome-action-btn" id="btn-traffic-config" type="button">📊 Traffic</button>
```

### CSS

Add to `main.css`:
```css
.traffic-config {
  position: fixed;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  min-width: 280px;
  box-shadow: var(--shadow-md);
  z-index: 500;
}

.config-field {
  margin: 12px 0;
}

.config-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.config-field input,
.config-field select {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.config-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.config-actions button {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
```

---

## Step 3: Failure Injection UI

### Create `src/ui/failure-injection-panel.ts`

```typescript
export interface InjectedFailure {
  componentId: string;
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  startTime: number;
  duration: number;
  severity: number;
}

export function renderFailureInjectionPanel(components: PlacedComponent[]): string {
  return `
    <div class="failure-panel">
      <h3>Inject Failure</h3>
      
      <div class="config-field">
        <label>Select Component</label>
        <select id="failure-component">
          <option value="">-- Choose Component --</option>
          ${components.map(c => `
            <option value="${c.id}">${c.label} (${c.type})</option>
          `).join('')}
        </select>
      </div>
      
      <div class="config-field">
        <label>Failure Type</label>
        <select id="failure-type">
          <option value="shutdown">Complete Shutdown</option>
          <option value="latency">Increased Latency +500ms</option>
          <option value="capacity">Reduced Capacity 50%</option>
          <option value="partition">Network Partition</option>
        </select>
      </div>
      
      <div class="config-field">
        <label>Duration (seconds)</label>
        <input type="number" id="failure-duration" value="10" min="1" max="60" />
      </div>
      
      <button id="btn-inject-failure" class="btn-danger">💥 Inject Failure</button>
    </div>
  `;
}
```

### Update Simulation Engine

Add to `src/game/simulation.ts`:

```typescript
export interface InjectedFailure {
  componentId: string;
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  startTime: number;
  duration: number;
  severity: number;
}

export class SimulationEngine {
  private injectedFailures: InjectedFailure[] = [];
  
  public injectFailure(failure: InjectedFailure): void {
    this.injectedFailures.push(failure);
  }
  
  private applyFailureEffects(componentId: string): void {
    const now = this.elapsedTime;
    const activeFailures = this.injectedFailures.filter(
      f => f.componentId === componentId && 
           now >= f.startTime &&
           now < f.startTime + f.duration
    );
    
    for (const failure of activeFailures) {
      const state = this.componentStates.get(componentId);
      if (!state) continue;
      
      switch (failure.type) {
        case 'shutdown':
          state.failed = true;
          break;
        case 'latency':
          // Reduce processing rate by 50%
          break;
        case 'capacity':
          // Handled by reducing capacity in component lookup
          break;
      }
    }
  }
}
```

---

## Step 4: Simulation Speed Controls

### Update `main.ts`

**Add to GameState:**
```typescript
interface GameState {
  // ... existing ...
  simulationSpeed: 1 | 5 | 20 | 100;
}

const state: GameState = {
  // ... existing ...
  simulationSpeed: 1,
};
```

**Update simulation loop:**
```typescript
function simulationLoop(now: number): void {
  if (!state.engine) return;

  const delta = (now - state.lastTick) / 1000;
  state.lastTick = now;
  state.simAccumulator += delta;

  // Apply speed multiplier
  const effectiveDt = SIM_STEP * state.simulationSpeed;

  while (state.simAccumulator >= effectiveDt && state.engine) {
    state.engine.tick(effectiveDt);
    state.simAccumulator -= effectiveDt;
  }

  refreshBoardVisuals();
  updateStatus();

  if (isSimRunning()) {
    state.animFrame = requestAnimationFrame(simulationLoop);
  }
}
```

### Update UI

Add speed controls in `floating-toolbar.ts`:
```typescript
<div class="speed-controls">
  <button class="speed-btn ${state.simulationSpeed === 1 ? 'active' : ''}" data-speed="1">1x</button>
  <button class="speed-btn ${state.simulationSpeed === 5 ? 'active' : ''}" data-speed="5">5x</button>
  <button class="speed-btn ${state.simulationSpeed === 20 ? 'active' : ''}" data-speed="20">20x</button>
  <button class="speed-btn ${state.simulationSpeed === 100 ? 'active' : ''}" data-speed="100">100x</button>
</div>
```

**Event handlers:**
```typescript
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const speed = parseInt(btn.getAttribute('data-speed') || '1');
    state.simulationSpeed = speed as 1 | 5 | 20 | 100;
    render();
  });
});
```

---

## Step 5: Undo/Redo

### Update `main.ts`

**Add to GameState:**
```typescript
interface HistoryEntry {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
}

interface GameState {
  // ... existing ...
  history: HistoryEntry[];
  historyIndex: number;
  maxHistory: number;
}

const state: GameState = {
  // ... existing ...
  history: [],
  historyIndex: -1,
  maxHistory: 50,
};
```

**Add functions:**
```typescript
function pushHistory(): void {
  // Trim future if we're not at the end
  state.history = state.history.slice(0, state.historyIndex + 1);
  
  // Add current state
  state.history.push({
    components: structuredClone(state.components),
    belts: structuredClone(state.belts),
    componentConfigs: cloneComponentConfigMap(state.componentConfigs),
  });
  
  // Limit size
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
    render();
  }
}
```

**Keyboard shortcuts:**
```typescript
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  }
});
```

**Call `pushHistory()` after each edit:**
- After placing component
- After deleting component
- After creating connection
- After deleting connection
- After applying config chip

---

## Step 6: Multi-Select & Copy/Paste

### Multi-Select

**Update GameState:**
```typescript
type BoardSelection =
  | { kind: 'component'; ids: string[] }  // Changed from id to ids
  | { kind: 'text'; ids: string[] }
  | null;
```

**Add Cmd/Ctrl+Click handling:**
```typescript
function handleComponentClick(componentId: string, event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey) {
    // Add to selection
    if (state.selection?.kind === 'component') {
      const ids = state.selection.ids;
      if (ids.includes(componentId)) {
        // Remove from selection
        state.selection.ids = ids.filter(id => id !== componentId);
      } else {
        // Add to selection
        state.selection.ids.push(componentId);
      }
    } else {
      state.selection = { kind: 'component', ids: [componentId] };
    }
  } else {
    // Replace selection
    state.selection = { kind: 'component', ids: [componentId] };
  }
  render();
}
```

### Copy/Paste

```typescript
let clipboard: {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  configs: Map<string, ComponentInstanceConfig>;
} | null = null;

function copy(): void {
  if (!state.selection || state.selection.kind !== 'component') return;
  
  const selectedIds = state.selection.ids;
  clipboard = {
    components: state.components.filter(c => selectedIds.includes(c.id)),
    belts: state.belts.filter(b => {
      const fromComp = b.fromPortId.split(':')[0];
      const toComp = b.toPortId.split(':')[0];
      return selectedIds.includes(fromComp) && selectedIds.includes(toComp);
    }),
    configs: new Map(
      Array.from(state.componentConfigs.entries())
        .filter(([id]) => selectedIds.includes(id))
    ),
  };
}

function paste(): void {
  if (!clipboard) return;
  
  const idMap = new Map<string, string>();
  const newComponents = clipboard.components.map(c => {
    const newId = `${c.type}-${Date.now()}-${Math.random()}`;
    idMap.set(c.id, newId);
    return { ...c, id: newId, x: c.x + 40, y: c.y + 40 };
  });
  
  const newBelts = clipboard.belts.map(b => {
    const fromParts = b.fromPortId.split(':');
    const toParts = b.toPortId.split(':');
    const newFromId = idMap.get(fromParts[0]);
    const newToId = idMap.get(toParts[0]);
    
    return {
      ...b,
      id: `belt-${Date.now()}-${Math.random()}`,
      fromPortId: `${newFromId}:${fromParts[1]}`,
      toPortId: `${newToId}:${toParts[1]}`,
    };
  });
  
  state.components.push(...newComponents);
  state.belts.push(...newBelts);
  
  pushHistory();
  render();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
    e.preventDefault();
    copy();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
    e.preventDefault();
    paste();
  }
});
```

---

## Testing Checklist

- [ ] Backend serves challenges via API
- [ ] Frontend loads challenges on startup
- [ ] Challenge selector modal opens and closes
- [ ] Selecting challenge resets board
- [ ] Components load dynamically based on challenge
- [ ] Traffic config panel opens and applies changes
- [ ] Failure injection works during simulation
- [ ] Speed controls change simulation speed
- [ ] Undo/redo preserves board state
- [ ] Multi-select with Cmd/Ctrl+Click
- [ ] Copy/paste duplicates selected components

---

## Deployment

### Frontend (GitHub Pages)

Already configured in `.github/workflows/deploy.yml`

### Backend Options

**Option 1: Azure App Service**
```bash
# Create app service
az webapp create --resource-group myResourceGroup --plan myPlan --name systemdesignsim-api

# Deploy
az webapp deployment source config-zip --resource-group myResourceGroup --name systemdesignsim-api --src publish.zip
```

**Option 2: Docker + Azure Container Instances**
```dockerfile
# Dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY published/ .
ENTRYPOINT ["dotnet", "SystemDesignSimulator.Api.dll"]
```

**Option 3: Fly.io / Railway**

Both support .NET and PostgreSQL. Follow their deployment guides.

---

## Final Notes

- Update CORS in backend `Program.cs` when deploying
- Set production API URL in frontend `.env.production`
- Add database connection string as environment variable in production
- Consider adding Redis for session caching (optional)
- Add rate limiting to API endpoints (optional)
- Add API authentication if needed (optional for MVP)

---

**Estimated time to complete remaining work: 6-8 hours**

Priority order:
1. API integration (1-2 hours)
2. Speed controls (30 min)
3. Traffic config UI (1-2 hours)
4. Undo/redo (1 hour)
5. Failure injection (2 hours)
6. Multi-select & copy/paste (1-2 hours)
