import { test as base, expect } from '@playwright/test';

/**
 * Test fixture for the live-backend suite: unlike `fixtures/test.ts` it does
 * **not** intercept `/api/` calls, so every request reaches the real ASP.NET
 * API. Third-party hosts are still blocked to keep runs hermetic.
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

export const test = base.extend({
  page: async ({ page, context }, use) => {
    for (const pattern of EXTERNAL_HOSTS) {
      await context.route(pattern, (route) => route.abort('blockedbyclient'));
    }
    await use(page);
  },
});

export { expect };
