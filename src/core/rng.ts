/**
 * Seeded pseudo-random number generator with named, independent streams.
 *
 * Each stream is a xoshiro128** generator whose state is derived from the run seed and the
 * stream name, so `rng.stream('comms')` yields the same sequence regardless of whether any
 * other stream was created or drawn from. Enabling noise in one subsystem therefore never
 * changes another's sequence (CLAUDE.md rule 3).
 *
 * This is the only source of randomness permitted in `src/core`.
 */

/** Names of the streams used by the simulation. Other names are allowed but discouraged. */
export type StreamName = 'launch' | 'perception' | 'comms' | 'strategy' | (string & {});

const TWO_POW_32 = 4294967296;
const TWO_POW_53 = 9007199254740992;

/** 32-bit FNV-1a hash of a string. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 step: returns the next 32-bit output and advances the state in `s[0]`. */
function splitmix32(s: Uint32Array): number {
  s[0] = (s[0] + 0x9e3779b9) >>> 0;
  let z = s[0];
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** A single independent random stream. Obtain one via `Rng.stream(name)`. */
export class RngStream {
  private readonly s = new Uint32Array(4);

  /** @param seed32 a 32-bit seed for this stream. */
  constructor(seed32: number) {
    const mix = new Uint32Array([seed32 >>> 0]);
    // Expand the seed into the four state words; avoid the all-zero state.
    for (let i = 0; i < 4; i++) this.s[i] = splitmix32(mix);
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  /** Next raw 32-bit unsigned integer. */
  nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform float in [0, 1) with 53 bits of resolution. */
  next(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / TWO_POW_53;
  }

  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    const span = max - min + 1;
    if (span <= 0) throw new RangeError(`int(): empty range [${min}, ${max}]`);
    return min + Math.floor((this.nextUint32() / TWO_POW_32) * span);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Normally distributed sample (Box–Muller) with the given mean and standard deviation. */
  normal(mean = 0, stdDev = 1): number {
    let u = this.next();
    // Guard against log(0).
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Copy of the internal state, for tests and snapshots. */
  state(): Uint32Array {
    return this.s.slice();
  }
}

/** Seeded generator that hands out named streams. Create one per run from the scenario seed. */
export class Rng {
  private readonly streams = new Map<string, RngStream>();

  /** @param seed integer run seed; fractional parts are discarded. */
  constructor(readonly seed: number) {
    if (!Number.isFinite(seed)) throw new RangeError(`Rng seed must be finite, got ${seed}`);
  }

  /**
   * Return the stream for `name`, creating it on first use. The stream's sequence depends only
   * on the run seed and the name, never on creation order.
   */
  stream(name: StreamName): RngStream {
    let stream = this.streams.get(name);
    if (stream === undefined) {
      stream = new RngStream(Rng.deriveSeed(this.seed, name));
      this.streams.set(name, stream);
    }
    return stream;
  }

  /** 32-bit seed for a named stream: a mix of the run seed and the name's hash. */
  static deriveSeed(seed: number, name: string): number {
    const lo = Math.floor(seed) >>> 0;
    const hi = Math.floor(Math.floor(seed) / TWO_POW_32) >>> 0;
    const mix = new Uint32Array([(lo ^ Math.imul(hi, 0x9e3779b1) ^ hashString(name)) >>> 0]);
    splitmix32(mix);
    return splitmix32(mix);
  }
}
