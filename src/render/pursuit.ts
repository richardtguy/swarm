/** Who is chasing what, derived from a snapshot. Shared by the 2D and 3D renderers. */
import type { WorldSnapshot } from '../core/snapshot';
import { BallState } from '../core/state';

/**
 * Number of alive fielders pursuing each ball slot. A count above 1 is a conflict: several
 * fielders chasing one ball, which renderers draw in the near-miss colour.
 */
export function pursuerCounts(snap: Readonly<WorldSnapshot>): Int32Array {
  const counts = new Int32Array(snap.ballState.length);
  for (let i = 0; i < snap.fielderCount; i++) {
    const b = snap.fielderTargetBall[i];
    if (b < 0 || snap.fielderAlive[i] === 0 || snap.ballState[b] !== BallState.FLYING) continue;
    counts[b]++;
  }
  return counts;
}
