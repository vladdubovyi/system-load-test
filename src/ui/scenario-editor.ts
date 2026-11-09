import type { ScenarioDocument } from '../game/flow-types';
import { validateScenarioDocument } from '../game/flows';

/**
 * Scenario editor (docs/specs/flow-authoring.md §3.1): one JSON document
 * holding the authorable part of the active scenario — request mix, tags,
 * flows and objectives. Validate reports problems; Apply installs the
 * document for this session; Reset returns to the challenge's own
 * definition. Nothing leaves the browser: the anonymous MVP has no write
 * endpoint (docs/specs/interview-platform.md §2.3, §4.1).
 */

export interface ScenarioEditorCallbacks {
  onApply: (doc: ScenarioDocument) => void;
  onReset: () => void;
  onClose: () => void;
}

export interface ScenarioEditorOptions {
  /** True when the shown document is a session override rather than the challenge's. */
  overridden: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderScenarioEditor(doc: ScenarioDocument, options: ScenarioEditorOptions): string {
  return `
    <div class="scenario-editor" id="scenario-editor" role="dialog" aria-labelledby="scenario-editor-title">
      <div class="config-panel-header">
        <h3 id="scenario-editor-title">Scenario${options.overridden ? ' <span class="scenario-editor-flag">edited</span>' : ''}</h3>
        <button class="config-panel-close" id="scenario-close" type="button" aria-label="Close scenario editor">×</button>
      </div>
      <div class="config-panel-body scenario-editor-body">
        <p class="scenario-editor-help">
          Request mix, roles (tags), flows and objectives for this challenge.
          <strong>Apply</strong> uses the document for your next runs in this session; copy the JSON to keep it.
        </p>
        <textarea id="scenario-json" class="scenario-json" spellcheck="false" aria-label="Scenario document (JSON)">${escapeHtml(JSON.stringify(doc, null, 2))}</textarea>
        <ul class="scenario-editor-errors" id="scenario-errors" aria-live="polite"></ul>
      </div>
      <div class="config-panel-actions scenario-editor-actions">
        <button class="config-btn config-btn-secondary" id="scenario-reset" type="button" title="Discard the applied document and return to the challenge definition">Reset</button>
        <button class="config-btn config-btn-secondary" id="scenario-validate" type="button">Validate</button>
        <button class="config-btn config-btn-primary" id="scenario-apply" type="button">Apply</button>
      </div>
    </div>
  `;
}

/** Parse and validate the textarea. Returns the document, or renders problems and returns null. */
function readDocument(container: HTMLElement): ScenarioDocument | null {
  const textarea = container.querySelector<HTMLTextAreaElement>('#scenario-json');
  const errors = container.querySelector<HTMLElement>('#scenario-errors');
  if (!textarea || !errors) return null;

  const show = (problems: string[]): void => {
    errors.innerHTML = problems
      .map((problem) => `<li class="scenario-error">${escapeHtml(problem)}</li>`)
      .join('');
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (error) {
    show([`Not valid JSON: ${(error as Error).message}`]);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    show(['The document must be a JSON object with requestTypes, tags, flows and objectives.']);
    return null;
  }

  const doc = parsed as ScenarioDocument;
  const problems = validateScenarioDocument(doc);
  show(problems);
  return problems.length === 0 ? doc : null;
}

export function mountScenarioEditor(
  container: HTMLElement,
  doc: ScenarioDocument,
  options: ScenarioEditorOptions,
  callbacks: ScenarioEditorCallbacks
): void {
  container.innerHTML = renderScenarioEditor(doc, options);

  container.querySelector('#scenario-close')?.addEventListener('click', callbacks.onClose);

  container.querySelector('#scenario-validate')?.addEventListener('click', () => {
    if (readDocument(container)) {
      const errors = container.querySelector<HTMLElement>('#scenario-errors');
      if (errors) errors.innerHTML = '<li class="scenario-ok">No problems found.</li>';
    }
  });

  container.querySelector('#scenario-apply')?.addEventListener('click', () => {
    const next = readDocument(container);
    if (!next) return;
    callbacks.onApply(next);
    callbacks.onClose();
  });

  container.querySelector('#scenario-reset')?.addEventListener('click', () => {
    callbacks.onReset();
    callbacks.onClose();
  });
}
