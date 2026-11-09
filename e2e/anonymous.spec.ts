import { expect, test } from './fixtures/test';
import { plantLegacyAuthStorage } from './helpers/sandbox';
import { TEST_TOKEN, TEST_USER } from './fixtures/api-data';
import { SandboxPage } from './helpers/sandbox';

/**
 * The anonymous MVP (docs/specs/interview-platform.md §2): BreakIT collects
 * no personal data at all. There is no sign-in, no account, no identity in
 * the header, nothing written to browser storage, and no request that could
 * carry one person's identity to the backend.
 *
 * These tests are the standing proof of that claim. The API mock still serves
 * `/api/auth/*` (see fixtures/test.ts), so if the app ever started calling
 * those endpoints again it would *succeed* — and these assertions would fail
 * loudly rather than passing on a 404.
 */

/** Every storage key the page holds, as a plain object. */
async function readLocalStorage(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      out[key] = localStorage.getItem(key)!;
    }
    return out;
  });
}

test.describe('Anonymous by construction', () => {
  test('there is no sign-in anywhere: /login falls back to the landing page', async ({ page }) => {
    await page.goto('/login');

    // Not a sign-in page, and not a 404 either — the unknown-route fallback.
    await expect(page).toHaveTitle('BreakIT — Practice system design interviews');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Practice architecture under real load'
    );
    await expect(page.locator('#login-form')).toHaveCount(0);
    await expect(page.locator('#register-form')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });

  test('the header offers no sign-in and shows no identity', async ({ page }) => {
    for (const path of ['/', '/challenges']) {
      await page.goto(path);
      await expect(page.locator('.site-header-actions')).toBeVisible();
      await expect(page.locator('.site-header-actions a', { hasText: 'Sign in' })).toHaveCount(0);
      await expect(page.locator('.site-user-chip')).toHaveCount(0);
      await expect(page.locator('.site-user-name')).toHaveCount(0);
      await expect(page.locator('a[href="/login"]')).toHaveCount(0);
    }
  });

  test('the landing page states that nothing personal is stored, and the terms of use', async ({ page }) => {
    await page.goto('/');

    const note = page.locator('#privacy-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/anonymous/i);
    await expect(note).toContainText(/no account/i);
    await expect(note).toContainText(/nothing you type is stored/i);
    // Rooms (§3) are not built yet, but the promise about them is made now.
    await expect(note).toContainText(/rooms live in memory/i);

    const terms = page.locator('#terms-note');
    await expect(terms).toBeVisible();
    await expect(terms).toContainText(/free/i);
    await expect(terms).toContainText(/as-is/i);
    await expect(terms).toContainText(/unlawful or abusive/i);
  });

  test('no auth endpoint is ever called, on any route', async ({ page, api }) => {
    await page.goto('/');
    await page.goto('/challenges');
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    expect(api.requests.filter((r) => r.path.startsWith('/api/auth/'))).toEqual([]);
  });

  test('no API request carries an Authorization header', async ({ page, api }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    expect(api.requests.length).toBeGreaterThan(0);
    const withAuth = api.requests.filter((r) => 'authorization' in r.headers);
    expect(withAuth.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  test('a full session — landing, challenges, sandbox, scenario edit, run — writes nothing to storage', async ({
    page,
  }) => {
    await page.goto('/');
    expect(await readLocalStorage(page)).toEqual({});

    await page.goto('/challenges');
    expect(await readLocalStorage(page)).toEqual({});

    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    // Editing the scenario is the one place the app used to need an account.
    await sandbox.openScenarioEditor();
    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({ ...doc, requestTypes: { read: 0.5, create: 0.5 } });
    await page.locator('#scenario-apply').click();

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    expect(await readLocalStorage(page)).toEqual({});
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });

  test('a legacy session left in storage by an older build is deleted, not adopted', async ({
    page,
    api,
  }) => {
    await plantLegacyAuthStorage(page, TEST_TOKEN, TEST_USER);

    await page.goto('/');

    // The mock would happily answer /api/auth/me for this token. The app must
    // not ask, must not show the user, and must not sign requests with it.
    await expect(page.locator('.site-user-name')).toHaveCount(0);
    await expect(page.locator('.site-user-chip')).toHaveCount(0);

    // Decision §11 Q7 (b): we put an email there and nothing uses it any
    // more, so boot removes both keys rather than leaving them behind.
    await expect.poll(() => readLocalStorage(page)).toEqual({});

    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    expect(api.calls('/api/auth/me', 'GET')).toEqual([]);
    expect(api.requests.filter((r) => r.headers['authorization'])).toEqual([]);
    expect(await readLocalStorage(page)).toEqual({});
  });
});
