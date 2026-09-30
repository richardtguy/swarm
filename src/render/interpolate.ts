/**
 * Smooth motion between snapshots. The Worker posts a snapshot whenever ticks run, at roughly
 * render rate but not in step with it. Renderers draw one snapshot interval behind the newest
 * one and blend positions linearly between the two most recent snapshots. This never changes the
 * simulation's `dt` (CLAUDE.md section 3); it only affects what is drawn.
 */
import type { WorldSnapshot } from '../core/snapshot';
import { BallState } from '../core/state';

/**
 * Longest interval (ms) used for blending. After a pause the first new snapshot may arrive long
 * after the previous one; capping the interval keeps the view from crawling to catch up.
 */
export const MAX_BLEND_INTERVAL_MS = 100;

/**
 * Blend factor in [0, 1] at wall-clock time `now` (ms) for snapshots that arrived at `prevAt`
 * and `nextAt`: 0 shows the previous snapshot, 1 the newest.
 */
export function interpolationAlpha(prevAt: number, nextAt: number, now: number): number {
  const span = Math.min(nextAt - prevAt, MAX_BLEND_INTERVAL_MS);
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - nextAt) / span));
}

/** Holds the last two snapshots and produces blended ones on demand. */
export class SnapshotInterpolator {
  private prev: WorldSnapshot | null = null;
  private next: WorldSnapshot | null = null;
  private prevAt = 0;
  private nextAt = 0;
  private fielderPos = new Float32Array(0);
  private ballPos = new Float32Array(0);

  /** Record a snapshot that arrived at wall-clock time `atMs`. */
  push(snapshot: WorldSnapshot, atMs: number): void {
    const next = this.next;
    const restarted =
      next === null ||
      snapshot.tick < next.tick ||
      snapshot.fielderCount !== next.fielderCount ||
      snapshot.ballPos.length !== next.ballPos.length;
    if (restarted) {
      this.prev = null;
      this.next = snapshot;
      this.nextAt = atMs;
      return;
    }
    if (snapshot.tick === next.tick) {
      // Same tick, e.g. after a kill or pause: take the new state without restarting the blend.
      this.next = snapshot;
      return;
    }
    this.prev = next;
    this.prevAt = this.nextAt;
    this.next = snapshot;
    this.nextAt = atMs;
  }

  /** Forget everything, e.g. when the run is replaced. */
  clear(): void {
    this.prev = null;
    this.next = null;
  }

  /**
   * The snapshot to draw at wall-clock time `nowMs`, or null before the first push. Blended
   * snapshots share output buffers between calls, so consumers must not keep them.
   */
  sample(nowMs: number): WorldSnapshot | null {
    const { prev, next } = this;
    if (next === null) return null;
    if (prev === null) return next;
    const alpha = interpolationAlpha(this.prevAt, this.nextAt, nowMs);
    if (alpha >= 1) return next;

    if (this.fielderPos.length !== next.fielderPos.length) {
      this.fielderPos = new Float32Array(next.fielderPos.length);
    }
    if (this.ballPos.length !== next.ballPos.length) {
      this.ballPos = new Float32Array(next.ballPos.length);
    }
    for (let i = 0; i < next.fielderCount; i++) {
      const both = prev.fielderAlive[i] === 1 && next.fielderAlive[i] === 1;
      blendVector(this.fielderPos, prev.fielderPos, next.fielderPos, i, both ? alpha : 1);
    }
    for (let b = 0; b < next.ballCount; b++) {
      const both =
        b < prev.ballCount &&
        prev.ballState[b] === BallState.FLYING &&
        next.ballState[b] === BallState.FLYING;
      blendVector(this.ballPos, prev.ballPos, next.ballPos, b, both ? alpha : 1);
    }
    return {
      ...next,
      time: prev.time + (next.time - prev.time) * alpha,
      fielderPos: this.fielderPos,
      ballPos: this.ballPos,
    };
  }
}

/** out[i] = a[i] + (b[i] - a[i]) * alpha for the i-th 3-vector of SoA buffers. */
function blendVector(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array,
  i: number,
  alpha: number,
): void {
  const o = 3 * i;
  out[o] = a[o] + (b[o] - a[o]) * alpha;
  out[o + 1] = a[o + 1] + (b[o + 1] - a[o + 1]) * alpha;
  out[o + 2] = a[o + 2] + (b[o + 2] - a[o + 2]) * alpha;
}
