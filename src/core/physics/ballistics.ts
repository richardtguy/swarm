/**
 * Ball flight without drag: closed-form integration and landing prediction.
 *
 * Gravity acts along -z. Drag and wind (Phase 7) will add numerical integrators alongside
 * these analytic forms; the landing predictor will then become an estimate rather than exact.
 */
import type { Vec3 } from '../vec3';

/** Gravitational acceleration (m/s²). */
export const GRAVITY = 9.81;

/**
 * Advance the i-th ball of a struct-of-arrays buffer by `dt` seconds under gravity alone.
 * Exact for constant acceleration, so the trajectory is independent of the timestep.
 */
export function integrateBallistic(
  pos: Float64Array,
  vel: Float64Array,
  i: number,
  dt: number,
): void {
  const o = 3 * i;
  pos[o] += vel[o] * dt;
  pos[o + 1] += vel[o + 1] * dt;
  pos[o + 2] += vel[o + 2] * dt - 0.5 * GRAVITY * dt * dt;
  vel[o + 2] -= GRAVITY * dt;
}

/** Position (m) `t` seconds from now for a ball at `pos` with velocity `vel`. */
export function positionAt(out: Vec3, pos: Vec3, vel: Vec3, t: number): Vec3 {
  out[0] = pos[0] + vel[0] * t;
  out[1] = pos[1] + vel[1] * t;
  out[2] = pos[2] + vel[2] * t - 0.5 * GRAVITY * t * t;
  return out;
}

/**
 * Time (s, relative) until a ball at height `z` with vertical speed `vz` next descends through
 * height `h`. Returns 0 if it is already at or below `h` and descending, and NaN if its apex
 * never reaches `h`.
 */
export function timeToDescendThrough(z: number, vz: number, h: number): number {
  if (z <= h && vz <= 0) return 0;
  const disc = vz * vz - 2 * GRAVITY * (h - z);
  if (disc < 0) return Number.NaN;
  return (vz + Math.sqrt(disc)) / GRAVITY;
}

/**
 * Predict where the ball stored at index `i` of SoA buffers descends through height `h`.
 * Writes the landing point (m) into `out` and returns the relative time (s), or NaN if the ball
 * never descends through `h` (in which case `out` is left untouched).
 */
export function predictLandingAt(
  out: Vec3,
  pos: ArrayLike<number>,
  vel: ArrayLike<number>,
  i: number,
  h: number,
): number {
  const o = 3 * i;
  const t = timeToDescendThrough(pos[o + 2], vel[o + 2], h);
  if (Number.isNaN(t)) return t;
  out[0] = pos[o] + vel[o] * t;
  out[1] = pos[o + 1] + vel[o + 1] * t;
  out[2] = t === 0 ? pos[o + 2] : h;
  return t;
}

/** `predictLandingAt` for standalone vectors. */
export function predictLanding(out: Vec3, pos: Vec3, vel: Vec3, h: number): number {
  return predictLandingAt(out, pos, vel, 0, h);
}
