import { PlaneGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fromThree, layFlat, toThree, writeThree } from '../../../src/render/three/coords';

describe('core ↔ three.js coordinates', () => {
  it('maps core (x, y, z) to three (x, z, -y)', () => {
    expect(toThree(new Vector3(), 1, 2, 3).toArray()).toEqual([1, 3, -2]);
    const buf = new Float32Array(6);
    writeThree(buf, 1, 4, 5, 6);
    expect([...buf]).toEqual([0, 0, 0, 4, 6, -5]);
  });

  it('keeps east, up and north where expected', () => {
    // East stays +x, up is +y, north is -z.
    expect(toThree(new Vector3(), 1, 0, 0).toArray()).toEqual([1, 0, -0]);
    expect(toThree(new Vector3(), 0, 0, 1).toArray()).toEqual([0, 1, -0]);
    expect(toThree(new Vector3(), 0, 1, 0).toArray()).toEqual([0, 0, -1]);
  });

  it('round-trips through fromThree', () => {
    const v = toThree(new Vector3(), -7.5, 12.25, 3);
    expect(fromThree(v)).toEqual([-7.5, 12.25, 3]);
  });

  it('lays a flat geometry on the ground with local +y pointing north and facing up', () => {
    const plane = layFlat(new PlaneGeometry(2, 4));
    const pos = plane.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = fromThree(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      expect(Math.abs(x)).toBeCloseTo(1, 6);
      expect(Math.abs(y)).toBeCloseTo(2, 6); // the 4 m side runs north–south
      expect(z).toBeCloseTo(0, 6);
    }
    const n = plane.getAttribute('normal');
    const [, , nz] = fromThree(new Vector3(n.getX(0), n.getY(0), n.getZ(0)));
    expect(nz).toBeCloseTo(1, 6); // facing up
  });
});
