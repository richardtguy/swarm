import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { StateHasher, hashWorld } from '../../src/core/hash';
import { createWorld } from '../../src/core/state';

describe('StateHasher', () => {
  it('is deterministic and order-sensitive', () => {
    const a = new StateHasher().number(1).number(2).digest();
    const b = new StateHasher().number(1).number(2).digest();
    const c = new StateHasher().number(2).number(1).digest();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('distinguishes bit patterns that compare equal as numbers', () => {
    expect(new StateHasher().number(0).digest()).not.toBe(new StateHasher().number(-0).digest());
  });
});

describe('hashWorld', () => {
  it('matches for identical worlds and differs after a change', () => {
    const a = createWorld(DEFAULT_CONFIG);
    const b = createWorld(DEFAULT_CONFIG);
    expect(hashWorld(a)).toBe(hashWorld(b));
    b.fielderPos[4] += 1e-12;
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});
