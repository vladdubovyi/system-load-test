import { expect, test } from './fixtures/test';
import { SandboxPage, readObjectives } from './helpers/sandbox';

/**
 * Coaching layer, D3 phase 1 (docs/specs/product-directions.md §4.2): a
 * failed objective explains itself. "Why?" opens a drawer with the engine
 * rule in one sentence and up to three example request traces drawn from
 * the finished run, rendered with the request inspector's own timeline.
 */
test.describe('Coaching: Why? on failed objectives', () => {
  test('a flow-violation loss explains itself with the rule and example traces', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    // No durable store: every create dies at "Persist mapping".
    await sandbox.deleteComponent('SQL Database');
    const overlay = await sandbox.runToReport();

    const violations = overlay.locator('.report-objective[data-objective="violations"]');
    await expect(violations).toHaveClass(/unmet/);
    await violations.locator('.objective-why').click();

    const drawer = overlay.locator('.objective-why-drawer[data-for="violations"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/violated when no connected component satisfies/i);
    const examples = drawer.locator('.why-example');
    await expect(examples).toHaveCount(3);
    await expect(examples.first()).toContainText('create');
    await expect(examples.first()).toContainText('Flow violation');
    await expect(examples.first()).toContainText(/durable store/i);

    // The completion row for creates explains the same loss from its side.
    const creates = overlay.locator('.report-objective[data-objective="completion:create"]');
    await creates.locator('.objective-why').click();
    await expect(overlay.locator('.objective-why-drawer[data-for="completion:create"]')).toContainText('Flow violation');

    // A met objective has nothing to explain.
    const failures = overlay.locator('.report-objective[data-objective="failures"]');
    await expect(failures).toHaveClass(/\bmet\b/);
    await expect(failures.locator('.objective-why')).toHaveCount(0);

    // Why? toggles.
    await violations.locator('.objective-why').click();
    await expect(drawer).toBeHidden();
  });

  test('a capacity loss shows where requests were dropped', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    // The starter is correct but under capacity: it loses on completion
    // floors through drops, never violations.
    const overlay = await sandbox.runToReport();
    const objectives = await readObjectives(overlay);
    const missed = objectives.find((o) => o.id.startsWith('completion:') && !o.met)!;
    expect(missed).toBeDefined();

    const row = overlay.locator(`.report-objective[data-objective="${missed.id}"]`);
    await row.locator('.objective-why').click();
    const drawer = overlay.locator(`.objective-why-drawer[data-for="${missed.id}"]`);
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/dropped when it arrives at a component whose queue is full/i);
    const examples = drawer.locator('.why-example');
    await expect(examples).toHaveCount(3);
    await expect(examples.first()).toContainText('Dropped');
    await expect(examples.first()).toContainText(/queue full/i);
    await expect(drawer).not.toContainText('Flow violation');
  });
});
