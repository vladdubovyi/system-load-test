import type { Request, RequestEvent } from '../game/types';
import { REQUEST_COLORS } from '../game/types';
import { getComponentDef } from '../game/component-catalog';

/**
 * Floating panel that shows the full journey of one request: where it went,
 * how long each hop took, and where it is right now. While the simulation is
 * running the panel re-renders live; while paused it is a frozen trace.
 */

export interface RequestInspectorContext {
  /** Current simulation time, used for live durations. */
  now: number;
  paused: boolean;
  /** Whether the simulation is still running (as opposed to finished/idle). */
  running: boolean;
}

interface TimelineNode {
  type: 'source' | 'travel' | 'component' | 'end';
  at?: number;
  ms?: number;
  live?: boolean;
  label?: string;
  emoji?: string;
  componentType?: string;
  lines?: string[];
  liveLine?: string;
  ok?: boolean;
  reason?: string;
}

let panel: HTMLElement | null = null;
let lastSignature = '';
let lastRenderAt = 0;
let onCloseHandler: (() => void) | null = null;

const LIVE_RENDER_INTERVAL_MS = 90;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = seconds * 1000;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatClock(seconds: number): string {
  return `t=${seconds.toFixed(2)}s`;
}

function describeState(request: Request, ctx: RequestInspectorContext): { label: string; tone: string } {
  switch (request.state) {
    case 'traveling': {
      const last = [...request.events].reverse().find((e) => e.detail && e.kind !== 'arrived');
      const target = last?.detail?.replace(/^→\s*/, '');
      return { label: target ? `In flight → ${target}` : 'In flight', tone: 'flight' };
    }
    case 'queued':
    case 'processing': {
      const arrived = [...request.events].reverse().find((e) => e.kind === 'arrived');
      return {
        label: arrived?.componentLabel ? `Queued at ${arrived.componentLabel}` : 'Queued',
        tone: 'queued',
      };
    }
    case 'done':
      return { label: 'Completed', tone: 'done' };
    case 'dropped':
      return { label: 'Dropped', tone: 'dropped' };
    default:
      return { label: ctx.running ? 'Unknown' : 'Idle', tone: 'flight' };
  }
}

function buildTimeline(request: Request, ctx: RequestInspectorContext): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let travelStart: number | null = null;
  let current: TimelineNode | null = null;

  const pushTravel = (end: number, live = false) => {
    if (travelStart === null) return;
    nodes.push({ type: 'travel', ms: end - travelStart, live });
    travelStart = null;
  };

  for (const ev of request.events as RequestEvent[]) {
    switch (ev.kind) {
      case 'spawned':
        nodes.push({ type: 'source', at: ev.at, lines: ev.detail ? [ev.detail] : [] });
        travelStart = ev.at;
        break;
      case 'arrived': {
        pushTravel(ev.at);
        const def = ev.componentType ? getComponentDef(ev.componentType) : null;
        current = {
          type: 'component',
          at: ev.at,
          label: ev.componentLabel ?? ev.componentId ?? 'Component',
          emoji: def?.emoji ?? '▣',
          componentType: ev.componentType,
          lines: [],
        };
        nodes.push(current);
        break;
      }
      case 'routed':
        current?.lines?.push(`routed ${ev.detail ?? ''}`.trim());
        travelStart = ev.at;
        break;
      case 'processed': {
        const waited = current?.at !== undefined ? ev.at - current.at : 0;
        current?.lines?.push(
          waited > 0.0005 ? `queued ${formatDuration(waited)} · processed` : 'processed immediately'
        );
        if (ev.detail) current?.lines?.push(ev.detail);
        break;
      }
      case 'forwarded':
        current?.lines?.push(`forwarded ${ev.detail ?? ''}`.trim());
        travelStart = ev.at;
        break;
      case 'completed':
        nodes.push({ type: 'end', ok: true, at: ev.at });
        break;
      case 'dropped':
        if (ev.componentLabel && (!current || current.label !== ev.componentLabel)) {
          pushTravel(ev.at);
          const def = ev.componentType ? getComponentDef(ev.componentType) : null;
          current = {
            type: 'component',
            at: ev.at,
            label: ev.componentLabel,
            emoji: def?.emoji ?? '▣',
            componentType: ev.componentType,
            lines: [],
          };
          nodes.push(current);
        }
        nodes.push({ type: 'end', ok: false, at: ev.at, reason: ev.detail });
        break;
    }
  }

  // Live tail: where is the request right now?
  if (request.state === 'traveling' && travelStart !== null) {
    nodes.push({ type: 'travel', ms: ctx.now - travelStart, live: true });
    nodes.push({ type: 'end', ok: true, live: true });
  } else if ((request.state === 'queued' || request.state === 'processing') && current) {
    current.liveLine = `waiting in queue · ${formatDuration(ctx.now - (current.at ?? ctx.now))}`;
  }

  return nodes;
}

function renderTimeline(nodes: TimelineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'source':
          return `
            <li class="ri-node ri-node-source">
              <span class="ri-dot"></span>
              <div class="ri-node-body">
                <div class="ri-node-title">📨 Incoming requests <span class="ri-time">${formatClock(node.at ?? 0)}</span></div>
                ${node.lines?.length ? `<div class="ri-node-line">${escapeHtml(node.lines[0])}</div>` : ''}
              </div>
            </li>`;
        case 'travel':
          return `
            <li class="ri-travel ${node.live ? 'is-live' : ''}">
              <span class="ri-travel-line"></span>
              <span class="ri-travel-label">${node.live ? 'in flight' : 'travel'} · ${formatDuration(node.ms ?? 0)}</span>
            </li>`;
        case 'component':
          return `
            <li class="ri-node ri-node-component ${node.liveLine ? 'is-live' : ''}">
              <span class="ri-dot"></span>
              <div class="ri-node-body">
                <div class="ri-node-title">${node.emoji ?? ''} ${escapeHtml(node.label ?? '')} <span class="ri-time">${formatClock(node.at ?? 0)}</span></div>
                ${(node.lines ?? []).map((line) => `<div class="ri-node-line">${escapeHtml(line)}</div>`).join('')}
                ${node.liveLine ? `<div class="ri-node-line ri-live-line">${escapeHtml(node.liveLine)}</div>` : ''}
              </div>
            </li>`;
        case 'end':
          if (node.live) {
            return `
              <li class="ri-node ri-node-end is-pending">
                <span class="ri-dot"></span>
                <div class="ri-node-body"><div class="ri-node-title">…</div></div>
              </li>`;
          }
          return `
            <li class="ri-node ri-node-end ${node.ok ? 'is-ok' : 'is-dropped'}">
              <span class="ri-dot"></span>
              <div class="ri-node-body">
                <div class="ri-node-title">${node.ok ? '✓ Completed' : '✕ Dropped'} <span class="ri-time">${formatClock(node.at ?? 0)}</span></div>
                ${node.reason ? `<div class="ri-node-line">${escapeHtml(node.reason)}</div>` : ''}
              </div>
            </li>`;
      }
    })
    .join('');
}

function signatureFor(request: Request, ctx: RequestInspectorContext): string {
  const live = request.finishedAt === null && ctx.running && !ctx.paused;
  const liveBucket = live ? Math.floor(ctx.now * 20) : 0;
  return `${request.id}:${request.state}:${request.events.length}:${liveBucket}:${ctx.paused ? 'p' : 'r'}:${ctx.running ? 1 : 0}`;
}

export function mountRequestInspector(host: HTMLElement, onClose: () => void): void {
  unmountRequestInspector();
  onCloseHandler = onClose;
  panel = document.createElement('aside');
  panel.className = 'request-inspector';
  panel.id = 'request-inspector';
  panel.setAttribute('aria-label', 'Request inspector');
  host.appendChild(panel);
  lastSignature = '';
}

export function unmountRequestInspector(): void {
  panel?.remove();
  panel = null;
  onCloseHandler = null;
  lastSignature = '';
}

export function isRequestInspectorMounted(): boolean {
  return panel !== null && panel.isConnected;
}

export function updateRequestInspector(request: Request | null, ctx: RequestInspectorContext): void {
  if (!panel) return;

  if (!request) {
    panel.innerHTML = `
      <header class="ri-header">
        <div class="ri-title">Request</div>
        <button class="ri-close" type="button" aria-label="Close">✕</button>
      </header>
      <p class="ri-empty">Pause the simulation and click any moving dot to trace its journey.</p>
    `;
    bindClose();
    lastSignature = '';
    return;
  }

  const signature = signatureFor(request, ctx);
  const nowMs = performance.now();
  const isLive = request.finishedAt === null && ctx.running && !ctx.paused;
  if (signature === lastSignature) return;
  if (isLive && nowMs - lastRenderAt < LIVE_RENDER_INTERVAL_MS && lastSignature.startsWith(`${request.id}:`)) {
    return;
  }
  lastSignature = signature;
  lastRenderAt = nowMs;

  const color = REQUEST_COLORS[request.colorIndex] ?? REQUEST_COLORS[0];
  const stateInfo = describeState(request, ctx);
  const totalLatency = (request.finishedAt ?? ctx.now) - request.spawnedAt;
  const hops = request.events.filter((e) => e.kind === 'arrived').length;
  const nodes = buildTimeline(request, ctx);

  let liveBadge = '';
  if (request.finishedAt === null) {
    liveBadge = ctx.paused
      ? '<span class="ri-badge ri-badge-paused">⏸ paused</span>'
      : ctx.running
        ? '<span class="ri-badge ri-badge-live"><span class="ri-live-dot"></span>live</span>'
        : '';
  }

  panel.innerHTML = `
    <header class="ri-header">
      <span class="ri-swatch" style="--ri-color: ${color}"></span>
      <div class="ri-title">
        Request <span class="ri-id">#${request.id}</span>
        <span class="ri-pill ri-pill-${request.kind}">${request.kind}</span>
        ${request.celebrity ? '<span class="ri-pill ri-pill-viral">viral</span>' : ''}
      </div>
      ${liveBadge}
      <button class="ri-close" type="button" aria-label="Close inspector">✕</button>
    </header>
    <div class="ri-summary">
      <div class="ri-state ri-state-${stateInfo.tone}">${escapeHtml(stateInfo.label)}</div>
      <div class="ri-metrics">
        <div><span class="ri-metric-label">Latency</span><span class="ri-metric-value">${formatDuration(totalLatency)}</span></div>
        <div><span class="ri-metric-label">Hops</span><span class="ri-metric-value">${hops}</span></div>
        <div><span class="ri-metric-label">Queued</span><span class="ri-metric-value">${formatDuration(request.waitTime)}</span></div>
      </div>
    </div>
    <ol class="ri-timeline">${renderTimeline(nodes)}</ol>
    <footer class="ri-footer">
      ${
        ctx.paused && request.finishedAt === null
          ? 'Resume to watch this request continue live.'
          : request.finishedAt !== null
            ? 'This request has finished. Click another dot to trace it.'
            : 'Updating live. Pause to freeze the trace.'
      }
    </footer>
  `;
  bindClose();
}

function bindClose(): void {
  panel?.querySelector('.ri-close')?.addEventListener('click', () => {
    onCloseHandler?.();
  });
}
