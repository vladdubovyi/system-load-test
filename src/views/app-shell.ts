import { getCurrentUser, isAuthenticated } from '../auth/auth-store';
import { navigate } from '../router';

export function renderAppNav(active: 'home' | 'challenges' | 'sandbox' | 'login'): string {
  const user = getCurrentUser();
  const authed = isAuthenticated();

  return `
    <header class="site-header">
      <div class="site-header-inner">
        <a class="site-brand" href="/" data-link>
          <span class="site-brand-text">BreakIT</span>
        </a>
        <nav class="site-nav" aria-label="Main">
          <a class="site-nav-link ${active === 'home' ? 'is-active' : ''}" href="/" data-link>Home</a>
          <a class="site-nav-link ${active === 'challenges' ? 'is-active' : ''}" href="/challenges" data-link>Challenges</a>
        </nav>
        <div class="site-header-actions">
          ${
            authed && user
              ? `
                <div class="site-user-chip" title="${user.email}">
                  ${user.avatarUrl ? `<img class="site-user-avatar" src="${user.avatarUrl}" alt="" />` : '<span class="site-user-avatar-fallback">👤</span>'}
                  <span class="site-user-name">${user.displayName || user.email}</span>
                </div>
              `
              : `<a class="btn btn-ghost" href="/login" data-link>Sign in</a>`
          }
          <a class="btn btn-primary" href="/challenges" data-link>Start practicing</a>
        </div>
      </div>
    </header>
  `;
}

export function mountAppNav(container: HTMLElement): void {
  container.querySelectorAll('[data-link]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const anchor = el as HTMLAnchorElement;
      if (!anchor.href) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(url.pathname);
    });
  });
}
