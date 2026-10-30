import { expect, test } from './fixtures/test';
import { STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage } from './helpers/sandbox';

const STARTER = STARTER_PRESETS['url-shortener'];

test.describe('Sandbox board editing', () => {
  test('Reset clears the board and Starter restores the preset', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.reset();
    await expect(sandbox.belts).toHaveCount(0);
    await expect(sandbox.playButton).toBeDisabled();

    await sandbox.loadStarter();
    await expect(sandbox.components).toHaveCount(STARTER.components);
    await expect(sandbox.belts).toHaveCount(STARTER.belts);
    await expect(sandbox.playButton).toBeEnabled();
  });

  test('the same actions are available from the hamburger menu', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const menu = page.locator('#main-menu');
    await expect(menu).toBeHidden();
    await page.locator('#btn-menu').click();
    await expect(menu).toBeVisible();
    await page.locator('#menu-reset').click();
    await expect(menu).toBeHidden();
    await expect(sandbox.components).toHaveCount(0);

    await page.locator('#btn-menu').click();
    await page.locator('#menu-preset').click();
    await expect(sandbox.components).toHaveCount(STARTER.components);

    await page.locator('#btn-menu').click();
    await page.locator('#menu-challenge').click();
    await expect(page).toHaveURL(/\/challenges$/);
    await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible();
  });

  test('placing, selecting, deleting, undoing and redoing a component', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();

    const placed = await sandbox.placeComponent('redis', 800, 400);
    await expect(placed.locator('.component-name')).toHaveText('Redis Cache');
    // The new component is selected and the config palette opens for it.
    await expect(placed).toHaveClass(/selected/);
    await expect(sandbox.configPalette).toHaveClass(/open/);
    await expect(sandbox.configPalette.locator('.palette-selection')).toContainText('Redis Cache');
    // Placement returns to the hand tool.
    await expect(page.locator('.tool-btn[data-tool="hand"]')).toHaveClass(/active/);
    await expect(sandbox.panelItem('redis')).not.toHaveClass(/active/);

    await page.keyboard.press('Delete');
    await expect(sandbox.components).toHaveCount(0);

    await page.keyboard.press('Control+z');
    await expect(sandbox.components).toHaveCount(1);
    await expect(sandbox.components.first().locator('.component-name')).toHaveText('Redis Cache');

    await page.keyboard.press('Control+Shift+z');
    await expect(sandbox.components).toHaveCount(0);
  });

  test('Escape clears the selection and closes the palette', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const lb = sandbox.component('Load Balancer');
    await lb.click();
    await expect(lb).toHaveClass(/selected/);
    await expect(sandbox.configPalette).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(lb).not.toHaveClass(/selected/);
    await expect(sandbox.configPalette).not.toHaveClass(/open/);
  });

  test('dragging between ports connects valid hops and ignores invalid ones', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();

    const lb = await sandbox.placeComponent('load-balancer', 620, 336);
    const db = await sandbox.placeComponent('database', 1140, 336);

    // Source → database is not an allowed hop.
    await sandbox.connectFromSource(sandbox.port(db, 'in'));
    await expect(sandbox.belts).toHaveCount(0);

    // Source → load balancer is, dragging outward from the source port.
    await sandbox.connect(sandbox.sourcePort(), sandbox.port(lb, 'in'));
    await expect(sandbox.belts).toHaveCount(1);

    // Duplicate connections are collapsed.
    await sandbox.connectFromSource(sandbox.port(lb, 'in'));
    await expect(sandbox.belts).toHaveCount(1);

    // Load balancer → database skips the compute tier and is rejected,
    // whichever direction the drag goes.
    await sandbox.connect(sandbox.port(lb, 'out'), sandbox.port(db, 'in'));
    await sandbox.connect(sandbox.port(db, 'in'), sandbox.port(lb, 'out'));
    await expect(sandbox.belts).toHaveCount(1);

    // A service in between completes the chain.
    const service = await sandbox.placeComponent('backend-service', 880, 336);
    await sandbox.connect(sandbox.port(lb, 'out'), sandbox.port(service, 'in'));
    await sandbox.connect(sandbox.port(service, 'out'), sandbox.port(db, 'in'));
    await expect(sandbox.belts).toHaveCount(3);
  });

  test('dropping a configuration chip onto a matching component adds a badge', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();

    const db = await sandbox.placeComponent('database', 880, 336);
    await expect(sandbox.configPalette).toHaveClass(/open/);
    await expect(db.locator('.component-config-badges')).toHaveCount(0);

    await page.locator('[data-config-chip="db-sharding"]').dragTo(db);

    await expect(db.locator('.component-config-badges')).toHaveCount(1);
    await expect(db.locator('.component-config-badges')).not.toBeEmpty();

    // Undo removes the configuration again.
    await page.keyboard.press('Control+z');
    await expect(db.locator('.component-config-badges')).toHaveCount(0);
  });

  test('speed buttons are mutually exclusive', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await expect(page.locator('.speed-btn.active')).toHaveAttribute('data-speed', '1');
    await sandbox.setSpeed(20);
    await expect(page.locator('.speed-btn.active')).toHaveCount(1);
    await expect(page.locator('.speed-btn.active')).toHaveAttribute('data-speed', '20');
  });

  test('zoom controls update the zoom label', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const label = page.locator('#zoom-label');
    await expect(label).toHaveText('100%');
    await page.locator('#btn-zoom-in').click();
    await expect(label).toHaveText('115%');
    await page.locator('#btn-zoom-out').click();
    await page.locator('#btn-zoom-out').click();
    await expect(label).toHaveText('87%');
    await page.locator('#btn-zoom-reset').click();
    await expect(label).toHaveText('100%');
  });
});

test.describe('Sandbox simulation controls', () => {
  test('Play, Pause and Resume toggle the run and lock the board while running', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.playButton.click();
    await expect(sandbox.playButton).toHaveText('⏸ Pause');
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.hud).toContainText('RPS');
    await expect(sandbox.statusBar).toContainText('Simulation running');

    await sandbox.playButton.click();
    await expect(sandbox.playButton).toHaveText('▶ Resume');
    await expect(sandbox.statusBar).toHaveClass(/paused/);
    await expect(sandbox.statusBar).toContainText('Paused');

    // The board cannot be edited while a run is in progress.
    await page.keyboard.press('Delete');
    await expect(sandbox.components).toHaveCount(STARTER.components);

    await sandbox.playButton.click();
    await expect(sandbox.playButton).toHaveText('⏸ Pause');
    await expect(sandbox.statusBar).not.toHaveClass(/paused/);

    await page.locator('#btn-reset').click();
    expect(await sandbox.engineStatus()).toBe('idle');
    await expect(sandbox.components).toHaveCount(0);
  });

  test('the HUD counts time and completed requests while running', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.setSpeed(5);
    await sandbox.playButton.click();

    const time = sandbox.hud.locator('.hud-stat', { hasText: 'Time' }).locator('.hud-value');
    await expect(time).toContainText('/ 45s');
    await expect.poll(async () => parseFloat((await time.textContent()) ?? '0')).toBeGreaterThan(2);

    const done = sandbox.hud.locator('.hud-stat', { hasText: 'Done' }).locator('.hud-value');
    await expect.poll(async () => Number(((await done.textContent()) ?? '0').replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('traffic configuration panel opens with the scenario values and closes on Apply', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('dropbox');

    await page.locator('#btn-traffic').click();
    const panel = page.locator('#traffic-config-container');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#traffic-base-rps')).toHaveValue('300');
    await expect(panel.locator('#traffic-pattern')).toHaveValue('gradual');
    await expect(panel.locator('.request-type-row')).toHaveCount(3);

    await panel.locator('#traffic-base-rps').fill('500');
    await panel.locator('#traffic-apply').click();
    await expect(panel).toHaveCount(0);

    // Re-opening shows the applied value.
    await page.locator('#btn-traffic').click();
    await expect(page.locator('#traffic-base-rps')).toHaveValue('500');
    await page.locator('#traffic-close').click();
    await expect(page.locator('#traffic-config-container')).toHaveCount(0);
  });

  test('applied traffic configuration drives the simulation', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    const rps = sandbox.hud.locator('.hud-stat', { hasText: 'RPS' }).locator('.hud-value');
    const readRps = async () => Number(((await rps.textContent()) ?? '0').replace(/,/g, ''));

    // Five times the scenario's 200 RPS, with spikes disabled so the reading is steady.
    await page.locator('#btn-traffic').click();
    await page.locator('#traffic-base-rps').fill('1000');
    await page.locator('#traffic-spike-chance').fill('0');
    await page.locator('#traffic-apply').click();
    await expect(page.locator('#traffic-config-container')).toHaveCount(0);
    // Visible before Play: the board's problem frame reflects the override.
    await expect(page.locator('.board-problem-frame')).toContainText('1000 RPS base');

    await sandbox.setSpeed(5);
    await sandbox.playButton.click();
    await expect.poll(readRps, { timeout: 15_000 }).toBeGreaterThan(700);

    // The override survives a stop; Reset in the panel returns to the challenge defaults.
    await page.locator('#btn-reset').click();
    await sandbox.loadStarter();
    await page.locator('#btn-traffic').click();
    await expect(page.locator('#traffic-base-rps')).toHaveValue('1000');
    await page.locator('#traffic-reset').click();
    await expect(page.locator('#traffic-config-container')).toHaveCount(0);
    await expect(page.locator('.board-problem-frame')).toContainText('200 RPS base');

    await sandbox.playButton.click();
    await expect.poll(readRps, { timeout: 15_000 }).toBeGreaterThan(120);
    expect(await readRps()).toBeLessThan(350);
  });

  test('failure injection requires a running simulation and then lists board components', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const messages: string[] = [];
    page.once('dialog', (dialog) => {
      messages.push(dialog.message());
      void dialog.accept();
    });
    await page.locator('#btn-failure').click();
    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toContain('Start the simulation first');
    await expect(page.locator('#failure-injection-container')).toHaveCount(0);

    await sandbox.playButton.click();
    await page.locator('#btn-failure').click();
    const panel = page.locator('#failure-injection-container');
    await expect(panel).toBeVisible();
    // One option per component plus the placeholder.
    await expect(panel.locator('#failure-component option')).toHaveCount(STARTER.components + 1);

    await panel.locator('#failure-component').selectOption({ label: 'Redis Cache (redis)' });
    await panel.locator('#failure-type').selectOption('shutdown');
    await panel.locator('#failure-inject').click();
    await expect(panel).toHaveCount(0);
    await expect(sandbox.statusBar).toContainText('Redis Cache has shut down');
  });
});

test.describe('Sandbox board editing (continued)', () => {
  test('scaling chips apply to backend-defined compute services', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const service = sandbox.component('Backend Service');
    await service.click();
    await expect(sandbox.configPalette).toHaveClass(/open/);

    await page.locator('[data-config-chip="horizontal-scaling"]').dragTo(service);
    await expect(service.locator('.component-config-badges')).toContainText('H-scale');
  });

  test('Play becomes enabled once a component is placed on an empty board', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();
    await expect(sandbox.playButton).toBeDisabled();

    const lb = await sandbox.placeComponent('load-balancer', 620, 336);
    await expect(sandbox.playButton).toBeEnabled();

    await sandbox.connectFromSource(sandbox.port(lb, 'in'));
    await expect(sandbox.belts).toHaveCount(1);
    await expect(sandbox.playButton).toBeEnabled();
  });

  test('deleting the selected component closes the config palette', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.reset();
    await sandbox.placeComponent('redis', 800, 400);
    await expect(sandbox.configPalette).toHaveClass(/open/);

    await page.keyboard.press('Delete');
    await expect(sandbox.components).toHaveCount(0);
    await expect(sandbox.configPalette).not.toHaveClass(/open/);
  });
});
