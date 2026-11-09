import { describe, expect, it } from 'vitest';
import {
  applyDiff,
  createEmptyBoard,
  diffBoards,
  invertDiff,
  isEmptyDiff,
  snapshotBoard,
  type BoardState,
} from '../board-diff';
import type { ConveyorBelt, PlacedComponent } from '../types';

function component(id: string, x = 0, y = 0): PlacedComponent {
  return {
    id,
    type: 'backend-service',
    x,
    y,
    width: 140,
    height: 72,
    label: id,
    capacity: 100,
    queueLimit: 50,
  };
}

function belt(id: string, from: string, to: string): ConveyorBelt {
  return { id, fromPortId: `${from}:out`, toPortId: `${to}:in`, capacity: 100 };
}

function board(parts: Partial<BoardState> = {}): BoardState {
  return { ...createEmptyBoard(), ...parts };
}

describe('board-diff (interview-platform.md §5.2)', () => {
  it('reports nothing for identical boards, including a snapshot copy', () => {
    const a = board({
      components: [component('a', 10, 20)],
      componentConfigs: new Map([['a', { autoScaling: { enabled: true } as never }]]),
    });
    expect(isEmptyDiff(diffBoards(a, a))).toBe(true);
    expect(isEmptyDiff(diffBoards(a, snapshotBoard(a)))).toBe(true);
  });

  it('classifies adds, removes and changes per entity kind', () => {
    const before = board({
      components: [component('a'), component('b')],
      belts: [belt('ab', 'a', 'b')],
      annotations: {
        texts: [{ id: 't1', x: 0, y: 0, width: 200, minHeight: 40, content: 'hi' }],
        strokes: [],
      },
    });
    const after = board({
      components: [component('a', 50, 0), component('c')],
      belts: [],
      componentConfigs: new Map([['c', { database: { replicas: 2 } as never }]]),
      annotations: {
        texts: [{ id: 't1', x: 0, y: 0, width: 200, minHeight: 40, content: 'hello' }],
        strokes: [{ id: 's1', points: [{ x: 0, y: 0 }], color: '#000', width: 2 }],
      },
    });

    const { changes } = diffBoards(before, after);
    const byKey = Object.fromEntries(changes.map((c) => [`${c.kind}:${c.id}`, c]));

    expect(Object.keys(byKey).sort()).toEqual([
      'belt:ab',
      'component:a',
      'component:b',
      'component:c',
      'config:c',
      'stroke:s1',
      'text:t1',
    ]);
    expect(byKey['component:a'].before).toMatchObject({ x: 0 });
    expect(byKey['component:a'].after).toMatchObject({ x: 50 });
    expect(byKey['component:b'].after).toBeNull();
    expect(byKey['component:c'].before).toBeNull();
    expect(byKey['belt:ab'].after).toBeNull();
    expect(byKey['config:c'].before).toBeNull();
    expect(byKey['text:t1'].before).toMatchObject({ content: 'hi' });
    expect(byKey['text:t1'].after).toMatchObject({ content: 'hello' });
    expect(byKey['stroke:s1'].before).toBeNull();
  });

  it('applying a diff and then its inverse round-trips the board', () => {
    const before = board({
      components: [component('a'), component('b')],
      belts: [belt('ab', 'a', 'b')],
      componentConfigs: new Map([['a', { autoScaling: { enabled: false } as never }]]),
    });
    const after = board({
      components: [component('a', 1, 1), component('c')],
      belts: [belt('ac', 'a', 'c')],
      componentConfigs: new Map([['c', {}]]),
    });
    const forward = diffBoards(before, after);

    const applied = applyDiff(before, forward).board;
    expect(isEmptyDiff(diffBoards(applied, after))).toBe(true);

    const reverted = applyDiff(applied, invertDiff(forward)).board;
    expect(isEmptyDiff(diffBoards(reverted, before))).toBe(true);
  });

  it('does not mutate the input board and keeps array order for changed entities', () => {
    const start = board({ components: [component('a'), component('b'), component('c')] });
    const frozen = snapshotBoard(start);
    const diff = diffBoards(start, board({ components: [component('a'), component('b', 9, 9), component('c')] }));

    const { board: next } = applyDiff(start, diff);
    expect(isEmptyDiff(diffBoards(start, frozen))).toBe(true);
    expect(next.components.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(next.components[1].x).toBe(9);
  });

  it('drops a belt whose endpoint component was removed, and keeps source belts', () => {
    const start = board({
      components: [component('a'), component('b')],
      belts: [
        { id: 'src', fromPortId: '__source__:out', toPortId: 'a:in', capacity: 100 },
        belt('ab', 'a', 'b'),
      ],
    });
    const removeB = diffBoards(start, board({ components: [component('a')], belts: start.belts }));

    const result = applyDiff(start, removeB);
    expect(result.board.belts.map((b) => b.id)).toEqual(['src']);
    expect(result.droppedBelts.map((b) => b.id)).toEqual(['ab']);
  });

  it('per-person undo skips entities someone else changed since', () => {
    const base = board({ components: [component('a', 0, 0), component('b', 0, 0)] });

    // Alice moves both components in one gesture.
    const afterAlice = board({ components: [component('a', 100, 0), component('b', 100, 0)] });
    const aliceGesture = diffBoards(base, afterAlice);

    // Bob then moves `a` again; `b` is untouched.
    const afterBob = board({ components: [component('a', 250, 0), component('b', 100, 0)] });

    const undo = applyDiff(afterBob, invertDiff(aliceGesture), { skipConflicts: true });
    expect(undo.board.components.find((c) => c.id === 'a')?.x).toBe(250);
    expect(undo.board.components.find((c) => c.id === 'b')?.x).toBe(0);
    expect(undo.skipped.map((c) => `${c.kind}:${c.id}`)).toEqual(['component:a']);
  });

  it('with skipConflicts, re-adding an entity is skipped if someone already re-created it', () => {
    const withA = board({ components: [component('a')] });
    const removeA = diffBoards(withA, board());
    // Someone else put a different `a` back in the meantime.
    const current = board({ components: [component('a', 7, 7)] });

    const undo = applyDiff(current, invertDiff(removeA), { skipConflicts: true });
    expect(undo.skipped).toHaveLength(1);
    expect(undo.board.components[0].x).toBe(7);
  });

  it('without skipConflicts the latest write wins and a remove beats a change', () => {
    const start = board({ components: [component('a', 0, 0)] });
    const move = diffBoards(start, board({ components: [component('a', 40, 0)] }));
    const remove = diffBoards(start, board());

    const moved = applyDiff(start, move).board;
    const removed = applyDiff(moved, remove).board;
    expect(removed.components).toHaveLength(0);

    const movedAgain = applyDiff(start, diffBoards(start, board({ components: [component('a', 80, 0)] }))).board;
    expect(applyDiff(movedAgain, move).board.components[0].x).toBe(40);
  });
});
