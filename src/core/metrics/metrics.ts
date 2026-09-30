/**
 * Summary metrics computed from world state plus the counters the simulation keeps for things
 * the state alone cannot recover (near-misses; messages from Phase 3).
 */
import { BallState, countAlive, type World } from '../state';

/** Counters maintained by the simulation across ticks. */
export interface RunCounters {
  /** Near-miss episodes (pairs entering `minSeparation`) since init. */
  nearMisses: number;
}

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
  /** Near-miss episodes since init. */
  nearMisses: number;
}

/** Compute the summary from the current world state and counters. */
export function computeMetrics(
  world: Readonly<World>,
  counters: Readonly<RunCounters>,
): MetricsSummary {
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
    nearMisses: counters.nearMisses,
  };
}
