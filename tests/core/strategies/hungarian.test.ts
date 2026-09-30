import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import {
  INFEASIBLE,
  assignmentCost,
  solveAssignment,
} from '../../../src/core/strategies/hungarian';

/** Exhaustive minimum over all partial injective row → column maps, ignoring infeasible pairs. */
function bruteForce(
  cost: Float64Array,
  rows: number,
  cols: number,
): { count: number; cost: number } {
  let bestCount = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  const usedCol = new Uint8Array(cols);
  const recurse = (row: number, count: number, total: number): void => {
    if (row === rows) {
      if (count > bestCount || (count === bestCount && total < bestCost)) {
        bestCount = count;
        bestCost = total;
      }
      return;
    }
    recurse(row + 1, count, total); // leave this row unassigned
    for (let c = 0; c < cols; c++) {
      if (usedCol[c] || cost[row * cols + c] >= INFEASIBLE) continue;
      usedCol[c] = 1;
      recurse(row + 1, count + 1, total + cost[row * cols + c]);
      usedCol[c] = 0;
    }
  };
  recurse(0, 0, 0);
  return { count: bestCount, cost: bestCount === 0 ? 0 : bestCost };
}

function countAssigned(assignment: Int32Array): number {
  let n = 0;
  for (const a of assignment) if (a >= 0) n++;
  return n;
}

function checkValid(assignment: Int32Array, cost: Float64Array, cols: number): void {
  const seen = new Set<number>();
  for (let r = 0; r < assignment.length; r++) {
    const c = assignment[r];
    if (c < 0) continue;
    expect(c).toBeLessThan(cols);
    expect(seen.has(c)).toBe(false);
    seen.add(c);
    expect(cost[r * cols + c]).toBeLessThan(INFEASIBLE);
  }
}

describe('solveAssignment', () => {
  it('handles empty problems', () => {
    expect([...solveAssignment(new Float64Array(0), 0, 3)]).toEqual([]);
    expect([...solveAssignment(new Float64Array(0), 2, 0)]).toEqual([-1, -1]);
  });

  it('solves a known 3×3 case', () => {
    // Classic example: optimal is (0→1, 1→0, 2→2) with cost 1 + 2 + 3 = 6? Check by brute force.
    const cost = new Float64Array([4, 1, 3, 2, 0, 5, 3, 2, 2]);
    const a = solveAssignment(cost, 3, 3);
    checkValid(a, cost, 3);
    const bf = bruteForce(cost, 3, 3);
    expect(countAssigned(a)).toBe(bf.count);
    expect(assignmentCost(cost, 3, a)).toBeCloseTo(bf.cost, 9);
  });

  it('matches brute force on random square, rectangular and infeasible matrices up to 7×7', () => {
    const s = new Rng(123).stream('test');
    for (let trial = 0; trial < 300; trial++) {
      const rows = s.int(1, 7);
      const cols = s.int(1, 7);
      const infeasibleProb = trial % 3 === 0 ? 0.4 : trial % 3 === 1 ? 0.1 : 0;
      const cost = new Float64Array(rows * cols);
      for (let k = 0; k < cost.length; k++) {
        cost[k] = s.chance(infeasibleProb) ? INFEASIBLE : s.int(0, 20);
      }
      const a = solveAssignment(cost, rows, cols);
      checkValid(a, cost, cols);
      const bf = bruteForce(cost, rows, cols);
      expect(countAssigned(a)).toBe(bf.count);
      expect(assignmentCost(cost, cols, a)).toBeCloseTo(bf.cost, 9);
    }
  });

  it('leaves every row unassigned when nothing is feasible', () => {
    const cost = new Float64Array(6).fill(INFEASIBLE);
    expect([...solveAssignment(cost, 2, 3)]).toEqual([-1, -1]);
    expect([...solveAssignment(cost, 3, 2)]).toEqual([-1, -1, -1]);
  });
});
