/**
 * Launch plans: when and how each ball is launched.
 *
 * The whole plan is drawn at init from `rng.stream('launch')`, in ball index order, so balls
 * launch in index order and no other subsystem can disturb the sequence. Balls start on the
 * ground (z = 0) in a launch zone, aimed towards the field centre with an azimuth spread.
 */
import type { SimConfig } from '../config';
import type { Rng } from '../rng';

/** Precomputed launch schedule and initial state for every ball. */
export interface LaunchPlan {
  /** Number of balls. */
  count: number;
  /** Launch tick per ball, non-decreasing in index order. */
  tick: Int32Array;
  /** Launch positions (m), 3 per ball. */
  pos: Float64Array;
  /** Launch velocities (m/s), 3 per ball. */
  vel: Float64Array;
}

const DEG = Math.PI / 180;

/** Build the launch plan for `config`, drawing only from the `launch` stream. */
export function createLaunchPlan(config: Readonly<SimConfig>, rng: Rng): LaunchPlan {
  const { launch, dt } = config;
  const n = launch.count;
  const stream = rng.stream('launch');
  const plan: LaunchPlan = {
    count: n,
    tick: new Int32Array(n),
    pos: new Float64Array(3 * n),
    vel: new Float64Array(3 * n),
  };

  // Times first, so that the schedule is independent of the per-ball aim draws.
  let time = 0;
  for (let i = 0; i < n; i++) {
    switch (launch.pattern) {
      case 'salvo':
        time = 0;
        break;
      case 'staggered':
        time = launch.ratePerSecond > 0 ? i / launch.ratePerSecond : 0;
        break;
      case 'random':
        // Poisson process: exponential inter-arrival times with mean 1 / rate.
        if (i > 0 && launch.ratePerSecond > 0) {
          time += -Math.log(1 - stream.next()) / launch.ratePerSecond;
        }
        break;
    }
    plan.tick[i] = Math.round(time / dt);
  }

  const zones = launch.zones;
  for (let i = 0; i < n; i++) {
    const zone = zones[zones.length > 1 ? stream.int(0, zones.length - 1) : 0];
    // Uniform over the zone disc.
    const r = zone.radius * Math.sqrt(stream.next());
    const theta = stream.uniform(0, 2 * Math.PI);
    const x = zone.x + r * Math.cos(theta);
    const y = zone.y + r * Math.sin(theta);

    const speed = stream.uniform(launch.speed.min, launch.speed.max);
    const elevation = stream.uniform(launch.elevation_deg.min, launch.elevation_deg.max) * DEG;
    const spread = launch.azimuthSpread_deg * DEG;
    const baseAzimuth = Math.atan2(-zone.y, -zone.x); // towards the field centre
    const azimuth = baseAzimuth + stream.uniform(-spread / 2, spread / 2);

    const o = 3 * i;
    plan.pos[o] = x;
    plan.pos[o + 1] = y;
    plan.pos[o + 2] = 0;
    const horizontal = speed * Math.cos(elevation);
    plan.vel[o] = horizontal * Math.cos(azimuth);
    plan.vel[o + 1] = horizontal * Math.sin(azimuth);
    plan.vel[o + 2] = speed * Math.sin(elevation);
  }
  return plan;
}
