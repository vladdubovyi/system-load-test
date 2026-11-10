import { ApiMock, expect, test } from './fixtures/test';
import { SandboxPage, readObjectives, readReport } from './helpers/sandbox';

/**
 * Scenario depth, D2 phase 1 (docs/specs/product-directions.md §3.3–§3.4):
 * scripted failure phases and multi-phase traffic are scenario data — they
 * ride the scenario document, fire on simulation time, and so stay
 * deterministic and room-safe with no new run inputs.
 */
const DB_OUTAGE = {
  id: 'db-outage',
  label: 'Database outage',
  atSeconds: 3,
  target: { capability: 'durable-store' },
  type: 'shutdown',
  durationSeconds: 12,
};

test.describe('Scripted failure phases', () => {
  test('a scripted outage fires on schedule, shows in the HUD and is judged in the report', async ({
    page,
  }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();
    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({ ...doc, failureScenarios: [DB_OUTAGE] });
    await page.locator('#scenario-apply').click();

    await sandbox.setSpeed(5);
    await sandbox.playButton.click();
    // At t = 3 s the script takes the durable store down for 12 s.
    const banner = page.locator('#scripted-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('Database outage');
    await expect(banner).toContainText('SQL Database');
    await expect(banner).toContainText(/\d+s/);
    // The drill ends on schedule and the banner goes with it.
    await expect(banner).toHaveCount(0, { timeout: 20_000 });

    await sandbox.setSpeed(100);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
    const scripted = sandbox.reportOverlay.locator('#report-scripted');
    await expect(scripted).toContainText('Database outage');
    await expect(scripted).toContainText('SQL Database');
    const objectives = await readObjectives(sandbox.reportOverlay);
    expect(objectives.map((o) => o.id)).toContain('scripted-failures');
  });

  test('a phase whose target is missing is skipped, not fatal', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();
    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({
      ...doc,
      failureScenarios: [{ ...DB_OUTAGE, id: 'cdn-outage', label: 'CDN outage', target: { componentType: 'cdn' } }],
    });
    await page.locator('#scenario-apply').click();

    const overlay = await sandbox.runToReport();
    const scripted = overlay.locator('#report-scripted');
    await expect(scripted).toContainText('CDN outage');
    await expect(scripted).toContainText(/skipped/i);
    const report = await readReport(overlay);
    expect(report.title).not.toMatch(/failed/i);
  });

  test('interview participants still see the drill: scripted phases are public scenario data', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-setting-report').selectOption('everyone');
    await host.roomDialog.locator('#room-close').click();
    await host.openScenarioEditor();
    const doc = await host.scenarioDocument();
    await host.setScenarioDocument({ ...doc, failureScenarios: [DB_OUTAGE] });
    await page.locator('#scenario-apply').click();

    const guestContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await new ApiMock(guestContext).install();
    await hub.install(guestContext);
    const guestPage = await guestContext.newPage();
    const guest = new SandboxPage(guestPage);
    await guest.gotoRoomLink(room.participantLink);

    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay.locator('#report-scripted')).toContainText('Database outage');
    // Flows and objectives are still withheld; the drill is not.
    expect((await readObjectives(guest.reportOverlay)).map((o) => o.id)).not.toContain('completion:read');
    await guestContext.close();
  });
});

test.describe('Multi-phase traffic', () => {
  test('traffic phases ramp the load and the Traffic panel shows them read-only', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener', { seed: 4242 });
    const plain = await readReport(await sandbox.runToReport());
    await sandbox.reportOverlay.locator('#report-close').click();

    await sandbox.openScenarioEditor();
    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({
      ...doc,
      trafficPhases: [
        { atSeconds: 0, baseRps: 40 },
        { atSeconds: 30, baseRps: 600 },
      ],
    });
    await page.locator('#scenario-apply').click();

    await page.locator('#btn-traffic').click();
    const phases = page.locator('#traffic-phases');
    await expect(phases).toBeVisible();
    await expect(phases).toContainText('600');
    await page.locator('#traffic-close').click();

    const phased = await readReport(await sandbox.runToReport());
    // Same seed, same board: only the phased ramp explains a higher peak.
    expect(phased.peakRps).toBeGreaterThan(plain.peakRps);
    expect(phased.peakRps).toBeGreaterThanOrEqual(500);
  });
});
