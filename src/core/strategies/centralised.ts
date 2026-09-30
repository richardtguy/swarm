/**
 * L0 — the centralised oracle benchmark.
 *
 * It has perfect global knowledge, sends no messages and solves the assignment problem exactly
 * (`hungarian.ts`) with `timeToReach` as the cost. It is not a swarm strategy: it is the
 * yardstick every other strategy is measured against, and it is the only strategy module that
 * may see the world (CLAUDE.md rule 2).
 */
import { timeToReach } from '../agents/kinematics';
import { predictLandingAt } from '../physics/ballistics';
import type { WorldSnapshot } from '../snapshot';
import { BallState } from '../state';
import { load, vec3 } from '../vec3';
import { INFEASIBLE, solveAssignment } from './hungarian';
import type { OracleStrategy } from './types';

export const centralisedStrategy: OracleStrategy = {
  name: 'centralised',
  isOracle: true,

  assign(world: Readonly<WorldSnapshot>): Int32Array {
    const { config } = world;
    const assignment = new Int32Array(world.fielderCount).fill(-1);

    const fielders: number[] = [];
    for (let i = 0; i < world.fielderCount; i++) if (world.fielderAlive[i]) fielders.push(i);
    const balls: number[] = [];
    for (let b = 0; b < world.ballCount; b++) {
      if (world.ballState[b] === BallState.FLYING) balls.push(b);
    }
    if (fielders.length === 0 || balls.length === 0) return assignment;

    // Landing point and arrival time per flying ball.
    const landing = new Float64Array(3 * balls.length);
    const arrival = new Float64Array(balls.length);
    const point = vec3();
    for (let k = 0; k < balls.length; k++) {
      const t = predictLandingAt(
        point,
        world.ballPos,
        world.ballVel,
        balls[k],
        config.catch.height,
      );
      arrival[k] = Number.isNaN(t) ? Number.NaN : world.time + t;
      landing[3 * k] = point[0];
      landing[3 * k + 1] = point[1];
      landing[3 * k + 2] = point[2];
    }

    const rows = fielders.length;
    const cols = balls.length;
    const cost = new Float64Array(rows * cols);
    const pos = vec3();
    const vel = vec3();
    const target = vec3();
    const { maxSpeed, maxAccel } = config.fielders;
    const margin = config.strategy.feasibilityMargin;
    for (let r = 0; r < rows; r++) {
      load(pos, world.fielderPos, fielders[r]);
      load(vel, world.fielderVel, fielders[r]);
      for (let c = 0; c < cols; c++) {
        if (Number.isNaN(arrival[c])) {
          cost[r * cols + c] = INFEASIBLE;
          continue;
        }
        load(target, landing, c);
        const eta = timeToReach(pos, vel, target, maxSpeed, maxAccel);
        const slack = arrival[c] - (world.time + eta);
        cost[r * cols + c] = slack >= margin ? eta : INFEASIBLE;
      }
    }

    const solved = solveAssignment(cost, rows, cols);
    for (let r = 0; r < rows; r++) {
      if (solved[r] >= 0) assignment[fielders[r]] = balls[solved[r]];
    }
    return assignment;
  },
};
