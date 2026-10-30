import { expect, test } from './fixtures/test';

test.describe('Landing page', () => {
  test('renders the hero and primary calls to action', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/BreakIT/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Practice architecture under real load');
    await expect(page.getByRole('link', { name: 'Browse challenges' })).toHaveAttribute('href', '/challenges');

    const tryIt = page.getByRole('link', { name: 'Try it yourself' });
    await expect(tryIt).toHaveAttribute('href', '/sandbox/url-shortener');
    await expect(tryIt).toHaveAttribute('target', '_blank');

    await expect(page.locator('.feature-card')).toHaveCount(3);
    await expect(page.locator('.site-nav-link.is-active')).toHaveText('Home');
  });

  test('"Browse challenges" navigates client-side to the challenges browser', async ({ page, api }) => {
    await page.goto('/');
    // Mark the document so we can prove no full reload happened.
    await page.evaluate(() => ((window as unknown as { __spaMarker?: boolean }).__spaMarker = true));

    await page.getByRole('link', { name: 'Browse challenges' }).click();

    await expect(page).toHaveURL(/\/challenges$/);
    await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible();
    await expect(page.locator('.challenge-list-item')).toHaveCount(4);
    expect(await page.evaluate(() => (window as unknown as { __spaMarker?: boolean }).__spaMarker)).toBe(true);
    expect(api.calls('/api/challenges', 'GET')).toHaveLength(1);
  });

  test('"Try it yourself" opens the URL shortener sandbox in a new tab', async ({ page, context }) => {
    await page.goto('/');

    const popupPromise = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Try it yourself' }).click();
    const popup = await popupPromise;

    await expect(popup).toHaveURL(/\/sandbox\/url-shortener$/);
    await expect(popup.locator('.chrome-brand-name')).toHaveText('URL Shortener');
    await expect(popup.locator('#board .component')).toHaveCount(5);
    await popup.close();
  });

  test('unknown paths fall back to the landing page', async ({ page }) => {
    await page.goto('/this/route/does/not/exist');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Practice architecture under real load');
  });

  test('browser back returns from challenges to the landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Browse challenges' }).click();
    await expect(page).toHaveURL(/\/challenges$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.landing-hero')).toBeVisible();
  });
});
