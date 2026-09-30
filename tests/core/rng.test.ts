import { describe, expect, it } from 'vitest';
import { Rng, RngStream } from '../../src/core/rng';

function draw(stream: RngStream, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(stream.next());
  return out;
}

describe('Rng', () => {
  it('produces the same sequence for the same seed and stream', () => {
    const a = draw(new Rng(42).stream('launch'), 100);
    const b = draw(new Rng(42).stream('launch'), 100);
    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const a = draw(new Rng(1).stream('launch'), 20);
    const b = draw(new Rng(2).stream('launch'), 20);
    expect(a).not.toEqual(b);
  });

  it('produces different sequences for different streams', () => {
    const rng = new Rng(42);
    const a = draw(rng.stream('launch'), 20);
    const b = draw(rng.stream('comms'), 20);
    expect(a).not.toEqual(b);
  });

  it('gives each stream a sequence independent of creation order and other draws', () => {
    const solo = draw(new Rng(42).stream('comms'), 50);

    const shared = new Rng(42);
    draw(shared.stream('launch'), 1000);
    draw(shared.stream('perception'), 7);
    const interleaved = draw(shared.stream('comms'), 50);

    expect(interleaved).toEqual(solo);
  });

  it('returns the same stream object on repeated calls', () => {
    const rng = new Rng(3);
    expect(rng.stream('strategy')).toBe(rng.stream('strategy'));
  });

  it('rejects non-finite seeds', () => {
    expect(() => new Rng(Number.NaN)).toThrow(RangeError);
  });

  it('handles seeds beyond 32 bits without collapsing them', () => {
    const a = draw(new Rng(2 ** 32 + 5).stream('launch'), 10);
    const b = draw(new Rng(5).stream('launch'), 10);
    expect(a).not.toEqual(b);
  });
});

describe('RngStream', () => {
  it('next() stays in [0, 1) with a mean near 0.5', () => {
    const s = new Rng(9).stream('test');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('int() covers the whole inclusive range', () => {
    const s = new Rng(11).stream('test');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = s.int(-2, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('int() rejects an empty range', () => {
    expect(() => new Rng(1).stream('test').int(5, 4)).toThrow(RangeError);
  });

  it('uniform() stays within bounds', () => {
    const s = new Rng(5).stream('test');
    for (let i = 0; i < 1000; i++) {
      const v = s.uniform(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('chance() matches its probability statistically', () => {
    const s = new Rng(21).stream('test');
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (s.chance(0.3)) hits++;
    expect(hits / n).toBeCloseTo(0.3, 1);
  });

  it('normal() has the requested mean and standard deviation', () => {
    const s = new Rng(33).stream('test');
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = s.normal(2, 0.5);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(2, 1);
    expect(sd).toBeCloseTo(0.5, 1);
  });

  it('never starts from the all-zero state', () => {
    // Exhaustive search is impossible; check a spread of seeds including 0.
    for (const seed of [0, 1, 0xffffffff, 12345]) {
      const state = new RngStream(seed).state();
      expect(state.some((w) => w !== 0)).toBe(true);
    }
  });
});
