/**
 * Rectangular linear assignment: minimise total cost of matching rows to columns, each row to
 * at most one column and vice versa. Kuhn–Munkres with potentials, O(n²m) for n ≤ m.
 *
 * Pairs whose cost is `INFEASIBLE` or greater are never reported as assigned. Because
 * `INFEASIBLE` dwarfs any sum of feasible costs, the solver first maximises the number of
 * feasible assignments and then minimises their total cost.
 */

/** Cost of an impossible pairing. Feasible costs must stay well below this. */
export const INFEASIBLE = 1e6;

/**
 * Solve the assignment problem for a row-major `cost` matrix of `rows` × `cols`.
 * Returns, per row, the assigned column or -1.
 */
export function solveAssignment(cost: ArrayLike<number>, rows: number, cols: number): Int32Array {
  const result = new Int32Array(rows).fill(-1);
  if (rows === 0 || cols === 0) return result;

  if (rows > cols) {
    // Transpose so that rows ≤ cols, solve, then invert the mapping.
    const t = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) t[j * rows + i] = cost[i * cols + j];
    }
    const colToRow = solveAssignment(t, cols, rows);
    for (let j = 0; j < cols; j++) if (colToRow[j] >= 0) result[colToRow[j]] = j;
    return result;
  }

  const n = rows;
  const m = cols;
  // 1-indexed working arrays; index 0 is the virtual source.
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1); // p[j] = row matched to column j, 0 if none
  const way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Number.POSITIVE_INFINITY);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[(i0 - 1) * m + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  for (let j = 1; j <= m; j++) {
    const i = p[j];
    if (i !== 0 && cost[(i - 1) * m + (j - 1)] < INFEASIBLE) result[i - 1] = j - 1;
  }
  return result;
}

/** Total cost of an assignment, counting only assigned rows. */
export function assignmentCost(
  cost: ArrayLike<number>,
  cols: number,
  assignment: Int32Array,
): number {
  let total = 0;
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] >= 0) total += cost[i * cols + assignment[i]];
  }
  return total;
}
