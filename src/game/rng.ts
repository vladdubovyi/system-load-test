/**
 * Seeded pseudo-random numbers for the simulation
 * (docs/specs/interview-platform.md §8).
 *
 * Every draw the engine makes — spawn kind, celebrity share, spike timing
 * and jitter, target and belt choice, branch outcomes, request colours —
 * comes from one of these, so two engines built from the same board and the
 * same seed produce the same run tick for tick. That is what lets every
 * client in a room simulate locally yet watch the same traffic, lets a host
 * pin a seed for a fair comparison, and makes a bug report reproducible.
 *
 * The generator is mulberry32: 32-bit state, a single multiply-xorshift
 * round per draw, good enough statistics for a traffic simulation and tiny
 * enough to reason about. It is not a cryptographic source and nothing here
 * should be used as one.
 */
export interface Rng {
  /** Uniform in [0, 1), like `Math.random()`. */
  next(): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** The seed this generator started from. */
  readonly seed: number;
}

/** Seeds are 32-bit unsigned integers; anything else is reduced to one. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.floor(Math.abs(seed)) >>> 0;
}

export function createRng(seed: number): Rng {
  const normalized = normalizeSeed(seed);
  let state = normalized;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: normalized,
    next,
    chance: (probability) => next() < probability,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

/**
 * A fresh seed for a run nobody pinned. Drawn from the platform's
 * cryptographic source only because it is the best-distributed one
 * available; the seed itself is public and ends up on the report.
 */
export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  // Keep seeds non-zero so "no seed" can never be confused with seed 0.
  return buffer[0] === 0 ? 1 : buffer[0];
}

/** Parse a user-supplied seed (URL query, room setting); null when absent or malformed. */
export function parseSeed(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > 0xffffffff ? null : parsed;
}
