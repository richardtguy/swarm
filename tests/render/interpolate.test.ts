import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/core/config';
import { Simulation } from '../../src/core/sim';
import { BallState } from '../../src/core/state';
import {
  MAX_BLEND_INTERVAL_MS,
  SnapshotInterpolator,
  interpolationAlpha,
} from '../../src/render/interpolate';

function salvo(): Simulation {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.launch.pattern = 'salvo';
  config.launch.count = 20;
  config.strategy.name = 'greedy';
  return new Simulation(config);
}

describe('interpolationAlpha', () => {
  it('runs from 0 when the newest snapshot arrives to 1 one interval later', () => {
    expect(interpolationAlpha(0, 20, 20)).toBe(0);
    expect(interpolationAlpha(0, 20, 30)).toBeCloseTo(0.5, 12);
    expect(interpolationAlpha(0, 20, 40)).toBe(1);
    expect(interpolationAlpha(0, 20, 100)).toBe(1);
    expect(interpolationAlpha(0, 20, 10)).toBe(0);
  });

  it('caps long intervals so the view catches up quickly after a pause', () => {
    expect(interpolationAlpha(0, 10_000, 10_000 + MAX_BLEND_INTERVAL_MS)).toBe(1);
  });

  it('shows the newest snapshot for a zero or negative interval', () => {
    expect(interpolationAlpha(5, 5, 5)).toBe(1);
  });
});

describe('SnapshotInterpolator', () => {
  it('returns null before any snapshot and the only snapshot after one', () => {
    const interp = new SnapshotInterpolator();
    expect(interp.sample(0)).toBeNull();
    const sim = salvo();
    const snap = sim.snapshot();
    interp.push(snap, 0);
    expect(interp.sample(1000)).toBe(snap);
  });

  it('blends fielder and ball positions between the last two snapshots', () => {
    const sim = salvo();
    sim.run(20);
    const a = sim.snapshot();
    sim.run(3);
    const b = sim.snapshot();
    const interp = new SnapshotInterpolator();
    interp.push(a, 100);
    interp.push(b, 120);

    const mid = interp.sample(130);
    expect(mid).not.toBeNull();
    if (mid === null) return;
    expect(mid.tick).toBe(b.tick);
    expect(mid.time).toBeCloseTo((a.time + b.time) / 2, 6);
    let moved = 0;
    for (let k = 0; k < a.fielderPos.length; k++) {
      expect(mid.fielderPos[k]).toBeCloseTo((a.fielderPos[k] + b.fielderPos[k]) / 2, 4);
      if (a.fielderPos[k] !== b.fielderPos[k]) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    for (let ball = 0; ball < b.ballCount; ball++) {
      if (b.ballState[ball] !== BallState.FLYING) continue;
      for (let c = 0; c < 3; c++) {
        const k = 3 * ball + c;
        expect(mid.ballPos[k]).toBeCloseTo((a.ballPos[k] + b.ballPos[k]) / 2, 4);
      }
    }
    // Inputs are untouched.
    expect(interp.sample(140)).toBe(b);
  });

  it('does not blend a ball that was not flying in the previous snapshot', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'staggered';
    config.launch.ratePerSecond = 50; // one ball per tick
    config.strategy.name = 'idle';
    const sim = new Simulation(config);
    sim.run(1);
    const a = sim.snapshot();
    sim.run(1);
    const b = sim.snapshot();
    expect(b.ballCount).toBeGreaterThan(a.ballCount);
    const interp = new SnapshotInterpolator();
    interp.push(a, 0);
    interp.push(b, 20);
    const mid = interp.sample(30);
    if (mid === null) throw new Error('no sample');
    const fresh = b.ballCount - 1;
    for (let c = 0; c < 3; c++) {
      expect(mid.ballPos[3 * fresh + c]).toBe(b.ballPos[3 * fresh + c]);
    }
  });

  it('restarts on a reset and replaces a same-tick snapshot without restarting', () => {
    const sim = salvo();
    sim.run(30);
    const late = sim.snapshot();
    const interp = new SnapshotInterpolator();
    interp.push(late, 0);
    sim.reset();
    const fresh = sim.snapshot();
    interp.push(fresh, 20);
    expect(interp.sample(25)).toBe(fresh); // tick went backwards: no blending

    sim.run(2);
    const a = sim.snapshot();
    sim.run(2);
    const b = sim.snapshot();
    interp.clear();
    interp.push(a, 100);
    interp.push(b, 120);
    sim.killAgent(0);
    const killed = sim.snapshot(); // same tick as b
    interp.push(killed, 125);
    const mid = interp.sample(130);
    if (mid === null) throw new Error('no sample');
    expect(mid.fielderAlive[0]).toBe(0);
    // Fielder 0 is dead in the newest snapshot, so it is drawn where it died, not blended.
    expect(mid.fielderPos[0]).toBe(killed.fielderPos[0]);
    // Others still blend between a and the replacement.
    expect(mid.fielderPos[3]).toBeCloseTo((a.fielderPos[3] + killed.fielderPos[3]) / 2, 4);
  });
});
