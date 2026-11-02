/**
 * Transient toast above the board's status bar, used for feedback on actions
 * that would otherwise fail silently (e.g. a rejected connection). One toast
 * at a time; a new message replaces the current one and restarts the timer.
 */

let toast: HTMLElement | null = null;
let hideTimer: number | null = null;

const TOAST_DURATION_MS = 3600;

export function showBoardToast(message: string): void {
  const host = document.querySelector('.canvas-workspace');
  if (!host) return;

  if (!toast || !toast.isConnected) {
    toast = document.createElement('div');
    toast.id = 'board-toast';
    toast.className = 'board-toast';
    toast.setAttribute('role', 'status');
    host.appendChild(toast);
  }
  toast.textContent = message;

  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(dismissBoardToast, TOAST_DURATION_MS);
}

export function dismissBoardToast(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  toast?.remove();
  toast = null;
}
