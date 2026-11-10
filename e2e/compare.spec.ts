import { expect, test } from './fixtures/test';
import { SandboxPage, readReport } from './helpers/sandbox';

/**
 * Coaching layer, D3 phase 2 (docs/specs/product-directions.md §4.3): pin a
 * run as A, change the design, run the same seed again, and compare like
 * for like — objectives, per-kind flow stats, headline numbers and the board
 * changes in between. Pins live in the tab and nowhere else.
 */
test.describe('Coaching: same-seed A/B comparison', () => {
  test('pin the starter, load the reference, and compare like for like', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener', { seed: 4242 });

    const first = await sandbox.runToReport();
    const starter = await readReport(first);
    await expect(first.locator('#report-compare')).toBeDisabled();
    await first.locator('#report-pin').click();
    await expect(first.locator('#report-pin')).toContainText('Pinned as A');
    await first.locator('#report-close').click();

    await sandbox.loadReference();
    const second = await sandbox.runToReport();
    const reference = await readReport(second);
    expect(reference.seed).toBe(starter.seed);
    await expect(second.locator('#report-compare')).toBeEnabled();
    await second.locator('#report-compare').click();

    const panel = second.locator('#report-compare-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('A');
    await expect(panel).toContainText('This run');
    // Objectives aligned side by side: the starter missed creates, the reference met them.
    const creates = panel.locator('.compare-objective[data-objective="completion:create"]');
    await expect(creates.locator('.compare-a')).toContainText('✕');
    await expect(creates.locator('.compare-b')).toContainText('✓');
    // Headline numbers: the reference scores higher.
    const scoreRow = panel.locator('.compare-metric[data-metric="score"]');
    expect(Number((await scoreRow.locator('.compare-a').textContent())?.trim())).toBe(starter.score);
    expect(Number((await scoreRow.locator('.compare-b').textContent())?.trim())).toBe(reference.score);
    expect(reference.score).toBeGreaterThan(starter.score);
    // Per-kind flow stats are there too.
    await expect(panel.locator('.compare-flow[data-kind="read"]')).toBeVisible();
    // And the board changes that explain the difference: the reference
    // auto-scales both services. Scale-out instances the engine spawned
    // during the run are not board changes and must not be counted.
    const changes = panel.locator('.compare-board-changes');
    await expect(changes).toContainText(/Microservice:.*H-scale/);
    await expect(changes).toContainText(/Backend Service:.*H-scale/);
    await expect(changes).not.toContainText(/\+\d+ (Microservice|Backend Service)/);
    await expect(changes).not.toContainText(/connections/);

    // Pins are tab memory: nothing was written anywhere.
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('a different seed is not compared; the panel points at Replay same traffic', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const first = await sandbox.runToReport();
    const a = await readReport(first);
    await first.locator('#report-pin').click();
    // "Run again" draws a fresh seed.
    await first.locator('#report-replay').click();
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
    const b = await readReport(sandbox.reportOverlay);
    expect(b.seed).not.toBe(a.seed);

    await sandbox.reportOverlay.locator('#report-compare').click();
    const panel = sandbox.reportOverlay.locator('#report-compare-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/different seed/i);
    await expect(panel).toContainText(/Replay same traffic/);
    await expect(panel.locator('.compare-objective')).toHaveCount(0);
  });
});
