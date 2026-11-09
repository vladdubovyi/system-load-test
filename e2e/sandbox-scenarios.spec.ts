import { expect, test } from './fixtures/test';
import { CHALLENGES, COMPONENT_DEFINITIONS, STARTER_PRESETS } from './fixtures/api-data';
import { SandboxPage, readReport } from './helpers/sandbox';
import type { Locator } from '@playwright/test';

// A full run takes ~3s on an idle machine, but the 100x loop is CPU-bound and
// slows down sharply when the host is busy. Give these tests extra headroom.
test.describe.configure({ timeout: 120_000 });

function completedStat(overlay: Locator): Locator {
  return overlay.locator('.report-stat-card', { hasText: 'Completed' }).locator('.report-stat-value');
}

/**
 * Sample scenario runs: every seeded challenge is opened in the sandbox, its
 * starter architecture is verified, and a full simulation is run at 100x
 * speed. The starter presets are provisioned to survive, so the end-of-run
 * report must say "Architecture survived".
 */
for (const challenge of CHALLENGES) {
  const starter = STARTER_PRESETS[challenge.slug];

  test.describe(`Scenario: ${challenge.name}`, () => {
    test('opens with the challenge starter architecture and scenario details', async ({ page }) => {
      const sandbox = new SandboxPage(page);
      await sandbox.goto(challenge.slug);

      await expect(page).toHaveTitle(`Sandbox: ${challenge.slug} — BreakIT`);
      await expect(sandbox.title).toHaveText(challenge.name);
      await expect(sandbox.hud).toContainText(challenge.name);
      await expect(sandbox.hud).toContainText(`${challenge.scenario.durationSeconds}s`);
      await expect(sandbox.statusBar).toContainText('press Play');

      await expect(sandbox.components).toHaveCount(starter.components);
      await expect(sandbox.belts).toHaveCount(starter.belts);
      const labels = await sandbox.components.locator('.component-name').allTextContents();
      expect(labels.sort()).toEqual([...starter.labels].sort());

      // The problem frame on the board describes the active scenario.
      const frame = page.locator('.board-problem-frame');
      await expect(frame).toContainText(challenge.name);
      for (const requirement of challenge.scenario.scenarioConfig.requirements as string[]) {
        await expect(frame).toContainText(requirement);
      }

      await expect(sandbox.playButton).toBeEnabled();
      await expect(sandbox.playButton).toHaveText('▶ Play');
    });

    test('component library highlights the components this challenge expects', async ({ page }) => {
      const sandbox = new SandboxPage(page);
      await sandbox.goto(challenge.slug);

      const items = page.locator('.components-panel-item');
      await expect(items).toHaveCount(COMPONENT_DEFINITIONS.length);

      for (const type of challenge.allowedComponents) {
        await expect(sandbox.panelItem(type)).not.toHaveClass(/is-optional/);
      }
      const notRequired = COMPONENT_DEFINITIONS.filter((d) => !challenge.allowedComponents.includes(d.componentType));
      expect(notRequired.length).toBeGreaterThan(0);
      for (const def of notRequired) {
        await expect(sandbox.panelItem(def.componentType)).toHaveClass(/is-optional/);
      }
    });

    test('starter architecture survives the full traffic run but misses its objectives', async ({ page }) => {
      const sandbox = new SandboxPage(page);
      await sandbox.goto(challenge.slug);

      const overlay = await sandbox.runToReport();
      const report = await readReport(overlay);

      // Every component stays healthy, but the starter is not a passing
      // answer (docs/specs/interview-platform.md §8): the run is judged lost
      // on its completion objectives, and the report says so without
      // calling the architecture "failed".
      expect(report.title).toBe('Survived, objectives missed');
      expect(report.brokenServices).toEqual([]);
      expect(report.score).toBeGreaterThan(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(report.grade).toMatch(/^[A-F][+-]?$/);
      expect(report.componentRows).toBeGreaterThanOrEqual(starter.components);
      await expect(overlay.locator('.report-header')).toHaveClass(/lost/);
      await expect(completedStat(overlay)).not.toHaveText('0');
      expect(report.successRate).toBeGreaterThan(0);

      expect(await sandbox.engineStatus()).toBe('lost');
      await expect(sandbox.statusBar).toHaveClass(/lost/);
      await expect(sandbox.statusBar).toContainText('survived');
      await expect(sandbox.statusBar).toContainText('missed');

      await overlay.locator('#report-dismiss').click();
      await expect(sandbox.reportOverlay).toHaveCount(0);
      await expect(sandbox.playButton).toHaveText('▶ Play');
    });
  });
}

test.describe('Scenario: under-provisioned design', () => {
  test('dropping the cache and the tuned database from the starter overloads the database', async ({ page }) => {
    // Start from the URL shortener starter and reshape it into
    // LB → Backend Service → (fresh, unconfigured) SQL Database:
    // no Redis, no replication/sharding. Every read now hits a 140 RPS
    // database with 200 RPS of traffic, so it must overload and fail.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    for (const label of ['Redis Cache', 'Microservice', 'SQL Database']) {
      const node = sandbox.component(label);
      await node.click();
      await expect(node).toHaveClass(/selected/);
      await page.keyboard.press('Delete');
      await expect(node).toHaveCount(0);
    }
    await expect(sandbox.components).toHaveCount(2);
    await expect(sandbox.belts).toHaveCount(2);

    const service = sandbox.component('Backend Service');
    const db = await sandbox.placeComponent('database', 1100, 432);
    await expect(db.locator('.component-config-badges')).toHaveCount(0);
    await sandbox.connect(sandbox.port(service, 'out'), sandbox.port(db, 'in'));
    await expect(sandbox.belts).toHaveCount(3);
    expect((await sandbox.componentTypes()).sort()).toEqual(['backend-service', 'database', 'load-balancer']);

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    expect(report.title).toBe('Architecture failed');
    expect(report.brokenServices).toEqual(['🗄️ SQL Database']);
    await expect(overlay.locator('.report-header')).toHaveClass(/lost/);
    expect(await sandbox.engineStatus()).toBe('lost');
    await expect(sandbox.statusBar).toHaveClass(/lost/);
    await expect(sandbox.statusBar).toContainText('SQL Database overloaded and failed!');
  });

  test('"Run again" from the report restarts the same board', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('rate-limiter');

    const overlay = await sandbox.runToReport();
    await overlay.locator('#report-replay').click();
    await expect(sandbox.reportOverlay).toHaveCount(0);

    // A new run begins (status goes back to running) and ends with a fresh report.
    await expect(sandbox.playButton).toHaveText('⏸ Pause');
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });
    await expect(sandbox.components).toHaveCount(STARTER_PRESETS['rate-limiter'].components);
  });
});

test.describe('Scenario: backend unavailable', () => {
  test('falls back to the built-in URL shortener challenge and legacy component library', async ({ page, api }) => {
    await api.unavailable();
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await expect(sandbox.title).toHaveText('URL Shortener');
    await expect(sandbox.hud).toContainText('45s');
    await expect(page.locator('.components-panel-item')).toHaveCount(5);
    await expect(sandbox.panelItem('shortener')).toContainText('Shortener Service');
    await expect(sandbox.components).toHaveCount(5);

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);
    // The offline board is the legacy reference preset, outside the §8
    // calibration; what this test guards is that it loads and runs clean.
    expect(['Architecture survived', 'Survived, objectives missed']).toContain(report.title);
    expect(report.brokenServices).toEqual([]);
  });

  test('/sandbox without a slug defaults to the URL shortener', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto();
    await expect(page).toHaveTitle('Sandbox — BreakIT');
    await expect(sandbox.title).toHaveText('URL Shortener');
    await expect(sandbox.components).toHaveCount(STARTER_PRESETS['url-shortener'].components);
  });

  test('an unknown slug falls back to the URL shortener challenge', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('no-such-challenge');
    await expect(sandbox.title).toHaveText('URL Shortener');
  });
});
