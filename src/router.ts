export type RouteName = 'landing' | 'challenges' | 'sandbox' | 'login';

export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
  path: string;
}

type RouteListener = (route: RouteMatch) => void;

let currentRoute: RouteMatch = matchRoute(window.location.pathname);

const listeners = new Set<RouteListener>();

export function matchRoute(pathname: string): RouteMatch {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/login') {
    return { name: 'login', params: {}, path };
  }

  if (path === '/challenges') {
    return { name: 'challenges', params: {}, path };
  }

  const sandboxMatch = path.match(/^\/sandbox(?:\/([^/]+))?$/);
  if (sandboxMatch) {
    return {
      name: 'sandbox',
      params: sandboxMatch[1] ? { slug: sandboxMatch[1] } : {},
      path,
    };
  }

  return { name: 'landing', params: {}, path: '/' };
}

export function getCurrentRoute(): RouteMatch {
  return currentRoute;
}

export function navigate(path: string, replace = false): void {
  const next = matchRoute(path);
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  currentRoute = next;
  listeners.forEach((listener) => listener(next));
}

export function subscribeRoute(listener: RouteListener): () => void {
  listeners.add(listener);
  listener(currentRoute);
  return () => listeners.delete(listener);
}

export function initRouter(): void {
  window.addEventListener('popstate', () => {
    currentRoute = matchRoute(window.location.pathname);
    listeners.forEach((listener) => listener(currentRoute));
  });
}

export function pathForChallengeSandbox(slug: string): string {
  return `/sandbox/${slug}`;
}
