import { expect, test } from './fixtures/test';
import { CHALLENGES, COMPONENT_DEFINITIONS, TEST_TOKEN, TEST_USER, type ApiChallenge } from './fixtures/api-data';
import {
  SandboxPage,
  readFlowStats,
  readObjectives,
  readReport,
  signInBeforeLoad,
} from './helpers/sandbox';

// Full runs at 100x are CPU-bound; same headroom as the other run suites.
test.describe.configure({ timeout: 120_000 });

/**
 * Flow authoring and serialization (docs/specs/flow-authoring.md, Phase 5).
 *
 * Flows, objectives and tags travel inside the challenge's scenarioConfig
 * from the backend; the sandbox exposes a scenario editor that validates,
 * applies and saves that document; scenario-defined tags let a flow single
 * out one component among several of the same type; and every seeded
 * challenge now carries flows so the engine has no heuristic fallback left.
 */

/** Clone a canned challenge with extra scenarioConfig keys. */
function challengeWithConfig(slug: string, extra: Record<string, unknown>): ApiChallenge[] {
  return CHALLENGES.map((c) =>
    c.slug === slug
      ? {
          ...c,
          scenario: {
            ...c.scenario,
            scenarioConfig: { ...c.scenario.scenarioConfig, ...extra },
          },
        }
      : c
  );
}

const TAGGED_CREATE_FLOW = {
  kind: 'create',
  steps: [
    { id: 'ingress', require: { capability: 'ingress' } },
    { id: 'service', require: { tag: 'write-service' }, label: 'Write service' },
    { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
  ],
};

const WRITE_SERVICE_TAG = {
  id: 'write-service',
  label: 'Write service',
  description: 'The compute tier that handles creates',
  appliesTo: { capability: 'compute' },
};

test.describe('Scenario editor', () => {
  test('opens with the challenge document and rejects invalid JSON without applying it', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    const doc = await sandbox.scenarioDocument();
    expect(Object.keys(doc).sort()).toEqual(['flows', 'objectives', 'requestTypes', 'tags']);
    const flows = doc.flows as { kind: string }[];
    expect(flows.map((f) => f.kind).sort()).toEqual(['create', 'read']);
    expect(doc.requestTypes).toEqual({ read: 0.72, create: 0.28 });

    await sandbox.setScenarioDocument('{ "flows": [ this is not json');
    await page.locator('#scenario-apply').click();
    await expect(sandbox.scenarioErrors.first()).toBeVisible();
    await expect(sandbox.scenarioErrors.first()).toContainText(/JSON/i);
    // Still open: nothing was applied.
    await expect(sandbox.scenarioEditor).toBeVisible();

    // Structural problems are reported by name, not swallowed.
    await sandbox.setScenarioDocument({
      ...doc,
      flows: [{ kind: 'create', steps: [{ id: 'x', require: {} }] }],
    });
    await page.locator('#scenario-validate').click();
    await expect(sandbox.scenarioErrors.filter({ hasText: 'empty selector' })).toHaveCount(1);
    await expect(sandbox.scenarioErrors.filter({ hasText: 'read' })).toHaveCount(1);
  });

  test('a tag step is flagged until the role chip is dropped on a component, then the run completes', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    const doc = await sandbox.scenarioDocument();
    const flows = doc.flows as { kind: string }[];
    await sandbox.setScenarioDocument({
      ...doc,
      tags: [WRITE_SERVICE_TAG],
      flows: [TAGGED_CREATE_FLOW, ...flows.filter((f) => f.kind === 'read')],
    });
    await page.locator('#scenario-apply').click();
    await expect(sandbox.scenarioEditor).toHaveCount(0);

    // Nothing carries the tag yet: lint says what is missing and where.
    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintPanel).toContainText('tagged "Write service"');
    await expect(sandbox.lintPanel).toContainText('Load Balancer');

    // Back to editing: the board is restored but the applied scenario stays.
    await page.locator('#btn-reset').click();
    await sandbox.loadStarter();
    await expect(sandbox.lintPanel).toHaveCount(0);

    const writes = sandbox.component('Microservice');
    await writes.click();
    await expect(sandbox.configPalette).toHaveClass(/open/);
    await expect(sandbox.tagChip('write-service')).toBeVisible();

    // The role only applies to compute: dropping it on the database is refused.
    const db = sandbox.component('SQL Database');
    await sandbox.tagChip('write-service').dragTo(db);
    await expect(sandbox.boardToast).toBeVisible();
    await expect(sandbox.boardToast).toContainText('Write service');
    await expect(db.locator('.component-tag-badge')).toHaveCount(0);

    await sandbox.tagChip('write-service').dragTo(writes);
    await expect(writes.locator('.component-tag-badge')).toHaveText(/Write service/);

    // Undo and redo treat the tag like any other board edit.
    await page.keyboard.press('Control+z');
    await expect(writes.locator('.component-tag-badge')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(writes.locator('.component-tag-badge')).toHaveCount(1);

    const overlay = await sandbox.runToReport();
    await expect(sandbox.lintPanel).toHaveCount(0);
    const report = await readReport(overlay);
    expect(report.title).toBe('Architecture survived');

    const totals = await sandbox.flowTotals();
    expect(totals.violated).toBe(0);
    expect(totals.completedByKind['create'] ?? 0).toBeGreaterThan(0);
  });

  test('Reset returns to the challenge definition', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({ ...doc, requestTypes: { read: 0.5, create: 0.5 } });
    await page.locator('#scenario-apply').click();

    await sandbox.openScenarioEditor();
    expect((await sandbox.scenarioDocument()).requestTypes).toEqual({ read: 0.5, create: 0.5 });
    await page.locator('#scenario-reset').click();

    await sandbox.openScenarioEditor();
    expect((await sandbox.scenarioDocument()).requestTypes).toEqual({ read: 0.72, create: 0.28 });
  });

  test('Save is disabled when signed out', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    await expect(page.locator('#scenario-save')).toBeDisabled();
    await expect(page.locator('.scenario-save-hint')).toContainText(/sign in/i);
  });

  test('Save sends the document to the authoring endpoint when signed in', async ({ page, api }) => {
    await signInBeforeLoad(page, TEST_TOKEN, TEST_USER);
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    await expect(page.locator('#scenario-save')).toBeEnabled();
    const doc = await sandbox.scenarioDocument();
    await sandbox.setScenarioDocument({ ...doc, tags: [WRITE_SERVICE_TAG] });
    await page.locator('#scenario-save').click();

    await expect(sandbox.boardToast).toContainText(/saved/i);
    const puts = api.calls('/api/challenges/slug/url-shortener/scenario-config', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].headers['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    const body = puts[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['flows', 'objectives', 'requestTypes', 'tags']);
    expect(body.tags).toEqual([WRITE_SERVICE_TAG]);
    expect(Array.isArray(body.flows)).toBe(true);
  });

  test('an invalid document is never sent', async ({ page, api }) => {
    await signInBeforeLoad(page, TEST_TOKEN, TEST_USER);
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.openScenarioEditor();

    await sandbox.setScenarioDocument({ flows: [{ kind: 'create', steps: [] }] });
    await page.locator('#scenario-save').click();
    await expect(sandbox.scenarioErrors.first()).toBeVisible();
    expect(api.calls('/api/challenges/slug/url-shortener/scenario-config', 'PUT')).toHaveLength(0);
  });
});

test.describe('Backend-supplied definitions', () => {
  test('flows in scenarioConfig drive the lint and the run instead of the built-in preset', async ({ page, api }) => {
    // A deliberately different create flow: straight from the ingress to a
    // durable store, no compute tier. The starter wires the load balancer to
    // services only, so this flow is unsatisfiable — which proves the engine
    // is using the API's flows, not the preset's.
    await api.install({
      challenges: challengeWithConfig('url-shortener', {
        flows: [
          {
            kind: 'create',
            steps: [
              { id: 'ingress', require: { capability: 'ingress' } },
              { id: 'persist', require: { capability: 'durable-store' }, terminal: true },
            ],
          },
          {
            kind: 'read',
            steps: [
              { id: 'ingress', require: { capability: 'ingress' } },
              { id: 'lookup', require: { capability: 'durable-store' }, terminal: true },
            ],
          },
        ],
      }),
    });
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintPanel).toContainText('durable store');
    await expect(sandbox.lintPanel).toContainText('Load Balancer');
  });

  test('a null-ridden document from the API is normalised rather than breaking matching', async ({ page, api }) => {
    // System.Text.Json serialises unset members as null; a selector with
    // `componentType: null` must behave like one without the key.
    await api.install({
      challenges: challengeWithConfig('url-shortener', {
        flows: [
          {
            kind: 'create',
            steps: [
              { id: 'ingress', require: { capability: 'ingress', componentType: null, tag: null }, optional: null, branch: null },
              { id: 'service', require: { capability: 'compute', componentType: null, tag: null } },
              { id: 'persist', require: { capability: 'durable-store', componentType: null }, terminal: true, returnTo: null },
            ],
          },
          {
            kind: 'read',
            steps: [
              { id: 'ingress', require: { capability: 'ingress', componentType: null } },
              { id: 'service', require: { capability: 'compute', componentType: null } },
              { id: 'lookup', require: { capability: 'durable-store', componentType: null }, terminal: true },
            ],
          },
        ],
      }),
    });
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.playButton.click();
    expect(await sandbox.engineStatus()).toBe('running');
    await expect(sandbox.lintPanel).toHaveCount(0);
  });

  test('a request kind with no flow is a lint error and its requests are violated', async ({ page, api }) => {
    await api.install({
      challenges: challengeWithConfig('url-shortener', {
        requestTypes: { read: 0.5, create: 0.3, analytics: 0.2 },
      }),
    });
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');

    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintIssues.filter({ hasText: 'analytics' })).toHaveCount(1);
    await expect(sandbox.lintPanel).toContainText(/no flow/i);

    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });
    const stats = await readFlowStats(sandbox.reportOverlay);
    const analytics = stats.find((s) => s.kind === 'analytics')!;
    expect(analytics.spawned).toBeGreaterThan(0);
    expect(analytics.completed).toBe(0);
    expect(analytics.violated).toBe(analytics.spawned - analytics.dropped);
  });

  test('capabilities declared on a component definition override the built-in table', async ({ page, api }) => {
    // An authored component library that declares Redis durable. With it the
    // cache-only design that normally violates every create is correct.
    await api.install({
      components: COMPONENT_DEFINITIONS.map((d) =>
        d.componentType === 'redis' ? { ...d, capabilities: ['cache', 'durable-store'] } : d
      ),
    });
    const sandbox = new SandboxPage(page);
    await sandbox.goto('url-shortener');
    await sandbox.deleteComponent('SQL Database');

    // Lint no longer complains about creates: Redis now satisfies "persist".
    await sandbox.setSpeed(100);
    await sandbox.playButton.click();
    await expect(sandbox.lintIssues.filter({ hasText: 'create' })).toHaveCount(0);
    await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

    const stats = await readFlowStats(sandbox.reportOverlay);
    const creates = stats.find((s) => s.kind === 'create')!;
    expect(creates.completed).toBeGreaterThan(0);
    expect(creates.violated).toBe(0);
  });
});

test.describe('Every seeded challenge carries flows', () => {
  for (const slug of ['dropbox', 'rate-limiter'] as const) {
    test(`${slug}: the starter meets its objectives with no violations`, async ({ page }) => {
      const sandbox = new SandboxPage(page);
      await sandbox.goto(slug);

      await sandbox.setSpeed(100);
      await sandbox.playButton.click();
      await expect(sandbox.lintPanel).toHaveCount(0);
      await expect(sandbox.reportOverlay).toBeVisible({ timeout: 60_000 });

      const report = await readReport(sandbox.reportOverlay);
      expect(report.title).toBe('Architecture survived');

      const objectives = await readObjectives(sandbox.reportOverlay);
      expect(objectives.map((o) => o.id)).toContain('violations');
      expect(objectives.every((o) => o.met)).toBe(true);

      const challenge = CHALLENGES.find((c) => c.slug === slug)!;
      const kinds = Object.keys(challenge.scenario.scenarioConfig.requestTypes as object).sort();
      const stats = await readFlowStats(sandbox.reportOverlay);
      expect(stats.map((s) => s.kind).sort()).toEqual(kinds);
      for (const row of stats) {
        expect(row.completed).toBeGreaterThan(0);
        expect(row.violated).toBe(0);
      }
    });
  }

  test('rate limiter: bypassing the limiter violates every request', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('rate-limiter');
    await sandbox.deleteComponent('Rate Limiter');
    // Rewire the load balancer straight to the API.
    await sandbox.connect(
      sandbox.port(sandbox.component('Load Balancer'), 'out'),
      sandbox.port(sandbox.component('Backend Service'), 'in')
    );

    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintPanel).toContainText('traffic filter');
  });

  test('dropbox: a queue with no worker behind it is a dead end, not a sink', async ({ page }) => {
    const sandbox = new SandboxPage(page);
    await sandbox.goto('dropbox');
    await sandbox.deleteComponent('Worker Service');

    await sandbox.playButton.click();
    await expect(sandbox.lintPanel).toBeVisible();
    await expect(sandbox.lintIssues.filter({ hasText: 'upload' })).toHaveCount(1);
    await expect(sandbox.lintPanel).toContainText('Message Queue');
  });
});
