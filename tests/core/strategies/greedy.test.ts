import { describe, expect, it } from 'vitest';
import { timeToReach } from '../../../src/core/agents/kinematics';
import type { BallObservation, LocalView } from '../../../src/core/agents/types';
import { DEFAULT_CONFIG } from '../../../src/core/config';
import { greedyStrategy, type GreedyMemory } from '../../../src/core/strategies/greedy';
import { vec3 } from '../../../src/core/vec3';

const MAX_SPEED = 7;
const MAX_ACCEL = 4;

/** A ball observation landing at (x, y) at absolute time `arrival`. */
function ball(id: number, x: number, y: number, arrival: number): BallObservation {
  return {
    id,
    position: vec3(x, y, 20),
    velocity: vec3(0, 0, -10),
    predictedLanding: vec3(x, y, 1.5),
    predictedArrivalTime: arrival,
    uncertainty: 0,
  };
}

function view(balls: BallObservation[], memory: GreedyMemory, time = 10): LocalView {
  return {
    tick: Math.round(time / 0.02),
    time,
    self: {
      id: 0,
      position: vec3(0, 0, 0),
      velocity: vec3(),
      maxSpeed: MAX_SPEED,
      maxAccel: MAX_ACCEL,
      stunnedUntil: null,
    },
    bumps: [],
    balls,
    neighbours: [],
    inbox: [],
    memory,
    params: DEFAULT_CONFIG.strategy,
  };
}

function eta(x: number, y: number): number {
  return timeToReach(vec3(), vec3(), vec3(x, y, 0), MAX_SPEED, MAX_ACCEL);
}

describe('greedyStrategy', () => {
  it('is autonomous and sends no messages', () => {
    expect(greedyStrategy.isOracle).toBeUndefined();
    const memory = greedyStrategy.initMemory(3) as GreedyMemory;
    expect(memory).toEqual({ strategy: 'greedy', targetBallId: null });
    const d = greedyStrategy.decide(view([ball(0, 5, 0, 100)], memory));
    expect(d.outbox).toEqual([]);
  });

  it('picks the feasible ball with the lowest time to reach', () => {
    const memory = greedyStrategy.initMemory(0) as GreedyMemory;
    const balls = [ball(0, 20, 0, 100), ball(1, 4, 3, 100), ball(2, 10, 0, 100)];
    const d = greedyStrategy.decide(view(balls, memory));
    expect(d.targetBallId).toBe(1);
    expect([...(d.target ?? [])]).toEqual([4, 3, 1.5]);
    expect(memory.targetBallId).toBe(1);
  });

  it('ignores balls it cannot reach in time', () => {
    const memory = greedyStrategy.initMemory(0) as GreedyMemory;
    const near = ball(0, 4, 0, 10 + eta(4, 0) - 0.5); // arrives before we can get there
    const far = ball(1, 30, 0, 100);
    const d = greedyStrategy.decide(view([near, far], memory));
    expect(d.targetBallId).toBe(1);
    const none = greedyStrategy.decide(view([near], memory));
    expect(none.targetBallId).toBeNull();
    expect(none.target).toBeNull();
    expect(memory.targetBallId).toBeNull();
  });

  it('keeps its target unless a new ball beats it by more than switchMargin', () => {
    const memory = greedyStrategy.initMemory(0) as GreedyMemory;
    memory.targetBallId = 5;
    const current = ball(5, 10, 0, 100);
    // Slightly better, but not by the margin (0.3 s): stay.
    const marginal = ball(6, 9.5, 0, 100);
    expect(eta(10, 0) - eta(9.5, 0)).toBeLessThan(DEFAULT_CONFIG.strategy.switchMargin);
    expect(greedyStrategy.decide(view([current, marginal], memory)).targetBallId).toBe(5);
    // Much better: switch.
    const better = ball(7, 3, 0, 100);
    expect(greedyStrategy.decide(view([current, marginal, better], memory)).targetBallId).toBe(7);
    expect(memory.targetBallId).toBe(7);
  });

  it('forgets a target that is no longer observed', () => {
    const memory = greedyStrategy.initMemory(0) as GreedyMemory;
    memory.targetBallId = 5;
    const d = greedyStrategy.decide(view([ball(9, 12, 0, 100)], memory));
    expect(d.targetBallId).toBe(9);
  });

  it('breaks exact ties towards the lowest ball id', () => {
    const memory = greedyStrategy.initMemory(0) as GreedyMemory;
    const balls = [ball(3, 0, 6, 100), ball(4, 6, 0, 100), ball(8, -6, 0, 100)];
    expect(greedyStrategy.decide(view(balls, memory)).targetBallId).toBe(3);
  });

  it('is a pure function of the view apart from its own memory', () => {
    const balls = [ball(0, 20, 0, 100), ball(1, 4, 3, 100)];
    const a = greedyStrategy.decide(view(balls, greedyStrategy.initMemory(0) as GreedyMemory));
    const b = greedyStrategy.decide(view(balls, greedyStrategy.initMemory(0) as GreedyMemory));
    expect(a).toEqual(b);
  });
});
