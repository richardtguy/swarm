import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/core/config';
import { BallState, NOT_STUNNED, countAlive, createWorld } from '../../src/core/state';

describe('createWorld', () => {
  it('allocates fielders and ball slots to match the config', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.fielders.count = 12;
    cfg.launch.count = 5;
    const w = createWorld(cfg);
    expect(w.fielderCount).toBe(12);
    expect(w.fielderPos.length).toBe(36);
    expect(w.ballCapacity).toBe(5);
    expect(w.ballCount).toBe(0);
    expect([...w.ballState]).toEqual(new Array(5).fill(BallState.PENDING));
    expect(countAlive(w)).toBe(12);
    expect(w.fielderStunnedUntil.every((s) => s === NOT_STUNNED)).toBe(true);
  });

  it('lays fielders out on a grid inside the field, on the ground, at their home positions', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.fielders.count = 100;
    const w = createWorld(cfg);
    const half = cfg.field.width / 2;
    const positions = new Set<string>();
    for (let i = 0; i < w.fielderCount; i++) {
      const x = w.fielderPos[3 * i];
      const y = w.fielderPos[3 * i + 1];
      const z = w.fielderPos[3 * i + 2];
      expect(Math.abs(x)).toBeLessThan(half);
      expect(Math.abs(y)).toBeLessThan(half);
      expect(z).toBe(0);
      positions.add(`${x},${y}`);
    }
    expect(positions.size).toBe(100);
    expect([...w.fielderHome]).toEqual([...w.fielderPos]);
  });

  it('handles zero fielders', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.fielders.count = 0;
    const w = createWorld(cfg);
    expect(w.fielderCount).toBe(0);
    expect(countAlive(w)).toBe(0);
  });
});
