/**
 * Uniform hash grid over the ground plane for neighbour and range queries.
 *
 * Entries are bucketed by their (x, y) cell; z is ignored while fielders are ground-bound
 * (a 3D grid is a Phase 9 upgrade). The grid is rebuilt each tick from a struct-of-arrays
 * position buffer and allocates nothing after construction. Query results are not in index
 * order: callers that need determinism must select by an explicit key (e.g. distance, then id).
 */

export class HashGrid {
  private readonly mask: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellY: Int32Array;
  private positions: ArrayLike<number> = [];
  private count = 0;

  /**
   * @param cellSize cell edge (m); choose about the largest query radius in use
   * @param capacity maximum number of entries
   */
  constructor(
    readonly cellSize: number,
    readonly capacity: number,
  ) {
    if (!(cellSize > 0)) throw new RangeError(`cellSize must be positive, got ${cellSize}`);
    let tableSize = 16;
    while (tableSize < 2 * capacity) tableSize *= 2;
    this.mask = tableSize - 1;
    this.head = new Int32Array(tableSize);
    this.next = new Int32Array(Math.max(1, capacity));
    this.cellX = new Int32Array(Math.max(1, capacity));
    this.cellY = new Int32Array(Math.max(1, capacity));
  }

  /**
   * Index the first `count` entries of `positions` (3 components each). Entries with
   * `include[i] === 0` are skipped when `include` is given.
   */
  build(positions: ArrayLike<number>, count: number, include?: Uint8Array): void {
    if (count > this.capacity)
      throw new RangeError(`count ${count} exceeds capacity ${this.capacity}`);
    this.positions = positions;
    this.count = count;
    this.head.fill(-1);
    for (let i = 0; i < count; i++) {
      if (include !== undefined && include[i] === 0) {
        this.next[i] = -2; // not indexed
        continue;
      }
      const cx = Math.floor(positions[3 * i] / this.cellSize);
      const cy = Math.floor(positions[3 * i + 1] / this.cellSize);
      this.cellX[i] = cx;
      this.cellY[i] = cy;
      const bucket = this.hash(cx, cy);
      this.next[i] = this.head[bucket];
      this.head[bucket] = i;
    }
  }

  /**
   * Write the indices of indexed entries within `radius` (horizontal distance) of (x, y) into
   * `out`, and return how many were found. If `out` fills up, further matches are dropped.
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    const s = this.cellSize;
    const minX = Math.floor((x - radius) / s);
    const maxX = Math.floor((x + radius) / s);
    const minY = Math.floor((y - radius) / s);
    const maxY = Math.floor((y + radius) / s);
    const rSq = radius * radius;
    const pos = this.positions;
    let found = 0;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        let i = this.head[this.hash(cx, cy)];
        while (i !== -1) {
          if (this.cellX[i] === cx && this.cellY[i] === cy) {
            const dx = pos[3 * i] - x;
            const dy = pos[3 * i + 1] - y;
            if (dx * dx + dy * dy <= rSq) {
              if (found < out.length) out[found] = i;
              found++;
            }
          }
          i = this.next[i];
        }
      }
    }
    return Math.min(found, out.length);
  }

  /** Number of entries passed to the last `build()`. */
  get size(): number {
    return this.count;
  }

  private hash(cx: number, cy: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & this.mask;
  }
}
