import type { SimulationReport } from '../game/types';
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
