import { SRGBColorSpace, type Color } from 'three';
import { describe, expect, it } from 'vitest';
import { parseCssColour } from '../../../src/render/three/palette';

function srgb(c: Color): number[] {
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, SRGBColorSpace);
  return [out.r, out.g, out.b].map((x) => Math.round(x * 255));
}

describe('parseCssColour', () => {
  it('parses rgba() with its alpha as opacity', () => {
    const p = parseCssColour('rgba(255, 128, 0, 0.35)', '#000');
    expect(srgb(p.color)).toEqual([255, 128, 0]);
    expect(p.opacity).toBeCloseTo(0.35, 12);
  });

  it('parses modern space-separated rgb() with a percentage alpha', () => {
    const p = parseCssColour('rgb(10 20 30 / 50%)', '#000');
    expect(srgb(p.color)).toEqual([10, 20, 30]);
    expect(p.opacity).toBeCloseTo(0.5, 12);
  });

  it('parses hex colours as opaque', () => {
    const p = parseCssColour('  #5aa860 ', '#000');
    expect(srgb(p.color)).toEqual([0x5a, 0xa8, 0x60]);
    expect(p.opacity).toBe(1);
  });

  it('uses the fallback for an empty value', () => {
    const p = parseCssColour('', 'rgba(1, 2, 3, 0.2)');
    expect(srgb(p.color)).toEqual([1, 2, 3]);
    expect(p.opacity).toBeCloseTo(0.2, 12);
  });
});
