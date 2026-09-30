/**
 * The ONLY place that converts between the core frame and three.js's frame (CLAUDE.md section 3).
 *
 * Core: right-handed, z-up. x east, y north, z up, in metres.
 * three.js: right-handed, y-up. Core (x, y, z) becomes three (x, z, -y), so east stays +x, up is
 * +y, and north is -z. Geometry built along three's +y axis therefore stands upright on the core
 * ground plane, and every other axis mapping goes through the functions below.
 */
import type { BufferGeometry, Vector3 } from 'three';

/** Write the three.js position of core point (x, y, z) (m) into `out`. */
export function toThree(out: Vector3, x: number, y: number, z: number): Vector3 {
  return out.set(x, z, -y);
}

/** Write core point (x, y, z) (m) as the `index`-th vertex of a three.js position buffer. */
export function writeThree(
  buffer: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const o = 3 * index;
  buffer[o] = x;
  buffer[o + 1] = z;
  buffer[o + 2] = -y;
}

/** Core coordinates (m) of a three.js position. */
export function fromThree(v: Readonly<Vector3>): [number, number, number] {
  return [v.x, -v.z, v.y];
}

/**
 * Orient a flat geometry built in three's xy-plane (such as `PlaneGeometry` or `CircleGeometry`)
 * onto the core ground plane, facing up. The geometry's local +x stays east and its local +y
 * becomes north. Mutates and returns `geometry`.
 */
export function layFlat<T extends BufferGeometry>(geometry: T): T {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
