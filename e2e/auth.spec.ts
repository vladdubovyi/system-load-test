import { expect, test } from './fixtures/test';
import { TEST_PASSWORD, TEST_TOKEN, TEST_USER } from './fixtures/api-data';

const TOKEN_KEY = 'sds_auth_token';
const USER_KEY = 'sds_auth_user';

test.describe('Authentication', () => {
  test('login page renders the email form and a hint that Google sign-in is not configured', async ({ page }) => {
    await page.goto('/login');

    await expect(page).toHaveTitle('Sign in — BreakIT');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to save progress');
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#register-form')).toBeHidden();
    await expect(page.locator('.login-hint')).toContainText('VITE_GOOGLE_CLIENT_ID');
    await expect(page.locator('.site-header-actions a', { hasText: 'Sign in' })).toBeVisible();
  });

  test('signs in with email and password, then shows the user in the header', async ({ page, api }) => {
    await page.goto('/login');

    const form = page.locator('#login-form');
    await form.locator('input[name="email"]').fill(TEST_USER.email);
    await form.locator('input[name="password"]').fill(TEST_PASSWORD);
    await form.getByRole('button', { name: 'Sign in with email' }).click();

    await expect(page).toHaveURL(/\/challenges$/);
    await expect(page.locator('.site-user-name')).toHaveText(TEST_USER.displayName);
    await expect(page.locator('.site-header-actions a', { hasText: 'Sign in' })).toHaveCount(0);

    const login = api.calls('/api/auth/login', 'POST');
    expect(login).toHaveLength(1);
    expect(login[0].body).toEqual({ email: TEST_USER.email, password: TEST_PASSWORD });

    const stored = await page.evaluate(
      ([t, u]) => ({ token: localStorage.getItem(t), user: localStorage.getItem(u) }),
      [TOKEN_KEY, USER_KEY]
    );
    expect(stored.token).toBe(TEST_TOKEN);
    expect(JSON.parse(stored.user ?? '{}')).toMatchObject({ email: TEST_USER.email });
  });

  test('rejected credentials keep the user on the login page with no session', async ({ page, api }) => {
    await page.goto('/login');

    const form = page.locator('#login-form');
    await form.locator('input[name="email"]').fill(TEST_USER.email);
    await form.locator('input[name="password"]').fill('definitely-wrong');
    await form.getByRole('button', { name: 'Sign in with email' }).click();

    await expect.poll(() => api.calls('/api/auth/login', 'POST').length).toBe(1);
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
    await expect(page.locator('.site-user-name')).toHaveCount(0);
  });

  test('switches to the registration form and creates an account', async ({ page, api }) => {
    await page.goto('/login');

    await page.locator('#show-register').click();
    const form = page.locator('#register-form');
    await expect(form).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();

    await form.locator('input[name="displayName"]').fill('Grace Hopper');
    await form.locator('input[name="email"]').fill('grace@example.com');
    await form.locator('input[name="password"]').fill('a-long-enough-password');
    await form.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/challenges$/);
    await expect(page.locator('.site-user-name')).toHaveText('Grace Hopper');
    expect(api.calls('/api/auth/register', 'POST')[0].body).toEqual({
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      displayName: 'Grace Hopper',
    });

    // And back again.
    await page.goto('/login');
    await page.locator('#show-register').click();
    await page.locator('#show-login').click();
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#register-form')).toBeHidden();
  });

  test('restores a stored session on load by calling /api/auth/me with the bearer token', async ({ page, api }) => {
    await page.addInitScript(
      ([t, u, token, user]) => {
        localStorage.setItem(t, token);
        localStorage.setItem(u, user);
      },
      [TOKEN_KEY, USER_KEY, TEST_TOKEN, JSON.stringify(TEST_USER)]
    );

    await page.goto('/');

    await expect(page.locator('.site-user-name')).toHaveText(TEST_USER.displayName);
    const me = api.calls('/api/auth/me', 'GET');
    expect(me).toHaveLength(1);
    expect(me[0].headers['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
  });

  test('clears a stale session when /api/auth/me rejects the token', async ({ page, api }) => {
    await api.install({ validToken: null });
    await page.addInitScript(
      ([t, u, user]) => {
        localStorage.setItem(t, 'expired-token');
        localStorage.setItem(u, user);
      },
      [TOKEN_KEY, USER_KEY, JSON.stringify(TEST_USER)]
    );

    await page.goto('/');

    await expect(page.locator('.site-header-actions a', { hasText: 'Sign in' })).toBeVisible();
    await expect(page.locator('.site-user-name')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
  });

  test('shows only one of the login / register forms at a time', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#register-form')).toBeHidden();

    await page.locator('#show-register').click();
    await expect(page.locator('#login-form')).toBeHidden();
    await expect(page.locator('#register-form')).toBeVisible();

    await page.locator('#show-login').click();
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#register-form')).toBeHidden();
  });

  test('rejected credentials show the API error message', async ({ page }) => {
    await page.goto('/login');
    // The alert box exists but is empty until something fails.
    await expect(page.locator('.login-error')).toBeHidden();

    const form = page.locator('#login-form');
    await form.locator('input[name="email"]').fill(TEST_USER.email);
    await form.locator('input[name="password"]').fill('definitely-wrong');
    await form.getByRole('button', { name: 'Sign in with email' }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  });
});
