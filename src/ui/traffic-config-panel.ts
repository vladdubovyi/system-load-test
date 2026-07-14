import type { TrafficProfile } from '../game/scenario-types';

export function renderTrafficConfigPanel(traffic: TrafficProfile): string {
  return `
    <div class="traffic-config-panel">
      <div class="config-panel-header">
        <h3>Traffic Configuration</h3>
        <button class="config-panel-close" id="traffic-close">×</button>
      </div>
      
      <div class="config-panel-body">
        <div class="config-field">
          <label for="traffic-base-rps">Base RPS</label>
          <input 
            type="number" 
            id="traffic-base-rps" 
            value="${traffic.baseRps}" 
            min="10" 
            max="10000" 
            step="10" 
          />
          <span class="config-field-hint">Requests per second</span>
        </div>
        
        <div class="config-field">
          <label for="traffic-pattern">Traffic Pattern</label>
          <select id="traffic-pattern">
            <option value="constant" ${traffic.pattern === 'constant' ? 'selected' : ''}>Constant</option>
            <option value="spike" ${traffic.pattern === 'spike' ? 'selected' : ''}>Spikes</option>
            <option value="gradual" ${traffic.pattern === 'gradual' ? 'selected' : ''}>Gradual</option>
            <option value="random" ${traffic.pattern === 'random' ? 'selected' : ''}>Random</option>
          </select>
        </div>
        
        ${traffic.spikeMultiplier ? `
          <div class="config-field">
            <label for="traffic-spike-mult">Spike Multiplier</label>
            <input 
              type="number" 
              id="traffic-spike-mult" 
              value="${traffic.spikeMultiplier}" 
              min="1" 
              max="10" 
              step="0.1" 
            />
            <span class="config-field-hint">Traffic increase during spikes</span>
          </div>
        ` : ''}
        
        ${traffic.spikeChance !== undefined ? `
          <div class="config-field">
            <label for="traffic-spike-chance">Spike Frequency</label>
            <input 
              type="number" 
              id="traffic-spike-chance" 
              value="${(traffic.spikeChance * 100).toFixed(0)}" 
              min="0" 
              max="50" 
              step="1" 
            />
            <span class="config-field-hint">% chance per second</span>
          </div>
        ` : ''}
        
        ${traffic.requestTypes ? `
          <div class="config-field">
            <label>Request Distribution</label>
            <div class="request-types">
              ${Object.entries(traffic.requestTypes).map(([type, ratio]) => `
                <div class="request-type-row">
                  <span class="request-type-label">${type}:</span>
                  <input 
                    type="range" 
                    class="request-type-slider" 
                    data-type="${type}"
                    value="${(ratio * 100).toFixed(0)}" 
                    min="0" 
                    max="100" 
                  />
                  <span class="request-type-value">${(ratio * 100).toFixed(0)}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      
      <div class="config-panel-actions">
        <button class="config-btn config-btn-secondary" id="traffic-reset">Reset</button>
        <button class="config-btn config-btn-primary" id="traffic-apply">Apply</button>
      </div>
    </div>
  `;
}

export function mountTrafficConfigPanel(
  container: HTMLElement,
  traffic: TrafficProfile,
  onApply: (traffic: TrafficProfile) => void,
  onClose: () => void
): void {
  container.innerHTML = renderTrafficConfigPanel(traffic);
  
  // Close button
  container.querySelector('#traffic-close')?.addEventListener('click', onClose);
  
  // Apply button
  container.querySelector('#traffic-apply')?.addEventListener('click', () => {
    const baseRps = parseFloat((document.getElementById('traffic-base-rps') as HTMLInputElement)?.value || '200');
    const pattern = (document.getElementById('traffic-pattern') as HTMLSelectElement)?.value as any || 'constant';
    const spikeMult = parseFloat((document.getElementById('traffic-spike-mult') as HTMLInputElement)?.value || '3.2');
    const spikeChance = parseFloat((document.getElementById('traffic-spike-chance') as HTMLInputElement)?.value || '8') / 100;
    
    const requestTypes: Record<string, number> = {};
    container.querySelectorAll('.request-type-slider').forEach(slider => {
      const type = slider.getAttribute('data-type');
      const value = parseFloat((slider as HTMLInputElement).value) / 100;
      if (type) requestTypes[type] = value;
    });
    
    onApply({
      ...traffic,
      baseRps,
      pattern,
      spikeMultiplier: spikeMult,
      spikeChance,
      requestTypes: Object.keys(requestTypes).length > 0 ? requestTypes : traffic.requestTypes,
    });
    
    onClose();
  });
  
  // Reset button
  container.querySelector('#traffic-reset')?.addEventListener('click', () => {
    onClose();
  });
  
  // Update slider values in real-time
  container.querySelectorAll('.request-type-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = target.value;
      const valueSpan = target.parentElement?.querySelector('.request-type-value');
      if (valueSpan) {
        valueSpan.textContent = `${value}%`;
      }
    });
  });
}
