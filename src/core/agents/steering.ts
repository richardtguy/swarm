/**
 * Target seeking with acceleration and speed limits.
 *
 * `steerArrive` produces the acceleration that carries a ground-bound fielder to a target and
 * brings it to rest there. It executes the same policy that `kinematics.timeToReach` models,
 * so the estimate and the motion agree: acceleration is spent first on cancelling velocity
 * across the approach line, and whatever budget remains follows an accelerate–cruise–brake
 * profile along it. Horizontal only: the z component of the output is 0.
 */
import type { Vec3 } from '../vec3';

/**
 * Acceleration (m/s², written into `out`) for one tick of length `dt` that steers from `pos`
 * with velocity `vel` towards `target`, arriving at rest. Magnitude never exceeds `maxAccel`
 * and the commanded speed never exceeds `maxSpeed`.
 */
export function steerArrive(
  out: Vec3,
  pos: Vec3,
  vel: Vec3,
  target: Vec3,
  maxSpeed: number,
  maxAccel: number,
  dt: number,
): Vec3 {
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  out[2] = 0;

  if (dist === 0) {
    // On the target: just come to rest. (`0 - v` rather than `-v` avoids emitting -0.)
    let ax = (0 - vel[0]) / dt;
    let ay = (0 - vel[1]) / dt;
    const mag = Math.sqrt(ax * ax + ay * ay);
    if (mag > maxAccel) {
      ax *= maxAccel / mag;
      ay *= maxAccel / mag;
    }
    out[0] = ax;
    out[1] = ay;
    return out;
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const along = vel[0] * ux + vel[1] * uy;
  const across = -vel[0] * uy + vel[1] * ux;

  // Priority 1: cancel the across component.
  const aAcross = clamp(-across / dt, maxAccel);
  const budget = Math.sqrt(Math.max(0, maxAccel * maxAccel - aAcross * aAcross));

  // Priority 2: follow the along-line profile with the remaining budget. The half-step term
  // accounts for semi-implicit Euler integration, so braking lands on the target rather than a
  // fraction of a step past it.
  const brakeSpeed = Math.sqrt(Math.max(0, 2 * maxAccel * (dist - (maxAccel * dt * dt) / 2)));
  const desired = Math.min(maxSpeed, brakeSpeed);
  const aAlong = clamp((desired - along) / dt, budget);

  out[0] = aAlong * ux - aAcross * uy;
  out[1] = aAlong * uy + aAcross * ux;
  return out;
}

function clamp(value: number, limit: number): number {
  return value > limit ? limit : value < -limit ? -limit : value;
}
