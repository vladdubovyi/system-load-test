import { AUTHOR_EMAIL, REAL_API_URL, authorToken, expect, signInAsAuthor, test } from './fixtures/real-api';
import { SandboxPage, readFlowStats, readObjectives, readReport } from './helpers/sandbox';

/**
 * Full-stack tests: a real ASP.NET API on a real PostgreSQL database, with
 * no request mocking at all. These prove the parts the mocked suite cannot —
 * that flows, objectives and capabilities actually survive the trip from
 * jsonb through the API and the client mapping into the simulation engine,
 * and that the authoring endpoint persists what the editor sends.
 *
 * Run with `npm run test:e2e:real`; skipped otherwise.
 */
test.describe('Live backend', () => {
  test.skip(!REAL_API_URL, 'Set E2E_REAL_API_URL (see npm run test:e2e:real)');
  test.describe.configure({ timeout: 120_000 });

  /**
   * Guard against a false pass. If the API is unreachable (or another
   * process is squatting on its port) the frontend quietly falls back to its
   * built-in challenge and most of these tests would still go green against
   * data that never left the browser.
   */
  test('the suite is really talking to the API, not the offline fallback', async ({ page, request }) => {
    const response = await request.get(`${REAL_API_URL}/api/challenges`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type'] ?? '').toContain('application/json');

    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    const id = await sandbox.loadedChallengeId();
    expect(id, 'sandbox fell back to the built-in challenge').not.toBe('legacy-url-shortener');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('the seeded challenge list is served by the API', async ({ page, request }) => {
    // Sanity-check the API directly, then through the UI, so a failure here
    // distinguishes "backend wrong" from "frontend wrong".
    const apiResponse = await request.get(`${REAL_API_URL}/api/challenges`);
    expect(apiResponse.ok()).toBe(true);
    const challenges = (await apiResponse.json()) as { slug: string; scenario: { scenarioConfig: { flows?: unknown[] } } }[];
    expect(challenges.map((c) => c.slug).sort()).toEqual([
      'dropbox',
      'instagram-feed',
      'rate-limiter',
      'url-shortener',
    ]);
    // Every seeded challenge carries flows in its jsonb config.
    for (const challenge of challenges) {
      expect(challenge.scenario.scenarioConfig.flows?.length ?? 0, challenge.slug).toBeGreaterThan(0);
    }

    await page.goto('/challenges');
    await expect(page.locator('.challenge-list-item')).toHaveCount(4);
  });

  test('component capabilities come from the database and keep Redis out of the write path', async ({ page, request }) => {
    const components = (await (await request.get(`${REAL_API_URL}/api/components`)).json()) as {
      componentType: string;
      capabilities: string[] | null;
    }[];
    const redis = components.find((c) => c.componentType === 'redis')!;
    expect(redis.capabilities).toEqual(['cache']);

    // And the engine honours it: with the database gone, creates have no
    // durable store, so they are violated rather than silently cached.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    const overlay = await sandbox.runToReport();
    const stats = await readFlowStats(overlay);
    const creates = stats.find((s) => s.kind === 'create')!;
    expect(creates.completed).toBe(0);
    expect(creates.violated).toBeGreaterThan(0);
  });

  test('database-sourced flows drive a clean run of the seeded starter', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    // Flows from the database match the starter board: nothing to warn about.
    await expect(sandbox.lintPanel).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const report = await readReport(sandbox.reportOverlay);
    expect(report.title).toBe('Architecture survived');

    const objectives = await readObjectives(sandbox.reportOverlay);
    expect(objectives.map((o) => o.id)).toEqual(
      expect.arrayContaining(['completion:create', 'completion:read', 'violations', 'failures'])
    );
    expect(objectives.every((o) => o.met)).toBe(true);

    const stats = await readFlowStats(sandbox.reportOverlay);
    expect(stats.map((s) => s.kind).sort()).toEqual(['create', 'read']);
    for (const row of stats) {
      expect(row.violated).toBe(0);
      expect(row.completed).toBeGreaterThan(0);
    }
  });

  test('every seeded challenge runs its own flows end to end', async ({ page }) => {
    for (const slug of ['dropbox', 'instagram-feed', 'rate-limiter'] as const) {
      const sandbox = new SandboxPage(page);
      await sandbox.goto(slug);
      await sandbox.setSpeed(100);
      await sandbox.playButton.click();
      await expect(sandbox.lintPanel, slug).toHaveCount(0);
      await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

      const stats = await readFlowStats(sandbox.reportOverlay);
      expect(stats.length, slug).toBeGreaterThan(0);
      for (const row of stats) {
        expect(row.violated, `${slug}/${row.kind}`).toBe(0);
        expect(row.completed, `${slug}/${row.kind}`).toBeGreaterThan(0);
      }
      await sandbox.reportOverlay.locator('#report-dismiss').click();
    }
  });

  test('an author saves a scenario and the backend serves it on the next load', async ({ page, context, request }) => {
    await signInAsAuthor(context, request);

    // This test writes to the shared backend. Capture the seeded scenario so
    // it can be put back, or later tests would see the edited flows.
    const slugUnderEdit = 'rate-limiter';
    const original = (await (
      await request.get(`${REAL_API_URL}/api/challenges/slug/${slugUnderEdit}`)
    ).json()) as { scenario: { scenarioConfig: Record<string, unknown> } };
    const seeded = original.scenario.scenarioConfig;

    try {

      const sandbox = new SandboxPage(page);
      await sandbox.goto('rate-limiter');
      await sandbox.openScenarioEditor();

      // Replace the check flow with one that requires a tagged component, and
      // declare the role it selects.
      const doc = await sandbox.scenarioDocument();
      await sandbox.setScenarioDocument({
        ...doc,
        tags: [{ id: 'edge-limiter', label: 'Edge limiter', appliesTo: { capability: 'traffic-filter' } }],
        flows: [
          {
            kind: 'check',
            steps: [
              { id: 'ingress', require: { capability: 'ingress' } },
              { id: 'limiter', require: { tag: 'edge-limiter' } },
              { id: 'service', require: { capability: 'compute' } },
              { id: 'store', require: { capability: 'durable-store' }, terminal: true },
            ],
          },
        ],
      });

      await expect(page.locator('#scenario-save')).toBeEnabled();
      await page.locator('#scenario-save').click();
      await expect(sandbox.boardToast).toContainText(/saved/i);

      // The API really stored it.
      const stored = (await (
        await request.get(`${REAL_API_URL}/api/challenges/slug/rate-limiter`)
      ).json()) as { scenario: { scenarioConfig: { flows: { steps: { require: { tag?: string } }[] }[]; tags: { id: string }[] } } };
      expect(stored.scenario.scenarioConfig.tags[0].id).toBe('edge-limiter');
      expect(stored.scenario.scenarioConfig.flows[0].steps[1].require.tag).toBe('edge-limiter');

      // A fresh page load picks the saved scenario up from the database: the
      // role chip is offered, and the untagged board now fails the lint.
      await page.reload();
      await sandbox.playButton.click();
      await expect(sandbox.lintPanel).toBeVisible();
      await expect(sandbox.lintPanel).toContainText('tagged "Edge limiter"');

      // Assigning the role satisfies the saved flow.
      await page.locator('#btn-reset').click();
      await sandbox.loadStarter();
      const limiter = sandbox.component('Rate Limiter');
      await limiter.click();
      await sandbox.tagChip('edge-limiter').dragTo(limiter);
      await expect(limiter.locator('.component-tag-badge')).toHaveText(/Edge limiter/);

      await sandbox.setSpeed(100);
      await sandbox.playButton.click();
      await expect(sandbox.lintPanel).toHaveCount(0);
      await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });
      const stats = await readFlowStats(sandbox.reportOverlay);
      expect(stats.find((s) => s.kind === 'check')!.violated).toBe(0);
    } finally {
      const restore = await request.put(
        `${REAL_API_URL}/api/challenges/slug/${slugUnderEdit}/scenario-config`,
        {
          data: {
            flows: seeded.flows,
            objectives: seeded.objectives,
            requestTypes: seeded.requestTypes,
            tags: seeded.tags ?? [],
          },
          headers: { Authorization: `Bearer ${await authorToken(request)}` },
          failOnStatusCode: false,
        }
      );
      expect(restore.ok(), 'failed to restore the seeded scenario').toBe(true);
    }
  });

  test('a signed-out visitor cannot save, and a non-author is refused by the API', async ({ page, request }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();
    await expect(page.locator('#scenario-save')).toBeDisabled();

    // Anonymous call is rejected by the endpoint itself.
    const anonymous = await request.put(
      `${REAL_API_URL}/api/challenges/slug/url-shortener/scenario-config`,
      { data: { flows: [] }, failOnStatusCode: false }
    );
    expect(anonymous.status()).toBe(401);

    // A registered user who is not on the allowlist gets 403, not 200.
    const email = `intruder+${Date.now()}@example.com`;
    const registration = await request.post(`${REAL_API_URL}/api/auth/register`, {
      data: { email, password: 'Intruder123', displayName: 'Intruder' },
      failOnStatusCode: false,
    });
    expect(registration.ok()).toBe(true);
    const { token } = (await registration.json()) as { token: string };
    expect(email).not.toBe(AUTHOR_EMAIL);

    const forbidden = await request.put(
      `${REAL_API_URL}/api/challenges/slug/url-shortener/scenario-config`,
      {
        data: { flows: [] },
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      }
    );
    expect(forbidden.status()).toBe(403);
  });
});
