/**
 * L2 — Claims. Fielders announce "I'm taking ball N, arriving at time t", resolve conflicts with
 * a shared deterministic rule, and re-plan when they lose (CLAUDE.md section 9).
 *
 * Every tick, from its own `LocalView` only, a fielder:
 * 1. reads its inbox: CLAIM records that claimant's arrival time for a ball, RELEASE removes it,
 *    CAUGHT removes the ball;
 * 2. expires claims not refreshed within `claimTtl` ticks, which cleans up after lost messages and
 *    dead fielders;
 * 3. finds the feasible balls it would hold if it claimed them, using `claimHolder`;
 * 4. picks the one it can reach soonest, keeping its current target unless another is better by
 *    `switchMargin` or someone else has won the current one;
 * 5. broadcasts CLAIM when it adopts a target, when its arrival time moves by more than
 *    `etaEpsilon`, and every `heartbeatInterval` ticks, and RELEASE when it abandons a target.
 *
 * Claim times are absolute sim times, so claims sent in different ticks compare directly. A
 * fielder is never told it caught a ball: a caught ball simply leaves its view, like a dropped
 * one. When its target vanishes it therefore abandons it and broadcasts RELEASE, which is also
 * correct for a drop. CAUGHT is honoured if received but never sent.
 *
 * With an empty claims table every feasible ball is available and the choice is exactly
 * greedy's, so claims with no communication reproduces a greedy run bit for bit.
 */
import { timeToReach } from '../agents/kinematics';
import type { AgentMemory, BallObservation, Decision, LocalView } from '../agents/types';
import type { Message, MessageBody } from '../comms/types';
import { copy, vec3 } from '../vec3';
import type { Strategy } from './types';

/** The latest claim heard from one claimant on one ball. */
export interface ClaimRecord {
  /** Claimed arrival at the landing point (absolute sim time, s). */
  eta: number;
  /** Tick the claim was sent. Expiry is measured from here, so latency ages claims. */
  sentTick: number;
}

/** Persistent state of a claims fielder. */
export interface ClaimsMemory extends AgentMemory {
  strategy: 'claims';
  /** Other fielders' live claims: ball id → claimant id → latest claim. */
  claims: Map<number, Map<number, ClaimRecord>>;
  /** Ball currently claimed and pursued, or null. */
  targetBallId: number | null;
  /** Arrival time (s) last broadcast for the target. */
  lastSentEta: number;
  /** Tick of the last CLAIM broadcast. */
  lastSentTick: number;
}

/** A claim on one ball, for conflict resolution. */
export interface Claimant {
  id: number;
  /** Claimed arrival (absolute sim time, s). */
  eta: number;
}

/**
 * The holder of a ball among `claimants`, or -1 if there are none. The earliest claimed arrival
 * sets the bar; every claim within `margin` (s) of it is tied, and the lowest id among the tied
 * wins. For two claimants this is the pairwise rule "A beats B if A.eta < B.eta - margin,
 * otherwise the lower id wins"; unlike repeated pairwise comparison it cannot form a cycle, so
 * the result never depends on the order claims are considered.
 */
export function claimHolder(claimants: readonly Claimant[], margin: number): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const c of claimants) if (c.eta < earliest) earliest = c.eta;
  let holder = -1;
  for (const c of claimants) {
    if (c.eta <= earliest + margin && (holder === -1 || c.id < holder)) holder = c.id;
  }
  return holder;
}

/** Type guard for claims memory, e.g. for the inspector. */
export function isClaimsMemory(memory: AgentMemory): memory is ClaimsMemory {
  return memory.strategy === 'claims';
}

/** Apply received messages to the claims table. Stale messages never overwrite newer ones. */
export function ingestMessages(
  memory: ClaimsMemory,
  inbox: readonly Message[],
  selfId: number,
): void {
  const claims = memory.claims;
  for (const m of inbox) {
    if (m.from === selfId) continue;
    switch (m.type) {
      case 'CLAIM': {
        let byClaimant = claims.get(m.ballId);
        if (byClaimant === undefined) {
          byClaimant = new Map();
          claims.set(m.ballId, byClaimant);
        }
        const previous = byClaimant.get(m.from);
        if (previous === undefined || previous.sentTick <= m.sentTick) {
          byClaimant.set(m.from, { eta: m.eta, sentTick: m.sentTick });
        }
        break;
      }
      case 'RELEASE': {
        const byClaimant = claims.get(m.ballId);
        const previous = byClaimant?.get(m.from);
        if (byClaimant !== undefined && previous !== undefined && previous.sentTick <= m.sentTick) {
          byClaimant.delete(m.from);
          if (byClaimant.size === 0) claims.delete(m.ballId);
        }
        break;
      }
      case 'CAUGHT':
        claims.delete(m.ballId);
        break;
      case 'HEARTBEAT':
      case 'BID':
        break;
    }
  }
}

/** Remove claims sent more than `ttl` ticks before `tick`. */
export function expireClaims(memory: ClaimsMemory, tick: number, ttl: number): void {
  for (const [ballId, byClaimant] of memory.claims) {
    for (const [claimant, record] of byClaimant) {
      if (tick - record.sentTick > ttl) byClaimant.delete(claimant);
    }
    if (byClaimant.size === 0) memory.claims.delete(ballId);
  }
}

/** Every claimant known for `ballId`, plus `self` arriving at `eta` if given. */
export function claimantsFor(
  memory: ClaimsMemory,
  ballId: number,
  self: Claimant | null,
): Claimant[] {
  const out: Claimant[] = [];
  const byClaimant = memory.claims.get(ballId);
  if (byClaimant !== undefined) {
    for (const [id, record] of byClaimant) out.push({ id, eta: record.eta });
  }
  if (self !== null) out.push(self);
  return out;
}

interface Candidate {
  ball: BallObservation;
  /** Time to reach the landing point (s). */
  eta: number;
  /** Absolute arrival time (s). */
  arrival: number;
}

export const claimsStrategy: Strategy = {
  name: 'claims',

  initMemory(_selfId: number): ClaimsMemory {
    return {
      strategy: 'claims',
      claims: new Map(),
      targetBallId: null,
      lastSentEta: Number.NaN,
      lastSentTick: Number.NEGATIVE_INFINITY,
    };
  },

  decide(view: LocalView): Decision {
    const memory = view.memory as ClaimsMemory;
    const { self, params } = view;
    ingestMessages(memory, view.inbox, self.id);
    expireClaims(memory, view.tick, params.claimTtl);

    const previous = memory.targetBallId;
    let best: Candidate | null = null;
    let current: Candidate | null = null;
    // Balls arrive in id order, so a strict comparison breaks ETA ties towards the lowest id.
    for (const ball of view.balls) {
      const eta = timeToReach(
        self.position,
        self.velocity,
        ball.predictedLanding,
        self.maxSpeed,
        self.maxAccel,
      );
      const slack = ball.predictedArrivalTime - (view.time + eta);
      if (slack < params.feasibilityMargin) continue;
      const arrival = view.time + eta;
      // For the ball already claimed, judge by the arrival time others last heard, so every
      // fielder applies the rule to the same numbers. A fresh estimate here could let two
      // fielders each believe they hold the ball until the next broadcast.
      const claimed = ball.id === previous && Number.isFinite(memory.lastSentEta);
      const me: Claimant = { id: self.id, eta: claimed ? memory.lastSentEta : arrival };
      if (claimHolder(claimantsFor(memory, ball.id, me), params.claimMargin) !== self.id) continue;
      const candidate: Candidate = { ball, eta, arrival };
      if (ball.id === previous) current = candidate;
      if (best === null || eta < best.eta) best = candidate;
    }

    let chosen = best;
    if (current !== null && best !== null && best.ball.id !== current.ball.id) {
      if (best.eta >= current.eta - params.switchMargin) chosen = current;
    }

    const outbox: MessageBody[] = [];
    const chosenId = chosen === null ? null : chosen.ball.id;
    if (previous !== null && previous !== chosenId)
      outbox.push({ type: 'RELEASE', ballId: previous });
    if (chosen !== null) {
      const due =
        chosenId !== previous ||
        !(Math.abs(chosen.arrival - memory.lastSentEta) <= params.etaEpsilon) ||
        view.tick - memory.lastSentTick >= params.heartbeatInterval;
      if (due) {
        outbox.push({ type: 'CLAIM', ballId: chosen.ball.id, eta: chosen.arrival });
        memory.lastSentEta = chosen.arrival;
        memory.lastSentTick = view.tick;
      }
    }
    memory.targetBallId = chosenId;

    if (chosen === null) return { target: null, targetBallId: null, outbox };
    return {
      target: copy(vec3(), chosen.ball.predictedLanding),
      targetBallId: chosen.ball.id,
      outbox,
    };
  },
};
