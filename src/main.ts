import './styles/main.css';
import './styles/site.css';
import { apiClient } from './api/client';
import { restoreAuthSession } from './auth/auth-store';
import { initRouter, subscribeRoute, type RouteMatch } from './router';
import { renderLandingPage, mountLandingPage } from './views/landing-page';
import { renderChallengesPage, mountChallengesPage, updateChallengesSelection } from './views/challenges-page';
import { renderLoginPage, mountLoginPage } from './views/login-page';
import { destroySandboxApp, mountSandboxApp } from './sandbox/sandbox-app';
import type { Challenge } from './game/scenario-types';

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
    case 'login': {
      app.innerHTML = renderLoginPage();
      await mountLoginPage(app);
      document.title = 'Sign in — BreakIT';
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
      });
      sandboxMounted = true;
      document.title = route.params.slug
        ? `Sandbox: ${route.params.slug} — BreakIT`
        : 'Sandbox — BreakIT';
      break;
    }
  }
}

async function bootstrap(): Promise<void> {
  initRouter();
  await restoreAuthSession(() => apiClient.getCurrentUser());
  subscribeRoute((route) => {
    void renderRoute(route);
  });
}

bootstrap();
