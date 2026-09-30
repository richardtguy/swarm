/**
 * L1 — Greedy. Each fielder chases the feasible ball it can reach soonest and tells nobody.
 *
 * Hysteresis: it switches target only when the new ball's ETA beats the current target's by
 * more than `switchMargin` seconds. This strategy exists to show clumping and conflict; do not
 * "fix" it (CLAUDE.md section 9).
 */
import { timeToReach } from '../agents/kinematics';
import type { AgentMemory, BallObservation, Decision, LocalView } from '../agents/types';
import { copy, vec3 } from '../vec3';
import type { Strategy } from './types';

/** Persistent state of a greedy fielder. */
export interface GreedyMemory extends AgentMemory {
  strategy: 'greedy';
  /** Ball currently pursued, or null. */
  targetBallId: number | null;
}

const NO_TARGET: Readonly<Decision> = Object.freeze({
  target: null,
  targetBallId: null,
  outbox: [],
});

export const greedyStrategy: Strategy = {
  name: 'greedy',

  initMemory(_selfId: number): GreedyMemory {
    return { strategy: 'greedy', targetBallId: null };
  },

  decide(view: LocalView): Decision {
    const memory = view.memory as GreedyMemory;
    const { self, params } = view;

    let best: BallObservation | null = null;
    let bestEta = Number.POSITIVE_INFINITY;
    let current: BallObservation | null = null;
    let currentEta = Number.POSITIVE_INFINITY;

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
      if (ball.id === memory.targetBallId) {
        current = ball;
        currentEta = eta;
      }
      if (eta < bestEta) {
        best = ball;
        bestEta = eta;
      }
    }

    let chosen = best;
    if (current !== null && best !== null && best.id !== current.id) {
      if (bestEta >= currentEta - params.switchMargin) chosen = current;
    }

    memory.targetBallId = chosen === null ? null : chosen.id;
    if (chosen === null) return NO_TARGET;
    return {
      target: copy(vec3(), chosen.predictedLanding),
      targetBallId: chosen.id,
      outbox: [],
    };
  },
};
