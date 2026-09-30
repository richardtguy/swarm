/**
 * World state in struct-of-arrays form.
 *
 * All vectors are stored as `Float64Array` with three consecutive components per entity, in
 * the z-up frame (x east, y north, z up), in metres and metres per second. Entities are
 * addressed by integer index, which stays stable for the lifetime of a run: a killed fielder
 * keeps its index with `fielderAlive[i] = 0`.
 */
import type { SimConfig } from './config';

/** Lifecycle of a ball slot. */
export const BallState = Object.freeze({
  /** Not launched yet. */
  PENDING: 0,
  /** In flight. */
  FLYING: 1,
  /** Caught by a fielder; removed from play. */
  CAUGHT: 2,
  /** Hit the ground uncaught; removed from play. */
  DROPPED: 3,
} as const);

/** Sentinel in `fielderStunnedUntil` meaning "not stunned". */
export const NOT_STUNNED = -1;

/** Mutable world state for one run. */
export interface World {
  /** Integer tick count since init. */
  tick: number;
  /** Simulation time (s) = tick * dt. */
  time: number;

  /** Number of fielder slots (alive or not). */
  fielderCount: number;
  /** Positions (m), 3 per fielder. */
  fielderPos: Float64Array;
  /** Velocities (m/s), 3 per fielder. */
  fielderVel: Float64Array;
  /** Home positions (m) for the idle policy, 3 per fielder. */
  fielderHome: Float64Array;
  /** 1 if alive, 0 if killed or crashed. */
  fielderAlive: Uint8Array;
  /** Sim time (s) until which a fielder is stunned, or `NOT_STUNNED`. */
  fielderStunnedUntil: Float64Array;
  /** Cumulative distance travelled (m) per fielder. */
  fielderDistance: Float64Array;

  /** Number of ball slots, i.e. the scenario's total launch count. */
  ballCapacity: number;
  /** Number of balls launched so far; slots `[0, ballCount)` are launched. */
  ballCount: number;
  /** Positions (m), 3 per ball. */
  ballPos: Float64Array;
  /** Velocities (m/s), 3 per ball. */
  ballVel: Float64Array;
  /** One of `BallState`. */
  ballState: Uint8Array;
}

/** Allocate a world for `config` with fielders in their initial formation and no balls. */
export function createWorld(config: Readonly<SimConfig>): World {
  const n = config.fielders.count;
  const m = config.launch.count;
  const world: World = {
    tick: 0,
    time: 0,
    fielderCount: n,
    fielderPos: new Float64Array(3 * n),
    fielderVel: new Float64Array(3 * n),
    fielderHome: new Float64Array(3 * n),
    fielderAlive: new Uint8Array(n).fill(1),
    fielderStunnedUntil: new Float64Array(n).fill(NOT_STUNNED),
    fielderDistance: new Float64Array(n),
    ballCapacity: m,
    ballCount: 0,
    ballPos: new Float64Array(3 * m),
    ballVel: new Float64Array(3 * m),
    ballState: new Uint8Array(m).fill(BallState.PENDING),
  };
  layoutFielders(world, config);
  return world;
}

/** Place fielders in their initial formation and record it as their home positions. */
export function layoutFielders(world: World, config: Readonly<SimConfig>): void {
  switch (config.fielders.layout) {
    case 'grid':
      layoutGrid(world, config.field.width, config.field.length);
      break;
  }
  world.fielderHome.set(world.fielderPos);
}

/**
 * Evenly spaced grid covering the field, centred on the origin, filled row by row from the
 * south-west corner. The column count is chosen so cells are roughly square.
 */
function layoutGrid(world: World, width: number, length: number): void {
  const n = world.fielderCount;
  if (n === 0) return;
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * width) / length)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const dx = width / (cols + 1);
  const dy = length / (rows + 1);
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    world.fielderPos[3 * i] = -width / 2 + (c + 1) * dx;
    world.fielderPos[3 * i + 1] = -length / 2 + (r + 1) * dy;
    world.fielderPos[3 * i + 2] = 0;
  }
}

/** Number of alive fielders. */
export function countAlive(world: Readonly<World>): number {
  let alive = 0;
  for (let i = 0; i < world.fielderCount; i++) alive += world.fielderAlive[i];
  return alive;
}
