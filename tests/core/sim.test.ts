import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../../src/core/config';
import { Simulation } from '../../src/core/sim';
import { BallState } from '../../src/core/state';

function runHash(config: Readonly<SimConfig> = DEFAULT_CONFIG, ticks = 500): string {
  const sim = new Simulation(config);
  sim.run(ticks);
  return sim.hash();
}

/** A config with no balls and the idle strategy: nothing moves unless a test makes it. */
function quietConfig(): SimConfig {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.launch.count = 0;
  config.strategy.name = 'idle';
  return config;
}

describe('Simulation determinism', () => {
  it('produces an identical final-state hash across two runs', () => {
    expect(runHash()).toBe(runHash());
  });

  it('produces different results for different seeds', () => {
    const other = cloneConfig(DEFAULT_CONFIG);
    other.seed = 43;
    expect(runHash(DEFAULT_CONFIG)).not.toBe(runHash(other));
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

  it('leaves idle fielders at home', () => {
    const sim = new Simulation(quietConfig());
    const before = Float64Array.from(sim.world.fielderPos);
    sim.run(100);
    expect([...sim.world.fielderPos]).toEqual([...before]);
    expect(sim.metrics().distanceTravelled).toBe(0);
  });

  it('returns a displaced idle fielder to its home position', () => {
    const sim = new Simulation(quietConfig());
    const homeX = sim.world.fielderHome[0];
    sim.world.fielderPos[0] = homeX + 10;
    sim.run(400);
    expect(sim.world.fielderPos[0]).toBeCloseTo(homeX, 1);
    expect(sim.world.fielderDistance[0]).toBeGreaterThan(9);
    expect(sim.world.fielderPos[2]).toBe(0);
  });

  it('gives every fielder an idle decision and memory under the idle strategy', () => {
    const sim = new Simulation(quietConfig());
    sim.step();
    expect(sim.strategyInfo).toEqual({ name: 'idle', isOracle: false });
    expect(sim.decisionOf(3)).toEqual({ target: null, targetBallId: null, outbox: [] });
    expect(sim.memoryOf(3)).toEqual({ strategy: 'idle' });
  });
});

describe('Balls', () => {
  it('launch on schedule, fly, and are caught or dropped', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.launch.count = 10;
    config.duration = 15;
    const sim = new Simulation(config);
    sim.step();
    expect(sim.world.ballCount).toBe(10);
    expect(sim.events.drain().filter((e) => e.type === 'LAUNCH')).toHaveLength(10);
    expect([...sim.world.ballState].every((s) => s === BallState.FLYING)).toBe(true);

    while (!sim.isFinished()) sim.step();
    const m = sim.metrics();
    expect(m.ballsInFlight).toBe(0);
    expect(m.ballsCaught + m.ballsDropped).toBe(10);
    const events = sim.events.all();
    expect(events.filter((e) => e.type === 'CATCH')).toHaveLength(m.ballsCaught);
    expect(events.filter((e) => e.type === 'DROP')).toHaveLength(m.ballsDropped);
  });

  it('are all dropped when there are no fielders', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.fielders.count = 0;
    config.launch.pattern = 'salvo';
    config.launch.count = 5;
    config.duration = 15;
    const sim = new Simulation(config);
    while (!sim.isFinished()) sim.step();
    expect(sim.metrics().ballsDropped).toBe(5);
    expect(sim.metrics().catchRate).toBe(0);
  });

  it('are caught by the nearest fielder, ties going to the lowest id', () => {
    const config = quietConfig();
    config.fielders.count = 3;
    config.launch.count = 1;
    config.launch.pattern = 'salvo';
    config.launch.zones = [{ x: 0, y: 0, radius: 0 }];
    config.launch.elevation_deg = { min: 90, max: 90 };
    config.launch.speed = { min: 15, max: 15 };
    config.duration = 10;
    const sim = new Simulation(config);
    // Fielder 2 nearest; fielders 0 and 1 share a position further out (an exact tie).
    const layout = [0.5, 0, 0, 0.5, 0, 0, 0.2, 0, 0];
    sim.world.fielderPos.set(layout);
    sim.world.fielderHome.set(sim.world.fielderPos);
    while (!sim.isFinished()) sim.step();
    const catches = sim.events.all().filter((e) => e.type === 'CATCH');
    expect(catches).toHaveLength(1);
    expect(catches[0]).toMatchObject({ ballId: 0, fielderId: 2 });

    // Remove fielder 2: the tie between 0 and 1 goes to the lowest id.
    const sim2 = new Simulation(config);
    sim2.world.fielderPos.set(layout);
    sim2.world.fielderHome.set(sim2.world.fielderPos);
    sim2.killAgent(2);
    while (!sim2.isFinished()) sim2.step();
    const catches2 = sim2.events.all().filter((e) => e.type === 'CATCH');
    expect(catches2).toHaveLength(1);
    expect(catches2[0]).toMatchObject({ ballId: 0, fielderId: 0 });
  });
});

describe('Oracle strategy in the loop', () => {
  it('catches most of a dense salvo and far more than idle fielders', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.launch.count = 30;
    config.duration = 15;
    const oracle = new Simulation(config);
    while (!oracle.isFinished()) oracle.step();
    const idleConfig = cloneConfig(config);
    idleConfig.strategy.name = 'idle';
    const idle = new Simulation(idleConfig);
    while (!idle.isFinished()) idle.step();

    expect(oracle.metrics().ballsCaught).toBeGreaterThanOrEqual(20);
    expect(oracle.metrics().ballsCaught).toBeGreaterThan(idle.metrics().ballsCaught * 2);
    expect(oracle.strategyInfo.isOracle).toBe(true);
  });

  it('reports the pursued ball in the snapshot', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    const sim = new Simulation(config);
    sim.run(5);
    const snap = sim.snapshot();
    let pursuing = 0;
    for (let i = 0; i < snap.fielderCount; i++) {
      const b = snap.fielderTargetBall[i];
      if (b >= 0) {
        pursuing++;
        expect(snap.ballState[b]).toBe(BallState.FLYING);
        expect(sim.decisionOf(i).targetBallId).toBe(b);
      }
    }
    expect(pursuing).toBeGreaterThan(0);
  });
});

describe('Simulation commands', () => {
  it('killAgent marks a fielder dead, stops it, logs an event and changes the hash', () => {
    const sim = new Simulation(quietConfig());
    const before = sim.hash();
    sim.world.fielderVel[3 * 5] = 1;
    sim.apply({ type: 'killAgent', id: 5 });
    expect(sim.world.fielderAlive[5]).toBe(0);
    expect(sim.world.fielderVel[3 * 5]).toBe(0);
    expect(sim.metrics().fieldersAlive).toBe(DEFAULT_CONFIG.fielders.count - 1);
    expect(sim.events.drain()).toEqual([{ type: 'KILL', tick: 0, fielderId: 5 }]);
    expect(sim.events.drain()).toEqual([]);
    expect(sim.hash()).not.toBe(before);
    sim.apply({ type: 'killAgent', id: 5 });
    expect(sim.events.count).toBe(1);
  });

  it('killAgent rejects unknown ids', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    expect(() => sim.apply({ type: 'killAgent', id: 1000 })).toThrow(RangeError);
    expect(() => sim.apply({ type: 'killAgent', id: -1 })).toThrow(RangeError);
  });

  it('dead fielders never move or catch', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.duration = 10;
    const sim = new Simulation(config);
    for (let i = 0; i < 40; i++) sim.killAgent(i);
    const frozen = Float64Array.from(sim.world.fielderPos.subarray(0, 120));
    while (!sim.isFinished()) sim.step();
    expect([...sim.world.fielderPos.subarray(0, 120)]).toEqual([...frozen]);
    for (const e of sim.events.all()) {
      if (e.type === 'CATCH') expect(e.fielderId).toBeGreaterThanOrEqual(40);
    }
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

  it('snapshots copy the world into Float32 buffers and carry the config', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(3);
    const snap = sim.snapshot();
    expect(snap.tick).toBe(3);
    expect(snap.config.fielders.count).toBe(DEFAULT_CONFIG.fielders.count);
    expect(snap.fielderPos).toBeInstanceOf(Float32Array);
    expect(snap.fielderPos.length).toBe(sim.world.fielderPos.length);
    expect(snap.fielderPos[0]).toBeCloseTo(sim.world.fielderPos[0], 4);
    snap.fielderPos[0] = 1234;
    expect(sim.world.fielderPos[0]).not.toBe(1234);
  });
});
