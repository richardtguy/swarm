import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/core/config';
import { Simulation } from '../../src/core/sim';

function runHash(config = DEFAULT_CONFIG, ticks = 500): string {
  const sim = new Simulation(config);
  sim.run(ticks);
  return sim.hash();
}

describe('Simulation determinism', () => {
  it('produces an identical final-state hash across two runs', () => {
    expect(runHash()).toBe(runHash());
  });

  it('reproduces the same hash after reset', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(300);
    const first = sim.hash();
    sim.apply({ type: 'reset' });
    expect(sim.world.tick).toBe(0);
    sim.run(300);
    expect(sim.hash()).toBe(first);
  });

  it('gives the same result whether stepped one at a time or in a batch', () => {
    const a = new Simulation(DEFAULT_CONFIG);
    for (let i = 0; i < 250; i++) a.apply({ type: 'step' });
    const b = new Simulation(DEFAULT_CONFIG);
    b.apply({ type: 'step', ticks: 250 });
    expect(a.hash()).toBe(b.hash());
  });

  it('is unaffected by the paused flag when stepped explicitly', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.apply({ type: 'pause' });
    expect(sim.advance()).toBe(false);
    expect(sim.world.tick).toBe(0);
    sim.apply({ type: 'step', ticks: 10 });
    expect(sim.world.tick).toBe(10);
    sim.apply({ type: 'resume' });
    expect(sim.advance()).toBe(true);
    expect(sim.world.tick).toBe(11);
  });
});

describe('Simulation stepping', () => {
  it('advances tick and time at the fixed timestep', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(50);
    expect(sim.world.tick).toBe(50);
    expect(sim.world.time).toBeCloseTo(1.0, 12);
    expect(sim.isFinished()).toBe(false);
  });

  it('finishes when sim time reaches the duration', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.duration = 1;
    const sim = new Simulation(cfg);
    let steps = 0;
    while (!sim.isFinished()) {
      sim.step();
      steps++;
    }
    expect(steps).toBe(50);
  });

  it('leaves stationary fielders where they started', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    const before = Float64Array.from(sim.world.fielderPos);
    sim.run(100);
    expect([...sim.world.fielderPos]).toEqual([...before]);
    expect(sim.metrics().distanceTravelled).toBe(0);
  });

  it('integrates fielder velocity and accumulates distance', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.world.fielderVel[0] = 2; // fielder 0 moves east at 2 m/s
    const x0 = sim.world.fielderPos[0];
    sim.run(50);
    expect(sim.world.fielderPos[0]).toBeCloseTo(x0 + 2, 9);
    expect(sim.world.fielderDistance[0]).toBeCloseTo(2, 9);
    expect(sim.metrics().distanceTravelled).toBeCloseTo(2, 9);
  });

  it('gives every fielder an idle decision and memory under the idle strategy', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.step();
    expect(sim.strategyInfo).toEqual({ name: 'idle', isOracle: false });
    expect(sim.decisionOf(3)).toEqual({ target: null, targetBallId: null, outbox: [] });
    expect(sim.memoryOf(3)).toEqual({ strategy: 'idle' });
  });
});

describe('Simulation commands', () => {
  it('killAgent marks a fielder dead, stops it, logs an event and changes the hash', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    const before = sim.hash();
    sim.world.fielderVel[3 * 5] = 1;
    sim.apply({ type: 'killAgent', id: 5 });
    expect(sim.world.fielderAlive[5]).toBe(0);
    expect(sim.world.fielderVel[3 * 5]).toBe(0);
    expect(sim.metrics().fieldersAlive).toBe(DEFAULT_CONFIG.fielders.count - 1);
    expect(sim.events.drain()).toEqual([{ type: 'KILL', tick: 0, fielderId: 5 }]);
    expect(sim.events.drain()).toEqual([]);
    expect(sim.hash()).not.toBe(before);
    // Idempotent: a second kill logs nothing.
    sim.apply({ type: 'killAgent', id: 5 });
    expect(sim.events.count).toBe(1);
  });

  it('killAgent rejects unknown ids', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    expect(() => sim.apply({ type: 'killAgent', id: 1000 })).toThrow(RangeError);
    expect(() => sim.apply({ type: 'killAgent', id: -1 })).toThrow(RangeError);
  });

  it('setParam changes live config and structural changes apply on reset', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.apply({ type: 'setParam', path: 'comms.range', value: 5 });
    expect(sim.config.comms.range).toBe(5);
    sim.apply({ type: 'setParam', path: 'fielders.count', value: 10 });
    expect(sim.world.fielderCount).toBe(DEFAULT_CONFIG.fielders.count);
    sim.apply({ type: 'reset' });
    expect(sim.world.fielderCount).toBe(10);
    expect(sim.config.comms.range).toBe(5);
  });

  it('init replaces the run and does not alias the caller config', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.fielders.count = 3;
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(10);
    sim.apply({ type: 'init', config: cfg });
    expect(sim.world.tick).toBe(0);
    expect(sim.world.fielderCount).toBe(3);
    cfg.comms.range = 1;
    expect(sim.config.comms.range).toBe(DEFAULT_CONFIG.comms.range);
  });

  it('rejects an unknown strategy name at init', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.strategy.name = 'telepathy';
    expect(() => new Simulation(cfg)).toThrow(/Unknown strategy "telepathy"/);
  });

  it('snapshots copy the world into Float32 buffers', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(3);
    const snap = sim.snapshot();
    expect(snap.tick).toBe(3);
    expect(snap.fielderPos).toBeInstanceOf(Float32Array);
    expect(snap.fielderPos.length).toBe(sim.world.fielderPos.length);
    expect(snap.fielderPos[0]).toBeCloseTo(sim.world.fielderPos[0], 4);
    snap.fielderPos[0] = 1234;
    expect(sim.world.fielderPos[0]).not.toBe(1234);
  });
});
