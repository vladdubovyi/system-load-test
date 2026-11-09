import { describe, expect, it } from 'vitest';
import {
  formatJoinCode,
  hostLink,
  normalizeJoinCode,
  parseRoomFragment,
  participantLink,
} from '../join-codes';

describe('join codes (interview-platform.md §3.2)', () => {
  it.each([
    ['K7QM-2XRD', 'K7QM2XRD'],
    ['k7qm2xrd', 'K7QM2XRD'],
    ['  k7qm 2xrd ', 'K7QM2XRD'],
    ['K7QM-2XRD\n', 'K7QM2XRD'],
    // Read aloud over a call.
    ['O1IL-ABCD', '0111ABCD'],
    ['o1il abcd', '0111ABCD'],
    // A pasted participant link, with or without the site part.
    ['https://breakit.example/#join=K7QM-2XRD', 'K7QM2XRD'],
    ['https://breakit.example/app/#join=k7qm2xrd', 'K7QM2XRD'],
    ['#join=K7QM-2XRD', 'K7QM2XRD'],
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeJoinCode(input)).toBe(expected);
  });

  it.each(['', '   ', 'K7QM-2XR', 'K7QM-2XRDA', 'K7QM-2XRU', 'K7QM_2XRD', '<script>', 'https://breakit.example/#host=abc'])(
    'rejects %j',
    (input) => {
      expect(normalizeJoinCode(input)).toBeNull();
    }
  );

  it('formats with a dash and leaves garbage alone', () => {
    expect(formatJoinCode('K7QM2XRD')).toBe('K7QM-2XRD');
    expect(formatJoinCode('k7qm-2xrd')).toBe('K7QM-2XRD');
    expect(formatJoinCode('nope')).toBe('nope');
  });

  it('reads join and host credentials from a fragment', () => {
    expect(parseRoomFragment('#join=K7QM-2XRD')).toEqual({ kind: 'join', code: 'K7QM2XRD' });
    expect(parseRoomFragment('join=k7qm2xrd')).toEqual({ kind: 'join', code: 'K7QM2XRD' });
    expect(parseRoomFragment('#host=Ab12-_cdEF34ghIJ56klMN')).toEqual({
      kind: 'host',
      secret: 'Ab12-_cdEF34ghIJ56klMN',
    });
    expect(parseRoomFragment('#join=bad')).toBeNull();
    expect(parseRoomFragment('#host=short')).toBeNull();
    expect(parseRoomFragment('#host=has/slash/in/it/which/is/wrong')).toBeNull();
    expect(parseRoomFragment('')).toBeNull();
    expect(parseRoomFragment('#something=else')).toBeNull();
  });

  it('builds links from the site base', () => {
    expect(participantLink('K7QM2XRD', 'https://breakit.example/')).toBe(
      'https://breakit.example/#join=K7QM-2XRD'
    );
    expect(hostLink('Ab12-_cdEF34ghIJ56klMN', 'https://breakit.example/app/')).toBe(
      'https://breakit.example/app/#host=Ab12-_cdEF34ghIJ56klMN'
    );
    // The two links round-trip through the fragment parser.
    expect(parseRoomFragment(new URL(participantLink('K7QM2XRD', 'https://x.y/')).hash)).toEqual({
      kind: 'join',
      code: 'K7QM2XRD',
    });
  });
});
