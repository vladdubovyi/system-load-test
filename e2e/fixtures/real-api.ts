import { test as base, expect } from '@playwright/test';

/**
 * Test fixture for the live-backend suite: unlike `fixtures/test.ts` it does
 * **not** intercept `/api/` calls, so every request reaches the real ASP.NET
 * API and PostgreSQL. Third-party hosts are still blocked to keep runs
 * hermetic.
 *
 * `scripts/e2e-real-api.sh` provisions the backend and exports the
 * environment these tests read.
 */

const EXTERNAL_HOSTS = [
  'https://fonts.googleapis.com/**',
  'https://fonts.gstatic.com/**',
  'https://www.youtube.com/**',
  'https://accounts.google.com/**',
];

/** API base URL the frontend was built against; absent means "skip these tests". */
export const REAL_API_URL = process.env.E2E_REAL_API_URL ?? '';

/** Email allowlisted via CHALLENGE_AUTHORS on the backend under test. */
export const AUTHOR_EMAIL = process.env.E2E_AUTHOR_EMAIL ?? 'author@example.com';
/** Satisfies ASP.NET Identity's default complexity rules. */
export const AUTHOR_PASSWORD = process.env.E2E_AUTHOR_PASSWORD ?? 'TestAuthor123';

export const test = base.extend({
  page: async ({ page, context }, use) => {
    for (const pattern of EXTERNAL_HOSTS) {
      await context.route(pattern, (route) => route.abort('blockedbyclient'));
    }
    await use(page);
  },
});

export { expect };

/**
 * Register (or log in) the allowlisted author through the real auth API and
 * store the session the way the app does, before any page script runs.
 */
export async function signInAsAuthor(
  context: import('@playwright/test').BrowserContext,
  request: import('@playwright/test').APIRequestContext
): Promise<void> {
  const credentials = { email: AUTHOR_EMAIL, password: AUTHOR_PASSWORD, displayName: 'Test Author' };

  let response = await request.post(`${REAL_API_URL}/api/auth/register`, { data: credentials });
  if (!response.ok()) {
    // Already registered by an earlier test run.
    response = await request.post(`${REAL_API_URL}/api/auth/login`, {
      data: { email: AUTHOR_EMAIL, password: AUTHOR_PASSWORD },
    });
  }
  if (!response.ok()) {
    throw new Error(`Could not sign in as ${AUTHOR_EMAIL}: ${response.status()} ${await response.text()}`);
  }

  const body = (await response.json()) as { token: string; user: unknown };
  await context.addInitScript(
    ([token, user]) => {
      localStorage.setItem('sds_auth_token', token);
      localStorage.setItem('sds_auth_user', user);
    },
    [body.token, JSON.stringify(body.user)] as const
  );
}

/** Bearer token for the allowlisted author, for direct API calls. */
export async function authorToken(
  request: import('@playwright/test').APIRequestContext
): Promise<string> {
  const response = await request.post(`${REAL_API_URL}/api/auth/login`, {
    data: { email: AUTHOR_EMAIL, password: AUTHOR_PASSWORD },
    failOnStatusCode: false,
  });
  if (!response.ok()) {
    throw new Error(`Could not get a token for ${AUTHOR_EMAIL}: ${response.status()}`);
  }
  return ((await response.json()) as { token: string }).token;
}
