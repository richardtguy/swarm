/**
 * Collision avoidance as behaviour: a separation force that pushes a fielder away from others
 * inside `separationRadius`, blended with steering by the motion stage. Physical contact is
 * handled separately in `physics/collisions.ts` (Phase 5). ORCA is a Phase 7 upgrade.
 *
 * The force is a spring plus approach damping. Without damping, the spring and the pull back
 * home form an undamped oscillator: two fielders sharing a home swing between 0.6 m and 2.5 m
 * apart indefinitely, dipping under `minSeparation` every cycle. The damping coefficient is
 * chosen for critical damping of the linearised pair, so it is derived, not tuned.
 */
import type { Vec3 } from '../vec3';

/**
 * Write into `out` the horizontal push (m/s²) on fielder `self` from each of the `count`
 * fielders in `neighbours` (indices into the SoA `positions` and `velocities` buffers; self may
 * be included) that lie within `radius` (m).
 *
 * Each neighbour contributes, along the unit normal n from the neighbour to self:
 * - a spring term `strength * (1 - d / radius)`;
 * - a damping term `c * closing` while the pair is approaching, where `closing` is the relative
 *   speed (m/s) at which the gap shrinks and `c = sqrt(2 * strength / radius)` (1/s) critically
 *   damps the gap's linearised dynamics when both fielders apply the same rule.
 *
 * Two fielders at exactly the same point are pushed apart along x, the lower id towards -x, so
 * the result is still deterministic. Returns `out`, which is zero when nothing is near.
 */
export function separation(
  out: Vec3,
  positions: ArrayLike<number>,
  velocities: ArrayLike<number>,
  self: number,
  neighbours: Int32Array,
  count: number,
  radius: number,
  strength: number,
): Vec3 {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (!(radius > 0)) return out;
  const damping = Math.sqrt((2 * strength) / radius);
  const o = 3 * self;
  const sx = positions[o];
  const sy = positions[o + 1];
  const svx = velocities[o];
  const svy = velocities[o + 1];
  for (let k = 0; k < count; k++) {
    const j = neighbours[k];
    if (j === self) continue;
    const q = 3 * j;
    const dx = sx - positions[q];
    const dy = sy - positions[q + 1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= radius) continue;
    if (d === 0) {
      out[0] += self < j ? -strength : strength;
      continue;
    }
    const nx = dx / d;
    const ny = dy / d;
    // Gap rate is (v_self - v_other) · n; the pair is closing when it is negative.
    const closing = -((svx - velocities[q]) * nx + (svy - velocities[q + 1]) * ny);
    const push = strength * (1 - d / radius) + (closing > 0 ? damping * closing : 0);
    out[0] += nx * push;
    out[1] += ny * push;
  }
  return out;
}

/**
 * Combine a steering acceleration with a separation push, giving separation priority: any
 * component of the steering that pushes against the separation direction is discarded, so a
 * fielder never drives into a neighbour inside the separation radius. The result is written
 * over `steer` and clamped to `maxAccel` (m/s²). Returns `steer`.
 */
export function blendAvoidance(steer: Vec3, push: Vec3, maxAccel: number): Vec3 {
  const pushSq = push[0] * push[0] + push[1] * push[1];
  if (pushSq > 0) {
    const along = (steer[0] * push[0] + steer[1] * push[1]) / pushSq;
    if (along < 0) {
      steer[0] -= along * push[0];
      steer[1] -= along * push[1];
    }
    steer[0] += push[0];
    steer[1] += push[1];
  }
  const mag = Math.sqrt(steer[0] * steer[0] + steer[1] * steer[1]);
  if (mag > maxAccel) {
    steer[0] *= maxAccel / mag;
    steer[1] *= maxAccel / mag;
  }
  return steer;
}
