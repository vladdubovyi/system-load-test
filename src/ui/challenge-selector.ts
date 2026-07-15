import type { Challenge } from '../game/scenario-types';

export function renderChallengeSelector(challenges: Challenge[]): string {
  if (challenges.length === 0) {
    return `
      <div class="challenge-selector-empty">
        <p>⚠️ No challenges available</p>
        <p class="text-muted">Unable to load challenges from the server</p>
      </div>
    `;
  }

  const difficultyColors: Record<string, string> = {
    easy: '#34d399',
    medium: '#fbbf24',
    hard: '#f87171',
  };

  return `
    <div class="challenge-selector">
      <h2>Choose a System Design Challenge</h2>
      <div class="challenge-grid">
        ${challenges.map(challenge => `
          <div class="challenge-card" data-challenge-id="${challenge.id}">
            <div class="challenge-header">
              <h3>${challenge.name}</h3>
              <span class="challenge-difficulty" style="background: ${difficultyColors[challenge.difficulty] || '#888'}">
                ${challenge.difficulty.toUpperCase()}
              </span>
            </div>
            <p class="challenge-description">${challenge.description || 'No description available'}</p>
            <div class="challenge-stats">
              <div class="stat">
                <span class="stat-label">Duration</span>
                <span class="stat-value">${challenge.scenario.duration}s</span>
              </div>
              <div class="stat">
                <span class="stat-label">Base RPS</span>
                <span class="stat-value">${challenge.scenario.traffic.baseRps}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Components</span>
                <span class="stat-value">${challenge.allowedComponents.length}</span>
              </div>
            </div>
            <button class="select-challenge-btn" data-challenge-id="${challenge.id}">
              Start Challenge →
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

export function mountChallengeSelector(
  container: HTMLElement,
  challenges: Challenge[],
  onSelect: (challenge: Challenge) => void
): void {
  container.innerHTML = renderChallengeSelector(challenges);

  // Attach event listeners
  const buttons = container.querySelectorAll('.select-challenge-btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const challengeId = button.getAttribute('data-challenge-id');
      const challenge = challenges.find(c => c.id === challengeId);
      if (challenge) {
        onSelect(challenge);
      }
    });
  });
}
