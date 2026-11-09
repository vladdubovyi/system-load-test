import { expect, test } from './fixtures/test';
import { SandboxPage, readReport } from './helpers/sandbox';

// Full runs at 100x are CPU-bound; give them the same headroom as the
// scenario suite.
test.describe.configure({ timeout: 120_000 });

/**
 * Flow correctness (docs/specs/flow-correctness.md, Phase 2): the URL
 * shortener challenge validates that requests execute their declared flow —
 * creates must reach a durable store, reads may be served by the cache but a
 * miss must chain through to the database. A request that cannot take its
 * next required step terminates as a flow violation instead of counting as a
 * success.
 */
test.describe('Flow correctness: Instagram feed', () => {
  test('the CDN serves hot feed loads instead of dead-ending them', async ({ page }) => {
    // Historically the starter CDN had no outgoing wire and silently swallowed
    // every request routed to it (~75% of traffic dropped). With feed flows
    // the CDN is an edge cache: it completes hot feed loads, forwards misses
    // to the service, and writes bypass it entirely.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('instagram-feed');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    // Correct (nothing violated, nothing broke) but, like every starter,
    // short of its completion floors (interview-platform.md §8).
    expect(report.title).toBe('Survived, objectives missed');
    expect(report.brokenServices).toEqual([]);
    expect(report.successRate).toBeGreaterThan(80);

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBe(0);
    expect(totals.completedByKind['feedLoad'] ?? 0).toBeGreaterThan(0);
    expect(totals.completedByKind['post'] ?? 0).toBeGreaterThan(0);
    expect(totals.completedByKind['like'] ?? 0).toBeGreaterThan(0);
  });

  test('writes cannot be faked by the caches: no durable store means violated posts', async ({ page }) => {
    // Delete both durable stores. Feed loads served from the CDN or Redis
    // still complete, but every post/like (and every cache miss) must die as
    // a flow violation instead of silently succeeding somewhere volatile.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('instagram-feed');
    await sandbox.deleteComponent('NoSQL Database');
    await sandbox.deleteComponent('Object Storage');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    // Since Phase 4 the violation ceiling is an objective, so a design that
    // cannot persist writes loses the run — but on correctness, not on
    // survival: nothing overloaded or broke.
    expect(report.title).toBe('Architecture failed');
    expect(report.brokenServices).toEqual([]);

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBeGreaterThan(0);
    expect(totals.completedByKind['feedLoad'] ?? 0).toBeGreaterThan(0);
    expect(totals.completedByKind['post'] ?? 0).toBe(0);
    expect(totals.completedByKind['like'] ?? 0).toBe(0);
  });
});

test.describe('Flow correctness: URL shortener', () => {
  test('starter design completes both request kinds without flow violations', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    // The unconfigured starter sheds some spike traffic as drops, so it
    // misses its completion floors (interview-platform.md §8); what matters
    // here is that nothing is *violated* — every surviving request takes
    // its required path — and nothing breaks.
    expect(report.title).toBe('Survived, objectives missed');
    expect(report.brokenServices).toEqual([]);
    expect(report.successRate).toBeGreaterThan(50);

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBe(0);
    expect(totals.completed).toBeGreaterThan(0);
    // Both request kinds flow end to end: creates persist, reads resolve.
    expect(totals.completedByKind['create'] ?? 0).toBeGreaterThan(0);
    expect(totals.completedByKind['read'] ?? 0).toBeGreaterThan(0);
  });

  test('a cache cannot stand in for the database: cache-only designs violate instead of completing', async ({ page }) => {
    // Remove the SQL Database so Redis is the only "storage" left. Before
    // flow correctness this design scored near-100%: creates and cache
    // misses silently completed in Redis. Now every create (no durable store
    // reachable) and every cache miss (no onward path from Redis) must die
    // as a flow violation, while cache hits still succeed.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    // Violations fail requests outright; since Phase 4 they also fail the
    // run's violation objective. Nothing overloads, so the loss is a
    // correctness verdict rather than a crash.
    expect(report.title).toBe('Architecture failed');
    expect(await sandbox.engineStatus()).toBe('lost');
    expect(report.brokenServices).toEqual([]);

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBeGreaterThan(0);
    // Reads served from the cache still complete…
    expect(totals.completedByKind['read'] ?? 0).toBeGreaterThan(0);
    // …but creates can never be persisted.
    expect(totals.completedByKind['create'] ?? 0).toBe(0);
    // The success rate exposes the gap instead of reporting ~100%.
    expect(report.successRate).toBeLessThan(85);
    expect(report.successRate).toBeGreaterThan(0);
  });

  test('a design without a cache is correct: every request flows through the database', async ({ page }) => {
    // The cache is optional in the flow spec. Removing Redis must not cause
    // violations — reads simply take the direct database path.
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('Redis Cache');

    const overlay = await sandbox.runToReport();
    const report = await readReport(overlay);

    // Without the cache the compute tier sheds some spike traffic as drops
    // (that is the point of the cache), so the floors are missed — but
    // nothing may be *violated* and nothing breaks.
    expect(report.title).toBe('Survived, objectives missed');
    expect(report.brokenServices).toEqual([]);
    expect(report.successRate).toBeGreaterThan(50);

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBe(0);
    expect(totals.completedByKind['create'] ?? 0).toBeGreaterThan(0);
    expect(totals.completedByKind['read'] ?? 0).toBeGreaterThan(0);
  });
});
