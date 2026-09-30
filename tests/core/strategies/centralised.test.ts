import { describe, expect, it } from 'vitest';
import { timeToReach } from '../../../src/core/agents/kinematics';
import { DEFAULT_CONFIG, cloneConfig } from '../../../src/core/config';
import { predictLandingAt } from '../../../src/core/physics/ballistics';
import { Simulation } from '../../../src/core/sim';
import { BallState } from '../../../src/core/state';
import { centralisedStrategy } from '../../../src/core/strategies/centralised';
import { load, vec3 } from '../../../src/core/vec3';

describe('centralisedStrategy', () => {
  it('is flagged as the oracle', () => {
    expect(centralisedStrategy.isOracle).toBe(true);
    expect(centralisedStrategy.name).toBe('centralised');
  });

  it('assigns only flying balls, once each, and only when feasible', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.launch.count = 40;
    const sim = new Simulation(config);
    sim.run(10); // balls are in the air
    const snap = sim.snapshot();
    const assignment = centralisedStrategy.assign(snap);
    expect(assignment.length).toBe(snap.fielderCount);

    const seen = new Set<number>();
    const pos = vec3();
    const vel = vec3();
    const landing = vec3();
    let assigned = 0;
    for (let i = 0; i < assignment.length; i++) {
      const b = assignment[i];
      if (b < 0) continue;
      assigned++;
      expect(snap.ballState[b]).toBe(BallState.FLYING);
      expect(seen.has(b)).toBe(false);
      seen.add(b);
      const t = predictLandingAt(landing, snap.ballPos, snap.ballVel, b, config.catch.height);
      load(pos, snap.fielderPos, i);
      load(vel, snap.fielderVel, i);
      const eta = timeToReach(
        pos,
        vel,
        landing,
        config.fielders.maxSpeed,
        config.fielders.maxAccel,
      );
      expect(t - eta).toBeGreaterThanOrEqual(config.strategy.feasibilityMargin - 1e-9);
    }
    expect(assigned).toBeGreaterThan(0);
  });

  it('skips dead fielders', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    const sim = new Simulation(config);
    sim.run(5);
    for (let i = 0; i < 50; i++) sim.killAgent(i);
    const assignment = centralisedStrategy.assign(sim.snapshot());
    for (let i = 0; i < 50; i++) expect(assignment[i]).toBe(-1);
  });

  it('returns no assignments with no balls in flight', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    const assignment = centralisedStrategy.assign(sim.snapshot());
    expect(assignment.every((a) => a === -1)).toBe(true);
  });
});
