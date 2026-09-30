/** Colour rules shared by the 2D and 3D renderers. */

/**
 * A stable, well-spread hue (degrees) per ball id. Fielders chasing the same ball share it, so
 * clumping is visible at a glance.
 */
export function targetHue(ballId: number): number {
  return (ballId * 47) % 360;
}

/** Saturation and lightness (0–1) used with `targetHue`. */
export const TARGET_SATURATION = 0.75;
export const TARGET_LIGHTNESS = 0.55;

/** The pursued-ball colour as a CSS string. */
export function targetColour(ballId: number): string {
  return `hsl(${targetHue(ballId)} ${TARGET_SATURATION * 100}% ${TARGET_LIGHTNESS * 100}%)`;
}
