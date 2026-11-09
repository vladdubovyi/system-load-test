import './styles/main.css';
import './styles/site.css';
import { apiClient } from './api/client';
import { initRouter, navigate, subscribeRoute, type RouteMatch } from './router';
import { renderLandingPage, mountLandingPage } from './views/landing-page';
import { renderChallengesPage, mountChallengesPage, updateChallengesSelection } from './views/challenges-page';
import { destroySandboxApp, mountSandboxApp } from './sandbox/sandbox-app';
import type { Challenge } from './game/scenario-types';
import { parseRoomFragment } from './rooms/join-codes';

const app = document.getElementById('app')!;

let challengesCache: Challenge[] = [];
let selectedChallengeId: string | null = null;
let sandboxMounted = false;

async function ensureChallenges(): Promise<Challenge[]> {
  if (challengesCache.length) return challengesCache;
  try {
    challengesCache = await apiClient.getChallenges();
    if (!selectedChallengeId && challengesCache[0]) {
      selectedChallengeId = challengesCache[0].id;
    }
  } catch (error) {
    console.error('Failed to load challenges:', error);
    challengesCache = [];
  }
  return challengesCache;
}

async function renderRoute(route: RouteMatch): Promise<void> {
  if (sandboxMounted) {
    destroySandboxApp();
    sandboxMounted = false;
  }

  document.body.classList.toggle('sandbox-mode', route.name === 'sandbox');
  document.title = 'BreakIT';

  // A participant or host link is `{site}#join=…` / `{site}#host=…`
  // (docs/specs/interview-platform.md §3.2); the room lives in the sandbox.
  const roomCredential = parseRoomFragment(window.location.hash);
  if (roomCredential && route.name !== 'sandbox') {
    navigate(`/sandbox${window.location.hash}`, true);
    return;
  }

  switch (route.name) {
    case 'landing': {
      app.innerHTML = renderLandingPage();
      mountLandingPage(app);
      document.title = 'BreakIT — Practice system design interviews';
      break;
    }
    case 'challenges': {
      const challenges = await ensureChallenges();
      const handleChallengeSelect = (id: string) => {
        selectedChallengeId = id;
        updateChallengesSelection(app, challenges, id, handleChallengeSelect);
      };
      app.innerHTML = renderChallengesPage(challenges, selectedChallengeId);
      mountChallengesPage(app, challenges, selectedChallengeId, handleChallengeSelect);
      document.title = 'Challenges — BreakIT';
      break;
    }
    case 'sandbox': {
      app.innerHTML = '<div id="sandbox-root" class="sandbox-root"></div>';
      const root = document.getElementById('sandbox-root');
      if (!root) return;
      await mountSandboxApp({
        container: root,
        challengeSlug: route.params.slug,
        loadReferencePreset: true,
        room: roomCredential ?? undefined,
      });
      sandboxMounted = true;
      document.title = roomCredential
        ? 'Room — BreakIT'
        : route.params.slug
          ? `Sandbox: ${route.params.slug} — BreakIT`
          : 'Sandbox — BreakIT';
      break;
    }
  }
}

/**
 * Keys an older, account-based build wrote to localStorage (a JWT and a user
 * record that included an email). Nothing reads them any more, and the MVP
 * stores nothing in the browser, so boot removes them
 * (docs/specs/interview-platform.md §2.1, §11 Q7).
 */
const LEGACY_STORAGE_KEYS = ['sds_auth_token', 'sds_auth_user'];

function purgeLegacyStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

function bootstrap(): void {
  purgeLegacyStorage();
  initRouter();
  subscribeRoute((route) => {
    void renderRoute(route);
  });
}

bootstrap();
