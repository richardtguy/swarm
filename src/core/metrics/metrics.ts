/**
 * Summary metrics computed from world state plus the counters the simulation keeps for things
 * the state alone cannot recover (near-misses, messages, recent outcomes).
 */
import { emptyCommsCounters, type CommsCounters } from '../comms/messageBus';
import { BallState, countAlive, type World } from '../state';

/** How many of the most recently settled balls the rolling catch rate covers. */
export const RECENT_WINDOW = 20;

/** Counters maintained by the simulation across ticks. */
export interface RunCounters {
  /** Near-miss episodes (pairs entering `minSeparation`) since init. */
  nearMisses: number;
  /** Message bus counts since init. */
  comms: CommsCounters;
  /** Outcomes of the last `RECENT_WINDOW` settled balls, oldest first: 1 caught, 0 dropped. */
  recentOutcomes: number[];
}

export function emptyRunCounters(): RunCounters {
  return { nearMisses: 0, comms: emptyCommsCounters(), recentOutcomes: [] };
}

/** Record a settled ball in the rolling window. */
export function recordOutcome(counters: RunCounters, caught: boolean): void {
  counters.recentOutcomes.push(caught ? 1 : 0);
  if (counters.recentOutcomes.length > RECENT_WINDOW) counters.recentOutcomes.shift();
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
  /**
   * Catch rate over the last `RECENT_WINDOW` settled balls. It reacts within a few seconds when a
   * parameter changes, where the cumulative rate barely moves. 0 before any ball settles.
   */
  recentCatchRate: number;
  /** Balls counted by `recentCatchRate`. */
  recentSettled: number;
  /** Balls currently pursued by more than one alive fielder. */
  contestedBalls: number;
  /** Sum of distance travelled by all fielders (m). */
  distanceTravelled: number;
  /** Near-miss episodes since init. */
  nearMisses: number;
  /** Broadcasts that passed the bandwidth cap. */
  messagesSent: number;
  /** Arrivals in an inbox (one per recipient). */
  messagesDelivered: number;
  /** Broadcasts cut by the bandwidth cap. */
  droppedBandwidth: number;
  /** Recipients that lost a message to packet loss. */
  droppedLoss: number;
  /** Recipients that died while a message to them was in flight. */
  droppedRecipientDead: number;
  /** Broadcasts per fielder per simulated second. */
  messageRate: number;
}

/**
 * Compute the summary from the current world state and counters. `targetBall` holds each
 * fielder's pursued ball from the last tick, or -1.
 */
export function computeMetrics(
  world: Readonly<World>,
  counters: Readonly<RunCounters>,
  targetBall: Int32Array,
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

  const pursuers = new Int32Array(world.ballCapacity);
  let contested = 0;
  for (let i = 0; i < world.fielderCount; i++) {
    const b = targetBall[i];
    if (b < 0 || world.fielderAlive[i] === 0 || world.ballState[b] !== BallState.FLYING) continue;
    if (++pursuers[b] === 2) contested++;
  }

  const recent = counters.recentOutcomes;
  let recentCaught = 0;
  for (const o of recent) recentCaught += o;
  const settled = caught + dropped;
  const c = counters.comms;
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
    recentCatchRate: recent.length > 0 ? recentCaught / recent.length : 0,
    recentSettled: recent.length,
    contestedBalls: contested,
    distanceTravelled: distance,
    nearMisses: counters.nearMisses,
    messagesSent: c.sent,
    messagesDelivered: c.delivered,
    droppedBandwidth: c.droppedBandwidth,
    droppedLoss: c.droppedLoss,
    droppedRecipientDead: c.droppedRecipientDead,
    messageRate:
      world.fielderCount > 0 && world.time > 0 ? c.sent / world.fielderCount / world.time : 0,
  };
}
