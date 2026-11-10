import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import { getPresetFlows } from '../../src/game/flow-presets';
import { CHALLENGES, type ApiChallenge } from './api-data';

/**
 * In-process stand-in for the room hub (docs/specs/interview-platform.md §3,
 * §5) for the mocked e2e suite. It speaks enough of the SignalR JSON hub
 * protocol over `context.routeWebSocket` for the real `@microsoft/signalr`
 * client, and keeps rooms in the test process, so two browser contexts in one
 * test share a room exactly as two people would.
 *
 * Semantics mirror `backend/.../Rooms`: codes and host secrets, last-writer-
 * wins per entity, belt cascade, one ordered version stream with the author
 * marked as `origin`, presence, cursors, rotation. The real server is covered
 * by the C# tests and by `e2e/real-api.spec.ts`.
 */

const SEP = '\x1e';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

interface Conn {
  id: string;
  ws: WebSocketRoute;
  room: FakeRoom | null;
  name: string;
  role: 'Host' | 'Participant';
  ping: NodeJS.Timeout | null;
}

interface FakeSettings {
  mode: 'open' | 'interview';
  pen: 'shared' | 'single';
  lintVisible: boolean | null;
  seed: number | null;
  reportVisibility: 'everyone' | 'hostOnly' | null;
  whoCanRun: 'anyone' | 'hostOnly';
}

const DEFAULT_SETTINGS: FakeSettings = { mode: 'open', pen: 'shared', lintVisible: null, seed: null, reportVisibility: null, whoCanRun: 'anyone' };

interface FakeRun {
  seed: number;
  boardVersion: number;
  controllerConnectionId: string;
  lastTick: number;
  events: { seq: number; kind: string; payload: unknown | null; from: string; applyAtTick: number | null }[];
  nextSeq: number;
}

interface FakeRoom {
  id: string;
  code: string;
  hostSecret: string;
  scenarioSlug: string;
  scenarioOverride: unknown | null;
  trafficOverride: unknown | null;
  run: FakeRun | null;
  settings: FakeSettings;
  penHolder: string | null;
  reportReleased: boolean;
  entities: Map<string, { kind: string; id: string; value: unknown }>;
  version: number;
  members: Conn[];
}

const NAMES = ['Blue Heron', 'Amber Wren', 'Quiet Kestrel', 'Golden Plover', 'Misty Curlew', 'Swift Tern'];

function newCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function normalizeCode(input: string): string | null {
  let out = '';
  for (const raw of (input ?? '').trim()) {
    if (raw === ' ' || raw === '-') continue;
    let c = raw.toUpperCase();
    if (c === 'O') c = '0';
    if (c === 'I' || c === 'L') c = '1';
    if (!ALPHABET.includes(c) || out.length === 8) return null;
    out += c;
  }
  return out.length === 8 ? out : null;
}

function newSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < 22; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function portOwner(portId: string): string {
  const sep = portId.lastIndexOf(':');
  return sep === -1 ? portId : portId.slice(0, sep);
}

// ── Scenario projection (interview-platform.md §6.1), mirroring the server ──

function effectiveLintVisible(settings: FakeSettings): boolean {
  return settings.lintVisible ?? settings.mode !== 'interview';
}

/** One role's view of the room's scenario, as `ScenarioChanged` carries it. */
function projectScenario(
  room: FakeRoom,
  role: 'Host' | 'Participant'
): { scenarioSlug: string | null; challenge: unknown | null; scenarioOverride: unknown | null } {
  if (role === 'Host' || room.settings.mode !== 'interview') {
    return { scenarioSlug: room.scenarioSlug, challenge: null, scenarioOverride: room.scenarioOverride };
  }
  const includeFlows = effectiveLintVisible(room.settings);
  return {
    scenarioSlug: null,
    challenge: stripChallenge(room.scenarioSlug, includeFlows),
    scenarioOverride: stripOverride(room.scenarioOverride, includeFlows),
  };
}

/** The whitelisted catalog entry an interview participant may see (§6.1). */
function stripChallenge(slug: string, includeFlows: boolean): unknown | null {
  const challenge = CHALLENGES.find((c: ApiChallenge) => c.slug === slug);
  if (!challenge) return null;
  const config = challenge.scenario.scenarioConfig;
  const keptConfig: Record<string, unknown> = {};
  for (const field of ['requirements', 'drainDuration', 'pattern', 'requestTypes', 'characteristics', 'tags', 'failureScenarios', 'trafficPhases']) {
    if (config[field] != null) keptConfig[field] = config[field];
  }
  // The mocked catalog has no flows in its config; like the frontend, the
  // fake server falls back to the built-in presets for the slug.
  if (includeFlows) {
    const flows = config.flows ?? getPresetFlows(slug);
    if (flows) keptConfig.flows = flows;
  }
  return {
    id: '',
    name: challenge.name,
    slug: '',
    description: challenge.description,
    createdAt: challenge.createdAt,
    scenario: {
      id: '',
      durationSeconds: challenge.scenario.durationSeconds,
      baseRps: challenge.scenario.baseRps,
      spikeMultiplier: challenge.scenario.spikeMultiplier,
      spikeChance: challenge.scenario.spikeChance,
      readRatio: challenge.scenario.readRatio,
      scenarioConfig: keptConfig,
    },
    allowedComponents: challenge.allowedComponents,
  };
}

/** The applied override reduced to what a participant may keep (§6.1). */
function stripOverride(scenarioOverride: unknown | null, includeFlows: boolean): unknown | null {
  if (!scenarioOverride || typeof scenarioOverride !== 'object') return null;
  const doc = scenarioOverride as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const field of ['requestTypes', 'tags', 'failureScenarios', 'trafficPhases']) {
    if (doc[field] != null) kept[field] = doc[field];
  }
  if (includeFlows && Array.isArray(doc.flows)) kept.flows = doc.flows;
  return Object.keys(kept).length === 0 ? null : kept;
}

/** The opaque flow bundle a participant's engine needs for one run (§6.2). */
function flowBundle(room: FakeRoom): unknown | null {
  const doc = room.scenarioOverride as Record<string, unknown> | null;
  if (doc && Array.isArray(doc.flows)) return doc.flows;
  const challenge = CHALLENGES.find((c: ApiChallenge) => c.slug === room.scenarioSlug);
  return challenge?.scenario.scenarioConfig.flows ?? getPresetFlows(room.scenarioSlug) ?? null;
}

export class FakeRoomHub {
  private readonly rooms = new Map<string, FakeRoom>();
  private readonly byCode = new Map<string, FakeRoom>();
  private readonly byHost = new Map<string, FakeRoom>();
  private readonly conns = new Set<Conn>();
  private nextConn = 1;
  /** Every invocation received, for assertions about what the app sends. */
  readonly invocations: { connectionId: string; target: string; args: unknown[] }[] = [];
  /** Every WebSocket URL the app connected with (credentials must not be in them). */
  readonly urls: string[] = [];

  async install(context: BrowserContext): Promise<void> {
    await context.routeWebSocket((url) => url.pathname.startsWith('/hubs/room'), (ws) => this.accept(ws));
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** The formatted join code of the only room, for tests that opened one. */
  get onlyCode(): string {
    const rooms = [...this.rooms.values()];
    if (rooms.length !== 1) throw new Error(`expected one room, have ${rooms.length}`);
    return formatCode(rooms[0].code);
  }

  hostSecretOf(formattedCode: string): string {
    const room = this.byCode.get(normalizeCode(formattedCode) ?? '');
    if (!room) throw new Error('no such room');
    return room.hostSecret;
  }

  boardOf(formattedCode: string): { kind: string; id: string; value: unknown }[] {
    const room = this.byCode.get(normalizeCode(formattedCode) ?? '');
    if (!room) throw new Error('no such room');
    return [...room.entities.values()];
  }

  /** Simulate the server ending a room (idle expiry or a restart). */
  endRoom(formattedCode: string, reason: string): void {
    const room = this.byCode.get(normalizeCode(formattedCode) ?? '');
    if (!room) return;
    for (const member of [...room.members]) {
      this.push(member, 'RoomEnded', { reason });
      member.room = null;
      member.ws.close({ code: 1000, reason: 'room ended' });
    }
    this.deleteRoom(room);
  }

  private accept(ws: WebSocketRoute): void {
    this.urls.push(ws.url());
    const conn: Conn = {
      id: `conn-${this.nextConn++}`,
      ws,
      room: null,
      name: '',
      role: 'Participant',
      ping: null,
    };
    this.conns.add(conn);
    let handshaken = false;
    ws.onMessage((raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      for (const frame of text.split(SEP)) {
        if (!frame) continue;
        if (!handshaken) {
          handshaken = true;
          ws.send(`{}${SEP}`);
          conn.ping = setInterval(() => ws.send(`{"type":6}${SEP}`), 5000);
          continue;
        }
        const message = JSON.parse(frame) as { type: number; invocationId?: string; target?: string; arguments?: unknown[] };
        if (message.type === 1) this.invoke(conn, message.invocationId, message.target ?? '', message.arguments ?? []);
        else if (message.type === 6) ws.send(`{"type":6}${SEP}`);
      }
    });
    ws.onClose(() => {
      if (conn.ping) clearInterval(conn.ping);
      this.conns.delete(conn);
      this.leave(conn);
    });
  }

  private complete(conn: Conn, invocationId: string | undefined, result?: unknown, error?: string): void {
    if (!invocationId) return;
    const body: Record<string, unknown> = { type: 3, invocationId };
    if (error) body.error = error;
    else if (result !== undefined) body.result = result;
    conn.ws.send(JSON.stringify(body) + SEP);
  }

  private push(conn: Conn, target: string, arg: unknown): void {
    try {
      conn.ws.send(JSON.stringify({ type: 1, target, arguments: [arg] }) + SEP);
    } catch {
      /* closed */
    }
  }

  private broadcast(room: FakeRoom, target: string, arg: unknown, except?: Conn): void {
    for (const member of room.members) {
      if (member !== except) this.push(member, target, arg);
    }
  }

  private participants(room: FakeRoom) {
    return room.members.map((m) => ({ connectionId: m.id, name: m.name, role: m.role }));
  }

  private pickName(room: FakeRoom): string {
    const taken = new Set(room.members.map((m) => m.name));
    return NAMES.find((n) => !taken.has(n)) ?? `Guest ${room.members.length + 1}`;
  }

  private invoke(conn: Conn, invocationId: string | undefined, target: string, args: unknown[]): void {
    this.invocations.push({ connectionId: conn.id, target, args });
    const t = target.toLowerCase();
    try {
      switch (t) {
        case 'createroom': {
          const req = args[0] as {
            scenarioSlug: string;
            scenarioOverride: unknown | null;
            trafficOverride?: unknown | null;
            board: { kind: string; id: string; value: unknown }[];
          };
          this.leave(conn);
          const room: FakeRoom = {
            id: `room-${this.rooms.size + 1}-${Date.now()}`,
            code: newCode(),
            hostSecret: newSecret(),
            scenarioSlug: req.scenarioSlug,
            scenarioOverride: req.scenarioOverride ?? null,
            trafficOverride: req.trafficOverride ?? null,
            run: null,
            settings: { ...DEFAULT_SETTINGS },
            penHolder: null,
            reportReleased: false,
            entities: new Map(req.board.map((e) => [`${e.kind}:${e.id}`, e])),
            version: 0,
            members: [],
          };
          this.rooms.set(room.id, room);
          this.byCode.set(room.code, room);
          this.byHost.set(room.hostSecret, room);
          conn.role = 'Host';
          conn.name = this.pickName(room);
          conn.room = room;
          room.members.push(conn);
          this.complete(conn, invocationId, {
            joinCode: formatCode(room.code),
            hostSecret: room.hostSecret,
            connectionId: conn.id,
            name: conn.name,
            version: room.version,
            participants: this.participants(room),
          });
          return;
        }
        case 'joinbycode':
        case 'joinashost': {
          const credential = String(args[0] ?? '');
          const room =
            t === 'joinbycode'
              ? this.byCode.get(normalizeCode(credential) ?? '')
              : this.byHost.get(credential);
          if (!room) {
            this.complete(conn, invocationId, undefined, t === 'joinbycode' ? 'No room with that code.' : 'No room for that host link.');
            return;
          }
          this.leave(conn);
          conn.role = t === 'joinashost' ? 'Host' : 'Participant';
          conn.name = this.pickName(room);
          conn.room = room;
          room.members.push(conn);
          this.broadcast(room, 'PresenceChanged', { participants: this.participants(room) }, conn);
          const projection = projectScenario(room, conn.role);
          const interviewGuest = conn.role === 'Participant' && room.settings.mode === 'interview';
          this.complete(conn, invocationId, {
            role: conn.role,
            connectionId: conn.id,
            name: conn.name,
            joinCode: conn.role === 'Host' ? formatCode(room.code) : null,
            scenarioSlug: projection.scenarioSlug,
            challenge: projection.challenge,
            scenarioOverride: projection.scenarioOverride,
            trafficOverride: room.trafficOverride,
            version: room.version,
            board: [...room.entities.values()],
            participants: this.participants(room),
            run: room.run
              ? {
                  seed: room.run.seed,
                  boardVersion: room.run.boardVersion,
                  controllerConnectionId: room.run.controllerConnectionId,
                  lastTick: room.run.lastTick,
                  events: room.run.events,
                  // A mid-run joiner needs the flows now (§6.2).
                  flows: interviewGuest ? flowBundle(room) : null,
                }
              : null,
            settings: room.settings,
            penHolder: room.penHolder,
            reportReleased: room.reportReleased,
          });
          return;
        }
        case 'leaveroom': {
          this.leave(conn);
          this.complete(conn, invocationId, null);
          return;
        }
        case 'settrafficoverride': {
          const room = conn.room;
          if (!room) {
            this.complete(conn, invocationId, undefined, 'You are not in a room.');
            return;
          }
          if (room.run) {
            this.complete(conn, invocationId, undefined, 'The board is locked while a run is in progress.');
            return;
          }
          if (room.settings.whoCanRun === 'hostOnly' && conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, 'Only the host can control runs in this room.');
            return;
          }
          room.trafficOverride = args[0] ?? null;
          this.broadcast(room, 'TrafficChanged', { trafficOverride: room.trafficOverride });
          this.complete(conn, invocationId, null);
          return;
        }
        case 'startrun': {
          const room = conn.room;
          if (!room) {
            this.complete(conn, invocationId, undefined, 'You are not in a room.');
            return;
          }
          if (room.run) {
            this.complete(conn, invocationId, undefined, 'A run is already in progress.');
            return;
          }
          if (room.settings.whoCanRun === 'hostOnly' && conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, 'Only the host can control runs in this room.');
            return;
          }
          const seed = room.settings.seed ?? (args[0] as number | null) ?? Math.floor(Math.random() * 2 ** 31) + 1;
          room.reportReleased = false;
          room.run = { seed, boardVersion: room.version, controllerConnectionId: conn.id, lastTick: 0, events: [], nextSeq: 1 };
          this.complete(conn, invocationId, null);
          // §6.2: interview participants receive the opaque flow bundle with the run.
          const bundle = room.settings.mode === 'interview' ? flowBundle(room) : null;
          for (const member of room.members) {
            this.push(member, 'RunStarted', {
              seed,
              boardVersion: room.version,
              controllerConnectionId: conn.id,
              flows: member.role === 'Participant' ? bundle : null,
            });
          }
          return;
        }
        case 'reporttick': {
          const room = conn.room;
          const run = room?.run;
          if (!room || !run) {
            this.complete(conn, invocationId, undefined, 'No run is in progress.');
            return;
          }
          if (run.controllerConnectionId !== conn.id) {
            this.complete(conn, invocationId, undefined, "Only the run's controller can do that.");
            return;
          }
          const tick = args[0] as { tick: number; stamps: { seq: number; applyAtTick: number }[] };
          if (tick.tick > run.lastTick) run.lastTick = tick.tick;
          for (const stamp of tick.stamps) {
            const evt = run.events.find((e) => e.seq === stamp.seq);
            if (evt && evt.applyAtTick === null) evt.applyAtTick = stamp.applyAtTick;
          }
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'RunTick', tick, conn);
          return;
        }
        case 'sendrunevent': {
          const room = conn.room;
          const run = room?.run;
          if (!room || !run) {
            this.complete(conn, invocationId, undefined, 'No run is in progress.');
            return;
          }
          if (room.settings.whoCanRun === 'hostOnly' && conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, 'Only the host can control runs in this room.');
            return;
          }
          const evt = { seq: run.nextSeq++, kind: String(args[0]), payload: args[1] ?? null, from: conn.id, applyAtTick: null };
          run.events.push(evt);
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'RunEvent', evt);
          return;
        }
        case 'endrun': {
          const room = conn.room;
          if (!room || !room.run) {
            this.complete(conn, invocationId, null);
            return;
          }
          if (room.run.controllerConnectionId !== conn.id) {
            this.complete(conn, invocationId, undefined, "Only the run's controller can do that.");
            return;
          }
          room.run = null;
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'RunEnded', { reason: args[0] === 'stopped' ? 'stopped' : 'finished' });
          return;
        }
        case 'applyboarddiff': {
          const room = conn.room;
          if (!room) {
            this.complete(conn, invocationId, undefined, 'You are not in a room.');
            return;
          }
          if (room.run) {
            this.complete(conn, invocationId, undefined, 'The board is locked while a run is in progress.');
            return;
          }
          if (room.settings.pen === 'single' && room.penHolder !== conn.id) {
            const holder = room.members.find((m) => m.id === room.penHolder);
            this.complete(conn, invocationId, undefined, holder ? `${holder.name} holds the pen.` : 'Nobody holds the pen; ask the host for it.');
            return;
          }
          const { changes } = args[0] as { baseVersion: number; changes: { kind: string; id: string; after: unknown | null }[] };
          const applied: { kind: string; id: string; after: unknown | null }[] = [];
          for (const c of changes) {
            const key = `${c.kind}:${c.id}`;
            if (c.after === null || c.after === undefined) {
              if (room.entities.delete(key)) applied.push({ kind: c.kind, id: c.id, after: null });
            } else {
              room.entities.set(key, { kind: c.kind, id: c.id, value: c.after });
              applied.push({ kind: c.kind, id: c.id, after: c.after });
            }
          }
          // Belt cascade.
          const components = new Set([...room.entities.values()].filter((e) => e.kind === 'component').map((e) => e.id));
          components.add('__source__');
          for (const e of [...room.entities.values()]) {
            if (e.kind !== 'belt') continue;
            const belt = e.value as { fromPortId: string; toPortId: string };
            if (!components.has(portOwner(belt.fromPortId)) || !components.has(portOwner(belt.toPortId))) {
              room.entities.delete(`belt:${e.id}`);
              applied.push({ kind: 'belt', id: e.id, after: null });
            }
          }
          room.version++;
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'BoardChanged', { version: room.version, origin: conn.id, changes: applied });
          return;
        }
        case 'requestboard': {
          const room = conn.room;
          if (!room) {
            this.complete(conn, invocationId, undefined, 'You are not in a room.');
            return;
          }
          this.complete(conn, invocationId, { version: room.version, board: [...room.entities.values()] });
          return;
        }
        case 'movecursor': {
          const room = conn.room;
          if (room) this.broadcast(room, 'CursorMoved', { connectionId: conn.id, x: args[0], y: args[1] }, conn);
          this.complete(conn, invocationId, null);
          return;
        }
        case 'setscenariooverride': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          room.scenarioOverride = args[0] ?? null;
          this.sendScenarioProjections(room, false);
          this.complete(conn, invocationId, null);
          return;
        }
        case 'updatesettings': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          const next = args[0] as FakeSettings;
          const wasShared = room.settings.pen === 'shared';
          const before = room.settings;
          room.settings = { ...DEFAULT_SETTINGS, ...next };
          if (room.settings.pen === 'single' && (wasShared || !room.penHolder)) room.penHolder = conn.id;
          if (room.settings.pen === 'shared') room.penHolder = null;
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'SettingsChanged', { settings: room.settings, penHolder: room.penHolder });
          // §4.2, §6.3: a mode switch or lint toggle re-projects participants.
          if (
            before.mode !== room.settings.mode ||
            effectiveLintVisible(before) !== effectiveLintVisible(room.settings)
          ) {
            this.sendScenarioProjections(room, true);
          }
          return;
        }
        case 'assignpen': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          room.penHolder = (args[0] as string | null) ?? null;
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'PenChanged', { penHolder: room.penHolder });
          return;
        }
        case 'requestpen': {
          const room = conn.room;
          if (!room) {
            this.complete(conn, invocationId, undefined, 'You are not in a room.');
            return;
          }
          for (const m of room.members) {
            if (m.role === 'Host') this.push(m, 'PenRequested', { connectionId: conn.id, name: conn.name });
          }
          this.complete(conn, invocationId, null);
          return;
        }
        case 'releasereport': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          room.reportReleased = true;
          this.complete(conn, invocationId, null);
          this.broadcast(room, 'ReportReleased', {});
          return;
        }
        case 'rotatejoincode': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          this.byCode.delete(room.code);
          room.code = newCode();
          this.byCode.set(room.code, room);
          this.complete(conn, invocationId, formatCode(room.code));
          return;
        }
        case 'rotatehostlink': {
          const room = conn.room;
          if (!room || conn.role !== 'Host') {
            this.complete(conn, invocationId, undefined, room ? 'Only the host can do that.' : 'You are not in a room.');
            return;
          }
          this.byHost.delete(room.hostSecret);
          room.hostSecret = newSecret();
          this.byHost.set(room.hostSecret, room);
          for (const other of [...room.members]) {
            if (other !== conn && other.role === 'Host') {
              this.push(other, 'RoomEnded', { reason: 'host-link-rotated' });
              other.ws.close({ code: 1000, reason: 'host link rotated' });
            }
          }
          this.complete(conn, invocationId, room.hostSecret);
          return;
        }
        default:
          this.complete(conn, invocationId, undefined, `Unknown hub method '${target}'`);
      }
    } catch (error) {
      this.complete(conn, invocationId, undefined, `Fake hub error: ${(error as Error).message}`);
    }
  }

  /** Send each connection its own view of the scenario (§6.1). */
  private sendScenarioProjections(room: FakeRoom, participantsOnly: boolean): void {
    for (const member of room.members) {
      if (participantsOnly && member.role === 'Host') continue;
      this.push(member, 'ScenarioChanged', projectScenario(room, member.role));
    }
  }

  private leave(conn: Conn): void {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.members = room.members.filter((m) => m !== conn);
    this.broadcast(room, 'PresenceChanged', { participants: this.participants(room) });
    if (room.penHolder === conn.id) {
      room.penHolder = room.members.find((m) => m.role === 'Host')?.id ?? null;
      this.broadcast(room, 'PenChanged', { penHolder: room.penHolder });
    }
    if (room.run && room.run.controllerConnectionId === conn.id) {
      const host = room.members.find((m) => m.role === 'Host');
      if (host) {
        room.run.controllerConnectionId = host.id;
        this.broadcast(room, 'RunControllerChanged', { controllerConnectionId: host.id, lastTick: room.run.lastTick });
      } else {
        room.run = null;
        this.broadcast(room, 'RunEnded', { reason: 'interrupted' });
      }
    }
  }

  private deleteRoom(room: FakeRoom): void {
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.byHost.delete(room.hostSecret);
  }
}
