/**
 * A plain, serialisable summary of one fielder's view and state for the UI inspector. Built in
 * the core from the fielder's own `LocalView`, decision and memory, so the inspector shows
 * exactly what the fielder knew when it decided.
 */
import { timeToReach } from './agents/kinematics';
import type { AgentMemory, Decision, LocalView } from './agents/types';
import type { Message } from './comms/types';
import type { StrategyParams } from './config';
import { claimHolder, claimantsFor, isClaimsMemory } from './strategies/claims';

/** Most recent inbox messages kept for the inspector. */
export const INSPECTOR_INBOX_LENGTH = 12;

/** A ball the fielder can see. */
export interface InspectedBall {
  id: number;
  /** Time to reach the predicted landing point (s). */
  eta: number;
  /** Predicted ball arrival minus the fielder's arrival (s). Negative means out of reach. */
  slack: number;
  /** Whether slack meets `feasibilityMargin`. */
  feasible: boolean;
  /** Holder by this fielder's knowledge, counting its own claim on its target; -1 if none. */
  holder: number;
}

/** One entry of the fielder's claims table, or its own current claim. */
export interface InspectedClaim {
  ballId: number;
  claimant: number;
  /** Claimed arrival (absolute sim time, s). */
  eta: number;
  /** Ticks since the claim was sent; for the fielder's own claim, since its last broadcast. */
  ageTicks: number;
  /** Whether this claim holds the ball by the tie-group rule. */
  winning: boolean;
}

/** A message the fielder received. */
export interface InspectedMessage {
  /** Tick it arrived. */
  receivedTick: number;
  sentTick: number;
  from: number;
  type: Message['type'];
  ballId: number | null;
  /** Claimed arrival for CLAIM messages (s), else null. */
  eta: number | null;
}

export interface Inspection {
  id: number;
  tick: number;
  alive: boolean;
  strategy: string;
  /** Position (m) and speed (m/s). */
  position: [number, number, number];
  speed: number;
  /** Ball pursued after the last decision, or null. */
  targetBallId: number | null;
  /** Types of the messages sent in the last decision. */
  sent: string[];
  /**
   * Whether the fielder's own view is available. False for oracle and dead fielders, and until
   * the first tick after inspection starts; `balls` and `neighbours` are then empty.
   */
  hasView: boolean;
  neighbours: number;
  balls: InspectedBall[];
  /** Claims table, or null when the strategy keeps none. */
  claims: InspectedClaim[] | null;
  /** Recent inbox, newest first. */
  inbox: InspectedMessage[];
}

/** Summarise received messages for the inspector. */
export function inspectMessages(inbox: readonly Message[], tick: number): InspectedMessage[] {
  return inbox.map((m) => ({
    receivedTick: tick,
    sentTick: m.sentTick,
    from: m.from,
    type: m.type,
    ballId: 'ballId' in m ? m.ballId : null,
    eta: m.type === 'CLAIM' ? m.eta : null,
  }));
}

/**
 * Build an inspection. `view` is null for fielders that were not given one (dead fielders and
 * oracle fielders); `recentInbox` is newest first.
 */
export function buildInspection(
  id: number,
  tick: number,
  alive: boolean,
  strategy: string,
  position: [number, number, number],
  speed: number,
  view: LocalView | null,
  decision: Readonly<Decision>,
  memory: Readonly<AgentMemory>,
  params: Readonly<StrategyParams>,
  recentInbox: InspectedMessage[],
): Inspection {
  const claimsMemory = isClaimsMemory(memory) ? memory : null;
  const target = decision.targetBallId;
  const balls: InspectedBall[] = [];
  if (view !== null) {
    for (const ball of view.balls) {
      const eta = timeToReach(
        view.self.position,
        view.self.velocity,
        ball.predictedLanding,
        view.self.maxSpeed,
        view.self.maxAccel,
      );
      const slack = ball.predictedArrivalTime - (view.time + eta);
      let holder = -1;
      if (claimsMemory !== null) {
        const me = ball.id === target ? { id, eta: view.time + eta } : null;
        holder = claimHolder(claimantsFor(claimsMemory, ball.id, me), params.claimMargin);
      } else if (ball.id === target) {
        holder = id;
      }
      balls.push({ id: ball.id, eta, slack, feasible: slack >= params.feasibilityMargin, holder });
    }
  }

  let claims: InspectedClaim[] | null = null;
  if (claimsMemory !== null) {
    claims = [];
    const ballIds = [...claimsMemory.claims.keys()];
    if (target !== null && !ballIds.includes(target)) ballIds.push(target);
    ballIds.sort((a, b) => a - b);
    for (const ballId of ballIds) {
      const own =
        ballId === target && Number.isFinite(claimsMemory.lastSentEta)
          ? { id, eta: claimsMemory.lastSentEta }
          : null;
      const all = claimantsFor(claimsMemory, ballId, own);
      const holder = claimHolder(all, params.claimMargin);
      for (const c of all.sort((a, b) => a.id - b.id)) {
        const record = claimsMemory.claims.get(ballId)?.get(c.id);
        claims.push({
          ballId,
          claimant: c.id,
          eta: c.eta,
          // The fielder's own claim has no record: age it from its last broadcast.
          ageTicks: tick - (record === undefined ? claimsMemory.lastSentTick : record.sentTick),
          winning: c.id === holder,
        });
      }
    }
  }

  return {
    id,
    tick,
    alive,
    strategy,
    position,
    speed,
    targetBallId: target,
    sent: decision.outbox.map((m) => m.type),
    hasView: view !== null,
    neighbours: view === null ? 0 : view.neighbours.length,
    balls,
    claims,
    inbox: recentInbox,
  };
}
