import { navigate } from '../router';
import { normalizeJoinCode, roomFragment } from '../rooms/join-codes';

/**
 * "Join a room" (docs/specs/interview-platform.md §3.2): a code or a pasted
 * participant link. Lives on every page so a participant never has to find
 * the sandbox first.
 */
export function renderJoinRoomForm(): string {
  return `
    <form class="join-room-form" id="join-room-form" aria-label="Join a room">
      <input class="join-room-input" id="join-room-code" type="text" autocomplete="off" spellcheck="false"
        placeholder="Room code" aria-label="Room code or participant link" />
      <button class="btn btn-secondary" id="join-room-submit" type="submit">Join a room</button>
      <span class="join-room-error" id="join-room-error" role="alert"></span>
    </form>
  `;
}

export function mountJoinRoomForm(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>('#join-room-form');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector<HTMLInputElement>('#join-room-code');
    const error = form.querySelector<HTMLElement>('#join-room-error');
    const code = normalizeJoinCode(input?.value ?? '');
    if (!code) {
      if (error) error.textContent = 'Enter the 8-character code or paste the participant link.';
      input?.focus();
      return;
    }
    if (error) error.textContent = '';
    navigate(`/sandbox${roomFragment({ kind: 'join', code })}`);
  });
}

export function renderAppNav(active: 'home' | 'challenges' | 'sandbox'): string {
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
          ${renderJoinRoomForm()}
          <a class="btn btn-primary" href="/challenges" data-link>Start practicing</a>
        </div>
      </div>
    </header>
  `;
}

export function mountAppNav(container: HTMLElement): void {
  mountJoinRoomForm(container);
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
