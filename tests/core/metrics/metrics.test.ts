import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../../src/core/config';
import {
  RECENT_WINDOW,
  computeMetrics,
  emptyRunCounters,
  recordOutcome,
} from '../../../src/core/metrics/metrics';
import { Simulation } from '../../../src/core/sim';
import { BallState, createWorld } from '../../../src/core/state';

describe('rolling catch rate', () => {
  it('covers only the most recent settled balls', () => {
    const counters = emptyRunCounters();
    for (let k = 0; k < RECENT_WINDOW; k++) recordOutcome(counters, false);
    for (let k = 0; k < RECENT_WINDOW / 2; k++) recordOutcome(counters, true);
    expect(counters.recentOutcomes).toHaveLength(RECENT_WINDOW);
    const world = createWorld(DEFAULT_CONFIG);
    const m = computeMetrics(world, counters, new Int32Array(world.fielderCount).fill(-1));
    expect(m.recentSettled).toBe(RECENT_WINDOW);
    expect(m.recentCatchRate).toBeCloseTo(0.5, 12);
  });

  it('matches the cumulative rate while fewer balls than the window have settled', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.launch.count = 10;
    config.duration = 15;
    const sim = new Simulation(config);
    while (!sim.isFinished()) sim.step();
    const m = sim.metrics();
    expect(m.recentSettled).toBe(10);
    expect(m.recentCatchRate).toBeCloseTo(m.catchRate, 12);
  });
});

describe('contested balls', () => {
  it('counts flying balls chased by two or more alive fielders', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.fielders.count = 5;
    config.launch.count = 3;
    const world = createWorld(config);
    world.ballCount = 3;
    world.ballState.set([BallState.FLYING, BallState.FLYING, BallState.CAUGHT]);
    world.fielderAlive[4] = 0;
    // Ball 0: fielders 0 and 1. Ball 1: fielder 2 and dead fielder 4. Ball 2 is settled.
    const targets = Int32Array.from([0, 0, 1, 2, 1]);
    const m = computeMetrics(world, emptyRunCounters(), targets);
    expect(m.contestedBalls).toBe(1);
  });
});

describe('message metrics', () => {
  it('reports bus counters and a per-fielder message rate', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.strategy.name = 'claims';
    config.launch.pattern = 'salvo';
    config.comms.bandwidth = 1;
    const sim = new Simulation(config);
    sim.run(100);
    const m = sim.metrics();
    expect(m.messagesSent).toBeGreaterThan(0);
    expect(m.messagesDelivered).toBeGreaterThan(0);
    expect(m.droppedBandwidth).toBeGreaterThan(0); // RELEASE plus CLAIM exceeds one per tick
    expect(m.messageRate).toBeCloseTo(m.messagesSent / m.fieldersTotal / m.time, 12);
  });

  it('is all zero for strategies that never talk', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    sim.run(200);
    const m = sim.metrics();
    expect([m.messagesSent, m.messagesDelivered, m.messageRate]).toEqual([0, 0, 0]);
  });
});
