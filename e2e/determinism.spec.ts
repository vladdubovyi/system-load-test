import { expect, test } from './fixtures/test';
import { SandboxPage, readFlowStats, readObjectives, readReport, type ReportSummary } from './helpers/sandbox';

// Full runs at 100x are CPU-bound; same headroom as the other run suites.
test.describe.configure({ timeout: 120_000 });

/**
 * Seeded determinism (docs/specs/interview-platform.md §8). Every run is
 * generated from a seed the report shows; the same seed on the same board
 * reproduces the run exactly, and a seed can be pinned through the URL so a
 * bug report or a comparison is reproducible.
 */

/** Everything the user can read off the report that depends on the traffic. */
async function readOutcome(sandbox: SandboxPage): Promise<{
  report: ReportSummary;
  flows: { kind: string; spawned: number; completed: number; dropped: number; violated: number }[];
  objectives: { id: string; actual: string; met: boolean }[];
  completed: string;
  peakRps: string;
  spikes: string;
}> {
  const overlay = sandbox.reportOverlay;
  const stat = (label: string) =>
    overlay.locator('.report-stat-card', { hasText: label }).locator('.report-stat-value').textContent();
  return {
    report: await readReport(overlay),
    flows: await readFlowStats(overlay),
    objectives: (await readObjectives(overlay)).map(({ id, actual, met }) => ({ id, actual, met })),
    completed: (await stat('Completed')) ?? '',
    peakRps: (await stat('Peak RPS')) ?? '',
    spikes: (await stat('Traffic spikes')) ?? '',
  };
}

test.describe('Seeded runs', () => {
  test('the report shows the seed, and "Replay same traffic" reproduces the run exactly', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('rate-limiter');

    await sandbox.runToReport();
    const first = await readOutcome(sandbox);
    expect(first.report.seed).toBeGreaterThan(0);
    expect(first.flows.length).toBeGreaterThan(0);

    await sandbox.reportOverlay.locator('#report-replay-seed').click();
    await expect(sandbox.reportOverlay).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const second = await readOutcome(sandbox);
    expect(second.report.seed).toBe(first.report.seed);
    expect(second).toEqual(first);
  });

  test('"Run again" draws a fresh seed and so a different run', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('rate-limiter');

    await sandbox.runToReport();
    const first = await readOutcome(sandbox);

    await sandbox.reportOverlay.locator('#report-replay').click();
    await expect(sandbox.reportOverlay).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const second = await readOutcome(sandbox);
    expect(second.report.seed).not.toBe(first.report.seed);
    // Spawn counts follow the jittered traffic curve, so two seeds disagree.
    expect(second.flows.map((f) => f.spawned)).not.toEqual(first.flows.map((f) => f.spawned));
  });

  test('a seed in the URL pins the traffic: two fresh loads produce the identical report', async ({ page }) => {
    const sandbox = new SandboxPage(page);

    await sandbox.goto('url-shortener', { seed: 4242 });
    await sandbox.runToReport();
    const first = await readOutcome(sandbox);
    expect(first.report.seed).toBe(4242);

    await sandbox.goto('url-shortener', { seed: 4242 });
    await sandbox.runToReport();
    const second = await readOutcome(sandbox);
    expect(second).toEqual(first);
  });

  test('with a pinned seed, "Run again" keeps it', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('rate-limiter', { seed: 7 });

    await sandbox.runToReport();
    const first = await readOutcome(sandbox);
    expect(first.report.seed).toBe(7);

    await sandbox.reportOverlay.locator('#report-replay').click();
    await expect(sandbox.reportOverlay).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const second = await readOutcome(sandbox);
    expect(second).toEqual(first);
  });

  test('a different pinned seed gives a different run on the same board', async ({ page }) => {
    const sandbox = new SandboxPage(page);

    await sandbox.goto('rate-limiter', { seed: 1 });
    await sandbox.runToReport();
    const first = await readOutcome(sandbox);

    await sandbox.goto('rate-limiter', { seed: 2 });
    await sandbox.runToReport();
    const second = await readOutcome(sandbox);

    expect(second.report.seed).toBe(2);
    expect(second.flows.map((f) => f.spawned)).not.toEqual(first.flows.map((f) => f.spawned));
  });
});
