import { describe, expect, it } from 'vitest';
import { steerArrive } from '../../../src/core/agents/steering';
import { vec3 } from '../../../src/core/vec3';

const MAX_SPEED = 7;
const MAX_ACCEL = 4;
const DT = 0.02;

describe('steerArrive', () => {
  it('never commands more than maxAccel and keeps z at zero', () => {
    const a = vec3();
    steerArrive(a, vec3(0, 0, 0), vec3(-7, 0, 0), vec3(50, 0, 0), MAX_SPEED, MAX_ACCEL, DT);
    expect(Math.hypot(a[0], a[1])).toBeCloseTo(MAX_ACCEL, 9);
    expect(a[2]).toBe(0);
  });

  it('commands zero acceleration when at rest on the target', () => {
    const a = vec3();
    steerArrive(a, vec3(3, 3, 0), vec3(), vec3(3, 3, 0), MAX_SPEED, MAX_ACCEL, DT);
    expect([...a]).toEqual([0, 0, 0]);
  });

  it('drives a fielder to the target and stops it there without large overshoot', () => {
    const p = vec3(-20, 5, 0);
    const v = vec3(2, -6, 0);
    const target = vec3(15, -10, 0);
    const a = vec3();
    let maxSpeed = 0;
    let arrived = false;
    let overshoot = 0;
    let minDist = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 2000; k++) {
      steerArrive(a, p, v, target, MAX_SPEED, MAX_ACCEL, DT);
      expect(Math.hypot(a[0], a[1])).toBeLessThanOrEqual(MAX_ACCEL + 1e-9);
      v[0] += a[0] * DT;
      v[1] += a[1] * DT;
      p[0] += v[0] * DT;
      p[1] += v[1] * DT;
      maxSpeed = Math.max(maxSpeed, Math.hypot(v[0], v[1]));
      const dist = Math.hypot(target[0] - p[0], target[1] - p[1]);
      if (dist < minDist) minDist = dist;
      if (arrived) overshoot = Math.max(overshoot, dist);
      if (dist < 0.02 && Math.hypot(v[0], v[1]) < 0.05) arrived = true;
    }
    expect(arrived).toBe(true);
    expect(maxSpeed).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
    expect(overshoot).toBeLessThan(0.1);
    const finalSpeed = Math.hypot(v[0], v[1]);
    expect(finalSpeed).toBeLessThan(0.05);
  });
});
