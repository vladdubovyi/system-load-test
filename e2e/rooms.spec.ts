import { expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage } from './helpers/sandbox';
import { openSecondPerson } from './helpers/rooms';

const STARTER = STARTER_PRESETS['url-shortener'];

/**
 * Collaborative rooms (docs/specs/interview-platform.md §3, §5): Share gives a
 * code and two links, whoever opens them is on the same canvas live, and the
 * room is private, anonymous and temporary. The hub is the in-process fake in
 * fixtures/fake-hub.ts; the real server is exercised by the C# tests and by
 * e2e/real-api.spec.ts.
 */
test.describe('Rooms', () => {
  test('Share opens a room with a code, a participant link and a host link', async ({ page, hub }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await expect(sandbox.shareButton).toHaveText(/Share/);
    await expect(sandbox.roomPresence).toHaveCount(0);

    const room = await sandbox.shareRoom();

    expect(room.participantLink).toBe(`http://localhost:${new URL(page.url()).port}/#join=${room.code}`);
    expect(room.hostLink).toMatch(/\/#host=[A-Za-z0-9_-]{16,}$/);
    // The tab is now the host: its own URL carries the host link so a refresh
    // comes back as host, and the presence panel shows one person.
    await expect(page).toHaveURL(/#host=/);
    await expect(sandbox.shareButton).toHaveText(new RegExp(room.code));
    await expect(sandbox.roomPresence).toBeVisible();
    await expect(sandbox.roomPresence).toContainText(room.code);
    await expect(sandbox.presenceNames()).toHaveCount(1);
    await expect(sandbox.roomPresence.locator('.room-participant')).toHaveAttribute('data-role', 'host');
    await expect(sandbox.roomPresence).toContainText('(you)');

    // The board that was shared is the board the server holds.
    expect(hub.boardOf(room.code).filter((e) => e.kind === 'component')).toHaveLength(STARTER.components);
    expect(hub.boardOf(room.code).filter((e) => e.kind === 'belt')).toHaveLength(STARTER.belts);

    // Reopening the dialog shows the same credentials and the host warning.
    await sandbox.shareButton.click();
    await expect(sandbox.roomDialog.locator('#room-code')).toHaveText(room.code);
    await expect(sandbox.roomDialog.locator('#room-host-warning')).toContainText('Keep this to get back in as host');
  });

  test('a participant who opens the link lands on the same board, and edits flow both ways', async ({
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

    // Same scenario, same board, no starter reload.
    await expect(guest.title).toHaveText('URL Shortener');
    await expect(guest.components).toHaveCount(STARTER.components);
    await expect(guest.belts).toHaveCount(STARTER.belts);
    await expect(guest.presenceNames()).toHaveCount(2);
    await expect(host.presenceNames()).toHaveCount(2);
    await expect(guest.roomPresence.locator('.room-participant[data-role="participant"]')).toContainText('(you)');

    // Host places a component: the participant sees it.
    await host.placeComponent('redis', 800, 520);
    await expect(guest.components).toHaveCount(STARTER.components + 1);
    await expect(guest.component('Redis Cache')).toHaveCount(2);

    // Participant moves the load balancer: the host sees it move.
    const before = (await host.component('Load Balancer').boundingBox())!;
    await guest.dragComponent('Load Balancer', 0, 160);
    await expect.poll(async () => Math.round((await host.component('Load Balancer').boundingBox())!.y)).toBeGreaterThan(
      Math.round(before.y) + 120
    );

    // Participant deletes a component: its belts go too, on both sides.
    await guest.deleteComponent('Load Balancer');
    await expect(host.component('Load Balancer')).toHaveCount(0);
    await expect(host.belts).toHaveCount(await guest.belts.count());
    expect(hub.boardOf(room.code).some((e) => e.kind === 'component' && (e.value as { label: string }).label === 'Load Balancer')).toBe(false);

    // Live cursors: the host's pointer shows up on the participant's board with the host's name.
    const hostName = (await host.roomPresence.locator('.room-participant[data-role="host"] .room-participant-name').textContent())!.trim();
    const target = await host.worldToScreen(700, 300);
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await expect(guest.board.locator('.remote-cursor')).toHaveCount(1);
    await expect(guest.board.locator('.remote-cursor-name')).toHaveText(hostName);

    // Leaving drops the participant from presence and from the hub.
    await second.page.locator('#room-presence').click();
    await second.page.locator('#room-leave').click();
    await expect(guest.roomPresence).toHaveCount(0);
    await expect(host.presenceNames()).toHaveCount(1);
    await second.context.close();
  });

  test('undo is per person: one side cannot erase the other side\'s work', async ({ page, browser, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    await host.reset();
    const room = await host.shareRoom();

    const second = await openSecondPerson(browser, hub);
    const guest = new SandboxPage(second.page);
    await guest.gotoRoomLink(room.participantLink);
    await expect(guest.components).toHaveCount(0);

    await host.placeComponent('redis', 700, 400);
    await expect(guest.components).toHaveCount(1);
    await guest.placeComponent('database', 1000, 400);
    await expect(host.components).toHaveCount(2);

    // The host undoes: only the host's own gesture is reverted.
    await page.keyboard.press('Control+z');
    await expect(host.components).toHaveCount(1);
    await expect(host.component('SQL Database')).toHaveCount(1);
    await expect(guest.components).toHaveCount(1);
    await expect(guest.component('SQL Database')).toHaveCount(1);

    // The participant moves the host's component. The host's undo of the
    // placement now touches an entity someone else changed, so it is skipped
    // (§5.2): the component stays where the participant put it, on both sides.
    await page.keyboard.press('Control+Shift+z');
    await expect(guest.components).toHaveCount(2);
    await guest.dragComponent('Redis Cache', 0, 200);
    const moved = (await guest.component('Redis Cache').boundingBox())!;
    await expect.poll(async () => Math.round((await host.component('Redis Cache').boundingBox())!.y)).toBe(Math.round(moved.y));
    await page.keyboard.press('Control+z');
    await expect(host.component('Redis Cache')).toHaveCount(1);
    await expect(guest.component('Redis Cache')).toHaveCount(1);
    expect(Math.round((await host.component('Redis Cache').boundingBox())!.y)).toBe(Math.round(moved.y));
    // The host's own untouched work still undoes: the database was the
    // participant's, so the host's stack is now empty and nothing changes.
    await page.keyboard.press('Control+z');
    await expect(host.components).toHaveCount(2);
    await second.context.close();
  });

  test('"Join a room" accepts a typed code, rejects nonsense inline, and reports unknown rooms', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();

    const second = await openSecondPerson(browser, hub);
    await second.page.goto('/');
    const form = second.page.locator('#join-room-form');
    await expect(form).toBeVisible();

    // Too short to be a code (and "not a code" would be one: N0TAC0DE).
    await form.locator('#join-room-code').fill('abc');
    await form.locator('#join-room-submit').click();
    await expect(second.page.locator('#join-room-error')).toContainText('8-character code');
    await expect(second.page).toHaveURL(/\/$/);

    // Typed the way people type: lowercase, a space instead of the dash.
    await form.locator('#join-room-code').fill(room.code.toLowerCase().replace('-', ' '));
    await form.locator('#join-room-submit').click();
    const guest = new SandboxPage(second.page);
    await expect(guest.board).toBeVisible();
    await expect(guest.roomPresence).toBeVisible();
    await expect(guest.components).toHaveCount(STARTER.components);
    await expect(second.page).toHaveURL(new RegExp(`/sandbox#join=${room.code}$`));

    // An unknown code gets the one uninformative message, in the sandbox dialog.
    await second.page.goto('/#join=ZZZZ-ZZZZ');
    await expect(guest.roomDialog).toBeVisible();
    await expect(guest.roomDialog.locator('#room-error')).toHaveText('No room with that code.');
    await expect(guest.roomPresence).toHaveCount(0);
    // ...and the sandbox is still usable underneath.
    await guest.roomDialog.locator('#room-close').click();
    await expect(guest.components).toHaveCount(STARTER.components);
    await second.context.close();
  });

  test('the host link grants the host role elsewhere, and a new join code retires the old link', async ({
    page,
    browser,
    hub,
  }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();

    const second = await openSecondPerson(browser, hub);
    const otherTab = new SandboxPage(second.page);
    await otherTab.gotoRoomLink(room.hostLink);
    await expect(otherTab.roomPresence.locator('.room-participant[data-role="host"]')).toHaveCount(2);
    await expect(otherTab.shareButton).toHaveText(new RegExp(room.code));

    // Rotate the join code from the first tab.
    await host.shareButton.click();
    await host.roomDialog.locator('#room-rotate-code').click();
    await expect(host.roomDialog.locator('#room-code')).not.toHaveText(room.code);
    const newCode = (await host.roomDialog.locator('#room-code').textContent())!.trim();
    await host.roomDialog.locator('#room-close').click();

    const third = await openSecondPerson(browser, hub);
    const late = new SandboxPage(third.page);
    await third.page.goto(room.participantLink);
    await expect(late.roomDialog.locator('#room-error')).toHaveText('No room with that code.');
    await third.page.goto(`/#join=${newCode}`);
    await expect(late.roomPresence).toBeVisible();
    await expect(late.presenceNames()).toHaveCount(3);

    await second.context.close();
    await third.context.close();
  });

  test('when the server ends the room the board stays and the host can start a new one', async ({ page, hub }) => {
    const host = new SandboxPage(page);
    await host.goto('url-shortener');
    const room = await host.shareRoom();
    await host.placeComponent('redis', 800, 520);

    hub.endRoom(room.code, 'idle');

    await expect(host.roomBanner).toBeVisible();
    await expect(host.roomBanner).toContainText('This room has ended');
    await expect(host.roomBanner).toContainText('12 hours');
    await expect(host.roomPresence).toHaveCount(0);
    await expect(page).not.toHaveURL(/#host=/);
    await expect(host.components).toHaveCount(STARTER.components + 1);

    await host.roomBanner.locator('#room-restart').click();
    await expect(host.roomDialog.locator('#room-code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const newCode = (await host.roomDialog.locator('#room-code').textContent())!.trim();
    expect(newCode).not.toBe(room.code);
    await expect(host.roomBanner).toHaveCount(0);
    expect(hub.boardOf(newCode).filter((e) => e.kind === 'component')).toHaveLength(STARTER.components + 1);
  });

  test('only the host edits the scenario, and the applied document reaches participants', async ({
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
    await expect(second.page.locator('#btn-scenario')).toBeHidden();
    await expect(page.locator('#btn-scenario')).toBeVisible();

    await host.openScenarioEditor();
    const doc = await host.scenarioDocument();
    await host.setScenarioDocument({
      ...doc,
      tags: [{ id: 'room-role', label: 'Room role', appliesTo: { kind: 'compute' } }],
    });
    await page.locator('#scenario-apply').click();

    await guest.component('Microservice').click();
    await expect(guest.tagChip('room-role')).toBeVisible();
    await second.context.close();
  });

  test('a room session stores nothing in the browser and sends credentials only inside the connection', async ({
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
    await guest.placeComponent('redis', 800, 520);
    await expect(host.components).toHaveCount(STARTER.components + 1);

    for (const p of [page, second.page]) {
      expect(await p.evaluate(() => localStorage.length)).toBe(0);
      expect(await p.evaluate(() => sessionStorage.length)).toBe(0);
      expect(await p.evaluate(() => document.cookie)).toBe('');
    }
    // No query string on the socket: codes and secrets travel in invocations.
    expect(hub.urls.length).toBeGreaterThanOrEqual(2);
    for (const url of hub.urls) {
      expect(new URL(url).search).toBe('');
    }
    expect(
      hub.invocations.some((i) => i.target === 'JoinByCode' && i.args[0] === room.code.replace('-', ''))
    ).toBe(true);
    await second.context.close();
  });
});
