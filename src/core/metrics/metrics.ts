/**
 * Summary metrics computed from world state. Per-tick counters that cannot be recovered from
 * the state alone (messages, conflicts, collisions) are added in later phases.
 */
import { BallState, countAlive, type World } from '../state';

/** Headline numbers for a run so far. */
export interface MetricsSummary {
  tick: number;
  /** Simulation time (s). */
  time: number;
  fieldersAlive: number;
  fieldersTotal: number;
  ballsLaunched: number;
  ballsInFlight: number;
  ballsCaught: number;
  ballsDropped: number;
  /** Caught divided by settled (caught + dropped); 0 before any ball settles. */
  catchRate: number;
  /** Sum of distance travelled by all fielders (m). */
  distanceTravelled: number;
}

/** Compute the summary from the current world state. */
export function computeMetrics(world: Readonly<World>): MetricsSummary {
  let inFlight = 0;
  let caught = 0;
  let dropped = 0;
  for (let i = 0; i < world.ballCount; i++) {
    switch (world.ballState[i]) {
      case BallState.FLYING:
        inFlight++;
        break;
      case BallState.CAUGHT:
        caught++;
        break;
      case BallState.DROPPED:
        dropped++;
        break;
    }
  }
  let distance = 0;
  for (let i = 0; i < world.fielderCount; i++) distance += world.fielderDistance[i];
  const settled = caught + dropped;
  return {
    tick: world.tick,
    time: world.time,
    fieldersAlive: countAlive(world),
    fieldersTotal: world.fielderCount,
    ballsLaunched: world.ballCount,
    ballsInFlight: inFlight,
    ballsCaught: caught,
    ballsDropped: dropped,
    catchRate: settled > 0 ? caught / settled : 0,
    distanceTravelled: distance,
  };
}
