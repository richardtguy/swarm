import { describe, expect, it } from 'vitest';
import { slack, timeToReach } from '../../../src/core/agents/kinematics';
import { steerArrive } from '../../../src/core/agents/steering';
import { Rng } from '../../../src/core/rng';
import { vec3, type Vec3 } from '../../../src/core/vec3';

const MAX_SPEED = 7;
const MAX_ACCEL = 4;
const DT = 0.02;
/** Arrival tolerance (m) for the brute-force simulation. */
const TOL = 0.05;
/**
 * The estimate is the time to be at rest on the target; the simulation stops when first within
 * TOL. On the braking profile the last TOL metres take sqrt(2 TOL / a), so subtract that.
 */
const TOL_CORRECTION = Math.sqrt((2 * TOL) / MAX_ACCEL);

/** Simulate the arrive controller and return the time to first come within TOL of the target. */
function simulateArrival(pos: Vec3, vel: Vec3, target: Vec3): number {
  const p = vec3(pos[0], pos[1], 0);
  const v = vec3(vel[0], vel[1], 0);
  const a = vec3();
  for (let k = 0; k < 20000; k++) {
    if (Math.hypot(target[0] - p[0], target[1] - p[1]) < TOL) return k * DT;
    steerArrive(a, p, v, target, MAX_SPEED, MAX_ACCEL, DT);
    v[0] += a[0] * DT;
    v[1] += a[1] * DT;
    const s = Math.hypot(v[0], v[1]);
    if (s > MAX_SPEED) {
      v[0] *= MAX_SPEED / s;
      v[1] *= MAX_SPEED / s;
    }
    p[0] += v[0] * DT;
    p[1] += v[1] * DT;
  }
  return Number.POSITIVE_INFINITY;
}

describe('timeToReach', () => {
  it('is zero for a stationary fielder already at the target', () => {
    expect(timeToReach(vec3(1, 2, 0), vec3(), vec3(1, 2, 0), MAX_SPEED, MAX_ACCEL)).toBe(0);
  });

  it('uses the triangular profile for short distances from rest', () => {
    // Accelerate then brake, never reaching max speed: t = 2 sqrt(d / a).
    const d = 4;
    expect(timeToReach(vec3(), vec3(), vec3(d, 0, 0), MAX_SPEED, MAX_ACCEL)).toBeCloseTo(
      2 * Math.sqrt(d / MAX_ACCEL),
      12,
    );
  });

  it('uses the trapezoidal profile for long distances from rest', () => {
    const d = 100;
    const accelTime = MAX_SPEED / MAX_ACCEL;
    const accelDist = (MAX_SPEED * MAX_SPEED) / (2 * MAX_ACCEL);
    const expected = 2 * accelTime + (d - 2 * accelDist) / MAX_SPEED;
    expect(timeToReach(vec3(), vec3(), vec3(0, d, 0), MAX_SPEED, MAX_ACCEL)).toBeCloseTo(
      expected,
      12,
    );
  });

  it('ignores the z component', () => {
    const a = timeToReach(vec3(0, 0, 0), vec3(), vec3(10, 0, 0), MAX_SPEED, MAX_ACCEL);
    const b = timeToReach(vec3(0, 0, 0), vec3(), vec3(10, 0, 1.5), MAX_SPEED, MAX_ACCEL);
    expect(a).toBe(b);
  });

  it('is longer when moving away and shorter when moving towards the target', () => {
    const rest = timeToReach(vec3(), vec3(), vec3(20, 0, 0), MAX_SPEED, MAX_ACCEL);
    const towards = timeToReach(vec3(), vec3(3, 0, 0), vec3(20, 0, 0), MAX_SPEED, MAX_ACCEL);
    const away = timeToReach(vec3(), vec3(-3, 0, 0), vec3(20, 0, 0), MAX_SPEED, MAX_ACCEL);
    expect(towards).toBeLessThan(rest);
    expect(away).toBeGreaterThan(rest);
  });

  it('agrees with a brute-force simulation of the arrive controller from a moving start', () => {
    const s = new Rng(77).stream('test');
    let worstUnder = 0;
    let worstOver = 0;
    for (let trial = 0; trial < 300; trial++) {
      const pos = vec3(s.uniform(-30, 30), s.uniform(-30, 30), 0);
      const target = vec3(s.uniform(-30, 30), s.uniform(-30, 30), 0);
      const speed = s.uniform(0, MAX_SPEED);
      const heading = s.uniform(0, 2 * Math.PI);
      const vel = vec3(speed * Math.cos(heading), speed * Math.sin(heading), 0);

      const estimate = timeToReach(pos, vel, target, MAX_SPEED, MAX_ACCEL) - TOL_CORRECTION;
      const simulated = simulateArrival(pos, vel, target);
      expect(simulated).toBeLessThan(Number.POSITIVE_INFINITY);
      worstUnder = Math.max(worstUnder, simulated - estimate);
      worstOver = Math.max(worstOver, estimate - simulated);
    }
    // Measured over 500 random trials: worst underestimate 0.41 s, worst overestimate 0.47 s.
    // Both tails come from a fielder moving near top speed almost perpendicular to a target
    // only a few metres away, where the approach line rotates as it drifts.
    expect(worstUnder).toBeLessThanOrEqual(0.5);
    expect(worstOver).toBeLessThanOrEqual(0.6);
  });

  it('from rest, matches the brute-force simulation closely and never underestimates', () => {
    const s = new Rng(5).stream('test');
    for (let trial = 0; trial < 100; trial++) {
      const pos = vec3(s.uniform(-40, 40), s.uniform(-40, 40), 0);
      const target = vec3(s.uniform(-40, 40), s.uniform(-40, 40), 0);
      const estimate = timeToReach(pos, vec3(), target, MAX_SPEED, MAX_ACCEL) - TOL_CORRECTION;
      const simulated = simulateArrival(pos, vec3(), target);
      expect(simulated - estimate).toBeLessThanOrEqual(0.02);
      expect(estimate - simulated).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('slack', () => {
  it('is arrival time minus now minus time to reach', () => {
    const pos = vec3();
    const target = vec3(4, 0, 0);
    const eta = timeToReach(pos, vec3(), target, MAX_SPEED, MAX_ACCEL);
    expect(slack(pos, vec3(), target, 10, 3, MAX_SPEED, MAX_ACCEL)).toBeCloseTo(7 - eta, 12);
  });
});
