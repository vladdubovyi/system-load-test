import { expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage, readReport } from './helpers/sandbox';
import { openSecondPerson } from './helpers/rooms';

const STARTER = STARTER_PRESETS['url-shortener'];

/**
 * Room settings (docs/specs/interview-platform.md §4): host-controlled,
 * immediate, gone with the room. Pen control (§4.3), who can run, a pinned
 * seed, report visibility, host notes and the PDF record (§4.5).
 */
test.describe('Room settings', () => {
  test('single pen: only the holder edits, participants can ask, the host hands it over', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-pen').selectOption('single');
    await expect(host.roomDialog.locator('.room-participant[data-role="host"][data-pen="1"]')).toHaveCount(1);
    await host.roomDialog.locator('#room-close').click();
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Single pen');

    // The participant cannot place, delete or drag; the board is untouched on both sides.
    await second.page.keyboard.press('Escape');
    await guest.panelItem('redis').click();
    const point = await guest.worldToScreen(800, 520);
    await second.page.mouse.click(point.x, point.y);
    await expect(guest.boardToast).toContainText('holds the pen');
    await expect(guest.components).toHaveCount(STARTER.components);
    await guest.component('Load Balancer').click();
    await second.page.keyboard.press('Delete');
    await expect(guest.components).toHaveCount(STARTER.components);
    await expect(host.components).toHaveCount(STARTER.components);

    // The host still edits.
    await host.placeComponent('redis', 800, 520);
    await expect(guest.components).toHaveCount(STARTER.components + 1);

    // Ask for the pen; the host sees the hand and gives it.
    await second.page.locator('#room-presence').click();
    await second.page.locator('#room-request-pen').click();
    await expect(host.roomPresence).toContainText('✋ 1');
    await host.shareButton.click();
    await expect(host.roomDialog.locator('.room-participant[data-role="participant"] .room-hand')).toBeVisible();
    await host.roomDialog.locator('.room-participant[data-role="participant"] [data-give-pen]').click();
    await host.roomDialog.locator('#room-close').click();

    await expect(guest.boardToast).toContainText('You have the pen');
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('You hold the pen');
    await second.page.locator('#room-close').click();
    await guest.placeComponent('database', 1000, 520);
    await expect(host.components).toHaveCount(STARTER.components + 2);
    // ...and now the host is the one refused.
    await page.keyboard.press('Escape');
    await host.panelItem('redis').click();
    const p2 = await host.worldToScreen(600, 600);
    await page.mouse.click(p2.x, p2.y);
    await expect(host.boardToast).toContainText('holds the pen');

    // The holder leaving returns the pen to the host.
    await second.context.close();
    await expect(host.roomPresence.locator('#room-presence-flags')).toContainText('You hold the pen');
  });

  test('host-only runs: participants cannot start or steer, and a pinned seed drives every run', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-run').selectOption('hostOnly');
    await host.roomDialog.locator('#room-setting-seed').fill('4242');
    await host.roomDialog.locator('#room-setting-seed').dispatchEvent('change');
    await host.roomDialog.locator('#room-close').click();
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Host runs');
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Seed 4242');

    await guest.playButton.click();
    await expect(guest.boardToast).toContainText('Only the host can control runs');
    expect(await guest.engineStatus()).toBe('idle');
    await second.page.locator('#btn-traffic').click();
    await expect(second.page.locator('#traffic-config-container')).toHaveCount(0);

    await host.setSpeed(100);
    await host.playButton.click();
    await expect.poll(() => guest.engineStatus()).toBe('running');
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(host.reportOverlay.locator('#report-seed')).toContainText('seed 4242');
    await expect(guest.reportOverlay.locator('#report-seed')).toContainText('seed 4242');
    await second.context.close();
  });

  test('report held for the host: participants see "Run complete" until the host releases it', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-report').selectOption('hostOnly');
    await host.roomDialog.locator('#room-close').click();

    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    const hostReport = await readReport(host.reportOverlay);

    await expect(second.page.locator('#room-report-held')).toContainText('Run complete');
    await expect(guest.reportOverlay).toHaveCount(0);
    await expect(host.reportOverlay.locator('#report-release')).toBeVisible();
    await expect(host.roomPresence.locator('#room-presence-flags')).toContainText('Report held');

    await host.reportOverlay.locator('#report-release').click();
    await expect(guest.reportOverlay).toBeVisible();
    expect(await readReport(guest.reportOverlay)).toEqual(hostReport);
    await expect(second.page.locator('#room-report-held')).toHaveCount(0);
    await second.context.close();
  });

  test('host notes stay in the tab and the PDF carries the record', async ({ page, browser, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    await expect(page.locator('#btn-notes')).toBeHidden();
    const room = await host.shareRoom();
    await expect(page.locator('#btn-notes')).toBeVisible();

    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);
    await expect(second.page.locator('#btn-notes')).toBeHidden();

    await page.locator('#btn-notes').click();
    await page.locator('#host-notes-text').fill('Strong on caching; asked about hot keys.');
    // Nothing about the notes reaches the server or storage.
    expect(hub.invocations.some((i) => JSON.stringify(i.args).includes('hot keys'))).toBe(false);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.locator('#host-notes-close').click();
    await page.locator('#btn-notes').click();
    await expect(page.locator('#host-notes-text')).toHaveValue('Strong on caching; asked about hot keys.');

    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    const download = page.waitForEvent('download');
    await host.reportOverlay.locator('#report-download').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(bytes).length).toBeGreaterThan(10_000);
    expect(hub.invocations.some((i) => JSON.stringify(i.args).includes('hot keys'))).toBe(false);
    await second.context.close();
  });

  test('switching to interview mode warns about participants who already saw the scenario', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await expect(host.roomDialog.locator('#room-error')).toContainText('already seen');
    // Mode defaults flipped: lint off, report host only.
    await expect(host.roomDialog.locator('#room-setting-lint')).not.toBeChecked();
    await expect(host.roomDialog.locator('#room-setting-report option:checked')).toContainText('host only');
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');
    await second.context.close();
  });
});
