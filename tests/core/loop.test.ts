import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../../src/core/loop';

describe('FixedStepAccumulator', () => {
  it('converts elapsed time into whole steps and carries the remainder', () => {
    const acc = new FixedStepAccumulator(0.02);
    expect(acc.advance(0.05)).toBe(2);
    expect(acc.alpha()).toBeCloseTo(0.5, 6);
    expect(acc.advance(0.01)).toBe(1);
    expect(acc.alpha()).toBeCloseTo(0, 6);
  });

  it('caps steps per advance and drops the surplus', () => {
    const acc = new FixedStepAccumulator(0.02, 5);
    expect(acc.advance(1)).toBe(5);
    expect(acc.advance(0.019)).toBe(0);
  });

  it('ignores negative and non-finite input', () => {
    const acc = new FixedStepAccumulator(0.02);
    expect(acc.advance(-1)).toBe(0);
    expect(acc.advance(Number.NaN)).toBe(0);
    expect(acc.advance(0.02)).toBe(1);
  });

  it('scales time', () => {
    const acc = new FixedStepAccumulator(0.02, 100, 2);
    expect(acc.advance(0.1)).toBe(10);
    acc.setTimeScale(0);
    expect(acc.advance(1)).toBe(0);
  });

  it('clears accumulated time', () => {
    const acc = new FixedStepAccumulator(0.02);
    acc.advance(0.019);
    acc.clear();
    expect(acc.advance(0.001)).toBe(0);
  });

  it('rejects a non-positive dt', () => {
    expect(() => new FixedStepAccumulator(0)).toThrow(RangeError);
  });
});
