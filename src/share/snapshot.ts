import type { ScenarioDocument } from '../game/flow-types';
import type { TrafficProfile } from '../game/scenario-types';
import { validateScenarioDocument } from '../game/flows';

/**
 * Portable board snapshots (docs/specs/product-directions.md §2): a design,
 * its applied scenario and traffic, and optionally the seed of a run, encoded
 * as `1.<base64url(deflate-raw(JSON))>` and carried in a `#board=` URL
 * fragment. No server state: the link *is* the artifact.
 *
 * Decoding is parsing untrusted input. Everything is whitelisted and
 * size-capped; a snapshot that fails any check is rejected whole, so a bad
 * link can never half-load. Values are data only — rendering goes through
 * the same escaping paths as typed input.
 */

export type SnapshotEntityKind = 'component' | 'belt' | 'config' | 'text' | 'stroke';

export interface SnapshotEntity {
  kind: SnapshotEntityKind;
  id: string;
  value: unknown;
}

export interface BoardSnapshotV1 {
  v: 1;
  /** 'run' additionally pins the seed that reproduces the run. */
  kind: 'board' | 'run';
  /** Catalog scenario this started from; null means "the default". */
  scenarioSlug: string | null;
  /** The applied scenario override, if any (flow-authoring §2). */
  scenario?: ScenarioDocument;
  /** The Traffic-panel override, if any. */
  traffic?: TrafficProfile;
  seed?: number;
  board: SnapshotEntity[];
}

/** Thrown by {@link decodeSnapshot}; `message` is written for the toast. */
export class SnapshotError extends Error {}

export const SNAPSHOT_VERSION = 1;
/** Links longer than this are refused at creation; use file export instead. */
export const MAX_FRAGMENT_CHARS = 8000;
/** Same caps as the room board (backend RoomLimits). */
export const MAX_ENTITIES = 5000;
const MAX_BOARD_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 256 * 1024;

const ENTITY_KINDS: ReadonlySet<string> = new Set([
  'component',
  'belt',
  'config',
  'text',
  'stroke',
]);

const NOT_A_LINK = 'That is not a board link.';
const NEWER_VERSION = 'This link was made by a newer version of BreakIT.';
const UNREADABLE = 'That board link could not be read.';
const TOO_LARGE = 'That board link is too large to load.';

// ── Encoding ────────────────────────────────────────────────────────────────

export async function encodeSnapshot(snapshot: BoardSnapshotV1): Promise<string> {
  const json = JSON.stringify(snapshot);
  const compressed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return `${SNAPSHOT_VERSION}.${toBase64Url(compressed)}`;
}

export function boardFragment(token: string): string {
  return `#board=${token}`;
}

/** Read a `#board=` token from a URL fragment; room keys are not ours. */
export function parseBoardFragment(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get('board');
}

// ── Decoding and validation ─────────────────────────────────────────────────

export async function decodeSnapshot(token: string): Promise<BoardSnapshotV1> {
  const match = /^(\d+)\.([A-Za-z0-9_-]*)$/.exec(token.trim());
  if (!match) throw new SnapshotError(NOT_A_LINK);
  const version = Number(match[1]);
  if (version > SNAPSHOT_VERSION) throw new SnapshotError(NEWER_VERSION);
  if (version !== SNAPSHOT_VERSION || match[2].length === 0) throw new SnapshotError(NOT_A_LINK);

  let json: string;
  try {
    const bytes = await pipe(fromBase64Url(match[2]), new DecompressionStream('deflate-raw'));
    if (bytes.byteLength > MAX_BOARD_BYTES + MAX_DOCUMENT_BYTES) throw new SnapshotError(TOO_LARGE);
    json = new TextDecoder().decode(bytes);
  } catch (error) {
    throw error instanceof SnapshotError ? error : new SnapshotError(UNREADABLE);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SnapshotError(UNREADABLE);
  }
  return validateSnapshot(parsed);
}

function validateSnapshot(parsed: unknown): BoardSnapshotV1 {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SnapshotError(UNREADABLE);
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.v !== 1) throw new SnapshotError(UNREADABLE);
  if (raw.kind !== 'board' && raw.kind !== 'run') throw new SnapshotError(UNREADABLE);
  if (raw.scenarioSlug !== null && typeof raw.scenarioSlug !== 'string') {
    throw new SnapshotError(UNREADABLE);
  }
  if (!Array.isArray(raw.board)) throw new SnapshotError(UNREADABLE);

  // Unknown top-level keys are dropped, not kept: rebuild from the whitelist.
  const snapshot: BoardSnapshotV1 = {
    v: 1,
    kind: raw.kind,
    scenarioSlug: raw.scenarioSlug === null ? null : String(raw.scenarioSlug).slice(0, 100),
    board: validateBoard(raw.board),
  };

  if (raw.scenario !== undefined && raw.scenario !== null) {
    const scenario = raw.scenario as ScenarioDocument;
    if (typeof scenario !== 'object' || Array.isArray(scenario)) throw new SnapshotError(UNREADABLE);
    if (JSON.stringify(scenario).length > MAX_DOCUMENT_BYTES) throw new SnapshotError(TOO_LARGE);
    const problems = validateScenarioDocument(scenario);
    if (problems.length > 0) throw new SnapshotError(UNREADABLE);
    snapshot.scenario = scenario;
  }

  if (raw.traffic !== undefined && raw.traffic !== null) {
    snapshot.traffic = validateTraffic(raw.traffic);
  }

  if (raw.kind === 'run') {
    const seed = raw.seed;
    // Seeds are uint32 (src/game/rng.ts randomSeed), not int32: the room's
    // server-pinned seed is the narrower one, not the engine's.
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
      throw new SnapshotError(UNREADABLE);
    }
    snapshot.seed = seed;
  }

  return snapshot;
}

function validateBoard(entities: unknown[]): SnapshotEntity[] {
  if (entities.length > MAX_ENTITIES) throw new SnapshotError(TOO_LARGE);
  // Duplicates: last wins, preserving first position (room-merge semantics).
  const byKey = new Map<string, SnapshotEntity>();
  let bytes = 0;
  for (const raw of entities) {
    if (!raw || typeof raw !== 'object') throw new SnapshotError(UNREADABLE);
    const entity = raw as Record<string, unknown>;
    const kind = entity.kind;
    const id = entity.id;
    if (typeof kind !== 'string' || !ENTITY_KINDS.has(kind)) throw new SnapshotError(UNREADABLE);
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      throw new SnapshotError(UNREADABLE);
    }
    if (entity.value === undefined || entity.value === null) throw new SnapshotError(UNREADABLE);
    bytes += JSON.stringify(entity.value).length;
    if (bytes > MAX_BOARD_BYTES) throw new SnapshotError(TOO_LARGE);
    byKey.set(`${kind}:${id}`, { kind: kind as SnapshotEntityKind, id, value: entity.value });
  }
  return dropOrphanBelts([...byKey.values()]);
}

/** A belt whose endpoint component is absent is dropped — same cascade as the room board. */
function dropOrphanBelts(entities: SnapshotEntity[]): SnapshotEntity[] {
  const components = new Set(
    entities.filter((e) => e.kind === 'component').map((e) => e.id)
  );
  components.add('__source__');
  return entities.filter((entity) => {
    if (entity.kind !== 'belt') return true;
    const belt = entity.value as { fromPortId?: unknown; toPortId?: unknown };
    return endpointExists(belt.fromPortId, components) && endpointExists(belt.toPortId, components);
  });
}

function endpointExists(portId: unknown, components: Set<string>): boolean {
  if (typeof portId !== 'string') return false;
  const sep = portId.lastIndexOf(':');
  const owner = sep === -1 ? portId : portId.slice(0, sep);
  return components.has(owner);
}

function validateTraffic(raw: unknown): TrafficProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SnapshotError(UNREADABLE);
  if (JSON.stringify(raw).length > MAX_DOCUMENT_BYTES) throw new SnapshotError(TOO_LARGE);
  const traffic = raw as TrafficProfile;
  if (
    typeof traffic.baseRps !== 'number' ||
    !Number.isFinite(traffic.baseRps) ||
    traffic.baseRps < 1 ||
    traffic.baseRps > 100000
  ) {
    throw new SnapshotError(UNREADABLE);
  }
  if (!['constant', 'spike', 'gradual', 'random'].includes(traffic.pattern)) {
    throw new SnapshotError(UNREADABLE);
  }
  return traffic;
}

// ── Bytes ↔ text plumbing ───────────────────────────────────────────────────

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new SnapshotError(UNREADABLE);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
