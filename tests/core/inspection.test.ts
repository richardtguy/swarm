import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/core/config';
import { INSPECTOR_INBOX_LENGTH } from '../../src/core/inspection';
import { Simulation } from '../../src/core/sim';

function claimsSalvo(): Simulation {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.strategy.name = 'claims';
  config.launch.pattern = 'salvo';
  config.launch.count = 40;
  return new Simulation(config);
}

describe('Simulation inspection', () => {
  it('is null until a fielder is chosen, and rejects unknown ids', () => {
    const sim = claimsSalvo();
    expect(sim.inspection()).toBeNull();
    expect(() => sim.setInspected(10_000)).toThrow(RangeError);
  });

  it('has no view until the next tick, then shows what the fielder knew', () => {
    const sim = claimsSalvo();
    sim.run(20);
    // A southern fielder, near the launch zone, sees the salvo.
    sim.setInspected(4);
    expect(sim.inspection()?.hasView).toBe(false);
    sim.run(30);
    const inspection = sim.inspection();
    if (inspection === null) throw new Error('no inspection');
    expect(inspection.hasView).toBe(true);
    expect(inspection.id).toBe(4);
    expect(inspection.tick).toBe(50);
    expect(inspection.balls.length).toBeGreaterThan(0);
    expect(inspection.claims).not.toBeNull();
    expect(inspection.inbox.length).toBeGreaterThan(0);
    expect(inspection.inbox.length).toBeLessThanOrEqual(INSPECTOR_INBOX_LENGTH);
    // Newest first.
    for (let k = 1; k < inspection.inbox.length; k++) {
      expect(inspection.inbox[k - 1].receivedTick).toBeGreaterThanOrEqual(
        inspection.inbox[k].receivedTick,
      );
    }
    // Its own target, if any, is one it holds by its own knowledge.
    if (inspection.targetBallId !== null) {
      const target = inspection.balls.find((b) => b.id === inspection.targetBallId);
      expect(target?.holder).toBe(4);
      expect(inspection.claims?.some((c) => c.claimant === 4 && c.winning)).toBe(true);
    }
  });

  it('never changes the run', () => {
    const plain = claimsSalvo();
    const watched = claimsSalvo();
    watched.setInspected(4);
    plain.run(300);
    watched.run(300);
    expect(watched.hash()).toBe(plain.hash());
    expect(watched.metrics()).toEqual(plain.metrics());
  });

  it('reports dead and oracle fielders without a view', () => {
    const sim = claimsSalvo();
    sim.setInspected(2);
    sim.killAgent(2);
    sim.run(5);
    expect(sim.inspection()).toMatchObject({ alive: false, hasView: false, balls: [] });

    const oracle = new Simulation(DEFAULT_CONFIG);
    oracle.setInspected(0);
    oracle.run(5);
    expect(oracle.inspection()).toMatchObject({ strategy: 'centralised', hasView: false });
  });
});
