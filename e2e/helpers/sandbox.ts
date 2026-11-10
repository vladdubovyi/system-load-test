import { expect, type Locator, type Page } from '@playwright/test';

type SimulationStatus = 'idle' | 'running' | 'won' | 'lost';

/**
 * Page helper for the `/sandbox/:slug` board. Uses stable ids/classes from
 * src/sandbox/sandbox-app.ts and src/ui/*. The dev-only
 * `window.__breakitDebug` hook is used read-only to assert engine state that
 * has no visible representation (e.g. the exact simulation status).
 */
export class SandboxPage {
  readonly board: Locator;
  readonly components: Locator;
  readonly belts: Locator;
  readonly playButton: Locator;
  readonly statusBar: Locator;
  readonly hud: Locator;
  readonly title: Locator;
  readonly reportOverlay: Locator;
  readonly configPalette: Locator;
  readonly lintPanel: Locator;
  readonly lintIssues: Locator;
  readonly boardToast: Locator;
  readonly requestInspector: Locator;
  readonly scenarioEditor: Locator;
  readonly scenarioJson: Locator;
  readonly scenarioErrors: Locator;
  readonly shareButton: Locator;
  readonly roomDialog: Locator;
  readonly roomPresence: Locator;
  readonly roomBanner: Locator;

  constructor(readonly page: Page) {
    this.board = page.locator('#board');
    this.components = page.locator('#board .component');
    this.belts = page.locator('#board .belt-group');
    this.playButton = page.locator('#btn-play');
    this.statusBar = page.locator('#status-bar');
    this.hud = page.locator('#header-stats');
    this.title = page.locator('.chrome-brand-name');
    this.reportOverlay = page.locator('#report-overlay');
    this.configPalette = page.locator('#config-palette');
    this.lintPanel = page.locator('#lint-panel');
    this.lintIssues = page.locator('#lint-panel .lint-issue');
    this.boardToast = page.locator('#board-toast');
    this.requestInspector = page.locator('#request-inspector');
    this.scenarioEditor = page.locator('#scenario-editor');
    this.scenarioJson = page.locator('#scenario-json');
    this.scenarioErrors = page.locator('#scenario-editor .scenario-error');
    this.shareButton = page.locator('#btn-share');
    this.roomDialog = page.locator('#room-dialog');
    this.roomPresence = page.locator('#room-presence');
    this.roomBanner = page.locator('#room-banner');
  }

  /** Open a room around the current board (docs/specs/interview-platform.md §3.1). */
  async shareRoom(): Promise<{ code: string; participantLink: string; hostLink: string }> {
    await this.shareButton.click();
    await expect(this.roomDialog).toBeVisible();
    await this.roomDialog.locator('#room-share').click();
    const codeEl = this.roomDialog.locator('#room-code');
    await expect(codeEl).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const code = (await codeEl.textContent())!.trim();
    const participantLink = await this.roomDialog.locator('#room-participant-link').inputValue();
    const hostLink = await this.roomDialog.locator('#room-host-link').inputValue();
    await this.roomDialog.locator('#room-close').click();
    await expect(this.roomDialog).toHaveCount(0);
    return { code, participantLink, hostLink };
  }

  /** Open a room link (`#join=` or `#host=`) and wait for the board. */
  async gotoRoomLink(link: string): Promise<void> {
    await this.page.goto(link);
    await expect(this.board).toBeVisible();
    await expect(this.roomPresence).toBeVisible();
  }

  /** Participant rows in the presence panel. */
  presenceNames(): Locator {
    return this.roomPresence.locator('.room-participant-name');
  }

  /** Drag a component by its label by a page-space offset. */
  async dragComponent(label: string, dx: number, dy: number): Promise<void> {
    const node = this.component(label);
    const box = await node.boundingBox();
    if (!box) throw new Error(`component ${label} not visible`);
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await this.page.mouse.up();
  }

  /** Open the scenario (flow authoring) editor from the chrome actions. */
  async openScenarioEditor(): Promise<void> {
    await this.page.locator('#btn-scenario').click();
    await expect(this.scenarioEditor).toBeVisible();
  }

  /** The current editor document, parsed. */
  async scenarioDocument(): Promise<Record<string, unknown>> {
    return JSON.parse(await this.scenarioJson.inputValue()) as Record<string, unknown>;
  }

  /** Replace the editor document wholesale. */
  async setScenarioDocument(doc: unknown): Promise<void> {
    await this.scenarioJson.fill(typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  }

  /** A scenario-defined role chip in the configuration palette. */
  tagChip(tagId: string): Locator {
    return this.configPalette.locator(`[data-tag-chip="${tagId}"]`);
  }

  /**
   * Open a challenge sandbox. `seed` pins the traffic seed for every run in
   * the tab (docs/specs/interview-platform.md §8), via the `?seed=` query.
   */
  async goto(slug?: string, options: { seed?: number } = {}): Promise<void> {
    const path = slug ? `/sandbox/${slug}` : '/sandbox';
    const query = options.seed === undefined ? '' : `?seed=${options.seed}`;
    await this.page.goto(`${path}${query}`);
    await expect(this.board).toBeVisible();
    // The starter preset is placed synchronously after the API resolves.
    await expect(this.playButton).toBeVisible();
  }

  /** Replace the board with the challenge's reference solution (§8). */
  async loadReference(): Promise<void> {
    await this.page.locator('#btn-reference').click();
    await expect(this.components.first()).toBeVisible();
  }

  panelItem(type: string): Locator {
    return this.page.locator(`.components-panel-item[data-component="${type}"]`);
  }

  component(label: string): Locator {
    return this.components.filter({ has: this.page.locator('.component-name', { hasText: label }) });
  }

  port(componentLocator: Locator, side: 'in' | 'out'): Locator {
    return componentLocator.locator(`.port-${side}`);
  }

  sourcePort(): Locator {
    return this.page.locator('#source-node .port-out');
  }

  async setSpeed(speed: 1 | 5 | 20 | 100): Promise<void> {
    const btn = this.page.locator(`.speed-btn[data-speed="${speed}"]`);
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  }

  async reset(): Promise<void> {
    await this.page.locator('#btn-reset').click();
    await expect(this.components).toHaveCount(0);
  }

  async loadStarter(): Promise<void> {
    await this.page.locator('#btn-preset').click();
  }

  /** Convert world (board) coordinates into page coordinates at zoom 1 / pan 0. */
  async worldToScreen(x: number, y: number): Promise<{ x: number; y: number }> {
    const rect = await this.page.locator('#board-viewport').boundingBox();
    if (!rect) throw new Error('board viewport not visible');
    return { x: rect.x + x, y: rect.y + y };
  }

  /**
   * Place a component from the library by clicking the palette item and then
   * the board. The app centres the node on the click, so pass the centre you
   * want in world coordinates.
   */
  async placeComponent(type: string, worldX: number, worldY: number): Promise<Locator> {
    // Clear any selection first: the open config palette is a fixed overlay on
    // the right edge of the viewport and would swallow the placement click.
    await this.page.keyboard.press('Escape');
    await expect(this.configPalette).not.toHaveClass(/open/);
    const before = await this.components.count();
    const item = this.panelItem(type);
    await item.click();
    await expect(item).toHaveClass(/active/);
    const point = await this.worldToScreen(worldX, worldY);
    await this.page.mouse.click(point.x, point.y);
    await expect(this.components).toHaveCount(before + 1);
    return this.components.nth(before);
  }

  /** Drag from one port to another with real pointer events. */
  async connect(from: Locator, to: Locator): Promise<void> {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error('port not visible');
    await this.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await this.page.mouse.up();
  }

  /** Connect the "Incoming Requests" source to a component's input port. */
  async connectFromSource(inPort: Locator): Promise<void> {
    await this.connect(this.sourcePort(), inPort);
  }

  /** Select a component by its visible label and delete it with the keyboard. */
  async deleteComponent(label: string): Promise<void> {
    const node = this.component(label);
    await node.click();
    await expect(node).toHaveClass(/selected/);
    await this.page.keyboard.press('Delete');
    await expect(node).toHaveCount(0);
  }

  /**
   * Flow-level request totals from the engine. `totalViolated` and the
   * per-kind completion map have no visible UI yet (that ships with the lint
   * panel), so they are read from the debug hook. Missing counters map to -1
   * so assertions fail loudly instead of passing on `undefined`.
   */
  async flowTotals(): Promise<{
    spawned: number;
    completed: number;
    violated: number;
    completedByKind: Record<string, number>;
  }> {
    return this.page.evaluate(() => {
      const dbg = (
        window as unknown as {
          __breakitDebug?: {
            state: {
              engine: {
                getSnapshot(): {
                  totalSpawned?: number;
                  totalCompleted?: number;
                  totalViolated?: number;
                  completedByKind?: Record<string, number>;
                };
              } | null;
            };
          };
        }
      ).__breakitDebug;
      const snap = dbg?.state.engine?.getSnapshot();
      return {
        spawned: snap?.totalSpawned ?? -1,
        completed: snap?.totalCompleted ?? -1,
        violated: snap?.totalViolated ?? -1,
        completedByKind: snap?.completedByKind ?? {},
      };
    });
  }

  /**
   * Trace the oldest live request in the running simulation. Clicking a
   * moving canvas dot is not reliably automatable, so this drives the same
   * `traceRequest` entry point the click handler uses via the dev hook; all
   * assertions still run against the visible inspector panel.
   */
  async traceAnyActiveRequest(): Promise<void> {
    await this.page.waitForFunction(() => {
      const dbg = (
        window as unknown as {
          __breakitDebug?: {
            state: { engine: { getSnapshot(): { activeRequests: { id: number }[] } } | null };
          };
        }
      ).__breakitDebug;
      return (dbg?.state.engine?.getSnapshot().activeRequests.length ?? 0) > 0;
    });
    await this.page.evaluate(() => {
      const dbg = (
        window as unknown as {
          __breakitDebug?: {
            state: { engine: { getSnapshot(): { activeRequests: { id: number }[] } } | null };
            traceRequest(id: number): void;
          };
        }
      ).__breakitDebug;
      const first = dbg?.state.engine?.getSnapshot().activeRequests[0];
      if (first) dbg?.traceRequest(first.id);
    });
  }

  /**
   * Requests processed so far by the component with this label. Processed
   * counts have no visible representation (the HUD only shows totals), so
   * this reads the engine snapshot through the dev hook.
   */
  async processedCount(label: string): Promise<number> {
    return this.page.evaluate((wanted) => {
      const dbg = (
        window as unknown as {
          __breakitDebug?: {
            state: {
              components: { id: string; label: string }[];
              engine: { getSnapshot(): { components: Map<string, { processed: number }> } } | null;
            };
          };
        }
      ).__breakitDebug;
      const comp = dbg?.state.components.find((c) => c.label === wanted);
      if (!comp) return -1;
      return dbg?.state.engine?.getSnapshot().components.get(comp.id)?.processed ?? -1;
    }, label);
  }

  async engineStatus(): Promise<SimulationStatus> {
    return this.page.evaluate(() => {
      const dbg = (window as unknown as { __breakitDebug?: { state: { engine: { getSnapshot(): { status: SimulationStatus } } | null } } }).__breakitDebug;
      return dbg?.state.engine?.getSnapshot().status ?? 'idle';
    });
  }

  /**
   * Id of the challenge the sandbox loaded. The offline fallback uses
   * 'legacy-url-shortener', so a GUID here proves the data came from the
   * backend rather than the built-in challenge.
   */
  async loadedChallengeId(): Promise<string | null> {
    return this.page.evaluate(() => {
      const dbg = (
        window as unknown as {
          __breakitDebug?: { state: { currentChallenge: { id: string } | null } };
        }
      ).__breakitDebug;
      return dbg?.state.currentChallenge?.id ?? null;
    });
  }

  async componentTypes(): Promise<string[]> {
    return this.page.evaluate(() => {
      const dbg = (window as unknown as { __breakitDebug?: { state: { components: { type: string }[] } } }).__breakitDebug;
      return dbg?.state.components.map((c) => c.type) ?? [];
    });
  }

  /** Run the current board at 100x and wait for the end-of-run report. */
  async runToReport(): Promise<Locator> {
    await this.setSpeed(100);
    await this.playButton.click();
    await expect(this.reportOverlay).toBeVisible({ timeout: 60_000 });
    return this.reportOverlay;
  }
}

export interface ReportSummary {
  title: string;
  score: number;
  grade: string;
  /** Percentage of spawned requests that completed, from the summary card. */
  successRate: number;
  componentRows: number;
  brokenServices: string[];
  /** The traffic seed this run was generated from (§8). */
  seed: number;
  peakRps: number;
}

export async function readReport(overlay: Locator): Promise<ReportSummary> {
  const title = (await overlay.locator('#report-title').textContent())?.trim() ?? '';
  const seed = Number(((await overlay.locator('#report-seed').textContent()) ?? '').replace(/[^0-9]/g, ''));
  const score = Number((await overlay.locator('.report-score').textContent())?.trim());
  const grade = ((await overlay.locator('.report-grade').textContent()) ?? '').replace('Grade', '').trim();
  const successRate = Number(
    ((await overlay
      .locator('.report-stat-card', { hasText: 'Success rate' })
      .locator('.report-stat-value')
      .textContent()) ?? '0').replace('%', '')
  );
  const peakRps = Number(
    ((await overlay
      .locator('.report-stat-card', { hasText: 'Peak RPS' })
      .locator('.report-stat-value')
      .textContent()) ?? '0').replace(/[^0-9.]/g, '')
  );
  const componentRows = await overlay.locator('.report-table tbody tr').count();
  const brokenSection = overlay.locator('.report-section', { hasText: 'Broken services' });
  const brokenServices = (await brokenSection.locator('.report-tags li').allTextContents()).map((t) => t.trim());
  return { title, score, grade, successRate, componentRows, brokenServices, seed, peakRps };
}

export interface ObjectiveRow {
  /** Stable objective id, e.g. 'violations' or 'completion:create'. */
  id: string;
  label: string;
  met: boolean;
  actual: string;
  cause: string;
}

/**
 * The end-of-run objective checklist (spec §6). Each row is one win
 * condition with its measured value, and a dominant cause when it failed.
 */
export async function readObjectives(overlay: Locator): Promise<ObjectiveRow[]> {
  const rows = overlay.locator('#report-objectives .report-objective');
  const count = await rows.count();
  const out: ObjectiveRow[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    out.push({
      id: (await row.getAttribute('data-objective')) ?? '',
      label: ((await row.locator('.objective-label').textContent()) ?? '').trim(),
      // Exact class match: 'unmet' also contains 'met'.
      met: ((await row.getAttribute('class')) ?? '').split(/\s+/).includes('met'),
      actual: ((await row.locator('.objective-actual').textContent()) ?? '').trim(),
      cause: ((await row.locator('.objective-cause').textContent()) ?? '').trim(),
    });
  }
  return out;
}

export interface FlowStatRow {
  kind: string;
  spawned: number;
  completed: number;
  dropped: number;
  violated: number;
}

/** Per-request-kind totals from the report's "Request flows" table. */
export async function readFlowStats(overlay: Locator): Promise<FlowStatRow[]> {
  const rows = overlay.locator('#report-flow-stats .report-flow-row');
  const count = await rows.count();
  const out: FlowStatRow[] = [];
  for (let i = 0; i < count; i++) {
    const cells = await rows.nth(i).locator('td').allTextContents();
    const num = (index: number) => Number(cells[index].replace(/[^0-9]/g, ''));
    out.push({
      kind: cells[0].trim(),
      spawned: num(1),
      completed: num(2),
      dropped: num(3),
      violated: num(4),
    });
  }
  return out;
}

/** localStorage keys an older, account-based build of BreakIT wrote. */
export const LEGACY_TOKEN_KEY = 'sds_auth_token';
export const LEGACY_USER_KEY = 'sds_auth_user';

/**
 * Simulate a browser that signed in under an older build: plant the session
 * keys that build stored, before any page script runs. The anonymous MVP
 * must neither adopt nor keep them (docs/specs/interview-platform.md §11 Q7).
 */
export async function plantLegacyAuthStorage(page: Page, token: string, user: object): Promise<void> {
  await page.addInitScript(
    ([t, u, tk, uk]) => {
      localStorage.setItem(tk, t);
      localStorage.setItem(uk, u);
    },
    [token, JSON.stringify(user), LEGACY_TOKEN_KEY, LEGACY_USER_KEY] as const
  );
}
