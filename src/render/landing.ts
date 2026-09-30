/** Landing-ring sizing shared by the 2D and 3D renderers. */

/**
 * Landing-ring radius (m): the catch radius, widened by the 1-sigma landing error fielders would
 * see with the current sensing noise (m) `t` seconds before landing, as in
 * `core/perception/sensing.ts`. Rings tighten as the ball comes down.
 */
export function landingRingRadius(catchRadius: number, noise: number, t: number): number {
  return Math.max(catchRadius, noise * Math.sqrt(1 + t * t));
}
