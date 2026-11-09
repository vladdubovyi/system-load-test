import { expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage, readFlowStats, readReport } from './helpers/sandbox';
import { openSecondPerson } from './helpers/rooms';

const STARTER = STARTER_PRESETS['url-shortener'];

/**
 * Runs in rooms (docs/specs/interview-platform.md §4.4): every client runs
 * the simulation itself from the server-fixed seed and board, the
 * controller's clock paces everyone, and pause / speed / failure injection
 * are tick-stamped room events. Determinism (§8) is what makes two reports
 * identical at the end.
 */
async function reportOf(sandbox: SandboxPage): Promise<unknown> {
  await expect(sandbox.reportOverlay).toBeVisible({ timeout: 90_000 });
  return { summary: await readReport(sandbox.reportOverlay), flows: await readFlowStats(sandbox.reportOverlay) };
}

async function hudTime(sandbox: SandboxPage): Promise<number> {
  const text = (await sandbox.hud.textContent()) ?? '';
  const m = text.match(/Time\s*([\d.]+)s/);
  return m ? Number(m[1]) : -1;
}

test.describe('Runs in rooms', () => {
  test('Play by one person runs the same simulation for everyone, ending in identical reports', async ({
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

    await host.setSpeed(100);
    await host.playButton.click();
    // Both engines start; the guest never pressed anything.
    await expect.poll(() => guest.engineStatus()).toBe('running');
    await expect(guest.playButton).toHaveText(/Pause/);
    // The board is read-only for everyone while it runs.
    await expect(second.page.locator('.canvas-app')).toBeVisible();

    const hostReport = await reportOf(host);
    const guestReport = await reportOf(guest);
    expect(guestReport).toEqual(hostReport);
    expect((hostReport as { flows: unknown[] }).flows.length).toBeGreaterThan(0);
    await second.context.close();
  });

  test('pause, speed and failure injection are room-wide, and the reports still agree', async ({
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

    await host.playButton.click();
    await expect.poll(() => guest.engineStatus()).toBe('running');

    // The guest pauses: both sides stop on the same clock.
    await guest.playButton.click();
    await expect(host.playButton).toHaveText(/Resume/);
    await expect(guest.playButton).toHaveText(/Resume/);
    const frozenHost = await hudTime(host);
    await second.page.waitForTimeout(600);
    expect(await hudTime(host)).toBe(frozenHost);
    expect(await hudTime(guest)).toBe(frozenHost);

    // The guest injects a failure while paused; the host resumes.
    await second.page.locator('#btn-failure').click();
    await second.page.locator('#failure-component').selectOption({ index: 1 });
    await second.page.locator('#failure-inject').click();
    await host.playButton.click();
    await expect(guest.playButton).toHaveText(/Pause/);

    // Speed from the guest reaches the host's controls.
    await second.page.locator('.speed-btn[data-speed="100"]').click();
    await expect(page.locator('.speed-btn.active')).toHaveAttribute('data-speed', '100');
    await expect(second.page.locator('.speed-btn.active')).toHaveAttribute('data-speed', '100');

    const hostReport = await reportOf(host);
    const guestReport = await reportOf(guest);
    expect(guestReport).toEqual(hostReport);
    await second.context.close();
  });

  test('someone who joins mid-run fast-forwards to the room clock and ends with the same report', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();

    await host.setSpeed(5);
    await host.playButton.click();
    await expect.poll(() => hudTime(host)).toBeGreaterThan(3);

    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);
    await expect.poll(() => guest.engineStatus()).toBe('running');
    await expect(guest.playButton).toHaveText(/Pause/);
    // Caught up: within a second of simulated time of the host.
    await expect.poll(async () => Math.abs((await hudTime(guest)) - (await hudTime(host)))).toBeLessThan(1.5);

    await host.setSpeed(100);
    const hostReport = await reportOf(host);
    const guestReport = await reportOf(guest);
    expect(guestReport).toEqual(hostReport);
    await second.context.close();
  });

  test('Reset during a run stops it for everyone instead of editing a locked board', async ({ page, browser, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.playButton.click();
    await expect.poll(() => guest.engineStatus()).toBe('running');

    await second.page.locator('#btn-reset').click();
    await expect(guest.boardToast).toContainText('locked during the run');
    await expect.poll(() => host.engineStatus()).toBe('idle');
    await expect.poll(() => guest.engineStatus()).toBe('idle');
    await expect(host.components).toHaveCount(STARTER.components);
    await expect(guest.components).toHaveCount(STARTER.components);

    // Unlocked again: a real reset now goes through for both.
    await second.page.locator('#btn-reset').click();
    await expect(guest.components).toHaveCount(0);
    await expect(host.components).toHaveCount(0);
    await second.context.close();
  });

  test('when the person driving the run leaves, the host takes over the clock', async ({ page, browser, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await guest.setSpeed(20);
    await guest.playButton.click();
    await expect.poll(() => host.engineStatus()).toBe('running');
    await expect.poll(() => hudTime(host)).toBeGreaterThan(1);

    await second.context.close();
    await expect(host.presenceNames()).toHaveCount(1);

    // The host keeps running on its own clock and reaches the report.
    const t = await hudTime(host);
    await expect.poll(() => hudTime(host)).toBeGreaterThan(t + 1);
    await host.setSpeed(100);
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
  });
});
