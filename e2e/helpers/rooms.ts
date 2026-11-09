import type { Browser, BrowserContext, Page } from '@playwright/test';
import { ApiMock } from '../fixtures/test';
import type { FakeRoomHub } from '../fixtures/fake-hub';

/**
 * A second person: a fresh browser context (own storage, own connection)
 * wired to the same API mock data and the same fake hub as the first.
 */
export async function openSecondPerson(
  browser: Browser,
  hub: FakeRoomHub
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await new ApiMock(context).install();
  await hub.install(context);
  const page = await context.newPage();
  return { context, page };
}
