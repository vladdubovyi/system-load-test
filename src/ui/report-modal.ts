import type { SimulationReport } from '../game/types';
import { formatCost, formatSeconds } from '../game/report';
import { downloadReportPdf } from '../game/report-pdf';
import { getActiveScenario } from '../game/scenario-runtime';

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
          <li class="report-objective ${objective.met ? 'met' : 'unmet'}" data-objective="${objective.id}">
            <span class="objective-icon">${objective.met ? '✓' : '✕'}</span>
            <span class="objective-label">${objective.label}</span>
            <span class="objective-target">${objective.target}</span>
            <span class="objective-actual">${objective.actual}</span>
            <span class="objective-cause">${objective.cause ?? ''}</span>
          </li>
        `
          )
          .join('')}
      </ul>
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
              <tr class="report-flow-row" data-kind="${stat.kind}">
                <td>${stat.kind}</td>
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

export function renderReportModal(report: SimulationReport): string {
  const won = report.outcome === 'won';

  return `
    <div class="report-overlay" id="report-overlay">
      <div class="report-modal" role="dialog" aria-labelledby="report-title">
        <header class="report-header ${won ? 'won' : 'lost'}">
          <div>
            <p class="report-kicker">Simulation complete</p>
            <h2 id="report-title">${won ? 'Architecture survived' : 'Architecture failed'}</h2>
            <p class="report-subtitle">${getActiveScenario().title} · ${report.duration.toFixed(1)}s run</p>
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
              ${report.recommendations.map((tip) => `<li>${tip}</li>`).join('')}
            </ul>
          </section>
        </div>

        <footer class="report-footer">
          <button class="btn btn-secondary" id="report-dismiss" type="button">Close</button>
          <button class="btn btn-secondary" id="report-download" type="button">⬇ Download PDF</button>
          <button class="btn btn-primary" id="report-replay" type="button">▶ Run again</button>
        </footer>
      </div>
    </div>
  `;
}

export function mountReportModal(
  report: SimulationReport,
  onClose: () => void,
  onReplay: () => void
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
  document.getElementById('report-download')?.addEventListener('click', () => {
    downloadReportPdf(report);
  });
  document.getElementById('report-replay')?.addEventListener('click', () => {
    close();
    onReplay();
  });

  document.getElementById('report-overlay')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'report-overlay') close();
  });
}
