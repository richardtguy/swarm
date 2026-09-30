/**
 * Allocation-free 3-vector helpers.
 *
 * A `Vec3` is a `Float64Array` of length 3 in the core's right-handed, z-up frame
 * (x east, y north, z up), in metres or metres per second depending on context.
 * Functions that produce a vector write into their first `out` argument and return it, so
 * callers can preallocate and reuse. The `load`/`store` helpers address the i-th vector of a
 * struct-of-arrays buffer (`buffer[3 * i + 0..2]`).
 */

/** A 3-vector backed by a typed array of length 3. */
export type Vec3 = Float64Array;

/** Allocate a new vector. Units follow the caller's context. */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  const v = new Float64Array(3);
  v[0] = x;
  v[1] = y;
  v[2] = z;
  return v;
}

/** out = (x, y, z) */
export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** out = a */
export function copy(out: Vec3, a: Vec3): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

/** out = a + b */
export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

/** out = a - b */
export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

/** out = a * s */
export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/** out = a + b * s. The workhorse of integration: `addScaled(pos, pos, vel, dt)`. */
export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

/** Dot product. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** out = a × b. `out` must not alias `a` or `b`. */
export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  return set(out, x, y, z);
}

/** Squared Euclidean length. */
export function lengthSq(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

/** Euclidean length. */
export function length(a: Vec3): number {
  return Math.sqrt(lengthSq(a));
}

/** Squared distance between two points. */
export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Distance between two points (m). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Horizontal (ground-plane) distance between two points, ignoring z (m). */
export function distanceXY(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** out = a / |a|, or zero if a is zero. */
export function normalize(out: Vec3, a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? scale(out, a, 1 / len) : set(out, 0, 0, 0);
}

/** out = a scaled so that |out| <= max, leaving shorter vectors unchanged. */
export function clampLength(out: Vec3, a: Vec3, max: number): Vec3 {
  const lsq = lengthSq(a);
  if (lsq > max * max && lsq > 0) return scale(out, a, max / Math.sqrt(lsq));
  return copy(out, a);
}

/** out = a + (b - a) * t */
export function lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Exact component-wise equality. */
export function equals(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** out = the i-th vector stored in a struct-of-arrays buffer. */
export function load(out: Vec3, buffer: ArrayLike<number>, i: number): Vec3 {
  const o = 3 * i;
  out[0] = buffer[o];
  out[1] = buffer[o + 1];
  out[2] = buffer[o + 2];
  return out;
}

/** Write `v` as the i-th vector of a struct-of-arrays buffer. */
export function store(buffer: Float64Array | Float32Array, i: number, v: Vec3): void {
  const o = 3 * i;
  buffer[o] = v[0];
  buffer[o + 1] = v[1];
  buffer[o + 2] = v[2];
}

/** Squared distance between the i-th vector of `a` and the j-th vector of `b`, both SoA buffers. */
export function distanceSqAt(
  a: ArrayLike<number>,
  i: number,
  b: ArrayLike<number>,
  j: number,
): number {
  const oa = 3 * i;
  const ob = 3 * j;
  const dx = a[oa] - b[ob];
  const dy = a[oa + 1] - b[ob + 1];
  const dz = a[oa + 2] - b[ob + 2];
  return dx * dx + dy * dy + dz * dz;
}
