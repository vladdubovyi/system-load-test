import {
  HubConnection,
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from '@microsoft/signalr';
import { apiBaseUrl } from '../api/client';
import type { BoardDiff, BoardEntityKind, BoardState, EntityChange } from '../game/board-diff';
import { createEmptyBoard } from '../game/board-diff';
import type { ConveyorBelt, PlacedComponent } from '../game/types';
import type { ComponentInstanceConfig } from '../game/component-config';
import type { DrawStroke, TextAnnotation } from '../game/board-annotations';
import type { FlowSpec, ScenarioDocument } from '../game/flow-types';
import type { TrafficProfile } from '../game/scenario-types';

/**
 * The client side of the room hub (docs/specs/interview-platform.md §3, §5).
 *
 * Credentials travel in invocations after the connection is up, never in the
 * query string (§3.2), so there is no `accessTokenFactory`. The transport is
 * WebSockets with negotiation skipped: one round trip less, nothing for a
 * static host to proxy, and the same URL in tests and production.
 */

export type RoomRole = 'Host' | 'Participant';

export interface ParticipantInfo {
  connectionId: string;
  name: string;
  role: RoomRole;
}

/** One board entity on the wire: opaque to the server, keyed by kind and ID. */
export interface WireEntity {
  kind: BoardEntityKind;
  id: string;
  value: unknown;
}

/** One change on the wire. `after` null means removed. */
export interface WireChange {
  kind: BoardEntityKind;
  id: string;
  after: unknown | null;
}

export interface RoomCreated {
  joinCode: string;
  hostSecret: string;
  connectionId: string;
  name: string;
  version: number;
  participants: ParticipantInfo[];
}

export interface RoomJoined {
  role: RoomRole;
  connectionId: string;
  name: string;
  joinCode: string | null;
  /** Null for interview-mode participants (§6.1): the slug identifies the scenario. */
  scenarioSlug: string | null;
  /** Interview-mode participants only: the stripped catalog entry, in the API wire shape. */
  challenge: unknown | null;
  scenarioOverride: ScenarioDocument | null;
  trafficOverride: TrafficProfile | null;
  version: number;
  board: WireEntity[];
  participants: ParticipantInfo[];
  /** A run in progress, for fast-forwarding from tick 0 (§4.4). */
  run: RunState | null;
  settings: RoomSettings;
  penHolder: string | null;
  reportReleased: boolean;
}

// ── Settings (§4) ──────────────────────────────────────────────────────────

export type RoomMode = 'open' | 'interview';
export type PenMode = 'shared' | 'single';
export type ReportVisibility = 'everyone' | 'hostOnly';
export type WhoCanRun = 'anyone' | 'hostOnly';

export interface RoomSettings {
  mode: RoomMode;
  pen: PenMode;
  /** Null means the mode's default: on in open, off in interview. */
  lintVisible: boolean | null;
  seed: number | null;
  /** Null means the mode's default: everyone in open, host only in interview. */
  reportVisibility: ReportVisibility | null;
  whoCanRun: WhoCanRun;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mode: 'open',
  pen: 'shared',
  lintVisible: null,
  seed: null,
  reportVisibility: null,
  whoCanRun: 'anyone',
};

export function effectiveLintVisible(s: RoomSettings): boolean {
  return s.lintVisible ?? s.mode !== 'interview';
}

export function effectiveReportVisibility(s: RoomSettings): ReportVisibility {
  return s.reportVisibility ?? (s.mode === 'interview' ? 'hostOnly' : 'everyone');
}

// ── Runs (§4.4) ────────────────────────────────────────────────────────────

export type RunEventKind = 'pause' | 'resume' | 'speed' | 'failure' | 'stop';

export interface RunEvent {
  seq: number;
  kind: RunEventKind;
  payload: unknown | null;
  from: string;
  /** Null until the controller stamps it. */
  applyAtTick: number | null;
}

export interface TickStamp {
  seq: number;
  applyAtTick: number;
}

export interface RunTick {
  tick: number;
  stamps: TickStamp[];
}

export interface RunStarted {
  seed: number;
  boardVersion: number;
  controllerConnectionId: string;
  /**
   * The opaque flow bundle (§6.2): set only for interview-mode participants,
   * whose scenario projection withholds the flows their engine needs. Never
   * rendered, discarded when the run ends.
   */
  flows?: FlowSpec[] | null;
}

export interface RunState extends RunStarted {
  lastTick: number;
  events: RunEvent[];
}

export interface BoardChanged {
  version: number;
  origin: string;
  changes: WireChange[];
}

export interface BoardSnapshotMessage {
  version: number;
  board: WireEntity[];
}

/** A connection's current view of the room's scenario (§6.1). */
export interface ScenarioProjection {
  scenarioSlug: string | null;
  challenge: unknown | null;
  scenarioOverride: ScenarioDocument | null;
}

export interface RoomClientEvents {
  onBoardChanged: (message: BoardChanged) => void;
  onPresence: (participants: ParticipantInfo[]) => void;
  onCursor: (connectionId: string, x: number, y: number) => void;
  onScenarioChanged: (projection: ScenarioProjection) => void;
  onTrafficChanged: (trafficOverride: TrafficProfile | null) => void;
  onRunStarted: (run: RunStarted) => void;
  onRunTick: (tick: RunTick) => void;
  onRunEvent: (event: RunEvent) => void;
  onRunEnded: (reason: 'finished' | 'stopped' | 'interrupted') => void;
  onRunControllerChanged: (controllerConnectionId: string, lastTick: number) => void;
  onSettingsChanged: (settings: RoomSettings, penHolder: string | null) => void;
  onPenChanged: (penHolder: string | null) => void;
  onPenRequested: (connectionId: string, name: string) => void;
  onReportReleased: () => void;
  /** The server ended the room: `idle`, `host-link-rotated`. */
  onEnded: (reason: string) => void;
  /** The connection dropped and automatic reconnection gave up, or the server went away. */
  onClosed: (error?: Error) => void;
  /** Reconnected with a new connection ID; the caller must join again. */
  onReconnected: () => void;
}

export function roomHubUrl(): string {
  return `${apiBaseUrl().replace(/\/+$/, '')}/hubs/room`;
}

/** The message a `HubException` carried, or a generic one for transport failures. */
export function roomErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // SignalR wraps hub errors as "An unexpected error occurred invoking 'X' on
  // the server. HubException: <message>".
  const hub = text.match(/HubException:\s*(.*)$/);
  if (hub) return hub[1].trim();
  if (/Failed to (start|complete negotiation|fetch)|WebSocket failed|connection was stopped|is not in the 'Connected' State/i.test(text)) {
    return 'Could not reach the room server.';
  }
  return text;
}

export class RoomClient {
  private readonly connection: HubConnection;
  private disposed = false;

  constructor(events: RoomClientEvents, hubUrl: string = roomHubUrl()) {
    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        transport: HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .withAutomaticReconnect([0, 1000, 3000, 5000])
      .configureLogging(LogLevel.None)
      .build();

    this.connection.on('BoardChanged', (m: BoardChanged) => events.onBoardChanged(m));
    this.connection.on('PresenceChanged', (m: { participants: ParticipantInfo[] }) =>
      events.onPresence(m.participants)
    );
    this.connection.on('CursorMoved', (m: { connectionId: string; x: number; y: number }) =>
      events.onCursor(m.connectionId, m.x, m.y)
    );
    this.connection.on(
      'ScenarioChanged',
      (m: { scenarioSlug?: string | null; challenge?: unknown; scenarioOverride?: ScenarioDocument | null }) =>
        events.onScenarioChanged({
          scenarioSlug: m.scenarioSlug ?? null,
          challenge: m.challenge ?? null,
          scenarioOverride: m.scenarioOverride ?? null,
        })
    );
    this.connection.on('TrafficChanged', (m: { trafficOverride: TrafficProfile | null }) =>
      events.onTrafficChanged(m.trafficOverride ?? null)
    );
    this.connection.on('RunStarted', (m: RunStarted) => events.onRunStarted(m));
    this.connection.on('RunTick', (m: RunTick) => events.onRunTick(m));
    this.connection.on('RunEvent', (m: RunEvent) => events.onRunEvent(m));
    this.connection.on('RunEnded', (m: { reason: 'finished' | 'stopped' | 'interrupted' }) =>
      events.onRunEnded(m.reason)
    );
    this.connection.on(
      'RunControllerChanged',
      (m: { controllerConnectionId: string; lastTick: number }) =>
        events.onRunControllerChanged(m.controllerConnectionId, m.lastTick)
    );
    this.connection.on('SettingsChanged', (m: { settings: RoomSettings; penHolder: string | null }) =>
      events.onSettingsChanged(m.settings, m.penHolder ?? null)
    );
    this.connection.on('PenChanged', (m: { penHolder: string | null }) => events.onPenChanged(m.penHolder ?? null));
    this.connection.on('PenRequested', (m: { connectionId: string; name: string }) =>
      events.onPenRequested(m.connectionId, m.name)
    );
    this.connection.on('ReportReleased', () => events.onReportReleased());
    this.connection.on('RoomEnded', (m: { reason: string }) => events.onEnded(m.reason));
    this.connection.onclose((error) => {
      if (!this.disposed) events.onClosed(error);
    });
    this.connection.onreconnected(() => events.onReconnected());
  }

  get connectionId(): string | null {
    return this.connection.connectionId;
  }

  get isConnected(): boolean {
    return this.connection.state === 'Connected';
  }

  async connect(): Promise<void> {
    if (this.connection.state === 'Disconnected') {
      await this.connection.start();
    }
  }

  createRoom(request: {
    scenarioSlug: string;
    scenarioOverride: ScenarioDocument | null;
    trafficOverride: TrafficProfile | null;
    board: WireEntity[];
  }): Promise<RoomCreated> {
    return this.connection.invoke<RoomCreated>('CreateRoom', request);
  }

  joinByCode(code: string): Promise<RoomJoined> {
    return this.connection.invoke<RoomJoined>('JoinByCode', code);
  }

  joinAsHost(secret: string): Promise<RoomJoined> {
    return this.connection.invoke<RoomJoined>('JoinAsHost', secret);
  }

  applyDiff(baseVersion: number, changes: WireChange[]): Promise<void> {
    return this.connection.invoke('ApplyBoardDiff', { baseVersion, changes });
  }

  requestBoard(): Promise<BoardSnapshotMessage> {
    return this.connection.invoke<BoardSnapshotMessage>('RequestBoard');
  }

  /** Fire-and-forget: cursors are unreliable by design (§5.2). */
  moveCursor(x: number, y: number): void {
    if (!this.isConnected) return;
    void this.connection.send('MoveCursor', x, y).catch(() => undefined);
  }

  setScenarioOverride(doc: ScenarioDocument | null): Promise<void> {
    return this.connection.invoke('SetScenarioOverride', doc);
  }

  setTrafficOverride(traffic: TrafficProfile | null): Promise<void> {
    return this.connection.invoke('SetTrafficOverride', traffic);
  }

  startRun(seed: number | null): Promise<void> {
    return this.connection.invoke('StartRun', seed);
  }

  /** The controller's clock; fire-and-forget like cursors, but rate-limited server-side. */
  reportTick(tick: number, stamps: TickStamp[]): void {
    if (!this.isConnected) return;
    void this.connection.send('ReportTick', { tick, stamps }).catch(() => undefined);
  }

  sendRunEvent(kind: RunEventKind, payload: unknown | null): Promise<void> {
    return this.connection.invoke('SendRunEvent', kind, payload);
  }

  endRun(reason: 'finished' | 'stopped'): Promise<void> {
    return this.connection.invoke('EndRun', reason);
  }

  updateSettings(settings: RoomSettings): Promise<void> {
    return this.connection.invoke('UpdateSettings', settings);
  }

  assignPen(connectionId: string | null): Promise<void> {
    return this.connection.invoke('AssignPen', connectionId);
  }

  requestPen(): Promise<void> {
    return this.connection.invoke('RequestPen');
  }

  releaseReport(): Promise<void> {
    return this.connection.invoke('ReleaseReport');
  }

  rotateJoinCode(): Promise<string> {
    return this.connection.invoke<string>('RotateJoinCode');
  }

  rotateHostLink(): Promise<string> {
    return this.connection.invoke<string>('RotateHostLink');
  }

  async leaveRoom(): Promise<void> {
    if (!this.isConnected) return;
    await this.connection.invoke('LeaveRoom').catch(() => undefined);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.connection.stop().catch(() => undefined);
  }
}

// ── Board ↔ wire conversions ───────────────────────────────────────────────

export function boardToEntities(board: BoardState): WireEntity[] {
  const out: WireEntity[] = [];
  for (const c of board.components) out.push({ kind: 'component', id: c.id, value: c });
  for (const b of board.belts) out.push({ kind: 'belt', id: b.id, value: b });
  for (const [id, cfg] of board.componentConfigs) out.push({ kind: 'config', id, value: cfg });
  for (const t of board.annotations.texts) out.push({ kind: 'text', id: t.id, value: t });
  for (const s of board.annotations.strokes) out.push({ kind: 'stroke', id: s.id, value: s });
  return out;
}

/** Rebuild a board in the server's order, which every client then shares. */
export function entitiesToBoard(entities: WireEntity[]): BoardState {
  const board = createEmptyBoard();
  for (const e of entities) {
    const value = structuredClone(e.value);
    switch (e.kind) {
      case 'component':
        board.components.push(value as PlacedComponent);
        break;
      case 'belt':
        board.belts.push(value as ConveyorBelt);
        break;
      case 'config':
        board.componentConfigs.set(e.id, value as ComponentInstanceConfig);
        break;
      case 'text':
        board.annotations.texts.push(value as TextAnnotation);
        break;
      case 'stroke':
        board.annotations.strokes.push(value as DrawStroke);
        break;
    }
  }
  return board;
}

export function diffToChanges(diff: BoardDiff): WireChange[] {
  return diff.changes.map((c) => ({ kind: c.kind, id: c.id, after: c.after ?? null }));
}

/**
 * Turn an incoming change list into a diff against `current`, filling in
 * `before` from what this client holds so `applyDiff` can run it.
 */
export function changesToDiff(changes: WireChange[], current: BoardState): BoardDiff {
  const lookup = (kind: BoardEntityKind, id: string): unknown => {
    switch (kind) {
      case 'component':
        return current.components.find((c) => c.id === id) ?? null;
      case 'belt':
        return current.belts.find((b) => b.id === id) ?? null;
      case 'config':
        return current.componentConfigs.get(id) ?? null;
      case 'text':
        return current.annotations.texts.find((t) => t.id === id) ?? null;
      case 'stroke':
        return current.annotations.strokes.find((s) => s.id === id) ?? null;
    }
  };
  const out: EntityChange[] = changes.map((c) => ({
    kind: c.kind,
    id: c.id,
    before: lookup(c.kind, c.id),
    after: c.after ?? null,
  }));
  return { changes: out };
}
