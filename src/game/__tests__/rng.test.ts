import { describe, expect, it } from 'vitest';
import { createRng, normalizeSeed, parseSeed, randomSeed } from '../rng';

describe('seeded rng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 10 }, () => a.next())).not.toEqual(
      Array.from({ length: 10 }, () => b.next())
    );
  });

  it('draws uniformly in [0, 1) and never outside', () => {
    const rng = createRng(99);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('int and pick stay within bounds', () => {
    const rng = createRng(7);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 1000; i++) {
      const k = rng.int(5);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(5);
      expect(Number.isInteger(k)).toBe(true);
      expect(items).toContain(rng.pick(items));
    }
  });

  it('chance(0) is never true and chance(1) always is', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('normalizes seeds to 32-bit unsigned integers', () => {
    expect(normalizeSeed(1.9)).toBe(1);
    expect(normalizeSeed(-5)).toBe(5);
    expect(normalizeSeed(2 ** 32 + 3)).toBe(3);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(createRng(2 ** 32 + 3).seed).toBe(3);
  });

  it('parses user-supplied seeds strictly', () => {
    expect(parseSeed('4242')).toBe(4242);
    expect(parseSeed(' 7 ')).toBe(7);
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed(undefined)).toBeNull();
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
    expect(parseSeed('-1')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('99999999999')).toBeNull();
    expect(parseSeed(String(0xffffffff))).toBe(0xffffffff);
  });

  it('randomSeed is a non-zero 32-bit integer', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
