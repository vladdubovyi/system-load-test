import { expect, test } from './fixtures/test';
import { CHALLENGES } from './fixtures/api-data';
import { SandboxPage, readFlowStats, readObjectives, readReport } from './helpers/sandbox';

// Full runs at 100x are CPU-bound; same headroom as the other run suites.
test.describe.configure({ timeout: 120_000 });

/**
 * Objectives and reporting (docs/specs/flow-correctness.md, Phase 4).
 *
 * A run is won when the design *survives* and *meets its objectives*:
 * per-kind completion floors, a violation ceiling, and no component
 * failures. The report explains each objective with the measured value and,
 * when one fails, the dominant cause — the flow step most requests died on,
 * or the component dropping them.
 */
test.describe('Objectives: URL shortener', () => {
  test('the starter design meets every objective and the report lists them', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);
    expect(report.title).toBe('Architecture survived');
    expect(await sandbox.engineStatus()).toBe('won');

    const objectives = await readObjectives(overlay);
    // Three objectives for this scenario: completion per kind, violations, failures.
    expect(objectives.length).toBeGreaterThanOrEqual(3);
    expect(objectives.every((o) => o.met)).toBe(true);
    expect(objectives.map((o) => o.id)).toEqual(
      expect.arrayContaining(['completion:create', 'completion:read', 'violations', 'failures'])
    );
    // A met objective states its measured value and offers no cause.
    const violations = objectives.find((o) => o.id === 'violations')!;
    expect(violations.actual).toContain('0');
    expect(violations.cause).toBe('');

    await expect(overlay.locator('#report-objectives')).toContainText('Objectives met');
  });

  test('per-flow statistics break the run down by request kind', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const overlay = await sandbox.runToReport();
    const stats = await readFlowStats(overlay);

    expect(stats.map((s) => s.kind).sort()).toEqual(['create', 'read']);
    for (const row of stats) {
      expect(row.spawned).toBeGreaterThan(0);
      expect(row.completed).toBeGreaterThan(0);
      expect(row.violated).toBe(0);
      // Every spawned request ends up accounted for in exactly one bucket.
      expect(row.completed + row.dropped + row.violated).toBeLessThanOrEqual(row.spawned);
    }
  });

  test('a cache-only design loses on objectives and the report names the cause', async ({ page }) => {
    // Deleting the database leaves Redis as the only store. Creates can never
    // be persisted and cache misses dead-end, so the violation objective
    // fails — the run is lost even though nothing overloaded.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    expect(report.title).toBe('Architecture failed');
    expect(await sandbox.engineStatus()).toBe('lost');
    // Lost on correctness, not on survival: no component broke.
    expect(report.brokenServices).toEqual([]);

    const objectives = await readObjectives(overlay);
    const violations = objectives.find((o) => o.id === 'violations')!;
    expect(violations.met).toBe(false);
    // The dominant cause points at the flow step requests died on.
    expect(violations.cause).toContain('create');
    expect(violations.cause.toLowerCase()).toContain('persist');

    const creates = objectives.find((o) => o.id === 'completion:create')!;
    expect(creates.met).toBe(false);
    expect(creates.actual).toContain('0');

    // The survival objective still passed, and says so.
    expect(objectives.find((o) => o.id === 'failures')!.met).toBe(true);

    const stats = await readFlowStats(overlay);
    expect(stats.find((s) => s.kind === 'create')!.completed).toBe(0);
    expect(stats.find((s) => s.kind === 'create')!.violated).toBeGreaterThan(0);
    expect(stats.find((s) => s.kind === 'read')!.completed).toBeGreaterThan(0);
  });

  test('the status bar explains an objective loss differently from a crash', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    const overlay = await sandbox.runToReport();
    await overlay.locator('#report-dismiss').click();

    await expect(sandbox.statusBar).toHaveClass(/lost/);
    await expect(sandbox.statusBar).toContainText('objective');
    // Nothing failed under load, so it must not claim an overload.
    await expect(sandbox.statusBar).not.toContainText('overloaded');
  });
});

test.describe('Objectives: scenarios without flows', () => {
  test('a challenge with no flows is still judged on survival alone', async ({ page, api }) => {
    // Every seeded challenge carries flows since Phase 5, so model a
    // not-yet-authored challenge from the API: no flows, no objectives, and a
    // slug with no built-in preset. The only win condition is the legacy
    // one, and the fallback board passes it.
    const template = CHALLENGES.find((c) => c.slug === 'rate-limiter')!;
    await api.install({
      challenges: [
        ...CHALLENGES,
        {
          ...template,
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Legacy Service',
          slug: 'legacy-service',
          scenario: {
            ...template.scenario,
            id: 'sc-legacy-service',
            scenarioConfig: { ...template.scenario.scenarioConfig, requestTypes: { check: 1 } },
          },
        },
      ],
    });
    const sandbox = new SandboxPage(page);
    await sandbox.goto('legacy-service');
    await expect(sandbox.title).toHaveText('Legacy Service');

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    // No flows means nothing to lint.
    await expect(sandbox.lintPanel).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const report = await readReport(sandbox.reportOverlay);
    expect(report.title).toBe('Architecture survived');
    expect(await sandbox.engineStatus()).toBe('won');

    const objectives = await readObjectives(sandbox.reportOverlay);
    expect(objectives.map((o) => o.id)).toEqual(['failures']);
    expect(objectives[0].met).toBe(true);
  });
});

test.describe('Objectives: Instagram feed', () => {
  test('losing both durable stores fails the write objectives', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('instagram-feed');
    await sandbox.deleteComponent('NoSQL Database');
    await sandbox.deleteComponent('Object Storage');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    expect(report.title).toBe('Architecture failed');
    expect(await sandbox.engineStatus()).toBe('lost');

    const objectives = await readObjectives(overlay);
    expect(objectives.find((o) => o.id === 'violations')!.met).toBe(false);
    expect(objectives.find((o) => o.id === 'completion:post')!.met).toBe(false);
    // Feed loads are served by the CDN and keep meeting their floor.
    expect(objectives.find((o) => o.id === 'completion:feedLoad')!.met).toBe(true);
  });
});
