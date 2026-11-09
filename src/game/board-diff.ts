import type { ConveyorBelt, PlacedComponent } from './types';
import type { ComponentInstanceConfig } from './component-config';
import type { BoardAnnotations, DrawStroke, TextAnnotation } from './board-annotations';
import { SOURCE_ID } from './simulation';

/**
 * Per-entity board diffs (docs/specs/interview-platform.md §5.2).
 *
 * Every board entity has an ID: components, belts, component configs (keyed
 * by component ID), text annotations and strokes. A gesture — a drag, a
 * connect, a config change, a text edit — is recorded as the set of entities
 * it added, removed or changed, with the full value on both sides. The same
 * diff shape serves three purposes:
 *
 * - the solo undo stack, which stores gestures rather than board snapshots;
 * - per-person undo in a room, which applies the inverse diff but skips any
 *   entity somebody else has changed since (`skipConflicts`);
 * - the room sync message, which is `{ kind, id, after }` per entity with
 *   last-writer-wins merging on the server.
 *
 * Entity collections are sets keyed by ID. Arrays keep their order for
 * existing entries; added entries append.
 */

export type BoardEntityKind = 'component' | 'belt' | 'config' | 'text' | 'stroke';

export interface BoardState {
  components: PlacedComponent[];
  belts: ConveyorBelt[];
  componentConfigs: Map<string, ComponentInstanceConfig>;
  annotations: BoardAnnotations;
}

export interface EntityChange {
  kind: BoardEntityKind;
  id: string;
  /** Value before the change; `null` when the entity was added. */
  before: unknown;
  /** Value after the change; `null` when the entity was removed. */
  after: unknown;
}

export interface BoardDiff {
  changes: EntityChange[];
}

export interface ApplyDiffOptions {
  /**
   * Apply a change only if the entity still has the value the diff expects
   * (`before`). Used for undo so one person's undo never erases what another
   * person did to the same entity in the meantime.
   */
  skipConflicts?: boolean;
}

export interface ApplyDiffResult {
  board: BoardState;
  /** Changes not applied because the entity had moved on (`skipConflicts`). */
  skipped: EntityChange[];
  /** Belts dropped because an endpoint component no longer exists. */
  droppedBelts: ConveyorBelt[];
}

export function createEmptyBoard(): BoardState {
  return {
    components: [],
    belts: [],
    componentConfigs: new Map(),
    annotations: { texts: [], strokes: [] },
  };
}

/** Deep copy of a board, safe to keep as a baseline while the live board mutates. */
export function snapshotBoard(board: BoardState): BoardState {
  return {
    components: structuredClone(board.components),
    belts: structuredClone(board.belts),
    componentConfigs: new Map(
      [...board.componentConfigs].map(([id, cfg]) => [id, structuredClone(cfg)])
    ),
    annotations: {
      texts: structuredClone(board.annotations.texts),
      strokes: structuredClone(board.annotations.strokes),
    },
  };
}

export function isEmptyDiff(diff: BoardDiff): boolean {
  return diff.changes.length === 0;
}

/** Swap before/after so applying the result reverts the original diff. */
export function invertDiff(diff: BoardDiff): BoardDiff {
  return {
    changes: diff.changes
      .map((c) => ({ kind: c.kind, id: c.id, before: c.after, after: c.before }))
      .reverse(),
  };
}

interface EntityRef {
  kind: BoardEntityKind;
  id: string;
  value: unknown;
}

function entityKey(kind: BoardEntityKind, id: string): string {
  return `${kind}:${id}`;
}

function collectEntities(board: BoardState): Map<string, EntityRef> {
  const out = new Map<string, EntityRef>();
  const add = (kind: BoardEntityKind, id: string, value: unknown): void => {
    out.set(entityKey(kind, id), { kind, id, value });
  };
  for (const c of board.components) add('component', c.id, c);
  for (const b of board.belts) add('belt', b.id, b);
  for (const [id, cfg] of board.componentConfigs) add('config', id, cfg);
  for (const t of board.annotations.texts) add('text', t.id, t);
  for (const s of board.annotations.strokes) add('stroke', s.id, s);
  return out;
}

/** Structural equality for plain JSON-like values (what board entities are). */
export function entitiesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => entitiesEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => k in bo && entitiesEqual(ao[k], bo[k]));
}

/**
 * Entities added, removed or changed between two boards. Values are deep
 * copies, so the diff stays valid when either board mutates afterwards.
 */
export function diffBoards(before: BoardState, after: BoardState): BoardDiff {
  const prev = collectEntities(before);
  const next = collectEntities(after);
  const changes: EntityChange[] = [];

  for (const [key, ref] of next) {
    const old = prev.get(key);
    if (!old) {
      changes.push({ kind: ref.kind, id: ref.id, before: null, after: structuredClone(ref.value) });
    } else if (!entitiesEqual(old.value, ref.value)) {
      changes.push({
        kind: ref.kind,
        id: ref.id,
        before: structuredClone(old.value),
        after: structuredClone(ref.value),
      });
    }
  }
  for (const [key, ref] of prev) {
    if (!next.has(key)) {
      changes.push({ kind: ref.kind, id: ref.id, before: structuredClone(ref.value), after: null });
    }
  }
  return { changes };
}

function portOwner(portId: string): string {
  const sep = portId.lastIndexOf(':');
  return sep === -1 ? portId : portId.slice(0, sep);
}

function readEntity(board: BoardState, kind: BoardEntityKind, id: string): unknown {
  switch (kind) {
    case 'component':
      return board.components.find((c) => c.id === id) ?? null;
    case 'belt':
      return board.belts.find((b) => b.id === id) ?? null;
    case 'config':
      return board.componentConfigs.get(id) ?? null;
    case 'text':
      return board.annotations.texts.find((t) => t.id === id) ?? null;
    case 'stroke':
      return board.annotations.strokes.find((s) => s.id === id) ?? null;
  }
}

function upsert<T extends { id: string }>(list: T[], value: T): void {
  const i = list.findIndex((item) => item.id === value.id);
  if (i === -1) list.push(value);
  else list[i] = value;
}

function writeEntity(board: BoardState, kind: BoardEntityKind, id: string, value: unknown): void {
  if (value === null) {
    switch (kind) {
      case 'component':
        board.components = board.components.filter((c) => c.id !== id);
        return;
      case 'belt':
        board.belts = board.belts.filter((b) => b.id !== id);
        return;
      case 'config':
        board.componentConfigs.delete(id);
        return;
      case 'text':
        board.annotations.texts = board.annotations.texts.filter((t) => t.id !== id);
        return;
      case 'stroke':
        board.annotations.strokes = board.annotations.strokes.filter((s) => s.id !== id);
        return;
    }
  }
  const copy = structuredClone(value);
  switch (kind) {
    case 'component':
      upsert(board.components, copy as PlacedComponent);
      return;
    case 'belt':
      upsert(board.belts, copy as ConveyorBelt);
      return;
    case 'config':
      board.componentConfigs.set(id, copy as ComponentInstanceConfig);
      return;
    case 'text':
      upsert(board.annotations.texts, copy as TextAnnotation);
      return;
    case 'stroke':
      upsert(board.annotations.strokes, copy as DrawStroke);
      return;
  }
}

/**
 * Apply a diff to a board and return the resulting board (the input is not
 * mutated). Adds and changes write the new value; removes delete. A belt left
 * without an endpoint component is dropped. With `skipConflicts`, a change
 * whose entity no longer matches `before` is skipped and reported.
 */
export function applyDiff(
  board: BoardState,
  diff: BoardDiff,
  options: ApplyDiffOptions = {}
): ApplyDiffResult {
  const next = snapshotBoard(board);
  const skipped: EntityChange[] = [];

  for (const change of diff.changes) {
    if (options.skipConflicts) {
      const current = readEntity(next, change.kind, change.id);
      if (!entitiesEqual(current, change.before ?? null)) {
        skipped.push(change);
        continue;
      }
    }
    writeEntity(next, change.kind, change.id, change.after ?? null);
  }

  const componentIds = new Set(next.components.map((c) => c.id));
  componentIds.add(SOURCE_ID);
  const droppedBelts = next.belts.filter(
    (b) => !componentIds.has(portOwner(b.fromPortId)) || !componentIds.has(portOwner(b.toPortId))
  );
  if (droppedBelts.length > 0) {
    const dropped = new Set(droppedBelts.map((b) => b.id));
    next.belts = next.belts.filter((b) => !dropped.has(b.id));
  }

  return { board: next, skipped, droppedBelts };
}
