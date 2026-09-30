import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig, setParam } from '../../src/core/config';

describe('cloneConfig', () => {
  it('produces an independent deep copy', () => {
    const a = cloneConfig(DEFAULT_CONFIG);
    const b = cloneConfig(a);
    b.comms.range = 1;
    b.launch.zones[0].x = 99;
    b.launch.speed.min = 0;
    expect(a.comms.range).toBe(DEFAULT_CONFIG.comms.range);
    expect(a.launch.zones[0].x).toBe(DEFAULT_CONFIG.launch.zones[0].x);
    expect(a.launch.speed.min).toBe(DEFAULT_CONFIG.launch.speed.min);
  });
});

describe('setParam', () => {
  it('sets nested scalar fields by dotted path', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    setParam(cfg, 'comms.range', 12.5);
    setParam(cfg, 'strategy.name', 'idle');
    setParam(cfg, 'seed', 7);
    expect(cfg.comms.range).toBe(12.5);
    expect(cfg.strategy.name).toBe('idle');
    expect(cfg.seed).toBe(7);
  });

  it('rejects unknown paths', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    expect(() => setParam(cfg, 'comms.rnage', 1)).toThrow(/unknown path/);
    expect(() => setParam(cfg, 'nope', 1)).toThrow(/unknown path/);
    expect(() => setParam(cfg, 'comms.range.extra', 1)).toThrow(/unknown path/);
  });

  it('rejects type mismatches and non-scalar targets', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    expect(() => setParam(cfg, 'comms.range', 'far')).toThrow(/expects number/);
    expect(() => setParam(cfg, 'comms', 1)).toThrow(/not addressable/);
    expect(() => setParam(cfg, 'launch.zones', 1)).toThrow(/not addressable/);
  });

  it('does not treat prototype members as config fields', () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    expect(() => setParam(cfg, 'toString', 'x')).toThrow(/expects/);
  });
});
