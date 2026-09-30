import { describe, expect, it } from 'vitest';
import { blendAvoidance, separation } from '../../../src/core/agents/avoidance';
import { vec3 } from '../../../src/core/vec3';

const still = (n: number): Float64Array => new Float64Array(3 * n);

describe('separation', () => {
  it('pushes away from a neighbour inside the radius, scaled by closeness', () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0]); // fielder 1 is 1 m east of 0
    const neighbours = new Int32Array([0, 1]);
    const a0 = separation(vec3(), positions, still(2), 0, neighbours, 2, 4, 10);
    const a1 = separation(vec3(), positions, still(2), 1, neighbours, 2, 4, 10);
    // strength * (1 - 1/4) = 7.5 along the line away from the other.
    expect(a0[0]).toBeCloseTo(-7.5, 12);
    expect(a0[1]).toBe(0);
    expect(a1[0]).toBeCloseTo(7.5, 12);
    expect(a0[2]).toBe(0);
  });

  it('overwrites out, sums pushes, and ignores neighbours outside the radius', () => {
    const positions = new Float64Array([0, 0, 0, 5, 0, 0, 0, 0.5, 0]);
    const neighbours = new Int32Array([0, 1, 2]);
    const push = separation(vec3(9, 9, 9), positions, still(3), 0, neighbours, 3, 2, 4);
    expect(push[0]).toBe(0); // fielder 1 at 5 m: no effect
    expect(push[1]).toBeCloseTo(-4 * (1 - 0.25), 12);
    expect(push[2]).toBe(0);
  });

  it('adds critical damping while the pair is closing, and none while it is opening', () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0]);
    const neighbours = new Int32Array([0, 1]);
    const radius = 2;
    const strength = 4;
    const spring = strength * (1 - 1 / radius);
    const damping = Math.sqrt((2 * strength) / radius);
    // Fielder 0 moves east at 1 m/s towards fielder 1: closing speed 1.
    const closing = new Float64Array([1, 0, 0, 0, 0, 0]);
    const a = separation(vec3(), positions, closing, 0, neighbours, 2, radius, strength);
    expect(a[0]).toBeCloseTo(-(spring + damping * 1), 12);
    // Moving west, away from fielder 1: spring only.
    const opening = new Float64Array([-1, 0, 0, 0, 0, 0]);
    const b = separation(vec3(), positions, opening, 0, neighbours, 2, radius, strength);
    expect(b[0]).toBeCloseTo(-spring, 12);
  });

  it('separates coincident fielders deterministically by id', () => {
    const positions = new Float64Array([3, 3, 0, 3, 3, 0]);
    const neighbours = new Int32Array([0, 1]);
    const a0 = separation(vec3(), positions, still(2), 0, neighbours, 2, 1, 2);
    const a1 = separation(vec3(), positions, still(2), 1, neighbours, 2, 1, 2);
    expect(a0[0]).toBe(-2);
    expect(a1[0]).toBe(2);
  });

  it('does nothing with a non-positive radius', () => {
    const positions = new Float64Array([0, 0, 0, 0.1, 0, 0]);
    const push = separation(vec3(), positions, still(2), 0, new Int32Array([1]), 1, 0, 5);
    expect([...push]).toEqual([0, 0, 0]);
  });
});

describe('blendAvoidance', () => {
  it('leaves steering alone when there is no push', () => {
    const steer = blendAvoidance(vec3(1, 2, 0), vec3(), 4);
    expect([...steer]).toEqual([1, 2, 0]);
  });

  it('discards the steering component that opposes the push and adds the push', () => {
    // Steering east at 3, push west at 1: the eastward component is dropped entirely.
    const steer = blendAvoidance(vec3(3, 0, 0), vec3(-1, 0, 0), 10);
    expect(steer[0]).toBeCloseTo(-1, 12);
    expect(steer[1]).toBe(0);
    // Steering north-east, push west: only the eastward part is dropped.
    const diagonal = blendAvoidance(vec3(3, 2, 0), vec3(-1, 0, 0), 10);
    expect(diagonal[0]).toBeCloseTo(-1, 12);
    expect(diagonal[1]).toBeCloseTo(2, 12);
  });

  it('keeps steering that agrees with the push and clamps the total', () => {
    const steer = blendAvoidance(vec3(-3, 0, 0), vec3(-3, 0, 0), 4);
    expect(steer[0]).toBeCloseTo(-4, 12);
  });
});
