/**
 * Shared belt curve math so the simulation engine (travel times) and the
 * board renderer (particle positions) agree on exactly the same path.
 */

export interface Vec2 {
  x: number;
  y: number;
}

interface BeltControlPoints {
  cx1: number;
  cx2: number;
}

function controlPoints(from: Vec2, to: Vec2): BeltControlPoints {
  const dx = to.x - from.x;
  return { cx1: from.x + dx * 0.45, cx2: to.x - dx * 0.45 };
}

/** SVG path data for a belt between two ports. */
export function beltPathD(from: Vec2, to: Vec2): string {
  const { cx1, cx2 } = controlPoints(from, to);
  return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
}

/** Point on the belt curve at parameter t in [0, 1]. */
export function beltPoint(from: Vec2, to: Vec2, t: number): Vec2 {
  const { cx1, cx2 } = controlPoints(from, to);
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const x = uu * u * from.x + 3 * uu * t * cx1 + 3 * u * tt * cx2 + tt * t * to.x;
  const y = uu * u * from.y + 3 * uu * t * from.y + 3 * u * tt * to.y + tt * t * to.y;
  return { x, y };
}

/** Unit tangent of the belt curve at parameter t (falls back to +x when degenerate). */
export function beltTangent(from: Vec2, to: Vec2, t: number): Vec2 {
  const { cx1, cx2 } = controlPoints(from, to);
  const u = 1 - t;
  const dx =
    3 * u * u * (cx1 - from.x) + 6 * u * t * (cx2 - cx1) + 3 * t * t * (to.x - cx2);
  const dy = 3 * u * u * 0 + 6 * u * t * (to.y - from.y) + 3 * t * t * 0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Approximate arc length of the belt curve by sampling. */
export function beltLength(from: Vec2, to: Vec2, samples = 16): number {
  let length = 0;
  let prev = beltPoint(from, to, 0);
  for (let i = 1; i <= samples; i++) {
    const next = beltPoint(from, to, i / samples);
    length += Math.hypot(next.x - prev.x, next.y - prev.y);
    prev = next;
  }
  return length;
}

/** World pixels per second a request travels along a belt. */
export const BELT_PIXEL_SPEED = 260;
export const MIN_TRAVEL_SECONDS = 0.55;
export const MAX_TRAVEL_SECONDS = 2.4;

/** Seconds a request needs to traverse a belt of the given length. */
export function beltTravelSeconds(length: number): number {
  const raw = length / BELT_PIXEL_SPEED;
  return Math.max(MIN_TRAVEL_SECONDS, Math.min(MAX_TRAVEL_SECONDS, raw));
}
