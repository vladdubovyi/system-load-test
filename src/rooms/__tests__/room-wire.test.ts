import { describe, expect, it } from 'vitest';
import { applyDiff, createEmptyBoard, diffBoards, isEmptyDiff, type BoardState } from '../../game/board-diff';
import { boardToEntities, changesToDiff, diffToChanges, entitiesToBoard, roomErrorMessage } from '../room-client';
import type { PlacedComponent } from '../../game/types';

function component(id: string, x = 0): PlacedComponent {
  return { id, type: 'redis', x, y: 0, width: 140, height: 72, label: id, capacity: 100, queueLimit: 50 };
}

describe('room wire format (interview-platform.md §5.2)', () => {
  it('a board survives the round trip through wire entities, in order', () => {
    const board: BoardState = {
      components: [component('b'), component('a')],
      belts: [{ id: 'ab', fromPortId: 'b:out', toPortId: 'a:in', capacity: 100 }],
      componentConfigs: new Map([['a', { autoScaling: { enabled: true } as never }]]),
      annotations: {
        texts: [{ id: 't', x: 1, y: 2, width: 200, minHeight: 40, content: 'hi' }],
        strokes: [{ id: 's', points: [{ x: 0, y: 0 }], color: '#000', width: 2 }],
      },
    };

    const back = entitiesToBoard(boardToEntities(board));

    expect(isEmptyDiff(diffBoards(board, back))).toBe(true);
    expect(back.components.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('changes from another client apply through changesToDiff', () => {
    const mine = createEmptyBoard();
    mine.components.push(component('a'), component('b'));

    const theirs = [
      { kind: 'component' as const, id: 'a', after: component('a', 50) },
      { kind: 'component' as const, id: 'b', after: null },
      { kind: 'component' as const, id: 'c', after: component('c') },
    ];
    const diff = changesToDiff(theirs, mine);
    expect(diff.changes[0].before).toMatchObject({ id: 'a', x: 0 });
    expect(diff.changes[1].before).toMatchObject({ id: 'b' });
    expect(diff.changes[2].before).toBeNull();

    const { board } = applyDiff(mine, diff);
    expect(board.components.map((c) => [c.id, c.x])).toEqual([
      ['a', 50],
      ['c', 0],
    ]);
  });

  it('outgoing changes carry only the after value', () => {
    const before = createEmptyBoard();
    before.components.push(component('a'));
    const after = createEmptyBoard();
    after.components.push(component('a', 9), component('z'));

    const wire = diffToChanges(diffBoards(before, after));
    expect(wire).toEqual([
      { kind: 'component', id: 'a', after: expect.objectContaining({ x: 9 }) },
      { kind: 'component', id: 'z', after: expect.objectContaining({ id: 'z' }) },
    ]);
    expect(Object.keys(wire[0])).toEqual(['kind', 'id', 'after']);
  });

  it('unwraps hub errors for people and hides transport noise', () => {
    expect(
      roomErrorMessage(new Error("An unexpected error occurred invoking 'JoinByCode' on the server. HubException: No room with that code."))
    ).toBe('No room with that code.');
    expect(roomErrorMessage(new Error('Failed to start the connection: Error: WebSocket failed to connect.'))).toBe(
      'Could not reach the room server.'
    );
  });
});
