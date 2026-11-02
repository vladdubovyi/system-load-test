import { expect, test } from './fixtures/test';
import { SandboxPage } from './helpers/sandbox';

/**
 * Flow correctness, Phase 3 (docs/specs/flow-correctness.md §7): design-time
 * lint and UX. Pressing Play runs a static check of the board against the
 * scenario's flow specs; problems are shown in a lint panel as warnings while
 * the run proceeds. Invalid connections explain themselves with a toast
 * instead of failing silently, and a traced request that violates its flow
 * shows the violation reason in the inspector.
 */
test.describe('Design lint on Play', () => {
  test('a design missing its durable store is flagged, and the run still proceeds', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    await sandbox.playButton.click();

    // Warnings, not a blocker: the panel is up while the simulation runs.
    await expect(sandbox.lintPanel).toBeVisible();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.playButton).toHaveText('⏸ Pause');

    // Creates have no durable store anywhere; reads dead-end on a cache miss
    // because Redis lost its onward belt. Both flows are reported.
    await expect(sandbox.lintPanel).toContainText('durable store');
    await expect(sandbox.lintIssues.filter({ hasText: 'create' }).first()).toBeVisible();
    await expect(sandbox.lintIssues.filter({ hasText: 'read' }).first()).toBeVisible();
    // The cache-miss issue points at the component where the flow gets stuck.
    await expect(sandbox.lintPanel).toContainText('Redis Cache');

    // The panel can be dismissed without stopping the run.
    await sandbox.lintPanel.locator('.lint-close').click();
    await expect(sandbox.lintPanel).toHaveCount(0);
    expect(await sandbox.engineStatus()).toBe('running');
  });

  test('clean starter designs produce no lint warnings', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.playButton.click();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.lintPanel).toHaveCount(0);
  });

  test('the Instagram starter (branches and an edge cache) lints clean too', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('instagram-feed');
    await sandbox.playButton.click();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.lintPanel).toHaveCount(0);
  });

  test('removing the optional cache is not a lint issue', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('Redis Cache');
    await sandbox.playButton.click();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.lintPanel).toHaveCount(0);
  });

  test('warnings from a previous run do not stick to the next clean one', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');
    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();

    // Stop the run, restore the full starter, and play again: no panel.
    await page.locator('#btn-reset').click();
    await sandbox.loadStarter();
    await sandbox.playButton.click();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.lintPanel).toHaveCount(0);
  });

  test('a second ingress that leads nowhere is flagged', async ({ page }) => {
    // Every wire out of the source carries traffic, so an extra load balancer
    // with no onward belt strands every request it receives.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    const extra = await sandbox.placeComponent('load-balancer', 520, 500);
    await sandbox.connectFromSource(sandbox.port(extra, 'in'));

    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintPanel).toContainText('compute service');
    await expect(sandbox.lintPanel).toContainText('nothing is connected');
  });
});

test.describe('Rejected connections', () => {
  test('an invalid wire shows a toast explaining the rule; a valid wire clears it', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();

    const lb = await sandbox.placeComponent('load-balancer', 620, 336);
    const db = await sandbox.placeComponent('database', 1140, 336);

    // Source → database is not an allowed hop: toast names the ingress rule.
    await sandbox.connectFromSource(sandbox.port(db, 'in'));
    await expect(sandbox.belts).toHaveCount(0);
    await expect(sandbox.boardToast).toBeVisible();
    await expect(sandbox.boardToast).toContainText(/load balancer|gateway/i);

    // Load balancer → database skips the compute tier.
    await sandbox.connect(sandbox.port(lb, 'out'), sandbox.port(db, 'in'));
    await expect(sandbox.belts).toHaveCount(0);
    await expect(sandbox.boardToast).toBeVisible();
    await expect(sandbox.boardToast).toContainText(/compute/i);

    // A valid connection succeeds and dismisses the stale explanation.
    await sandbox.connectFromSource(sandbox.port(lb, 'in'));
    await expect(sandbox.belts).toHaveCount(1);
    await expect(sandbox.boardToast).toHaveCount(0);
  });
});

test.describe('Request inspector violation reasons', () => {
  test('a traced request that violates its flow explains why in the timeline', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    // No storage at all: every create and every read must violate at the
    // service tier (no durable store reachable).
    await sandbox.deleteComponent('SQL Database');
    await sandbox.deleteComponent('Redis Cache');

    await sandbox.setSpeed(5);
    await sandbox.playButton.click();
    await sandbox.traceAnyActiveRequest();

    await expect(sandbox.requestInspector).toBeVisible();
    // The traced request reaches a service, cannot take its next required
    // step, and the inspector shows the violation end node with the reason.
    await expect(sandbox.requestInspector).toContainText('Flow violation', { timeout: 20_000 });
    await expect(sandbox.requestInspector.locator('.ri-node-end')).toContainText('durable store');
    await expect(sandbox.requestInspector.locator('.ri-node-end')).toContainText('nothing is connected');
  });
});
