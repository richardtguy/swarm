/**
 * Reachability shared by every strategy, so comparisons between them are fair.
 *
 * Fielders are ground-bound for now, so all quantities use horizontal (x, y) components only.
 * Phase 9 extends this to three dimensions for airborne agents.
 */
import type { Vec3 } from '../vec3';

/**
 * Refinements of the across-line cancellation phase. One pass matches the arrive controller
 * best: more passes were measured to overestimate the controller by up to 0.6 s.
 */
const ACROSS_PASSES = 1;
/** Across velocity (m/s) below which no further refinement is worthwhile. */
const ACROSS_EPSILON = 0.05;

/**
 * Time (s) for a fielder to reach `target` and be stationary there, starting from `pos` with
 * velocity `vel`, using an acceleration-limited profile.
 *
 * The model is sequential and therefore conservative: any velocity across the approach line is
 * cancelled first (the fielder drifts sideways while that happens, which lengthens the
 * approach), then the fielder cancels any velocity away from the target, accelerates at
 * `maxAccel`, cruises at `maxSpeed` and brakes at `maxAccel` to arrive at rest.
 */
export function timeToReach(
  pos: Vec3,
  vel: Vec3,
  target: Vec3,
  maxSpeed: number,
  maxAccel: number,
): number {
  const a = maxAccel;
  let dx = target[0] - pos[0];
  let dy = target[1] - pos[1];
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (!(a > 0) || !(maxSpeed > 0)) return dist > 0 ? Number.POSITIVE_INFINITY : 0;

  let px = pos[0];
  let py = pos[1];
  let vx = vel[0];
  let vy = vel[1];
  let t = 0;
  if (dist === 0) {
    // Already at the target: just come to rest.
    return Math.sqrt(vx * vx + vy * vy) / a;
  }

  // Phase 1: cancel the velocity component across the approach line. During that time the
  // fielder keeps its along-line velocity and drifts sideways by across² / 2a, which rotates
  // the approach line, so repeat against the new line until the residual is negligible.
  for (let pass = 0; pass < ACROSS_PASSES; pass++) {
    const ux = dx / dist;
    const uy = dy / dist;
    const alongNow = vx * ux + vy * uy;
    const across = -vx * uy + vy * ux; // signed, positive to the left of the approach line
    if (Math.abs(across) < ACROSS_EPSILON) break;
    const t1 = Math.abs(across) / a;
    const drift = (across * across) / (2 * a);
    t += t1;
    px += ux * alongNow * t1 - uy * Math.sign(across) * drift;
    py += uy * alongNow * t1 + ux * Math.sign(across) * drift;
    vx = ux * alongNow;
    vy = uy * alongNow;
    dx = target[0] - px;
    dy = target[1] - py;
    dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return t + Math.abs(alongNow) / a;
  }

  // Charge any residual across velocity without further drift, and take the along component
  // against the final approach line.
  const ux = dx / dist;
  const uy = dy / dist;
  const along = vx * ux + vy * uy;
  t += Math.abs(-vx * uy + vy * ux) / a;

  let d = dist;
  let v0 = along;
  if (v0 < 0) {
    // Phase 2: moving away. Stop first, which adds to the distance.
    t += -v0 / a;
    d += (v0 * v0) / (2 * a);
    v0 = 0;
  } else if (v0 > maxSpeed) {
    v0 = maxSpeed;
  }

  const brakeDist = (v0 * v0) / (2 * a);
  if (brakeDist > d) {
    // Cannot stop before the target: overshoot, then come back from rest.
    t += v0 / a;
    return t + restProfile(brakeDist - d, maxSpeed, a);
  }

  // Phase 3: trapezoidal (or triangular) profile from speed v0 to rest over distance d.
  const peak = Math.sqrt(a * d + (v0 * v0) / 2);
  if (peak <= maxSpeed) {
    return t + (peak - v0) / a + peak / a;
  }
  const accelDist = (maxSpeed * maxSpeed - v0 * v0) / (2 * a);
  const cruiseDist = d - accelDist - (maxSpeed * maxSpeed) / (2 * a);
  return t + (maxSpeed - v0) / a + cruiseDist / maxSpeed + maxSpeed / a;
}

/** Time to cover `d` from rest to rest with limits `maxSpeed` and `a`. */
function restProfile(d: number, maxSpeed: number, a: number): number {
  const peak = Math.sqrt(a * d);
  if (peak <= maxSpeed) return (2 * peak) / a;
  return (2 * maxSpeed) / a + (d - (maxSpeed * maxSpeed) / a) / maxSpeed;
}

/**
 * Slack (s): how much earlier the fielder can be at `target` than the ball arrives.
 * Negative slack means the ball is out of reach.
 */
export function slack(
  pos: Vec3,
  vel: Vec3,
  target: Vec3,
  arrivalTime: number,
  now: number,
  maxSpeed: number,
  maxAccel: number,
): number {
  return arrivalTime - (now + timeToReach(pos, vel, target, maxSpeed, maxAccel));
}
