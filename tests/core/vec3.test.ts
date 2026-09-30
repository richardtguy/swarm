import { describe, expect, it } from 'vitest';
import * as v from '../../src/core/vec3';

describe('vec3', () => {
  it('constructs and sets', () => {
    expect([...v.vec3()]).toEqual([0, 0, 0]);
    expect([...v.vec3(1, 2, 3)]).toEqual([1, 2, 3]);
    const out = v.vec3();
    expect(v.set(out, 4, 5, 6)).toBe(out);
    expect([...out]).toEqual([4, 5, 6]);
  });

  it('does arithmetic into out without allocating', () => {
    const a = v.vec3(1, 2, 3);
    const b = v.vec3(10, 20, 30);
    const out = v.vec3();
    expect([...v.add(out, a, b)]).toEqual([11, 22, 33]);
    expect([...v.sub(out, b, a)]).toEqual([9, 18, 27]);
    expect([...v.scale(out, a, 2)]).toEqual([2, 4, 6]);
    expect([...v.addScaled(out, a, b, 0.5)]).toEqual([6, 12, 18]);
    expect([...v.lerp(out, a, b, 0.5)]).toEqual([5.5, 11, 16.5]);
  });

  it('supports aliasing out with an input', () => {
    const a = v.vec3(1, 2, 3);
    v.addScaled(a, a, v.vec3(1, 1, 1), 2);
    expect([...a]).toEqual([3, 4, 5]);
  });

  it('computes products and lengths', () => {
    const a = v.vec3(1, 0, 0);
    const b = v.vec3(0, 1, 0);
    expect(v.dot(a, b)).toBe(0);
    expect([...v.cross(v.vec3(), a, b)]).toEqual([0, 0, 1]);
    expect(v.length(v.vec3(3, 4, 0))).toBe(5);
    expect(v.lengthSq(v.vec3(3, 4, 0))).toBe(25);
    expect(v.distance(v.vec3(1, 1, 1), v.vec3(4, 5, 1))).toBe(5);
    expect(v.distanceXY(v.vec3(0, 0, 0), v.vec3(3, 4, 100))).toBe(5);
  });

  it('normalises and clamps, treating zero safely', () => {
    expect([...v.normalize(v.vec3(), v.vec3(0, 3, 0))]).toEqual([0, 1, 0]);
    expect([...v.normalize(v.vec3(), v.vec3())]).toEqual([0, 0, 0]);
    expect([...v.clampLength(v.vec3(), v.vec3(0, 10, 0), 2)]).toEqual([0, 2, 0]);
    expect([...v.clampLength(v.vec3(), v.vec3(0, 1, 0), 2)]).toEqual([0, 1, 0]);
  });

  it('loads from and stores into struct-of-arrays buffers', () => {
    const buffer = new Float64Array([0, 0, 0, 7, 8, 9]);
    const out = v.load(v.vec3(), buffer, 1);
    expect([...out]).toEqual([7, 8, 9]);
    v.store(buffer, 0, v.vec3(1, 2, 3));
    expect([...buffer]).toEqual([1, 2, 3, 7, 8, 9]);
    expect(v.distanceSqAt(buffer, 0, buffer, 1)).toBe(36 + 36 + 36);
  });

  it('compares exactly', () => {
    expect(v.equals(v.vec3(1, 2, 3), v.vec3(1, 2, 3))).toBe(true);
    expect(v.equals(v.vec3(1, 2, 3), v.vec3(1, 2, 3.0000001))).toBe(false);
  });
});
