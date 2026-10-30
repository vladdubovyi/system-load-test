import { expect, test } from './fixtures/test';
import { CHALLENGES } from './fixtures/api-data';

test.describe('Challenges browser', () => {
  test('lists every challenge from the API and selects the first by default', async ({ page }) => {
    await page.goto('/challenges');

    const items = page.locator('.challenge-list-item');
    await expect(items).toHaveCount(CHALLENGES.length);
    await expect(items.locator('.challenge-list-title')).toHaveText(CHALLENGES.map((c) => c.name));

    await expect(items.first()).toHaveClass(/is-selected/);
    const detail = page.locator('.challenges-detail-panel');
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText('URL Shortener');
    await expect(detail.locator('.challenge-detail-description')).toHaveText(CHALLENGES[0].description);
    await expect(detail.locator('.challenge-detail-header .challenge-difficulty-pill')).toHaveText('medium');
    await expect(detail.locator('.challenge-detail-meta')).toContainText('45s simulation');
    await expect(detail.locator('.challenge-detail-meta')).toContainText('200 base RPS');
    await expect(detail.locator('.challenge-detail-meta')).toContainText('6 components');
    await expect(page.locator('.site-nav-link.is-active')).toHaveText('Challenges');
  });

  test('selecting another challenge swaps the detail panel', async ({ page }) => {
    await page.goto('/challenges');

    await page.locator('.challenge-list-select', { hasText: 'Rate Limiter' }).click();

    const detail = page.locator('.challenges-detail-panel');
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText('Rate Limiter');
    await expect(detail.locator('.challenge-detail-header .challenge-difficulty-pill')).toHaveText('easy');
    await expect(detail.locator('.challenge-detail-meta')).toContainText('40s simulation');
    await expect(detail.locator('.challenge-detail-meta')).toContainText('300 base RPS');
    await expect(detail.locator('.challenge-requirements li')).toHaveText([
      'Block requests exceeding rate limits',
      'Handle burst traffic',
    ]);
    await expect(detail.locator('.challenge-overview')).toContainText('Rate limiters protect APIs from abuse.');
    await expect(detail.locator('.challenge-video iframe')).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/FU4WlWF_SIQ'
    );

    const selected = page.locator('.challenge-list-item.is-selected');
    await expect(selected).toHaveCount(1);
    await expect(selected.locator('.challenge-list-title')).toHaveText('Rate Limiter');
  });

  test('renders overview markdown-ish content as headings, lists and paragraphs', async ({ page }) => {
    await page.goto('/challenges');
    const overview = page.locator('.challenge-overview');
    await expect(overview.locator('h4')).toHaveText(['What interviewers look for']);
    await expect(overview.locator('li')).toHaveCount(2);
    await expect(overview.locator('p').first()).toContainText('classic system design interview question');
  });

  test('every challenge has a Launch link to its sandbox that opens in a new tab', async ({ page }) => {
    await page.goto('/challenges');

    for (const challenge of CHALLENGES) {
      const item = page.locator('.challenge-list-item', { hasText: challenge.name });
      const launch = item.locator('a.challenge-launch-btn');
      await expect(launch).toHaveAttribute('href', `/sandbox/${challenge.slug}`);
      await expect(launch).toHaveAttribute('target', '_blank');
    }

    const detailLaunch = page.locator('.challenge-detail-actions a', { hasText: 'Launch' });
    await expect(detailLaunch).toHaveAttribute('href', '/sandbox/url-shortener');
  });

  test('launching from the detail panel opens the matching sandbox', async ({ page, context }) => {
    await page.goto('/challenges');
    await page.locator('.challenge-list-select', { hasText: 'Instagram Feed' }).click();

    const popupPromise = context.waitForEvent('page');
    await page.locator('.challenge-detail-actions a', { hasText: 'Launch' }).click();
    const popup = await popupPromise;

    await expect(popup).toHaveURL(/\/sandbox\/instagram-feed$/);
    await expect(popup.locator('.chrome-brand-name')).toHaveText('Instagram Feed');
    await expect(popup).toHaveTitle('Sandbox: instagram-feed — BreakIT');
    await popup.close();
  });

  test('shows an empty state when the API is unreachable', async ({ page, api }) => {
    await api.unavailable();
    await page.goto('/challenges');

    await expect(page.locator('.challenges-empty')).toHaveText('No challenges loaded.');
    await expect(page.locator('.challenge-detail-empty h2')).toHaveText('Select a challenge');
  });

  test('shows an empty state when the API returns no challenges', async ({ page, api }) => {
    await api.install({ challenges: [] });
    await page.goto('/challenges');

    await expect(page.locator('.challenges-empty')).toBeVisible();
    await expect(page.locator('.challenge-list-item')).toHaveCount(0);
  });
});
