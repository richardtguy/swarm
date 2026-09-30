/**
 * Builds the `LocalView` handed to each fielder's strategy from start-of-tick state, so every
 * fielder decides from the same snapshot regardless of processing order (CLAUDE.md rule 4).
 * Ball and neighbour observations come from `sensing.ts`; the inbox from the message bus
 * (Phase 3); bumps from collisions (Phase 5).
 */
import type {
  AgentMemory,
  BallObservation,
  BumpObservation,
  LocalView,
  NeighbourObservation,
} from '../agents/types';
import type { Message } from '../comms/types';
import type { SimConfig } from '../config';
import { NOT_STUNNED, type World } from '../state';
import { load, vec3 } from '../vec3';

/** Assemble fielder `id`'s view of the world at the start of the current tick. */
export function buildLocalView(
  world: Readonly<World>,
  config: Readonly<SimConfig>,
  id: number,
  memory: AgentMemory,
  inbox: Message[],
  balls: BallObservation[],
  neighbours: NeighbourObservation[],
  bumps: BumpObservation[],
): LocalView {
  const stunnedUntil = world.fielderStunnedUntil[id];
  return {
    tick: world.tick,
    time: world.time,
    self: {
      id,
      position: load(vec3(), world.fielderPos, id),
      velocity: load(vec3(), world.fielderVel, id),
      maxSpeed: config.fielders.maxSpeed,
      maxAccel: config.fielders.maxAccel,
      stunnedUntil: stunnedUntil === NOT_STUNNED ? null : stunnedUntil,
    },
    bumps,
    balls,
    neighbours,
    inbox,
    memory,
    params: config.strategy,
  };
}
