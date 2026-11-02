import type { FlowLintIssue } from '../game/flow-validator';

/**
 * Floating panel listing design-check warnings from the flow lint. Shown when
 * a run starts on a board that cannot execute the scenario's flows; the run
 * proceeds regardless (violations surface per request), so the panel is
 * dismissible and purely informative.
 */

let panel: HTMLElement | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showLintPanel(host: HTMLElement, issues: FlowLintIssue[]): void {
  hideLintPanel();
  if (issues.length === 0) return;

  panel = document.createElement('aside');
  panel.className = 'lint-panel';
  panel.id = 'lint-panel';
  panel.setAttribute('aria-label', 'Design check warnings');
  panel.innerHTML = `
    <header class="lint-header">
      <span class="lint-title">⚠ Design check</span>
      <span class="lint-count">${issues.length}</span>
      <button class="lint-close" type="button" aria-label="Dismiss design warnings">✕</button>
    </header>
    <ol class="lint-list">
      ${issues
        .map(
          (issue) => `
        <li class="lint-issue">
          ${issue.kind ? `<span class="lint-kind">${escapeHtml(issue.kind)}</span>` : ''}
          <span class="lint-message">${escapeHtml(issue.message)}</span>
        </li>`
        )
        .join('')}
    </ol>
    <footer class="lint-footer">
      The run continues — requests that can't take a required step fail as flow violations.
    </footer>
  `;
  panel.querySelector('.lint-close')?.addEventListener('click', hideLintPanel);
  host.appendChild(panel);
}

export function hideLintPanel(): void {
  panel?.remove();
  panel = null;
}
