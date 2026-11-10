import { expect, test } from './fixtures/test';
import { SandboxPage, readObjectives, readReport } from './helpers/sandbox';

/**
 * D2 phase 3 (docs/specs/product-directions.md §3.2): the last three
 * scenarios, each built on a depth mechanism from phase 1 — a traffic ramp
 * or a scripted drill that is scenario data, fires on simulation time, and
 * therefore stays deterministic and room-safe.
 */
test.describe('Scenario pack: ride dispatch, notification fan-out, payment webhooks', () => {
  test('ride dispatch ramps into rush hour: the Traffic panel shows the phases and the peak reflects them', async ({
    page,
  }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('ride-dispatch');
    await expect(sandbox.title).toHaveText('Ride Dispatch');

    await page.locator('#btn-traffic').click();
    const phases = page.locator('#traffic-phases');
    await expect(phases).toBeVisible();
    await expect(phases).toContainText('480');
    await page.locator('#traffic-close').click();

    const report = await readReport(await sandbox.runToReport());
    // The base rate alone climbs to 480 at the rush; spikes only add to it.
    expect(report.peakRps).toBeGreaterThanOrEqual(450);
  });

  test('notification fan-out ships with a worker-degradation drill that fires on schedule', async ({
    page,
  }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('notification-fanout');
    await expect(sandbox.title).toHaveText('Notification Fan-out');

    await sandbox.setSpeed(20);
    await sandbox.playButton.click();
    const banner = page.locator('#scripted-banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('Worker degraded');
    await expect(banner).toContainText('Worker Service');

    await sandbox.setSpeed(100);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(sandbox.reportOverlay.locator('#report-scripted')).toContainText('Worker degraded');
    const objectives = await readObjectives(sandbox.reportOverlay);
    expect(objectives.map((o) => o.id)).toContain('scripted-failures');
    expect(objectives.map((o) => o.id)).toContain('completion:event');
  });

  test('payment webhooks require the rate limiter and survive a degraded ledger only with headroom', async ({
    page,
  }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('payment-webhook');
    await expect(sandbox.title).toHaveText('Payment Webhooks');

    // The built-in drill is judged in the report.
    const overlay = await sandbox.runToReport();
    const scripted = overlay.locator('#report-scripted');
    await expect(scripted).toContainText('Ledger degraded');
    await expect(scripted).toContainText('SQL Database');
    await overlay.locator('#report-close').click();

    // Dropping the rate limiter is a flow violation, not a capacity problem:
    // the lint names the missing traffic filter before the run proves it.
    await sandbox.deleteComponent('Rate Limiter');
    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintPanel).toContainText(/traffic filter|rate limiter/i);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
    const report = await readReport(sandbox.reportOverlay);
    expect(report.title).toBe('Architecture failed');
  });
});
