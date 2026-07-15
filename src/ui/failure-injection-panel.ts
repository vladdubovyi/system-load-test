import type { PlacedComponent } from '../game/types';

export interface InjectedFailure {
  componentId: string;
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  startTime: number;
  duration: number;
  severity: number;
}

export function renderFailureInjectionPanel(components: PlacedComponent[]): string {
  if (components.length === 0) {
    return `
      <div class="failure-panel">
        <div class="config-panel-header">
          <h3>Inject Failure</h3>
          <button class="config-panel-close" id="failure-close">×</button>
        </div>
        <div class="config-panel-body">
          <p class="no-components">No components available. Add components to the board first.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="failure-panel">
      <div class="config-panel-header">
        <h3>Inject Failure</h3>
        <button class="config-panel-close" id="failure-close">×</button>
      </div>
      
      <div class="config-panel-body">
        <div class="config-field">
          <label for="failure-component">Select Component</label>
          <select id="failure-component">
            <option value="">-- Choose Component --</option>
            ${components.map(c => `
              <option value="${c.id}">${c.label} (${c.type})</option>
            `).join('')}
          </select>
        </div>
        
        <div class="config-field">
          <label for="failure-type">Failure Type</label>
          <select id="failure-type">
            <option value="shutdown">💥 Complete Shutdown</option>
            <option value="latency">🐌 Increased Latency (+500ms)</option>
            <option value="capacity">⚠️ Reduced Capacity (50%)</option>
            <option value="partition">🔌 Network Partition</option>
          </select>
        </div>
        
        <div class="config-field">
          <label for="failure-duration">Duration (seconds)</label>
          <input 
            type="number" 
            id="failure-duration" 
            value="10" 
            min="1" 
            max="60" 
            step="1"
          />
          <span class="config-field-hint">How long the failure lasts</span>
        </div>
        
        <div class="failure-warning">
          <strong>⚠️ Warning:</strong> Injecting failures during simulation can cause components to fail and the simulation to end.
        </div>
      </div>
      
      <div class="config-panel-actions">
        <button class="config-btn config-btn-secondary" id="failure-cancel">Cancel</button>
        <button class="config-btn config-btn-danger" id="failure-inject">💥 Inject Failure</button>
      </div>
    </div>
  `;
}

export function mountFailureInjectionPanel(
  container: HTMLElement,
  components: PlacedComponent[],
  onInject: (failure: Omit<InjectedFailure, 'startTime'>) => void,
  onClose: () => void
): void {
  container.innerHTML = renderFailureInjectionPanel(components);
  
  // Close button
  container.querySelector('#failure-close')?.addEventListener('click', onClose);
  container.querySelector('#failure-cancel')?.addEventListener('click', onClose);
  
  // Inject button
  container.querySelector('#failure-inject')?.addEventListener('click', () => {
    const componentId = (document.getElementById('failure-component') as HTMLSelectElement)?.value;
    const type = (document.getElementById('failure-type') as HTMLSelectElement)?.value as any;
    const duration = parseInt((document.getElementById('failure-duration') as HTMLInputElement)?.value || '10');
    
    if (!componentId) {
      alert('Please select a component');
      return;
    }
    
    onInject({
      componentId,
      type,
      duration,
      severity: 1.0,
    });
    
    onClose();
  });
}
