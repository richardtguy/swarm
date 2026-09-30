/**
 * What a fielder can sense: balls within sensing range (with optional observation noise) and
 * fielders within comms range. Both use start-of-tick state and hash grids built from it, so
 * every fielder perceives the same world regardless of processing order. Neighbour observations
 * are built once per tick and shared between views, so they must never be mutated.
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
 * Write one observation of each alive fielder's start-of-tick position (m) into `out[id]`, and
 * null for dead fielders. Call once per tick: every view that includes fielder `id` shares the
 * same observation object, which saves allocating one per (observer, neighbour) pair. The
 * objects are frozen and their positions are fresh each tick, so a strategy that keeps one sees
 * start-of-tick values forever; strategies must not write into the position vectors
 * (`checkNeighboursUnchanged` detects it).
 */
export function observeFielders(
  world: Readonly<World>,
  out: (NeighbourObservation | null)[],
): void {
  for (let j = 0; j < world.fielderCount; j++) {
    if (world.fielderAlive[j] === 0) {
      out[j] = null;
      continue;
    }
    const o = 3 * j;
    out[j] = Object.freeze({
      id: j,
      position: vec3(world.fielderPos[o], world.fielderPos[o + 1], world.fielderPos[o + 2]),
    });
  }
}

/**
 * Alive fielders within `comms.range` (horizontal) of fielder `id`, excluding itself, in index
 * order. `neighbourGrid` must index alive fielders' start-of-tick positions (its cell size should
 * be about `comms.range`), and `observations` must come from `observeFielders` on the same state.
 * `buffer` needs at least `world.fielderCount` entries. Positions are exact: there is no noise on
 * neighbours. The returned array is the caller's; its elements are shared (see `observeFielders`).
 */
export function senseNeighbours(
  world: Readonly<World>,
  config: Readonly<SimConfig>,
  id: number,
  neighbourGrid: HashGrid,
  observations: readonly (NeighbourObservation | null)[],
  buffer: Int32Array,
): NeighbourObservation[] {
  const found = neighbourGrid.query(
    world.fielderPos[3 * id],
    world.fielderPos[3 * id + 1],
    config.comms.range,
    buffer,
  );
  // Grid order depends on cell layout; a numeric in-place sort restores index order.
  const ids = buffer.subarray(0, found).sort();
  const neighbours: NeighbourObservation[] = [];
  for (let k = 0; k < found; k++) {
    const j = ids[k];
    if (j === id) continue;
    const observation = observations[j];
    if (observation !== null) neighbours.push(observation);
  }
  return neighbours;
}

/**
 * Throw if a strategy has written into the shared neighbour observations of fielder `id`'s view.
 * `neighbours` is a copy of the view's list taken before `decide()`; while decisions are being
 * collected the world still holds start-of-tick positions to compare against. A development and
 * test aid: see `Simulation.verifyViews`.
 */
export function checkNeighboursUnchanged(
  world: Readonly<World>,
  id: number,
  neighbours: readonly NeighbourObservation[],
): void {
  for (const n of neighbours) {
    const o = 3 * n.id;
    const p = n.position;
    if (
      p[0] !== world.fielderPos[o] ||
      p[1] !== world.fielderPos[o + 1] ||
      p[2] !== world.fielderPos[o + 2]
    ) {
      throw new Error(
        `Fielder ${id}'s strategy mutated the shared observation of neighbour ${n.id}. ` +
          'Views are read-only except view.memory.',
      );
    }
  }
}
