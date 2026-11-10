import type { ObjectiveResult, Request, SimulationReport } from '../game/types';
import { describeRequestState, renderRequestTimeline } from './request-inspector';
import { compareReports, type RunComparison } from '../game/run-compare';
import { applicableHints, conceptFor } from '../game/concepts';
import type { ScenarioHint } from '../game/flow-types';
import { formatCost, formatSeconds } from '../game/report';
import { downloadReportPdf, type ReportPdfExtras } from '../game/report-pdf';
import { getActiveScenario } from '../game/scenario-runtime';

/** Request kinds, flow step ids and tag labels are authored data: never trust them as HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadBar(pct: number): string {
  const width = Math.min(100, Math.max(0, pct));
  const hue = width >= 85 ? 0 : width >= 60 ? 35 : 142;
  return `
    <div class="report-bar-track">
      <div class="report-bar-fill" style="width:${width}%;background:hsl(${hue}, 75%, 52%)"></div>
    </div>
  `;
}

function objectivesSection(report: SimulationReport): string {
  if (report.objectives.length === 0) return '';

  const missed = report.objectives.filter((objective) => !objective.met).length;
  const heading = missed === 0
    ? 'Objectives met'
    : `${missed} objective${missed === 1 ? '' : 's'} missed`;

  return `
    <section class="report-section" id="report-objectives">
      <h3>Objectives <span class="report-objectives-verdict ${missed === 0 ? 'ok' : 'bad'}">${heading}</span></h3>
      <ul class="report-objective-list">
        ${report.objectives
          .map(
            (objective) => `
          <li class="report-objective ${objective.met ? 'met' : 'unmet'}" data-objective="${escapeHtml(objective.id)}">
            <span class="objective-icon">${objective.met ? '✓' : '✕'}</span>
            <span class="objective-label">${escapeHtml(objective.label)}</span>
            <span class="objective-target">${escapeHtml(objective.target)}</span>
            <span class="objective-actual">${escapeHtml(objective.actual)}</span>
            <span class="objective-cause">${escapeHtml(objective.cause ?? '')}</span>
            ${objective.met ? '' : `<button class="objective-why" type="button" data-why="${escapeHtml(objective.id)}" aria-expanded="false" title="Why did this fail? See the rule and example requests">Why?</button>`}
          </li>
        `
          )
          .join('')}
      </ul>
    </section>
  `;
}

/** Scripted failure phases (product-directions.md §3.3): what fired, on whom, and who survived. */
function scriptedSection(report: SimulationReport): string {
  if (report.scriptedPhases.length === 0) return '';
  const rows = report.scriptedPhases
    .map((phase) => {
      const outcome = phase.skipped
        ? '<span class="report-scripted-outcome skipped">skipped — no matching component</span>'
        : phase.failedDuring.length === 0
          ? '<span class="report-scripted-outcome ok">✓ survived</span>'
          : `<span class="report-scripted-outcome bad">✕ ${escapeHtml(phase.failedDuring.join(', '))} failed</span>`;
      const target = phase.componentLabel ? `${escapeHtml(phase.componentLabel)} · ${escapeHtml(phase.type)}` : escapeHtml(phase.type);
      return `
        <li class="report-scripted-phase" data-phase="${escapeHtml(phase.id)}">
          <span class="report-scripted-label">⚡ ${escapeHtml(phase.label)}</span>
          <span class="report-scripted-target">${target}</span>
          <span class="report-scripted-when">at ${phase.atSeconds}s for ${phase.durationSeconds}s</span>
          ${outcome}
        </li>`;
    })
    .join('');
  return `
    <section class="report-section" id="report-scripted">
      <h3>Scripted failures</h3>
      <ul class="report-scripted-list">${rows}</ul>
    </section>
  `;
}

function flowStatsSection(report: SimulationReport): string {
  if (report.flowStats.length === 0) return '';

  return `
    <section class="report-section">
      <h3>Request flows</h3>
      <div class="report-table-wrap">
        <table class="report-table" id="report-flow-stats">
          <thead>
            <tr>
              <th>Request kind</th>
              <th>Spawned</th>
              <th>Completed</th>
              <th>Dropped</th>
              <th>Violated</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            ${report.flowStats
              .map(
                (stat) => `
              <tr class="report-flow-row" data-kind="${escapeHtml(stat.kind)}">
                <td>${escapeHtml(stat.kind)}</td>
                <td>${stat.spawned.toLocaleString()}</td>
                <td>${stat.completed.toLocaleString()}</td>
                <td class="${stat.dropped > 0 ? 'bad' : ''}">${stat.dropped.toLocaleString()}</td>
                <td class="${stat.violated > 0 ? 'bad' : ''}">${stat.violated.toLocaleString()}</td>
                <td>${stat.completionRate}%</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function componentRow(report: SimulationReport['components'][0]): string {
  return `
    <tr>
      <td><span class="report-emoji">${report.emoji}</span> ${report.label}</td>
      <td>${Math.round(report.maxLoad)}%</td>
      <td>${Math.round(report.avgLoad)}%</td>
      <td>${Math.round(report.maxQueueFill)}%</td>
      <td>${formatSeconds(report.downtimeSeconds)}</td>
      <td>${formatSeconds(report.overloadSeconds)}</td>
      <td>${formatSeconds(report.idleSeconds)}</td>
      <td>${report.processed.toLocaleString()}</td>
      <td>${formatCost(report.monthlyCost)}</td>
    </tr>
  `;
}

function tagList(
  items: SimulationReport['components'],
  className: string,
  empty: string
): string {
  if (items.length === 0) {
    return `<p class="report-empty">${empty}</p>`;
  }
  return `
    <ul class="report-tags ${className}">
      ${items.map((item) => `<li>${item.emoji} ${item.label}</li>`).join('')}
    </ul>
  `;
}

/**
 * A lost run is not always a broken one. A design that overloaded a
 * component, or whose requests died on a flow violation, failed. A design
 * whose components all stayed healthy and whose requests all took their
 * required path, but which missed its completion floors, "survived" in the
 * engine's words (interview-platform.md §8) — it is correct but under
 * capacity, and the headline says so.
 */
function reportTitle(report: SimulationReport): string {
  if (report.outcome === 'won') return 'Architecture survived';
  if (report.brokenServices.length > 0) return 'Architecture failed';
  const violations = report.objectives.find((objective) => objective.id === 'violations');
  if (violations && !violations.met) return 'Architecture failed';
  return 'Survived, objectives missed';
}

export function renderReportModal(report: SimulationReport): string {
  const won = report.outcome === 'won';

  return `
    <div class="report-overlay" id="report-overlay">
      <div class="report-modal" role="dialog" aria-labelledby="report-title">
        <header class="report-header ${won ? 'won' : 'lost'}">
          <div>
            <p class="report-kicker">Simulation complete</p>
            <h2 id="report-title">${reportTitle(report)}</h2>
            <p class="report-subtitle">${getActiveScenario().title} · ${report.duration.toFixed(1)}s run · <span id="report-seed" title="Traffic seed — replay it to reproduce this exact run">seed ${report.seed}</span></p>
          </div>
          <div class="report-score-block">
            <div class="report-score">${report.score}</div>
            <div class="report-grade">Grade ${report.grade}</div>
          </div>
          <button class="report-close" id="report-close" type="button" aria-label="Close report">×</button>
        </header>

        <div class="report-body">
          <section class="report-summary-grid">
            <div class="report-stat-card">
              <span class="report-stat-label">Total cost</span>
              <span class="report-stat-value">${formatCost(report.totalCost)}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Wasted cost</span>
              <span class="report-stat-value ${report.wastedCost > 0 ? 'warn' : ''}">${formatCost(report.wastedCost)}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Success rate</span>
              <span class="report-stat-value">${report.successRate}%</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Availability</span>
              <span class="report-stat-value">${report.availabilityPct}%</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Peak RPS</span>
              <span class="report-stat-value">${report.peakRps}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Traffic spikes</span>
              <span class="report-stat-value">${report.spikeEvents}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Completed</span>
              <span class="report-stat-value">${report.totalCompleted.toLocaleString()}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Dropped</span>
              <span class="report-stat-value ${report.totalDropped > 0 ? 'bad' : ''}">${report.totalDropped.toLocaleString()}</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-label">Flow violations</span>
              <span class="report-stat-value ${report.totalViolated > 0 ? 'bad' : ''}">${report.totalViolated.toLocaleString()}</span>
            </div>
          </section>

          ${objectivesSection(report)}
          <div id="report-hints-slot"></div>
          ${scriptedSection(report)}
          ${flowStatsSection(report)}

          <section class="report-section">
            <h3>Component breakdown</h3>
            <div class="report-table-wrap">
              <table class="report-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Peak util.</th>
                    <th>Avg util.</th>
                    <th>Peak queue</th>
                    <th>Downtime</th>
                    <th>Overload</th>
                    <th>Idle</th>
                    <th>Processed</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${report.components.map(componentRow).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <div class="report-columns">
            <section class="report-section">
              <h3>Broken services</h3>
              ${tagList(report.brokenServices, 'bad', 'No failures — all services stayed healthy.')}
            </section>
            <section class="report-section">
              <h3>Scaled services</h3>
              ${tagList(report.scaledServices, 'hot', 'No component sustained critical load — good headroom.')}
            </section>
            <section class="report-section">
              <h3>Wasted resources</h3>
              ${tagList(report.wastedResources, 'idle', 'No obviously idle or duplicate resources detected.')}
            </section>
          </div>

          <section class="report-section">
            <h3>Utilization profile</h3>
            <div class="report-load-profile">
              ${report.components
                .map(
                  (c) => `
                <div class="report-load-row">
                  <span class="report-load-label">${c.emoji} ${c.label}</span>
                  ${loadBar(c.maxLoad)}
                  <span class="report-load-pct">${Math.round(c.maxLoad)}%</span>
                </div>
              `
                )
                .join('')}
            </div>
          </section>

          <section class="report-section">
            <h3>Recommendations</h3>
            <ul class="report-recommendations">
              ${report.recommendations.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
            </ul>
          </section>
        </div>

        <footer class="report-footer">
          <button class="btn btn-secondary" id="report-dismiss" type="button">Close</button>
          <button class="btn btn-secondary" id="report-download" type="button">⬇ Download PDF</button>
          <button class="btn btn-secondary" id="report-copy-link" type="button" title="Copy a link that replays this exact run — board, scenario, traffic and seed">🔗 Copy run link</button>
          <button class="btn btn-secondary" id="report-export-run" type="button" title="Download this run as a file: board, scenario, traffic, seed and every intervention">⬇ Export run file</button>
          <button class="btn btn-secondary" id="report-pin" type="button" title="Keep this run as A to compare the next one against — in this tab only">📌 Pin as A</button>
          <button class="btn btn-secondary" id="report-compare" type="button" title="Compare this run with the pinned run A, like for like" disabled>⇄ Compare to A</button>
          <button class="btn btn-secondary" id="report-replay-seed" type="button" title="Run the same board against the same traffic">↺ Replay same traffic</button>
          <button class="btn btn-primary" id="report-replay" type="button">▶ Run again</button>
        </footer>
      </div>
    </div>
  `;
}

export interface ReportModalOptions {
  /** Extra record sections for the PDF (interview-platform.md §4.5). */
  pdfExtras?: () => ReportPdfExtras;
  /** Shown as a button when set: the host can release a held report. */
  onRelease?: () => void;
  /** Copy a snapshot link that replays this run (product-directions.md §2). */
  onCopyRunLink?: () => void;
  /** Download this run as a file, interventions included (§2.6). */
  onExportRun?: () => void;
  /**
   * Coaching drawer (product-directions.md §4.2): example requests behind a
   * failed objective. Absent → the Why? drawer shows the rule only.
   */
  examplesFor?: (objective: ObjectiveResult) => Request[];
  /** Interview participants: example traces render, flow reasons do not (§6.2). */
  hideFlowDetails?: boolean;
  /** The scenario's hint ladder (§4.4); the caller withholds it from interview participants. */
  hints?: ScenarioHint[];
  /** Same-seed A/B comparison (§4.3): the pinned run A, held in the tab by the caller. */
  pinning?: {
    pinned: PinnedRun | null;
    onPin: () => void;
    /** Board changes between A's board and this run's board, in words. */
    boardChanges: () => string[];
  };
}

/** A run pinned for comparison: the report and the seed it ran on. */
export interface PinnedRun {
  report: SimulationReport;
  seed: number;
}

export function mountReportModal(
  report: SimulationReport,
  onClose: () => void,
  onReplay: () => void,
  onReplaySameSeed: () => void = onReplay,
  options: ReportModalOptions = {}
): void {
  const existing = document.getElementById('report-overlay');
  existing?.remove();

  document.body.insertAdjacentHTML('beforeend', renderReportModal(report));

  const close = (): void => {
    document.getElementById('report-overlay')?.remove();
    onClose();
  };

  document.getElementById('report-close')?.addEventListener('click', close);
  document.getElementById('report-dismiss')?.addEventListener('click', close);
  bindPinning(report, options.pinning);
  mountHints(report, options.hints ?? []);
  document.querySelectorAll<HTMLButtonElement>('#report-overlay .objective-why').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.why ?? '';
      const row = button.closest('li');
      const open = document.querySelector(`#report-overlay .objective-why-drawer[data-for="${CSS.escape(id)}"]`);
      if (open) {
        open.remove();
        button.setAttribute('aria-expanded', 'false');
        return;
      }
      const objective = report.objectives.find((o) => o.id === id);
      if (!row || !objective) return;
      const examples = options.examplesFor?.(objective) ?? [];
      row.insertAdjacentHTML('afterend', renderWhyDrawer(objective, examples, options.hideFlowDetails === true));
      button.setAttribute('aria-expanded', 'true');
    });
  });
  const copyLink = document.getElementById('report-copy-link');
  if (options.onCopyRunLink) copyLink?.addEventListener('click', options.onCopyRunLink);
  else copyLink?.remove();
  const exportRun = document.getElementById('report-export-run');
  if (options.onExportRun) exportRun?.addEventListener('click', options.onExportRun);
  else exportRun?.remove();
  document.getElementById('report-download')?.addEventListener('click', () => {
    downloadReportPdf(report, options.pdfExtras?.() ?? {});
  });
  if (options.onRelease) {
    const actions = document.querySelector('#report-overlay .report-footer');
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.id = 'report-release';
    btn.type = 'button';
    btn.textContent = '👁 Release to participants';
    btn.addEventListener('click', () => {
      options.onRelease?.();
      btn.disabled = true;
      btn.textContent = 'Released';
    });
    actions?.insertBefore(btn, actions.firstChild);
  }
  document.getElementById('report-replay')?.addEventListener('click', () => {
    close();
    onReplay();
  });
  document.getElementById('report-replay-seed')?.addEventListener('click', () => {
    close();
    onReplaySameSeed();
  });

  document.getElementById('report-overlay')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'report-overlay') close();
  });
}

// ── Coaching drawer (product-directions.md §4.2) ───────────────────────────

/** The engine rule behind an outcome, in one sentence. */
function ruleFor(objective: ObjectiveResult, examples: Request[]): string {
  if (objective.id === 'failures') {
    return 'A component fails when its queue stays full for 1.8 seconds while it cannot process anything — the components around it then drop what they send.';
  }
  if (objective.id === 'scripted-failures') {
    return 'A scripted drill degrades its target on schedule; the objective fails when some other component breaks while the drill is active.';
  }
  const state = examples[0]?.state;
  if (state === 'violated' || objective.id === 'violations') {
    return 'A request is violated when no connected component satisfies its next required flow step; it ends there instead of taking a wrong path.';
  }
  if (state === 'dropped') {
    return 'A request is dropped when it arrives at a component whose queue is full, or when nothing downstream can take it.';
  }
  return 'Requests still queued or traveling when the run ends count as neither completed nor dropped — the path works, but too slowly.';
}

function renderWhyDrawer(objective: ObjectiveResult, examples: Request[], hideFlowDetails: boolean): string {
  const shown = examples.slice(0, 3);
  const items = shown
    .map((request) => {
      const ctx = { now: request.finishedAt ?? request.spawnedAt, paused: false, running: false, hideFlowDetails };
      return `
        <article class="why-example">
          <header class="why-example-header">Request <span class="ri-id">#${request.id}</span> <span class="ri-pill ri-pill-${escapeHtml(request.kind)}">${escapeHtml(request.kind)}</span> · ${escapeHtml(describeRequestState(request, ctx))}</header>
          ${renderRequestTimeline(request, ctx)}
        </article>`;
    })
    .join('');
  const card = hideFlowDetails ? null : conceptFor(conceptRuleFor(objective, shown));
  return `
    <li class="objective-why-drawer" data-for="${escapeHtml(objective.id)}">
      <p class="why-rule">${escapeHtml(ruleFor(objective, shown))}</p>
      ${card ? `<aside class="why-concept"><span class="why-concept-title">${escapeHtml(card.title)}</span> <span class="why-concept-body">${escapeHtml(card.body)}</span></aside>` : ''}
      ${shown.length > 0 ? `<p class="why-intro">${shown.length === 1 ? 'An example request' : `${shown.length} example requests`} from this run:</p><div class="why-examples">${items}</div>` : '<p class="why-intro">No example requests were kept for this outcome.</p>'}
    </li>`;
}

// ── Same-seed A/B comparison (product-directions.md §4.3) ─────────────────

function bindPinning(report: SimulationReport, pinning: ReportModalOptions['pinning']): void {
  const pin = document.getElementById('report-pin') as HTMLButtonElement | null;
  const compare = document.getElementById('report-compare') as HTMLButtonElement | null;
  if (!pin || !compare) return;
  if (!pinning) {
    pin.remove();
    compare.remove();
    return;
  }
  const markPinned = (): void => {
    pin.textContent = 'Pinned as A ✓';
    pin.disabled = true;
    compare.disabled = true;
  };
  if (pinning.pinned?.report === report) {
    markPinned();
  } else {
    compare.disabled = pinning.pinned === null;
  }
  pin.addEventListener('click', () => {
    pinning.onPin();
    markPinned();
    document.getElementById('report-compare-panel')?.remove();
  });
  compare.addEventListener('click', () => {
    const existing = document.getElementById('report-compare-panel');
    if (existing) {
      existing.remove();
      compare.setAttribute('aria-expanded', 'false');
      return;
    }
    const pinned = pinning.pinned;
    if (!pinned) return;
    const comparison = compareReports(pinned.report, report);
    const body = document.querySelector('#report-overlay .report-body');
    body?.insertAdjacentHTML('beforeend', renderComparePanel(comparison, comparison.sameSeed ? pinning.boardChanges() : []));
    compare.setAttribute('aria-expanded', 'true');
    document.getElementById('report-compare-panel')?.scrollIntoView({ block: 'nearest' });
  });
}

function objectiveCell(o: { met: boolean; actual: string } | null): string {
  if (!o) return '<span class="compare-missing">—</span>';
  return `<span class="${o.met ? 'ok' : 'bad'}">${o.met ? '✓' : '✕'}</span> ${escapeHtml(o.actual)}`;
}

function flowCell(f: { spawned: number; completed: number; dropped: number; violated: number } | null): string {
  if (!f) return '<span class="compare-missing">—</span>';
  return `${f.completed.toLocaleString()} / ${f.spawned.toLocaleString()} completed · ${f.dropped.toLocaleString()} dropped · ${f.violated.toLocaleString()} violated`;
}

function renderComparePanel(cmp: RunComparison, boardChanges: string[]): string {
  if (!cmp.sameSeed) {
    return `
      <section class="report-section report-compare" id="report-compare-panel">
        <h3>Compared to A</h3>
        <p class="compare-note">A ran a different seed (${cmp.seedA}) from this run (${cmp.seedB}), so the numbers would not be like for like. Open A's board and use <strong>Replay same traffic</strong>, or pin this run and replay it with your next change.</p>
      </section>`;
  }
  const side = (better: 'a' | 'b' | null, which: 'a' | 'b'): string => (better === which ? ' is-better' : '');
  const metrics = cmp.metrics
    .map(
      (m) => `
        <tr class="compare-metric" data-metric="${escapeHtml(m.id)}">
          <th scope="row">${escapeHtml(m.label)}</th>
          <td class="compare-a${side(m.better, 'a')}">${escapeHtml(m.a)}</td>
          <td class="compare-b${side(m.better, 'b')}">${escapeHtml(m.b)}</td>
        </tr>`
    )
    .join('');
  const objectives = cmp.objectives
    .map(
      (o) => `
        <tr class="compare-objective" data-objective="${escapeHtml(o.id)}">
          <th scope="row">${escapeHtml(o.label)}</th>
          <td class="compare-a">${objectiveCell(o.a)}</td>
          <td class="compare-b">${objectiveCell(o.b)}</td>
        </tr>`
    )
    .join('');
  const flows = cmp.flows
    .map(
      (f) => `
        <tr class="compare-flow" data-kind="${escapeHtml(f.kind)}">
          <th scope="row">${escapeHtml(f.kind)}</th>
          <td class="compare-a">${flowCell(f.a)}</td>
          <td class="compare-b">${flowCell(f.b)}</td>
        </tr>`
    )
    .join('');
  const changes =
    boardChanges.length > 0
      ? `<ul>${boardChanges.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '<p>No board changes — same design, same traffic, same result.</p>';
  return `
    <section class="report-section report-compare" id="report-compare-panel">
      <h3>Compared to A <span class="report-compare-seeds">same seed ${cmp.seedA}</span></h3>
      <div class="report-table-wrap">
        <table class="report-table compare-table">
          <thead><tr><th></th><th>A</th><th>This run</th></tr></thead>
          <tbody>
            <tr class="compare-group"><th colspan="3">Headline</th></tr>
            ${metrics}
            <tr class="compare-group"><th colspan="3">Objectives</th></tr>
            ${objectives}
            <tr class="compare-group"><th colspan="3">Request flows</th></tr>
            ${flows}
          </tbody>
        </table>
      </div>
      <div class="compare-board-changes">
        <h4>Board changes since A</h4>
        ${changes}
      </div>
    </section>`;
}

/** Which concept card explains this objective's failure (product-directions §4.4). */
function conceptRuleFor(objective: ObjectiveResult, examples: Request[]): string {
  if (objective.id === 'failures') return 'failure:overload';
  if (objective.id === 'scripted-failures') return 'scripted:collateral';
  const first = examples[0];
  if (first?.state === 'violated' || objective.id === 'violations') {
    const violated = (first ?? examples.find((r) => r.state === 'violated'))?.events.find((e) => e.kind === 'violated');
    return violated?.ruleId ?? 'flow-ended';
  }
  if (first?.state === 'dropped') return 'drop:queue-full';
  return 'inflight:slow';
}

// ── Hint ladder (product-directions.md §4.4) ───────────────────────────────

function mountHints(report: SimulationReport, hints: ScenarioHint[]): void {
  const slot = document.getElementById('report-hints-slot');
  if (!slot) return;
  const ladder = applicableHints(hints, { lost: report.outcome === 'lost', violated: report.totalViolated > 0 });
  if (ladder.length === 0) {
    slot.remove();
    return;
  }
  let shown = 0;
  slot.outerHTML = `
    <section class="report-section report-hints" id="report-hints">
      <h3>Hints <span class="report-hint-count" id="report-hint-count">0 of ${ladder.length} shown</span></h3>
      <ol class="report-hint-list" id="report-hint-list"></ol>
      <button class="btn btn-secondary" id="report-hint-next" type="button">💡 Show a hint</button>
    </section>`;
  const list = document.getElementById('report-hint-list');
  const count = document.getElementById('report-hint-count');
  const next = document.getElementById('report-hint-next') as HTMLButtonElement | null;
  next?.addEventListener('click', () => {
    if (shown >= ladder.length) return;
    const hint = ladder[shown++];
    list?.insertAdjacentHTML('beforeend', `<li class="report-hint" data-hint="${escapeHtml(hint.id)}">${escapeHtml(hint.text)}</li>`);
    if (count) count.textContent = `Hint ${shown} of ${ladder.length}`;
    if (next && shown >= ladder.length) {
      next.disabled = true;
      next.textContent = 'No more hints';
    }
  });
}
