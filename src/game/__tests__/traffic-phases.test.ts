import { describe, expect, it } from 'vitest';
import { baseRpsAt, requestTypesAt, sortPhases } from '../traffic-phases';

describe('traffic phases (product-directions §3.4)', () => {
  const phases = sortPhases([
    { atSeconds: 30, baseRps: 600, requestTypes: { read: 0.9, create: 0.1 } },
    { atSeconds: 0, baseRps: 40 },
  ]);

  it('sorts by time and interpolates baseRps linearly between points', () => {
    expect(phases[0].atSeconds).toBe(0);
    expect(baseRpsAt(200, phases, 0)).toBe(40);
    expect(baseRpsAt(200, phases, 15)).toBe(320);
    expect(baseRpsAt(200, phases, 30)).toBe(600);
    expect(baseRpsAt(200, phases, 45)).toBe(600);
  });

  it('falls back to the flat base before the first point and with no points', () => {
    expect(baseRpsAt(200, [], 10)).toBe(200);
    expect(baseRpsAt(200, [{ atSeconds: 10, baseRps: 50 }], 5)).toBe(200);
    expect(baseRpsAt(200, [{ atSeconds: 10, requestTypes: { read: 1 } }], 50)).toBe(200);
  });

  it('switches the request mix at the point and keeps it after', () => {
    const base = { read: 0.5, create: 0.5 };
    expect(requestTypesAt(base, phases, 10)).toBe(base);
    expect(requestTypesAt(base, phases, 30)).toEqual({ read: 0.9, create: 0.1 });
    expect(requestTypesAt(base, phases, 44)).toEqual({ read: 0.9, create: 0.1 });
  });
});
