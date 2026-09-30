import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import { HashGrid } from '../../../src/core/spatial/hashGrid';

function randomPositions(n: number, seed: number, extent: number): Float64Array {
  const s = new Rng(seed).stream('test');
  const pos = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = s.uniform(-extent, extent);
    pos[3 * i + 1] = s.uniform(-extent, extent);
    pos[3 * i + 2] = s.uniform(0, 5); // z must be ignored
  }
  return pos;
}

function bruteForce(
  pos: Float64Array,
  n: number,
  x: number,
  y: number,
  r: number,
  include?: Uint8Array,
) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (include !== undefined && include[i] === 0) continue;
    if (Math.hypot(pos[3 * i] - x, pos[3 * i + 1] - y) <= r) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

describe('HashGrid', () => {
  it('matches brute force for many random queries', () => {
    const n = 300;
    const pos = randomPositions(n, 1, 60);
    const grid = new HashGrid(5, n);
    grid.build(pos, n);
    const s = new Rng(2).stream('test');
    const out = new Int32Array(n);
    for (let q = 0; q < 200; q++) {
      const x = s.uniform(-70, 70);
      const y = s.uniform(-70, 70);
      const r = s.uniform(0, 15);
      const found = grid.query(x, y, r, out);
      const got = [...out.subarray(0, found)].sort((a, b) => a - b);
      expect(got).toEqual(bruteForce(pos, n, x, y, r));
    }
  });

  it('skips excluded entries', () => {
    const n = 50;
    const pos = randomPositions(n, 3, 10);
    const include = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i += 3) include[i] = 0;
    const grid = new HashGrid(4, n);
    grid.build(pos, n, include);
    const out = new Int32Array(n);
    const found = grid.query(0, 0, 100, out);
    const got = [...out.subarray(0, found)].sort((a, b) => a - b);
    expect(got).toEqual(bruteForce(pos, n, 0, 0, 100, include));
  });

  it('truncates when the output buffer is too small', () => {
    const n = 20;
    const pos = new Float64Array(3 * n); // all at the origin
    const grid = new HashGrid(1, n);
    grid.build(pos, n);
    const out = new Int32Array(5);
    expect(grid.query(0, 0, 1, out)).toBe(5);
  });

  it('handles negative coordinates and cell boundaries', () => {
    const pos = new Float64Array([-0.0001, -0.0001, 0, 0, 0, 0, 4.9999, 4.9999, 0, 5, 5, 0]);
    const grid = new HashGrid(5, 4);
    grid.build(pos, 4);
    const out = new Int32Array(4);
    expect(grid.query(0, 0, 0.001, out)).toBe(2);
    expect(grid.query(5, 5, 0.001, out)).toBe(2);
  });

  it('rejects more entries than its capacity', () => {
    const grid = new HashGrid(1, 2);
    expect(() => grid.build(new Float64Array(9), 3)).toThrow(RangeError);
  });
});
