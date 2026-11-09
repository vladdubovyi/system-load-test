import { expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage, readFlowStats, readObjectives } from './helpers/sandbox';
import { openSecondPerson } from './helpers/rooms';

const STARTER = STARTER_PRESETS['url-shortener'];

/**
 * Interview mode (docs/specs/interview-platform.md §6, build step 7): the
 * server withholds flows, objectives and the scenario slug from participants;
 * runs still work because an opaque flow bundle arrives with the run and is
 * discarded after it; participant UI never renders flow internals; the
 * mode-switch warning offers a fresh room; unedited catalog scenarios carry a
 * host-side banner.
 */
test.describe('Interview mode', () => {
  test('objectives are withheld from participants while runs stay identical', async ({
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

    // Pin the seed and let everyone see reports, so the two sides and the
    // two runs are comparable.
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-seed').fill('4242');
    await host.roomDialog.locator('#room-setting-seed').dispatchEvent('change');
    await host.roomDialog.locator('#room-setting-report').selectOption('everyone');
    await host.roomDialog.locator('#room-close').click();

    // Open mode: the participant's report carries the objective checklist.
    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });
    const openGuestObjectives = await readObjectives(guest.reportOverlay);
    expect(openGuestObjectives.map((o) => o.id)).toContain('completion:read');
    expect(openGuestObjectives.map((o) => o.id)).toContain('violations');
    const openStats = await readFlowStats(host.reportOverlay);
    expect(await readFlowStats(guest.reportOverlay)).toEqual(openStats);
    await host.reportOverlay.locator('#report-close').click();
    await guest.reportOverlay.locator('#report-close').click();

    // Interview mode: same board, same seed. The participant computes the
    // same raw numbers (the opaque flow bundle drove their engine) but has
    // no objectives to judge them with.
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-close').click();
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');

    await host.playButton.click();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(guest.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => (await readObjectives(host.reportOverlay)).map((o) => o.id))
      .toContain('completion:read');
    // The participant keeps only the generic survival check, which their own
    // engine computes; the authored objectives (completion floors, violation
    // ceiling) were never sent (§6.2).
    await expect
      .poll(async () => (await readObjectives(guest.reportOverlay)).map((o) => o.id))
      .toEqual(['failures']);
    const interviewHostStats = await readFlowStats(host.reportOverlay);
    expect(await readFlowStats(guest.reportOverlay)).toEqual(interviewHostStats);
    // Same seed and board as the open run: the bundle reproduced it exactly.
    expect(interviewHostStats).toEqual(openStats);
    await second.context.close();
  });

  test('participants get no lint in interview mode until the host turns it on', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    // No storage: the lint names the missing durable-store step.
    await host.deleteComponent('SQL Database');
    await host.deleteComponent('Redis Cache');
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-close').click();
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');

    // Lint defaults off in interview mode: the host sees the panel, the
    // participant never does.
    await host.setSpeed(100);
    await host.playButton.click();
    await expect(host.lintPanel).toBeVisible();
    await expect(host.reportOverlay).toBeVisible({ timeout: 90_000 });
    await expect(second.page.locator('#room-report-held')).toBeVisible({ timeout: 90_000 });
    await expect(guest.lintPanel).toHaveCount(0);
    await host.reportOverlay.locator('#report-close').click();

    // Turning lint on sends the participant the flows as design hints.
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-lint').check();
    await expect(host.boardToast).toContainText('design hints');
    await host.roomDialog.locator('#room-close').click();

    await host.playButton.click();
    await expect(guest.lintPanel).toBeVisible({ timeout: 30_000 });
    await expect(guest.lintPanel).toContainText(/durable store/i);
    await second.context.close();
  });

  test('the request inspector hides flow internals from interview participants', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    // No storage at all: every request violates its flow at the service tier.
    await host.deleteComponent('SQL Database');
    await host.deleteComponent('Redis Cache');
    // Light traffic, so the services never overload: requests get processed
    // and violate instead of being dropped by a full queue.
    await page.locator('#btn-traffic').click();
    await page.locator('#traffic-base-rps').fill('40');
    await page.locator('#traffic-apply').click();
    const room = await host.shareRoom();
    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await host.roomDialog.locator('#room-close').click();
    await expect(guest.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');

    await host.setSpeed(5);
    await host.playButton.click();

    // The participant sees the request fail, not why its flow was violated.
    await guest.traceAnyActiveRequest();
    await expect(guest.requestInspector).toBeVisible();
    await expect(guest.requestInspector).toContainText('Failed', { timeout: 20_000 });
    await expect(guest.requestInspector).not.toContainText(/violation/i);
    await expect(guest.requestInspector).not.toContainText('needed');
    await expect(guest.requestInspector).not.toContainText(/durable store/i);

    // The host keeps the full violation UX.
    await host.traceAnyActiveRequest();
    await expect(host.requestInspector).toBeVisible();
    await expect(host.requestInspector).toContainText('Flow violation', { timeout: 20_000 });
    await second.context.close();
  });

  test('the mode-switch warning offers a fresh interview room with the same board', async ({
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
    await expect(host.roomPresence).toContainText('2 people');

    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    await expect(host.roomDialog.locator('#room-error')).toContainText('already seen');
    await host.roomDialog.locator('#room-fresh-interview').click();

    // A new private room: new code, nobody in it but the host, interview
    // mode on, and the board carried over.
    await expect(host.roomDialog.locator('#room-code')).toBeVisible();
    await expect(host.roomDialog.locator('#room-code')).not.toHaveText(room.code);
    await host.roomDialog.locator('#room-close').click();
    await expect(host.roomPresence).toContainText('1 person');
    await expect(host.roomPresence.locator('#room-presence-flags')).toContainText('Interview mode');
    await expect(host.components).toHaveCount(STARTER.components);

    // The old room lives on without the host.
    await expect(guest.roomPresence).toContainText('1 person');
    await second.context.close();
  });

  test('an unedited catalog scenario shows the host a public-scenario banner until the first Apply', async ({
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

    await expect(page.locator('#room-public-scenario')).toHaveCount(0);
    await host.shareButton.click();
    await host.roomDialog.locator('#room-setting-mode').selectOption('interview');
    // §2.4: the integrity note appears in the host's room menu.
    await expect(host.roomDialog.locator('#room-integrity-note')).toContainText('withholds');
    await host.roomDialog.locator('#room-close').click();

    await expect(page.locator('#room-public-scenario')).toBeVisible();
    await expect(page.locator('#room-public-scenario')).toContainText(/public scenario/i);
    await expect(second.page.locator('#room-public-scenario')).toHaveCount(0);

    // Editing the scenario makes it the host's own; the banner goes away.
    await host.openScenarioEditor();
    const doc = await host.scenarioDocument();
    await host.setScenarioDocument({ ...doc, requestTypes: { read: 0.5, create: 0.5 } });
    // Apply closes the editor itself.
    await page.locator('#scenario-apply').click();
    await expect(page.locator('#scenario-editor')).toHaveCount(0);
    await expect(page.locator('#room-public-scenario')).toHaveCount(0);
    await second.context.close();
  });
});
