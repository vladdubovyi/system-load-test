import { describe, expect, it } from 'vitest';
import {
  MAX_ENTITIES,
  SnapshotError,
  boardFragment,
  decodeSnapshot,
  encodeSnapshot,
  parseBoardFragment,
  type BoardSnapshotV1,
} from '../snapshot';

const component = (id: string) => ({
  kind: 'component' as const,
  id,
  value: { id, type: 'redis', x: 10, y: 20 },
});

const belt = (id: string, from: string, to: string) => ({
  kind: 'belt' as const,
  id,
  value: { id, fromPortId: `${from}:out`, toPortId: `${to}:in` },
});

const SNAPSHOT: BoardSnapshotV1 = {
  v: 1,
  kind: 'board',
  scenarioSlug: 'url-shortener',
  scenario: { requestTypes: { read: 0.5, create: 0.5 } },
  traffic: { baseRps: 123, pattern: 'spike' },
  board: [component('a'), component('b'), belt('ab', 'a', 'b')],
};

describe('snapshot codec (product-directions §2)', () => {
  it('round-trips a board snapshot', async () => {
    const token = await encodeSnapshot(SNAPSHOT);
    expect(token).toMatch(/^1\.[A-Za-z0-9_-]+$/);
    expect(await decodeSnapshot(token)).toEqual(SNAPSHOT);
  });

  it('round-trips a run snapshot with its seed', async () => {
    const run: BoardSnapshotV1 = { ...SNAPSHOT, kind: 'run', seed: 4242 };
    expect(await decodeSnapshot(await encodeSnapshot(run))).toEqual(run);
    // Seeds are uint32: above int32 max is a normal randomSeed() value.
    const big: BoardSnapshotV1 = { ...SNAPSHOT, kind: 'run', seed: 3224219984 };
    expect(await decodeSnapshot(await encodeSnapshot(big))).toEqual(big);
  });

  it('a run snapshot without a valid seed is rejected whole', async () => {
    const token = await encodeSnapshot({ ...SNAPSHOT, kind: 'run' });
    await expect(decodeSnapshot(token)).rejects.toThrow(SnapshotError);
    const bad = await encodeSnapshot({ ...SNAPSHOT, kind: 'run', seed: -5 });
    await expect(decodeSnapshot(bad)).rejects.toThrow(SnapshotError);
    const huge = await encodeSnapshot({ ...SNAPSHOT, kind: 'run', seed: 2 ** 32 });
    await expect(decodeSnapshot(huge)).rejects.toThrow(SnapshotError);
  });

  it('drops unknown top-level keys instead of keeping them', async () => {
    const smuggled = { ...SNAPSHOT, hostNotes: 'should never survive' } as unknown as BoardSnapshotV1;
    const decoded = await decodeSnapshot(await encodeSnapshot(smuggled));
    expect('hostNotes' in decoded).toBe(false);
  });

  it('last write wins for duplicate entities', async () => {
    const dup = {
      ...SNAPSHOT,
      board: [component('a'), { ...component('a'), value: { id: 'a', type: 'database', x: 1, y: 2 } }],
    };
    const decoded = await decodeSnapshot(await encodeSnapshot(dup));
    expect(decoded.board).toHaveLength(1);
    expect((decoded.board[0].value as { type: string }).type).toBe('database');
  });

  it('drops belts whose endpoint component is missing, keeping source belts', async () => {
    const snap = {
      ...SNAPSHOT,
      board: [
        component('a'),
        belt('ok', 'a', 'a'),
        belt('orphan', 'a', 'gone'),
        belt('from-source', '__source__', 'a'),
      ],
    };
    const decoded = await decodeSnapshot(await encodeSnapshot(snap));
    expect(decoded.board.map((e) => e.id).sort()).toEqual(['a', 'from-source', 'ok']);
  });

  it('tells a newer version apart from garbage', async () => {
    await expect(decodeSnapshot('9.AAAA')).rejects.toThrow(/newer version/);
    await expect(decodeSnapshot('not a token')).rejects.toThrow(/not a board link/);
    await expect(decodeSnapshot('1.!!!invalid-base64!!!')).rejects.toThrow(/not a board link/);
    await expect(decodeSnapshot('1.AAAA')).rejects.toThrow(/could not be read/);
  });

  it('rejects snapshots over the entity cap', async () => {
    const big = {
      ...SNAPSHOT,
      board: Array.from({ length: MAX_ENTITIES + 1 }, (_, i) => component(`c${i}`)),
    };
    await expect(decodeSnapshot(await encodeSnapshot(big))).rejects.toThrow(/too large/);
  });

  it('voids the snapshot when the scenario document is invalid', async () => {
    const bad = {
      ...SNAPSHOT,
      scenario: { flows: [{ kind: 'read', steps: 'nope' }] } as never,
    };
    await expect(decodeSnapshot(await encodeSnapshot(bad))).rejects.toThrow(SnapshotError);
  });

  it('rejects out-of-range traffic', async () => {
    const bad = { ...SNAPSHOT, traffic: { baseRps: 0, pattern: 'spike' as const } };
    await expect(decodeSnapshot(await encodeSnapshot(bad))).rejects.toThrow(SnapshotError);
  });

  it('reads #board= and ignores room fragments, and vice versa', () => {
    expect(parseBoardFragment(boardFragment('1.abc'))).toBe('1.abc');
    expect(parseBoardFragment('#join=K7QM-2XRD')).toBeNull();
    expect(parseBoardFragment('#host=abcdefabcdefabcdef')).toBeNull();
    expect(parseBoardFragment('#join=K7QM-2XRD&board=1.abc')).toBe('1.abc');
    expect(parseBoardFragment('')).toBeNull();
  });
});
