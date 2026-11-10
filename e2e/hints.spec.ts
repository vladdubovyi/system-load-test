import { expect, test } from './fixtures/test';
import { SandboxPage } from './helpers/sandbox';
import { openSecondPerson } from './helpers/rooms';

/**
 * Coaching layer, D3 phase 3 (docs/specs/product-directions.md §4.4): a
 * hint ladder authored per scenario, revealed one hint at a time on the
 * report; concept cards attached to lint rules and violation causes. Both
 * paraphrase flows, so interview participants see neither.
 */
test.describe('Coaching: hints and concept cards', () => {
  test('a lost run offers the scenario hints one at a time', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    const overlay = await sandbox.runToReport();

    const hints = overlay.locator('#report-hints');
    await expect(hints).toBeVisible();
    await expect(hints.locator('.report-hint')).toHaveCount(0);
    const next = hints.locator('#report-hint-next');
    await expect(next).toHaveText(/show a hint/i);

    await next.click();
    await expect(hints.locator('.report-hint')).toHaveCount(1);
    await expect(hints.locator('#report-hint-count')).toContainText(/1 of \d+/);
    await next.click();
    await expect(hints.locator('.report-hint')).toHaveCount(2);
    await expect(hints.locator('#report-hint-count')).toContainText(/2 of \d+/);

    // Walk the ladder to its end: the button says so and stops.
    const total = Number((await hints.locator('#report-hint-count').textContent())!.match(/of (\d+)/)![1]);
    for (let shown = 2; shown < total; shown++) await next.click();
    await expect(hints.locator('.report-hint')).toHaveCount(total);
    await expect(next).toBeDisabled();
    await expect(next).toHaveText(/no more hints/i);
  });

  test('the lint panel and the Why? drawer teach the concept behind a missing step', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    const concept = sandbox.lintPanel.locator('.lint-concept').first();
    await expect(concept).toBeVisible();
    await expect(concept.locator('.lint-concept-title')).toContainText(/durable store/i);

    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
    const row = sandbox.reportOverlay.locator('.report-objective[data-objective="violations"]');
    await row.locator('.objective-why').click();
    const drawer = sandbox.reportOverlay.locator('.objective-why-drawer[data-for="violations"]');
    await expect(drawer.locator('.why-concept')).toBeVisible();
    await expect(drawer.locator('.why-concept-title')).toContainText(/durable store/i);
  });

  test('interview participants get neither hints nor concept cards', async ({ page, browser, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-setting-report').selectOption('everyone');
    await host.roomDialog.locator('#room-close').click();

    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');

    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });

    // The host has the ladder; the participant's projection never carried it.
    await expect(host.reportOverlay.locator('#report-hints')).toBeVisible();
    await expect(guest.reportOverlay.locator('#report-hints')).toHaveCount(0);
    await expect(guest.reportOverlay.locator('.why-concept')).toHaveCount(0);
    await second.context.close();
  });
});
