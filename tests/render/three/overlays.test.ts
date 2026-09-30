import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { predictLanding, positionAt } from '../../../src/core/physics/ballistics';
import { vec3 } from '../../../src/core/vec3';
import { landingRingRadius } from '../../../src/render/landing';
import { fromThree } from '../../../src/render/three/coords';
import { writeArc, writeCircle } from '../../../src/render/three/overlays';

/** Core coordinates of the k-th vertex in a three.js position buffer. */
function vertex(buf: Float32Array, k: number): [number, number, number] {
  return fromThree(new Vector3(buf[3 * k], buf[3 * k + 1], buf[3 * k + 2]));
}

describe('writeArc', () => {
  const p = [3, -60, 0.5];
  const v = [2, 18, 16];

  it('writes connected segments from the ball to where it reaches zEnd', () => {
    const segments = 10;
    const buf = new Float32Array(2 * segments * 3);
    const written = writeArc(buf, 0, p, v, 0, segments);
    expect(written).toBe(2 * segments);

    const start = vertex(buf, 0);
    expect(start[0]).toBeCloseTo(p[0], 4);
    expect(start[1]).toBeCloseTo(p[1], 4);
    expect(start[2]).toBeCloseTo(p[2], 4);
    // Consecutive segments share endpoints.
    for (let s = 1; s < segments; s++) {
      const a = vertex(buf, 2 * s - 1);
      const b = vertex(buf, 2 * s);
      for (let c = 0; c < 3; c++) expect(a[c]).toBeCloseTo(b[c], 4);
    }
    const landing = vec3();
    predictLanding(landing, vec3(...p), vec3(...v), 0);
    const end = vertex(buf, 2 * segments - 1);
    expect(end[0]).toBeCloseTo(landing[0], 3);
    expect(end[1]).toBeCloseTo(landing[1], 3);
    expect(end[2]).toBeCloseTo(0, 3);
  });

  it('follows the ballistic trajectory at every vertex', () => {
    const buf = new Float32Array(2 * 8 * 3);
    writeArc(buf, 0, p, v, 0, 8);
    const at = vec3();
    const k = 5; // start of segment 5 is at 5/8 of the flight
    const [x, y, z] = vertex(buf, 2 * k);
    const duration = (v[2] + Math.sqrt(v[2] ** 2 + 2 * 9.81 * p[2])) / 9.81;
    positionAt(at, vec3(...p), vec3(...v), (k / 8) * duration);
    expect(x).toBeCloseTo(at[0], 3);
    expect(y).toBeCloseTo(at[1], 3);
    expect(z).toBeCloseTo(at[2], 3);
  });

  it('writes nothing for a ball that never reaches zEnd, and respects the offset', () => {
    const buf = new Float32Array(3 * 40).fill(7);
    expect(writeArc(buf, 0, [0, 0, 0], [0, 0, 1], 5, 4)).toBe(0);
    expect(buf.every((x) => x === 7)).toBe(true);
    expect(writeArc(buf, 3, p, v, 0, 4)).toBe(8);
    expect([...buf.subarray(0, 9)]).toEqual(new Array(9).fill(7));
  });
});

describe('writeCircle', () => {
  it('writes a closed horizontal circle of the given radius and height', () => {
    const segments = 16;
    const buf = new Float32Array(2 * segments * 3);
    expect(writeCircle(buf, 0, 10, -5, 1.5, 3, segments)).toBe(2 * segments);
    for (let k = 0; k < 2 * segments; k++) {
      const [x, y, z] = vertex(buf, k);
      expect(Math.hypot(x - 10, y + 5)).toBeCloseTo(3, 4);
      expect(z).toBeCloseTo(1.5, 5);
    }
    const first = vertex(buf, 0);
    const last = vertex(buf, 2 * segments - 1);
    for (let c = 0; c < 3; c++) expect(last[c]).toBeCloseTo(first[c], 4);
  });
});

describe('landingRingRadius', () => {
  it('is the catch radius without noise', () => {
    expect(landingRingRadius(1, 0, 3)).toBe(1);
  });

  it('widens with noise and shrinks as landing approaches', () => {
    const early = landingRingRadius(1, 0.5, 4);
    const late = landingRingRadius(1, 0.5, 1);
    expect(early).toBeCloseTo(0.5 * Math.sqrt(17), 12);
    expect(late).toBe(1); // 0.5·√2 < catch radius
    expect(early).toBeGreaterThan(late);
  });
});
