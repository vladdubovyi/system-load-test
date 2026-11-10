import { ApiMock, expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage, readFlowStats } from './helpers/sandbox';
import { encodeSnapshot } from '../src/share/snapshot';

const STARTER = STARTER_PRESETS['url-shortener'];

/**
 * Portable artifacts, D1 phases 1–2 (docs/specs/product-directions.md §2):
 * a board or a run travels as `{site}/#board=1.<payload>` — no server state,
 * nothing stored. Decoding is parsing untrusted input: a bad link leaves the
 * sandbox untouched, and imported text renders inert.
 */
test.describe('Snapshot links', () => {
  test('a board link reproduces the board, scenario and traffic in a fresh tab', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    // A distinctive state: one extra component, an applied scenario edit,
    // and a traffic override.
    await sandbox.placeComponent('redis', 820, 540);
    await sandbox.openScenarioEditor();
    const doc = await sandbox.scenarioDocument();
    // Tags, not requestTypes: applying a Traffic profile layers the panel's
    // request mix over the authored one (scenario-runtime layering), so tags
    // are the signal that distinguishes the scenario override cleanly.
    await sandbox.setScenarioDocument({
      ...doc,
      tags: [{ id: 'share-role', label: 'Share role' }],
    });
    await page.locator('#scenario-apply').click();
    await page.locator('#btn-traffic').click();
    await page.locator('#traffic-base-rps').fill('123');
    await page.locator('#traffic-apply').click();

    await sandbox.shareButton.click();
    await expect(page.locator('#snapshot-section')).toBeVisible();
    await page.locator('#snapshot-copy-board').click();
    await expect(sandbox.boardToast).toContainText('copied');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('#board=1.');

    const other = await context.newPage();
    const fresh = new SandboxPage(other);
    await other.goto(link);
    await expect(fresh.board).toBeVisible();
    await expect(fresh.title).toHaveText('URL Shortener');
    await expect(fresh.components).toHaveCount(STARTER.components + 1);
    await expect(fresh.belts).toHaveCount(STARTER.belts);
    // The applied scenario document travelled with the board…
    await fresh.openScenarioEditor();
    expect((await fresh.scenarioDocument()).tags).toEqual([{ id: 'share-role', label: 'Share role' }]);
    await other.locator('#scenario-close').click();
    // …and so did the traffic override.
    await other.locator('#btn-traffic').click();
    await expect(other.locator('#traffic-base-rps')).toHaveValue('123');
    await other.close();
  });

  test('a run link from the report replays the exact run', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    const overlay = await sandbox.runToReport();
    const originalStats = await readFlowStats(overlay);

    await overlay.locator('#report-copy-link').click();
    await expect(sandbox.boardToast).toContainText('copied');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('#board=1.');

    const other = await context.newPage();
    const fresh = new SandboxPage(other);
    await other.goto(link);
    await expect(fresh.components).toHaveCount(STARTER.components);
    const replayed = await fresh.runToReport();
    expect(await readFlowStats(replayed)).toEqual(originalStats);
    await other.close();
  });

  test('a room credential wins over a board fragment in the same link', async ({
    page,
    context,
    browser,
    hub,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    // A valid board token for a board with one extra component…
    await sandbox.placeComponent('redis', 820, 540);
    await sandbox.shareButton.click();
    await page.locator('#snapshot-copy-board').click();
    const boardLink = await page.evaluate(() => navigator.clipboard.readText());
    const boardFragment = boardLink.slice(boardLink.indexOf('#board=') + 1);
    await page.locator('#room-close').click();

    // …and a live room on the unmodified starter.
    await sandbox.loadStarter();
    const room = await sandbox.shareRoom();

    const guestContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await new ApiMock(guestContext).install();
    await hub.install(guestContext);
    const guestPage = await guestContext.newPage();
    const guest = new SandboxPage(guestPage);
    await guestPage.goto(`${room.participantLink}&${boardFragment}`);

    // The room defines the board: joined, starter count, snapshot ignored.
    await expect(guest.roomPresence).toBeVisible();
    await expect(guest.components).toHaveCount(STARTER.components);
    await guestContext.close();
  });

  test('a malformed or newer-version link leaves the sandbox untouched', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await page.goto('/#board=1.this-is-not-deflate');
    await expect(sandbox.board).toBeVisible();
    await expect(sandbox.components).toHaveCount(STARTER.components);
    await expect(sandbox.boardToast).toContainText(/board link/i);

    await page.goto('/#board=9.AAAA');
    await page.reload();
    await expect(sandbox.components).toHaveCount(STARTER.components);
    await expect(sandbox.boardToast).toContainText(/newer version/i);
  });

  test('imported text annotations render inert', async ({ page }) => {
    const token = await encodeSnapshot({
      v: 1,
      kind: 'board',
      scenarioSlug: 'url-shortener',
      board: [
        {
          kind: 'text',
          id: 'note-1',
          value: {
            id: 'note-1',
            x: 600,
            y: 300,
            width: 240,
            minHeight: 40,
            content: '<img src=x onerror="document.title=\'pwned\'">',
          },
        },
      ],
    });
    await page.goto(`/#board=${token}`);
    const sandbox = new SandboxPage(page);
    await expect(sandbox.board).toBeVisible();
    const note = page.locator('.board-text');
    await expect(note).toHaveCount(1);
    // Rendered as literal text: no element was created from it.
    await expect(note).toContainText('<img src=x');
    await expect(page.locator('.board-text img')).toHaveCount(0);
    await expect
      .poll(async () => page.title())
      .not.toContain('pwned');
  });
});
