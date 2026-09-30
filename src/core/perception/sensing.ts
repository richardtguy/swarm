/**
 * What a fielder can sense: balls within sensing range (with optional observation noise) and
 * fielders within comms range. Both use start-of-tick state and hash grids built from it, so
 * every fielder perceives the same world regardless of processing order.
 *
 * Noise is drawn from `rng.stream('perception')` in fielder index order, then ball index order,
 * and only when `sensing.noise > 0`, so enabling it never disturbs another stream.
 */
import type { BallObservation, NeighbourObservation } from '../agents/types';
import type { SimConfig } from '../config';
import { predictLandingAt } from '../physics/ballistics';
import type { RngStream } from '../rng';
import type { HashGrid } from '../spatial/hashGrid';
import type { World } from '../state';
import { vec3 } from '../vec3';

/**
 * Observe every flying ball within `sensing.range` (horizontal) of fielder `id`, in ball index
 * order. `ballGrid` must index the flying balls' start-of-tick positions; `buffer` is scratch
 * space of at least `world.ballCapacity` entries. Balls whose observed trajectory never descends
 * through catch height are omitted, since they cannot be caught.
 */
export function senseBalls(
  world: Readonly<World>,
  config: Readonly<SimConfig>,
  id: number,
  ballGrid: HashGrid,
  buffer: Int32Array,
  perception: RngStream | null,
): BallObservation[] {
  const { range, noise } = config.sensing;
  const found = ballGrid.query(
    world.fielderPos[3 * id],
    world.fielderPos[3 * id + 1],
    range,
    buffer,
  );
  const ids = Array.from(buffer.subarray(0, found)).sort((a, b) => a - b);
  const observations: BallObservation[] = [];
  const noisy = noise > 0 && perception !== null;
  for (const b of ids) {
    const o = 3 * b;
    const position = vec3(world.ballPos[o], world.ballPos[o + 1], world.ballPos[o + 2]);
    const velocity = vec3(world.ballVel[o], world.ballVel[o + 1], world.ballVel[o + 2]);
    if (noisy) {
      for (let k = 0; k < 3; k++) position[k] += perception.normal(0, noise);
      for (let k = 0; k < 3; k++) velocity[k] += perception.normal(0, noise);
    }
    const predictedLanding = vec3();
    const t = predictLandingAt(predictedLanding, position, velocity, 0, config.catch.height);
    if (Number.isNaN(t)) continue;
    observations.push({
      id: b,
      position,
      velocity,
      predictedLanding,
      predictedArrivalTime: world.time + t,
      uncertainty: noise * Math.sqrt(1 + t * t),
    });
  }
  return observations;
}

/**
 * Alive fielders within `comms.range` (horizontal) of fielder `id`, excluding itself, in index
 * order. `fielderGrid` must index alive fielders' start-of-tick positions; `buffer` needs at
 * least `world.fielderCount` entries. Positions are exact: there is no noise on neighbours.
 */
export function senseNeighbours(
  world: Readonly<World>,
  config: Readonly<SimConfig>,
  id: number,
  fielderGrid: HashGrid,
  buffer: Int32Array,
): NeighbourObservation[] {
  const found = fielderGrid.query(
    world.fielderPos[3 * id],
    world.fielderPos[3 * id + 1],
    config.comms.range,
    buffer,
  );
  const ids = Array.from(buffer.subarray(0, found)).sort((a, b) => a - b);
  const neighbours: NeighbourObservation[] = [];
  for (const j of ids) {
    if (j === id) continue;
    const o = 3 * j;
    neighbours.push({
      id: j,
      position: vec3(world.fielderPos[o], world.fielderPos[o + 1], world.fielderPos[o + 2]),
    });
  }
  return neighbours;
}
