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
  }

  async goto(slug?: string): Promise<void> {
    await this.page.goto(slug ? `/sandbox/${slug}` : '/sandbox');
    await expect(this.board).toBeVisible();
    // The starter preset is placed synchronously after the API resolves.
    await expect(this.playButton).toBeVisible();
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
}

export async function readReport(overlay: Locator): Promise<ReportSummary> {
  const title = (await overlay.locator('#report-title').textContent())?.trim() ?? '';
  const score = Number((await overlay.locator('.report-score').textContent())?.trim());
  const grade = ((await overlay.locator('.report-grade').textContent()) ?? '').replace('Grade', '').trim();
  const successRate = Number(
    ((await overlay
      .locator('.report-stat-card', { hasText: 'Success rate' })
      .locator('.report-stat-value')
      .textContent()) ?? '0').replace('%', '')
  );
  const componentRows = await overlay.locator('.report-table tbody tr').count();
  const brokenSection = overlay.locator('.report-section', { hasText: 'Broken services' });
  const brokenServices = (await brokenSection.locator('.report-tags li').allTextContents()).map((t) => t.trim());
  return { title, score, grade, successRate, componentRows, brokenServices };
}
