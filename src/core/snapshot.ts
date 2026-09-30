/**
 * Compact, read-only copy of the world for renderers, the oracle and the worker protocol.
 *
 * Float32 is used for positions and velocities because renderers do not need double precision
 * and the buffers are transferable between threads. Units and frame match `World`.
 */
import type { World } from './state';

/** A snapshot of the world at the end of a tick. */
export interface WorldSnapshot {
  tick: number;
  /** Simulation time (s). */
  time: number;
  fielderCount: number;
  /** Positions (m), 3 per fielder. */
  fielderPos: Float32Array;
  /** Velocities (m/s), 3 per fielder. */
  fielderVel: Float32Array;
  /** 1 if alive, 0 otherwise. */
  fielderAlive: Uint8Array;
  /** Sim time (s) until which a fielder is stunned, or `NOT_STUNNED`. */
  fielderStunnedUntil: Float32Array;
  /** Balls launched so far. */
  ballCount: number;
  /** Positions (m), 3 per ball slot. */
  ballPos: Float32Array;
  /** Velocities (m/s), 3 per ball slot. */
  ballVel: Float32Array;
  /** One of `BallState` per ball slot. */
  ballState: Uint8Array;
}

/** Copy the world into freshly allocated snapshot buffers. */
export function createSnapshot(world: Readonly<World>): WorldSnapshot {
  return {
    tick: world.tick,
    time: world.time,
    fielderCount: world.fielderCount,
    fielderPos: Float32Array.from(world.fielderPos),
    fielderVel: Float32Array.from(world.fielderVel),
    fielderAlive: Uint8Array.from(world.fielderAlive),
    fielderStunnedUntil: Float32Array.from(world.fielderStunnedUntil),
    ballCount: world.ballCount,
    ballPos: Float32Array.from(world.ballPos),
    ballVel: Float32Array.from(world.ballVel),
    ballState: Uint8Array.from(world.ballState),
  };
}

/** The transferable buffers of a snapshot, for `postMessage(snapshot, transfer)`. */
export function snapshotBuffers(snapshot: WorldSnapshot): ArrayBuffer[] {
  return [
    snapshot.fielderPos.buffer,
    snapshot.fielderVel.buffer,
    snapshot.fielderAlive.buffer,
    snapshot.fielderStunnedUntil.buffer,
    snapshot.ballPos.buffer,
    snapshot.ballVel.buffer,
    snapshot.ballState.buffer,
  ] as ArrayBuffer[];
}
