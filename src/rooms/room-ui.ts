import type { ParticipantInfo, RoomSettings } from './room-client';
import { effectiveLintVisible, effectiveReportVisibility } from './room-client';
import { hostLink, participantLink } from './join-codes';

/**
 * Room chrome (docs/specs/interview-platform.md §3, §5.3): the Share / Join
 * dialog, the presence panel, remote cursors and the "room ended" banner.
 * Pure DOM; the sandbox owns the state and calls back in.
 */

export type RoomStatus = 'none' | 'busy' | 'host' | 'participant';

export interface RoomViewModel {
  status: RoomStatus;
  /** Formatted join code, when known to this client. */
  joinCode: string | null;
  hostSecret: string | null;
  name: string | null;
  connectionId: string | null;
  participants: ParticipantInfo[];
  error: string | null;
  settings: RoomSettings;
  penHolder: string | null;
  /** Connections that raised a hand for the pen (host side). */
  penRequests: string[];
  /** A report exists that participants have not been shown yet (host side). */
  reportHeld: boolean;
  /**
   * The open → interview warning is showing (§4.2): participants have seen
   * the scenario's internals, so offer a fresh room with new credentials.
   */
  offerFreshRoom: boolean;
}

export interface RoomDialogCallbacks {
  onShare: () => void;
  onJoin: (input: string) => void;
  onRotateCode: () => void;
  onRotateHost: () => void;
  onLeave: () => void;
  onClose: () => void;
  onSettings: (settings: RoomSettings) => void;
  onAssignPen: (connectionId: string | null) => void;
  onRequestPen: () => void;
  onReleaseReport: () => void;
  /** Start a fresh interview room around the current board (§4.2). */
  onFreshRoom: () => void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DIALOG_CONTAINER_ID = 'room-dialog-container';
let dialogCallbacks: RoomDialogCallbacks | null = null;
let dialogModel: RoomViewModel | null = null;

export function isRoomDialogOpen(): boolean {
  return document.getElementById(DIALOG_CONTAINER_ID) !== null;
}

export function openRoomDialog(model: RoomViewModel, callbacks: RoomDialogCallbacks): void {
  closeRoomDialog();
  dialogCallbacks = callbacks;
  const container = document.createElement('div');
  container.id = DIALOG_CONTAINER_ID;
  container.className = 'modal-container';
  document.body.appendChild(container);
  updateRoomDialog(model);
}

export function closeRoomDialog(): void {
  document.getElementById(DIALOG_CONTAINER_ID)?.remove();
  dialogCallbacks = null;
  dialogModel = null;
}

/** Re-render the open dialog for a new model; a no-op when it is closed. */
export function updateRoomDialog(model: RoomViewModel): void {
  const container = document.getElementById(DIALOG_CONTAINER_ID);
  if (!container || !dialogCallbacks) return;
  const pendingInput =
    container.querySelector<HTMLInputElement>('#room-join-code')?.value ?? '';
  dialogModel = model;
  container.innerHTML = renderRoomDialog(model);
  bindDialog(container, dialogCallbacks);
  const input = container.querySelector<HTMLInputElement>('#room-join-code');
  if (input && pendingInput) input.value = pendingInput;
}

export function renderRoomDialog(model: RoomViewModel): string {
  return `
    <div class="room-dialog" id="room-dialog" role="dialog" aria-labelledby="room-dialog-title">
      <div class="config-panel-header">
        <h3 id="room-dialog-title">${model.status === 'none' || model.status === 'busy' ? 'Share or join a room' : 'Room'}</h3>
        <button class="config-panel-close" id="room-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="config-panel-body room-dialog-body">
        ${renderDialogBody(model)}
        ${model.error ? `<p class="room-error" id="room-error" role="alert">${escapeHtml(model.error)}</p>` : ''}
        ${model.offerFreshRoom ? '<button class="config-btn config-btn-primary" id="room-fresh-interview" type="button" title="Leave this room and open a new one, with new credentials, around the same board">Start a fresh interview room</button>' : ''}
      </div>
    </div>
  `;
}

function renderDialogBody(model: RoomViewModel): string {
  switch (model.status) {
    case 'none':
    case 'busy': {
      const busy = model.status === 'busy';
      return `
        <section class="room-section">
          <h4>Share this board</h4>
          <p>Anyone with the link or the code lands on this canvas, live. No sign-up, no names, and the room disappears when everyone leaves.</p>
          <button class="config-btn config-btn-primary" id="room-share" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Share'}</button>
        </section>
        <section class="room-section">
          <h4>Join a room</h4>
          <form class="room-join-form" id="room-join-form">
            <input id="room-join-code" class="room-join-input" type="text" autocomplete="off" spellcheck="false" placeholder="K7QM-2XRD or a link" aria-label="Join code or participant link" ${busy ? 'disabled' : ''} />
            <button class="config-btn config-btn-secondary" id="room-join" type="submit" ${busy ? 'disabled' : ''}>Join</button>
          </form>
          <p class="room-join-error" id="room-join-error" role="alert"></p>
        </section>
      `;
    }
    case 'host': {
      const code = model.joinCode ?? '';
      const link = participantLink(code);
      const host = model.hostSecret ? hostLink(model.hostSecret) : '';
      return `
        <section class="room-section">
          <p class="room-code-row">Join code <strong class="room-code" id="room-code">${escapeHtml(code)}</strong>
            <button class="config-btn config-btn-secondary room-copy" id="room-copy-code" type="button" data-copy="${escapeHtml(code)}">Copy</button></p>
          <label class="room-link-row">Participant link
            <span class="room-link-field"><input id="room-participant-link" readonly value="${escapeHtml(link)}" aria-label="Participant link" />
            <button class="config-btn config-btn-secondary room-copy" id="room-copy-link" type="button" data-copy="${escapeHtml(link)}">Copy</button></span>
          </label>
          <label class="room-link-row">Host link
            <span class="room-link-field"><input id="room-host-link" readonly value="${escapeHtml(host)}" aria-label="Host link" />
            <button class="config-btn config-btn-secondary room-copy" id="room-copy-host" type="button" data-copy="${escapeHtml(host)}">Copy</button></span>
          </label>
          <p class="room-warning" id="room-host-warning">Keep this to get back in as host.</p>
        </section>
        ${renderSettings(model)}
        ${renderParticipants(model)}
        <div class="config-panel-actions room-actions">
          <button class="config-btn config-btn-secondary" id="room-rotate-code" type="button" title="Invalidate the current code and link; people already here stay">New join code</button>
          <button class="config-btn config-btn-secondary" id="room-rotate-host" type="button" title="Issue a new host link and sign out other host tabs">New host link</button>
          <button class="config-btn config-btn-secondary room-leave" id="room-leave" type="button">Leave room</button>
        </div>
      `;
    }
    case 'participant':
      return `
        <section class="room-section">
          <p>You're in room <strong class="room-code" id="room-code">${escapeHtml(model.joinCode ?? '')}</strong> as <strong>${escapeHtml(model.name ?? '')}</strong>.</p>
          ${model.settings.pen === 'single' && model.penHolder !== model.connectionId ? '<button class="config-btn config-btn-secondary" id="room-request-pen" type="button">✋ Request the pen</button>' : ''}
        </section>
        ${renderParticipants(model)}
        <div class="config-panel-actions room-actions">
          <button class="config-btn config-btn-secondary room-leave" id="room-leave" type="button">Leave room</button>
        </div>
      `;
  }
}

function renderSettings(model: RoomViewModel): string {
  const s = model.settings;
  const opt = (value: string, current: string, label: string): string =>
    `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  return `
    <section class="room-section room-settings" id="room-settings">
      <h4>Room settings</h4>
      <p>Take effect immediately for everyone and end with the room.</p>
      <div class="room-settings-grid">
        <label>Mode
          <select id="room-setting-mode">${opt('open', s.mode, 'Open: everyone sees everything')}${opt('interview', s.mode, 'Interview: hide flows and objectives')}</select>
        </label>
        <label>Pen
          <select id="room-setting-pen">${opt('shared', s.pen, 'Shared: anyone edits')}${opt('single', s.pen, 'Single: one person holds the pen')}</select>
        </label>
        <label>Who can run
          <select id="room-setting-run">${opt('anyone', s.whoCanRun, 'Anyone')}${opt('hostOnly', s.whoCanRun, 'Host only')}</select>
        </label>
        <label>Report
          <select id="room-setting-report">${opt('default', s.reportVisibility ?? 'default', `Default for mode (${effectiveReportVisibility({ ...s, reportVisibility: null }) === 'everyone' ? 'everyone' : 'host only'})`)}${opt('everyone', s.reportVisibility ?? 'default', 'Everyone sees it')}${opt('hostOnly', s.reportVisibility ?? 'default', 'Host only, until released')}</select>
        </label>
        <label>Traffic seed
          <input id="room-setting-seed" type="number" min="1" step="1" placeholder="random per run" value="${s.seed ?? ''}" />
        </label>
        <label class="room-setting-check">
          <input id="room-setting-lint" type="checkbox" ${effectiveLintVisible(s) ? 'checked' : ''} />
          Participants see the design lint${s.mode === 'interview' ? ' <span class="room-hint" id="room-lint-hint">(sends them the flows as hints)</span>' : ''}
        </label>
      </div>
      ${model.reportHeld ? '<button class="config-btn config-btn-primary" id="room-release-report" type="button">Release the report to participants</button>' : ''}
      ${
        s.mode === 'interview'
          ? '<p class="room-hint" id="room-integrity-note">Interview mode withholds the scenario’s flows and objectives from participants’ screens and from idle inspection — not from a determined participant reading the browser’s network traffic during a run.</p>'
          : ''
      }
    </section>
  `;
}

function renderParticipants(model: RoomViewModel): string {
  return `
    <section class="room-section">
      <h4>In this room</h4>
      <ul class="room-participants">${participantItems(model)}</ul>
    </section>
  `;
}

function participantItems(model: RoomViewModel): string {
  const single = model.settings.pen === 'single';
  const amHost = model.status === 'host';
  return model.participants
    .map(
      (p) => `
        <li class="room-participant" data-connection-id="${escapeHtml(p.connectionId)}" data-role="${p.role.toLowerCase()}" ${single && model.penHolder === p.connectionId ? 'data-pen="1"' : ''}>
          <span class="room-participant-name">${escapeHtml(p.name)}</span>
          <span class="room-role">${p.role === 'Host' ? 'Host' : 'Participant'}</span>
          ${p.connectionId === model.connectionId ? '<span class="room-you">(you)</span>' : ''}
          ${single && model.penHolder === p.connectionId ? '<span class="room-pen" title="Holds the pen">✏️</span>' : ''}
          ${model.penRequests.includes(p.connectionId) ? '<span class="room-hand" title="Asked for the pen">✋</span>' : ''}
          ${amHost && single && model.penHolder !== p.connectionId ? `<button class="config-btn config-btn-secondary room-give-pen" type="button" data-give-pen="${escapeHtml(p.connectionId)}">Give pen</button>` : ''}
        </li>`
    )
    .join('');
}

function bindDialog(container: HTMLElement, callbacks: RoomDialogCallbacks): void {
  container.querySelector('#room-close')?.addEventListener('click', callbacks.onClose);
  container.querySelector('#room-share')?.addEventListener('click', callbacks.onShare);
  container.querySelector('#room-join-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = container.querySelector<HTMLInputElement>('#room-join-code');
    callbacks.onJoin(input?.value ?? '');
  });
  container.querySelector('#room-rotate-code')?.addEventListener('click', callbacks.onRotateCode);
  container.querySelector('#room-rotate-host')?.addEventListener('click', callbacks.onRotateHost);
  container.querySelector('#room-leave')?.addEventListener('click', callbacks.onLeave);
  container.querySelector('#room-request-pen')?.addEventListener('click', callbacks.onRequestPen);
  container.querySelector('#room-release-report')?.addEventListener('click', callbacks.onReleaseReport);
  container.querySelector('#room-fresh-interview')?.addEventListener('click', callbacks.onFreshRoom);
  container.querySelectorAll<HTMLButtonElement>('[data-give-pen]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onAssignPen(btn.dataset.givePen ?? null));
  });
  const settingsForm = container.querySelector('#room-settings');
  if (settingsForm && dialogModel) {
    const read = (changed: Element | null): RoomSettings => {
      const v = (id: string): string => (container.querySelector(`#${id}`) as HTMLSelectElement | HTMLInputElement | null)?.value ?? '';
      const current = dialogModel!.settings;
      const mode = v('room-setting-mode') as RoomSettings['mode'];
      const report = v('room-setting-report');
      const seedText = v('room-setting-seed').trim();
      const lint = (container.querySelector('#room-setting-lint') as HTMLInputElement | null)?.checked ?? true;
      const next: RoomSettings = {
        mode,
        pen: v('room-setting-pen') as RoomSettings['pen'],
        whoCanRun: v('room-setting-run') as RoomSettings['whoCanRun'],
        reportVisibility: report === 'default' ? null : (report as RoomSettings['reportVisibility']),
        seed: seedText === '' ? null : Math.max(1, Math.floor(Number(seedText)) || 1),
        // Keep "default" when the checkbox equals the mode's default, so a
        // mode switch flips it; a mode change itself is never a lint choice.
        lintVisible:
          changed?.id === 'room-setting-mode'
            ? current.lintVisible
            : lint === effectiveLintVisible({ ...current, mode, lintVisible: null })
              ? null
              : lint,
      };
      return next;
    };
    settingsForm.querySelectorAll('select, input').forEach((el) => {
      el.addEventListener('change', () => callbacks.onSettings(read(el)));
    });
  }
  container.querySelectorAll<HTMLButtonElement>('.room-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      void copyText(btn.dataset.copy ?? '').then((ok) => {
        const label = btn.textContent;
        btn.textContent = ok ? 'Copied' : 'Select and copy';
        window.setTimeout(() => {
          btn.textContent = label;
        }, 1500);
      });
    });
  });
  container.querySelector<HTMLInputElement>('#room-join-code')?.focus();
}

/** Show an inline problem with the typed code without re-rendering the dialog. */
export function showJoinInputError(message: string): void {
  const el = document.getElementById('room-join-error');
  if (el) el.textContent = message;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Presence panel ─────────────────────────────────────────────────────────

/** Render (or remove) the presence panel inside the canvas workspace. */
export function renderPresencePanel(model: RoomViewModel, onOpen: () => void): void {
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;
  let panel = document.getElementById('room-presence');
  if (model.status !== 'host' && model.status !== 'participant') {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('button');
    panel.id = 'room-presence';
    panel.className = 'room-presence';
    panel.setAttribute('type', 'button');
    panel.setAttribute('title', 'Room details');
    panel.addEventListener('click', onOpen);
    host.appendChild(panel);
  }
  const count = model.participants.length;
  const flags: string[] = [];
  if (model.settings.mode === 'interview') flags.push('Interview mode');
  if (model.settings.pen === 'single') flags.push(model.penHolder === model.connectionId ? 'You hold the pen' : 'Single pen');
  if (model.settings.whoCanRun === 'hostOnly') flags.push('Host runs');
  if (model.settings.seed !== null) flags.push(`Seed ${model.settings.seed}`);
  if (model.reportHeld) flags.push('Report held');
  panel.innerHTML = `
    <span class="room-presence-code">${model.joinCode ? `Room ${escapeHtml(model.joinCode)}` : 'In a room'}</span>
    <span class="room-presence-count">${count} ${count === 1 ? 'person' : 'people'}${model.penRequests.length ? ` · ✋ ${model.penRequests.length}` : ''}</span>
    ${flags.length ? `<span class="room-presence-flags" id="room-presence-flags">${flags.map(escapeHtml).join(' · ')}</span>` : ''}
    <ul class="room-presence-list">${participantItems(model)}</ul>
  `;
}

// ── Remote cursors ─────────────────────────────────────────────────────────

const cursors = new Map<string, { name: string; x: number; y: number; seen: number }>();
const CURSOR_LAYER_ID = 'remote-cursors';
const CURSOR_STALE_MS = 8000;

function cursorLayer(): HTMLElement | null {
  const board = document.getElementById('board');
  if (!board) return null;
  let layer = document.getElementById(CURSOR_LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = CURSOR_LAYER_ID;
    layer.className = 'remote-cursors';
    board.appendChild(layer);
  }
  return layer;
}

export function showRemoteCursor(connectionId: string, name: string, x: number, y: number): void {
  cursors.set(connectionId, { name, x, y, seen: performance.now() });
  paintCursors();
}

export function removeRemoteCursor(connectionId: string): void {
  cursors.delete(connectionId);
  paintCursors();
}

export function clearRemoteCursors(): void {
  cursors.clear();
  document.getElementById(CURSOR_LAYER_ID)?.remove();
}

/** Re-create the cursor layer after the board DOM was rebuilt. */
export function remountRemoteCursors(): void {
  if (cursors.size === 0) return;
  paintCursors();
}

function paintCursors(): void {
  const layer = cursorLayer();
  if (!layer) return;
  const now = performance.now();
  for (const [id, c] of cursors) {
    if (now - c.seen > CURSOR_STALE_MS) cursors.delete(id);
  }
  layer.innerHTML = [...cursors]
    .map(
      ([id, c]) => `
        <div class="remote-cursor" data-connection-id="${escapeHtml(id)}" style="transform: translate(${c.x}px, ${c.y}px)">
          <span class="remote-cursor-dot"></span>
          <span class="remote-cursor-name">${escapeHtml(c.name)}</span>
        </div>`
    )
    .join('');
}

// ── Held report notice (§4, report visibility) ─────────────────────────────

const HELD_ID = 'room-report-held';

/** Participants see this instead of the report until the host releases it. */
export function showHeldReportNotice(): void {
  hideHeldReportNotice();
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;
  const el = document.createElement('div');
  el.id = HELD_ID;
  el.className = 'room-banner room-report-held';
  el.setAttribute('role', 'status');
  el.innerHTML = `<strong>Run complete.</strong> <span class="room-banner-why">The host will share the report when ready.</span>
    <button class="config-btn config-btn-secondary" id="room-report-held-dismiss" type="button">OK</button>`;
  el.querySelector('#room-report-held-dismiss')?.addEventListener('click', hideHeldReportNotice);
  host.appendChild(el);
}

export function hideHeldReportNotice(): void {
  document.getElementById(HELD_ID)?.remove();
}

// ── Public-scenario banner (§6.1) ──────────────────────────────────────────

const PUBLIC_SCENARIO_ID = 'room-public-scenario';

/**
 * In interview mode, an unedited catalog scenario is public: its flows and
 * objectives ship with the app and the API. The host sees this until the
 * first Apply makes the scenario theirs.
 */
export function renderPublicScenarioBanner(show: boolean): void {
  const existing = document.getElementById(PUBLIC_SCENARIO_ID);
  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;
  const el = document.createElement('div');
  el.id = PUBLIC_SCENARIO_ID;
  el.className = 'room-banner room-public-scenario';
  el.setAttribute('role', 'status');
  el.innerHTML =
    '<strong>This is a public scenario</strong> <span class="room-banner-why">— participants may know it. Edit it to make it yours.</span>';
  host.appendChild(el);
}

// ── Room ended banner ──────────────────────────────────────────────────────

const BANNER_ID = 'room-banner';

export function showRoomBanner(reason: string, onRestart: (() => void) | null, onDismiss: () => void): void {
  hideRoomBanner();
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'room-banner';
  banner.setAttribute('role', 'alert');
  const why =
    reason === 'idle'
      ? 'Nothing happened here for 12 hours, so the room was closed.'
      : reason === 'host-link-rotated'
        ? 'The host issued a new host link from another tab.'
        : reason === 'connection-lost'
          ? 'The connection to the room server was lost.'
          : 'Rooms live in memory and this one is gone.';
  banner.innerHTML = `
    <strong>This room has ended.</strong>
    <span class="room-banner-why">${escapeHtml(why)} Your board is still here.</span>
    ${onRestart ? '<button class="config-btn config-btn-primary" id="room-restart" type="button">Start a new room</button>' : ''}
    <button class="config-btn config-btn-secondary" id="room-banner-dismiss" type="button">OK</button>
  `;
  banner.querySelector('#room-restart')?.addEventListener('click', () => onRestart?.());
  banner.querySelector('#room-banner-dismiss')?.addEventListener('click', onDismiss);
  host.appendChild(banner);
}

export function hideRoomBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

export function currentDialogModel(): RoomViewModel | null {
  return dialogModel;
}
