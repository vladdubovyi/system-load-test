import { apiClient } from '../api/client';
import { setAuthSession, clearAuthSession } from '../auth/auth-store';
import { renderAppNav, mountAppNav } from './app-shell';
import { navigate } from '../router';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById('google-gsi-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(script);
  });
}

export function renderLoginPage(errorMessage = ''): string {
  return `
    <div class="site-page login-page">
      ${renderAppNav('login')}
      <main class="login-main">
        <div class="login-card">
          <p class="login-eyebrow">Welcome back</p>
          <h1>Sign in to save progress</h1>
          <p class="login-lead">Continue with Google for the fastest sign-in, or use email and password.</p>

          ${errorMessage ? `<div class="login-error" role="alert">${errorMessage}</div>` : ''}

          <div class="login-google-section">
            <div id="google-signin-button" class="google-signin-host"></div>
            ${GOOGLE_CLIENT_ID ? '' : '<p class="login-hint">Google sign-in requires VITE_GOOGLE_CLIENT_ID.</p>'}
          </div>

          <div class="login-divider"><span>or use email</span></div>

          <form id="login-form" class="login-form">
            <label>
              Email
              <input type="email" name="email" autocomplete="email" required />
            </label>
            <label>
              Password
              <input type="password" name="password" autocomplete="current-password" required minlength="8" />
            </label>
            <button class="btn btn-secondary btn-block" type="submit">Sign in with email</button>
          </form>

          <p class="login-switch">
            New here?
            <button type="button" class="link-button" id="show-register">Create an account</button>
          </p>

          <form id="register-form" class="login-form" hidden>
            <label>
              Display name
              <input type="text" name="displayName" autocomplete="name" />
            </label>
            <label>
              Email
              <input type="email" name="email" autocomplete="email" required />
            </label>
            <label>
              Password
              <input type="password" name="password" autocomplete="new-password" required minlength="8" />
            </label>
            <button class="btn btn-secondary btn-block" type="submit">Create account</button>
            <p class="login-switch">
              Already have an account?
              <button type="button" class="link-button" id="show-login">Sign in</button>
            </p>
          </form>
        </div>
      </main>
    </div>
  `;
}

export async function mountLoginPage(container: HTMLElement): Promise<void> {
  container.dataset.activeNav = 'login';
  mountAppNav(container);

  const loginForm = container.querySelector('#login-form') as HTMLFormElement | null;
  const registerForm = container.querySelector('#register-form') as HTMLFormElement | null;
  const showRegister = container.querySelector('#show-register');
  const showLogin = container.querySelector('#show-login');
  const errorBox = container.querySelector('.login-error');

  const setError = (message: string) => {
    if (errorBox) {
      errorBox.textContent = message;
      (errorBox as HTMLElement).hidden = !message;
    }
  };

  showRegister?.addEventListener('click', () => {
    loginForm?.setAttribute('hidden', 'true');
    registerForm?.removeAttribute('hidden');
    setError('');
  });

  showLogin?.addEventListener('click', () => {
    registerForm?.setAttribute('hidden', 'true');
    loginForm?.removeAttribute('hidden');
    setError('');
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(loginForm);
    try {
      const response = await apiClient.login(
        String(data.get('email') || ''),
        String(data.get('password') || '')
      );
      setAuthSession(response.token, response.user);
      navigate('/challenges');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign in failed.');
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(registerForm);
    try {
      const response = await apiClient.register(
        String(data.get('email') || ''),
        String(data.get('password') || ''),
        String(data.get('displayName') || '')
      );
      setAuthSession(response.token, response.user);
      navigate('/challenges');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Registration failed.');
    }
  });

  if (!GOOGLE_CLIENT_ID) return;

  try {
    await loadGoogleScript();
    const buttonHost = container.querySelector('#google-signin-button') as HTMLElement | null;
    if (!buttonHost || !window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) return;
        try {
          const auth = await apiClient.googleLogin(response.credential);
          setAuthSession(auth.token, auth.user);
          navigate('/challenges');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Google sign-in failed.');
        }
      },
    });

    window.google.accounts.id.renderButton(buttonHost, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: 320,
    });
  } catch (error) {
    console.warn('Google Sign-In unavailable:', error);
  }
}

export function renderUserMenu(): string {
  return '';
}

export function logout(): void {
  clearAuthSession();
  navigate('/');
}
