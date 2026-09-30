/**
 * Builds the `LocalView` handed to each fielder's strategy.
 *
 * Phase 0 fills only the self block: ball observations (with sensing range and noise) and
 * neighbours arrive with `sensing.ts` in Phase 2, and the inbox with the message bus in
 * Phase 3. The view is built from start-of-tick state, so every fielder decides from the
 * same snapshot regardless of processing order (CLAUDE.md rule 4).
 */
import type { AgentMemory, LocalView } from '../agents/types';
import type { Message } from '../comms/types';
import type { SimConfig } from '../config';
import { NOT_STUNNED, type World } from '../state';
import { load, vec3 } from '../vec3';

/** Build fielder `id`'s view of the world at the start of the current tick. */
export function buildLocalView(
  world: Readonly<World>,
  config: Readonly<SimConfig>,
  id: number,
  memory: AgentMemory,
  inbox: Message[],
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
    bumps: [],
    balls: [],
    neighbours: [],
    inbox,
    memory,
    params: config.strategy,
  };
}
