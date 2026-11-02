import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the BreakIT frontend.
 *
 * The suite runs against the Vite dev server (so the `window.__breakitDebug`
 * hooks are available) and mocks the ASP.NET API with `page.route`, so no
 * backend or database is needed. Set E2E_BASE_URL to point at an already
 * running frontend instead of letting Playwright start one.
 *
 * `e2e/real-api.spec.ts` is the exception: it talks to a live ASP.NET API and
 * PostgreSQL, and skips itself unless E2E_REAL_API_URL is set. Run it with
 * `npm run test:e2e:real`, which provisions the backend first.
 */
const PORT = Number(process.env.E2E_PORT ?? 4273);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Simulation tests run the engine at 100x and are CPU-bound; too many
  // concurrent workers starve each other's requestAnimationFrame loop.
  workers: isCI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Wide enough that every starter-preset component (world x <= ~1310)
        // sits inside the board viewport next to the 260px components panel.
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx vite --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 60_000,
        // Vite inlines import.meta.env at serve time, so the real-backend run
        // needs the API URL in the dev server's own environment.
        env: process.env.E2E_REAL_API_URL
          ? { VITE_API_URL: process.env.E2E_REAL_API_URL }
          : {},
      },
});
