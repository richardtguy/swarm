import { describe, expect, it } from 'vitest';
import {
  GRAVITY,
  integrateBallistic,
  positionAt,
  predictLanding,
  timeToDescendThrough,
} from '../../../src/core/physics/ballistics';
import { vec3 } from '../../../src/core/vec3';

describe('integrateBallistic', () => {
  it('matches the closed-form trajectory step by step', () => {
    const pos = new Float64Array([1, 2, 0]);
    const vel = new Float64Array([5, -3, 20]);
    const p0 = vec3(1, 2, 0);
    const v0 = vec3(5, -3, 20);
    const dt = 0.02;
    const expected = vec3();
    for (let k = 1; k <= 200; k++) {
      integrateBallistic(pos, vel, 0, dt);
      positionAt(expected, p0, v0, k * dt);
      expect(pos[0]).toBeCloseTo(expected[0], 9);
      expect(pos[1]).toBeCloseTo(expected[1], 9);
      expect(pos[2]).toBeCloseTo(expected[2], 9);
      expect(vel[2]).toBeCloseTo(v0[2] - GRAVITY * k * dt, 9);
    }
  });

  it('is independent of the timestep', () => {
    const a = new Float64Array([0, 0, 0]);
    const va = new Float64Array([3, 4, 15]);
    const b = new Float64Array([0, 0, 0]);
    const vb = new Float64Array([3, 4, 15]);
    for (let k = 0; k < 100; k++) integrateBallistic(a, va, 0, 0.01);
    integrateBallistic(b, vb, 0, 1);
    expect(a[2]).toBeCloseTo(b[2], 9);
    expect(va[2]).toBeCloseTo(vb[2], 9);
  });
});

describe('timeToDescendThrough', () => {
  it('returns the descending root', () => {
    // From z = 0 with vz = 20, back to z = 0 after 2 vz / g.
    expect(timeToDescendThrough(0, 20, 0)).toBeCloseTo((2 * 20) / GRAVITY, 12);
  });

  it('returns 0 when already at or below the height and descending', () => {
    expect(timeToDescendThrough(1, -1, 1.5)).toBe(0);
    expect(timeToDescendThrough(1.5, 0, 1.5)).toBe(0);
  });

  it('returns NaN when the apex never reaches the height', () => {
    expect(timeToDescendThrough(0, 1, 10)).toBeNaN();
  });
});

describe('predictLanding', () => {
  it('matches where the integrated ball actually descends through catch height', () => {
    const h = 1.5;
    const pos = new Float64Array([-3, 10, 0]);
    const vel = new Float64Array([8, 12, 22]);
    const landing = vec3();
    const t = predictLanding(landing, pos, vel, h);
    expect(t).toBeGreaterThan(0);
    expect(landing[2]).toBe(h);

    const dt = 0.001;
    let elapsed = 0;
    let crossed = false;
    let prevZ = pos[2];
    for (let k = 0; k < 20000; k++) {
      integrateBallistic(pos, vel, 0, dt);
      elapsed += dt;
      if (vel[2] < 0 && prevZ > h && pos[2] <= h) {
        crossed = true;
        break;
      }
      prevZ = pos[2];
    }
    expect(crossed).toBe(true);
    expect(elapsed).toBeCloseTo(t, 2);
    expect(pos[0]).toBeCloseTo(landing[0], 1);
    expect(pos[1]).toBeCloseTo(landing[1], 1);
  });

  it('leaves the output untouched and returns NaN for an unreachable height', () => {
    const landing = vec3(9, 9, 9);
    expect(predictLanding(landing, vec3(0, 0, 0), vec3(1, 0, 1), 50)).toBeNaN();
    expect([...landing]).toEqual([9, 9, 9]);
  });
});
