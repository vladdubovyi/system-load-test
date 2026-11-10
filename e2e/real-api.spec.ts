import { REAL_API_URL, expect, test } from './fixtures/real-api';
import { SandboxPage, readFlowStats, readObjectives, readReport } from './helpers/sandbox';
import { STARTER_PRESETS } from './fixtures/api-data';

/**
 * Full-stack tests: a real ASP.NET API, with no request mocking at all.
 * These prove the parts the mocked suite cannot — that flows, objectives and
 * capabilities actually survive the trip from the in-memory catalog through
 * the API and the client mapping into the simulation engine, and that the
 * deployed API really has no account surface.
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
      'chat-messaging',
      'dropbox',
      'instagram-feed',
      'notification-fanout',
      'payment-webhook',
      'rate-limiter',
      'ride-dispatch',
      'search-autocomplete',
      'ticket-booking',
      'url-shortener',
    ]);
    // Every seeded challenge carries flows in its scenario config.
    for (const challenge of challenges) {
      expect(challenge.scenario.scenarioConfig.flows?.length ?? 0, challenge.slug).toBeGreaterThan(0);
    }

    await page.goto('/challenges');
    await expect(page.locator('.challenge-list-item')).toHaveCount(10);
  });

  test('component capabilities come from the API and keep Redis out of the write path', async ({ page, request }) => {
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

  test('API-sourced flows drive a clean run of the seeded starter', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    // Flows from the database match the starter board: nothing to warn about.
    await expect(sandbox.lintPanel).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const report = await readReport(sandbox.reportOverlay);
    // Correct but under capacity, like every starter (interview-platform.md §8).
    expect(report.title).toBe('Survived, objectives missed');

    const objectives = await readObjectives(sandbox.reportOverlay);
    expect(objectives.map((o) => o.id)).toEqual(
      expect.arrayContaining(['completion:create', 'completion:read', 'violations', 'failures'])
    );
    expect(objectives.find((o) => o.id === 'violations')!.met).toBe(true);
    expect(objectives.find((o) => o.id === 'failures')!.met).toBe(true);
    expect(objectives.some((o) => o.id.startsWith('completion:') && !o.met)).toBe(true);

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

  test('two people share one room through the real hub', async ({ page, browser }) => {
    // docs/specs/interview-platform.md §3, §5: the only part of rooms the
    // mocked suite cannot prove is the real SignalR hub, the real merge and
    // the real credentials, so this test drives two browsers through them.
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    expect(room.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const guestPage = await context.newPage();
    const guest = new SandboxPage(guestPage);
    await guest.gotoRoomLink(room.participantLink);
    await expect(guest.components).toHaveCount(STARTER_PRESETS['url-shortener'].components);
    await expect(guest.presenceNames()).toHaveCount(2);
    await expect(host.presenceNames()).toHaveCount(2);

    await host.placeComponent('redis', 800, 520);
    await expect(guest.component('Redis Cache')).toHaveCount(2);

    await guest.deleteComponent('Load Balancer');
    await expect(host.component('Load Balancer')).toHaveCount(0);
    await expect(host.belts).toHaveCount(await guest.belts.count());

    // The host link works from the other browser and keeps the code.
    await guestPage.goto(room.hostLink);
    await expect(guest.roomPresence).toBeVisible();
    await expect(guest.shareButton).toHaveText(new RegExp(room.code));

    // The hub lives next to the API, and the hub endpoint exists only for WebSockets.
    const negotiate = await page.request.post(`${REAL_API_URL}/hubs/room/negotiate?negotiateVersion=1`, {
      failOnStatusCode: false,
    });
    expect(negotiate.ok()).toBe(true);

    // A run through the real hub (§4.4): one Play, two identical reports.
    await guestPage.goto(room.participantLink);
    await expect(guest.roomPresence).toBeVisible();
    await host.setSpeed(100);
    await host.playButton.click();
    await expect.poll(() => guest.engineStatus()).toBe('running');
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });
    const hostReport = { summary: await readReport(host.reportOverlay), flows: await readFlowStats(host.reportOverlay) };
    const guestReport = { summary: await readReport(guest.reportOverlay), flows: await readFlowStats(guest.reportOverlay) };
    expect(guestReport).toEqual(hostReport);
    await context.close();
  });

  test('interview mode projects the scenario through the real hub', async ({ page, browser }) => {
    // docs/specs/interview-platform.md §6: the real server withholds flows
    // and objectives from participants and ships the opaque flow bundle with
    // the run; the mocked suite only proves the fake hub does.
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-setting-report').selectOption('everyone');
    await host.roomDialog.locator('#room-close').click();

    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const guestPage = await context.newPage();
    const guest = new SandboxPage(guestPage);
    await guest.gotoRoomLink(room.participantLink);
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');

    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });
    // The run agreed tick for tick (the bundle drove the guest's engine)…
    expect(await readFlowStats(guest.reportOverlay)).toEqual(await readFlowStats(host.reportOverlay));
    // …but the authored objectives never reached the guest.
    expect((await readObjectives(host.reportOverlay)).map((o) => o.id)).toContain('completion:read');
    expect((await readObjectives(guest.reportOverlay)).map((o) => o.id)).toEqual(['failures']);
    await context.close();
  });

  test('the API has no account surface and no write endpoint', async ({ request }) => {
    // docs/specs/interview-platform.md §2.3: the routes are gone, not gated.
    for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/google']) {
      const response = await request.post(`${REAL_API_URL}${path}`, {
        data: { email: 'someone@example.com', password: 'a-password' },
        failOnStatusCode: false,
      });
      expect(response.status(), path).toBe(404);
    }
    const me = await request.get(`${REAL_API_URL}/api/auth/me`, { failOnStatusCode: false });
    expect(me.status()).toBe(404);

    const put = await request.put(`${REAL_API_URL}/api/challenges/slug/url-shortener/scenario-config`, {
      data: { flows: [] },
      failOnStatusCode: false,
    });
    expect([404, 405]).toContain(put.status());
  });
});
