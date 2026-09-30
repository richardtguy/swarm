/**
 * Deterministic hashing of world state, used by the determinism tests and shown in the UI so
 * a browser run can be compared with a headless run. Two runs are bit-identical if and only
 * if (with overwhelming probability) their hashes match.
 */
import type { World } from './state';

/** Incremental 64-bit hash built from two independent 32-bit FNV-1a lanes. */
export class StateHasher {
  private a = 0x811c9dc5;
  private b = 0xcbf29ce4;

  /** Mix in the raw bytes of a typed array. */
  bytes(view: ArrayBufferView): this {
    const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < u8.length; i++) {
      a = Math.imul(a ^ u8[i], 0x01000193);
      b = Math.imul(b ^ u8[i], 0x01000193) ^ (b >>> 13);
    }
    this.a = a >>> 0;
    this.b = b >>> 0;
    return this;
  }

  /** Mix in a number by its IEEE-754 bit pattern. */
  number(value: number): this {
    return this.bytes(new Float64Array([value]));
  }

  /** Hex digest, 16 characters. */
  digest(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

/** Hash every field of the world that affects the simulation's future. */
export function hashWorld(world: Readonly<World>): string {
  return new StateHasher()
    .number(world.tick)
    .number(world.time)
    .number(world.fielderCount)
    .bytes(world.fielderPos)
    .bytes(world.fielderVel)
    .bytes(world.fielderHome)
    .bytes(world.fielderAlive)
    .bytes(world.fielderStunnedUntil)
    .bytes(world.fielderDistance)
    .number(world.ballCapacity)
    .number(world.ballCount)
    .bytes(world.ballPos)
    .bytes(world.ballVel)
    .bytes(world.ballState)
    .digest();
}
