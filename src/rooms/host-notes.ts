/**
 * Host notes (docs/specs/interview-platform.md §4.5): a private pane in the
 * host's tab. The text lives in this module's memory and nowhere else — not
 * the server, not storage. It leaves the browser only inside the PDF the
 * host downloads.
 */

let notes = '';
const PANE_ID = 'host-notes';

export function getHostNotes(): string {
  return notes;
}

export function clearHostNotes(): void {
  notes = '';
  document.getElementById(PANE_ID)?.remove();
}

export function isHostNotesOpen(): boolean {
  return document.getElementById(PANE_ID) !== null;
}

export function toggleHostNotes(): void {
  if (isHostNotesOpen()) {
    document.getElementById(PANE_ID)?.remove();
    return;
  }
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;
  const pane = document.createElement('aside');
  pane.id = PANE_ID;
  pane.className = 'host-notes';
  pane.setAttribute('aria-label', 'Host notes');
  pane.innerHTML = `
    <div class="host-notes-header">
      <strong>Notes</strong>
      <span class="host-notes-hint">Only in this tab. Lost on refresh unless you export the PDF.</span>
      <button class="config-panel-close" id="host-notes-close" type="button" aria-label="Close notes">×</button>
    </div>
    <textarea id="host-notes-text" class="host-notes-text" spellcheck="true" placeholder="What are you noticing?"></textarea>
  `;
  host.appendChild(pane);
  const textarea = pane.querySelector<HTMLTextAreaElement>('#host-notes-text')!;
  textarea.value = notes;
  textarea.addEventListener('input', () => {
    notes = textarea.value;
  });
  pane.querySelector('#host-notes-close')?.addEventListener('click', () => pane.remove());
  textarea.focus();
}
