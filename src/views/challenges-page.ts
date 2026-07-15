import type { Challenge } from '../game/scenario-types';
import { renderAppNav, mountAppNav } from './app-shell';
import { navigate, pathForChallengeSandbox } from '../router';

function difficultyClass(difficulty: string): string {
  return `difficulty-${difficulty}`;
}

function toEmbedUrl(videoUrl?: string): string | null {
  if (!videoUrl) return null;
  try {
    const url = new URL(videoUrl);
    if (url.hostname.includes('youtube.com') && url.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${url.searchParams.get('v')}`;
    }
    if (url.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
    }
    return videoUrl;
  } catch {
    return null;
  }
}

function formatOverview(text?: string): string {
  if (!text) return '<p>No overview available yet.</p>';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return `<h4>${line.slice(2, -2)}</h4>`;
      }
      if (line.startsWith('- ')) {
        return `<li>${line.slice(2)}</li>`;
      }
      return `<p>${line}</p>`;
    })
    .join('');
}

function renderChallengeDetail(challenge: Challenge | null): string {
  if (!challenge) {
    return `
      <div class="challenge-detail-empty">
        <h2>Select a challenge</h2>
        <p>Pick a problem on the left to read the overview, watch the explainer, and launch the sandbox.</p>
      </div>
    `;
  }

  const embedUrl = toEmbedUrl(challenge.videoUrl);
  const requirements = challenge.scenario.requirements
    .map((req) => `<li>${req}</li>`)
    .join('');

  return `
    <div class="challenge-detail">
      <div class="challenge-detail-header">
        <div>
          <p class="challenge-detail-eyebrow">Interview challenge</p>
          <h2>${challenge.name}</h2>
          <p class="challenge-detail-description">${challenge.description}</p>
        </div>
        <span class="challenge-difficulty-pill ${difficultyClass(challenge.difficulty)}">${challenge.difficulty}</span>
      </div>

      <div class="challenge-detail-meta">
        <span>${challenge.scenario.duration}s simulation</span>
        <span>${challenge.scenario.traffic.baseRps} base RPS</span>
        <span>${challenge.allowedComponents.length} components</span>
      </div>

      <div class="challenge-detail-body">
        <div class="challenge-overview">${formatOverview(challenge.overviewContent)}</div>
        ${
          requirements
            ? `<div class="challenge-requirements"><h4>Simulation requirements</h4><ul>${requirements}</ul></div>`
            : ''
        }
        ${
          embedUrl
            ? `
              <div class="challenge-video">
                <h4>Video walkthrough</h4>
                <div class="challenge-video-frame">
                  <iframe
                    src="${embedUrl}"
                    title="${challenge.name} walkthrough"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                    loading="lazy"
                  ></iframe>
                </div>
                <a class="challenge-video-link" href="${challenge.videoUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>
              </div>
            `
            : ''
        }
      </div>

      <div class="challenge-detail-actions">
        <button class="btn btn-primary btn-lg" data-launch-challenge="${challenge.slug}">Launch</button>
      </div>
    </div>
  `;
}

function renderChallengeList(challenges: Challenge[], selectedId: string | null): string {
  return challenges
    .map(
      (challenge) => `
        <div class="challenge-list-item ${challenge.id === selectedId ? 'is-selected' : ''}">
          <button
            class="challenge-list-select"
            data-challenge-id="${challenge.id}"
            type="button"
          >
            <span class="challenge-list-title">${challenge.name}</span>
            <span class="challenge-list-meta">
              <span class="challenge-difficulty-pill ${difficultyClass(challenge.difficulty)}">${challenge.difficulty}</span>
              <span>${challenge.scenario.duration}s</span>
            </span>
          </button>
          <button
            class="btn btn-primary challenge-launch-btn"
            type="button"
            data-launch-challenge="${challenge.slug}"
          >
            Launch
          </button>
        </div>
      `
    )
    .join('');
}

export function renderChallengesPage(challenges: Challenge[], selectedId: string | null): string {
  const selected = challenges.find((c) => c.id === selectedId) ?? challenges[0] ?? null;

  return `
    <div class="site-page challenges-page">
      ${renderAppNav('challenges')}
      <main class="challenges-main">
        <div class="challenges-layout">
          <aside class="challenges-sidebar">
            <div class="challenges-sidebar-header">
              <h1>Challenges</h1>
              <p>Prepare for system design interviews with guided scenarios.</p>
            </div>
            <div class="challenges-list" role="listbox" aria-label="Challenges">
              ${challenges.length ? renderChallengeList(challenges, selected?.id ?? null) : '<p class="challenges-empty">No challenges loaded.</p>'}
            </div>
          </aside>
          <section class="challenges-detail-panel" aria-live="polite">
            ${renderChallengeDetail(selected)}
          </section>
        </div>
      </main>
    </div>
  `;
}

export function mountChallengesPage(
  container: HTMLElement,
  _challenges: Challenge[],
  _selectedId: string | null,
  onSelect: (challengeId: string) => void
): void {
  container.dataset.activeNav = 'challenges';
  mountAppNav(container);
  bindChallengesPageEvents(container, onSelect);
}

function bindChallengesPageEvents(container: HTMLElement, onSelect: (challengeId: string) => void): void {
  container.querySelectorAll('[data-challenge-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.challengeId;
      if (id) onSelect(id);
    });
  });

  container.querySelectorAll('[data-launch-challenge]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      const slug = (el as HTMLElement).dataset.launchChallenge;
      if (slug) navigate(pathForChallengeSandbox(slug));
    });
  });
}

export function updateChallengesSelection(
  container: HTMLElement,
  challenges: Challenge[],
  selectedId: string,
  onSelect: (challengeId: string) => void
): void {
  const selected = challenges.find((c) => c.id === selectedId) ?? null;
  const list = container.querySelector('.challenges-list');
  const detail = container.querySelector('.challenges-detail-panel');
  if (list) {
    list.innerHTML = renderChallengeList(challenges, selectedId);
  }
  if (detail) {
    detail.innerHTML = renderChallengeDetail(selected);
  }
  bindChallengesPageEvents(container, onSelect);
}
