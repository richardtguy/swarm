import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig, type LaunchPattern } from '../../../src/core/config';
import { createLaunchPlan } from '../../../src/core/physics/launcher';
import { Rng } from '../../../src/core/rng';

function planFor(pattern: LaunchPattern, seed = 1, count = 20) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.launch.pattern = pattern;
  config.launch.count = count;
  return { config, plan: createLaunchPlan(config, new Rng(seed)) };
}

describe('createLaunchPlan', () => {
  it('salvo launches everything at tick 0', () => {
    const { plan } = planFor('salvo');
    expect([...plan.tick]).toEqual(new Array(20).fill(0));
  });

  it('staggered launches at the configured rate', () => {
    const { config, plan } = planFor('staggered');
    for (let i = 0; i < plan.count; i++) {
      expect(plan.tick[i]).toBe(Math.round(i / config.launch.ratePerSecond / config.dt));
    }
  });

  it('random launches are non-decreasing with a plausible mean interval', () => {
    const { config, plan } = planFor('random', 3, 400);
    for (let i = 1; i < plan.count; i++)
      expect(plan.tick[i]).toBeGreaterThanOrEqual(plan.tick[i - 1]);
    const meanInterval = (plan.tick[plan.count - 1] * config.dt) / (plan.count - 1);
    expect(meanInterval).toBeCloseTo(1 / config.launch.ratePerSecond, 1);
  });

  it('starts every ball on the ground inside a launch zone', () => {
    const { config, plan } = planFor('staggered', 5, 200);
    const zone = config.launch.zones[0];
    for (let i = 0; i < plan.count; i++) {
      const dx = plan.pos[3 * i] - zone.x;
      const dy = plan.pos[3 * i + 1] - zone.y;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(zone.radius + 1e-9);
      expect(plan.pos[3 * i + 2]).toBe(0);
    }
  });

  it('respects the speed, elevation and azimuth ranges', () => {
    const { config, plan } = planFor('staggered', 8, 200);
    const { speed, elevation_deg, azimuthSpread_deg } = config.launch;
    const zone = config.launch.zones[0];
    const towardsCentre = Math.atan2(-zone.y, -zone.x);
    for (let i = 0; i < plan.count; i++) {
      const vx = plan.vel[3 * i];
      const vy = plan.vel[3 * i + 1];
      const vz = plan.vel[3 * i + 2];
      const s = Math.hypot(vx, vy, vz);
      expect(s).toBeGreaterThanOrEqual(speed.min - 1e-9);
      expect(s).toBeLessThanOrEqual(speed.max + 1e-9);
      const elev = (Math.atan2(vz, Math.hypot(vx, vy)) * 180) / Math.PI;
      expect(elev).toBeGreaterThanOrEqual(elevation_deg.min - 1e-9);
      expect(elev).toBeLessThanOrEqual(elevation_deg.max + 1e-9);
      let dAz = Math.atan2(vy, vx) - towardsCentre;
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      expect(Math.abs((dAz * 180) / Math.PI)).toBeLessThanOrEqual(azimuthSpread_deg / 2 + 1e-9);
    }
  });

  it('is deterministic for a seed and unaffected by other streams', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    const a = createLaunchPlan(config, new Rng(42));
    const rng = new Rng(42);
    rng.stream('comms').next();
    rng.stream('perception').normal();
    const b = createLaunchPlan(config, rng);
    expect([...a.tick]).toEqual([...b.tick]);
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.vel]).toEqual([...b.vel]);
    const c = createLaunchPlan(config, new Rng(43));
    expect([...a.vel]).not.toEqual([...c.vel]);
  });
});
