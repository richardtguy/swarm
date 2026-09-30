/**
 * Colours for the 3D view, read from the same CSS custom properties as the 2D view so light and
 * dark themes apply to both. CSS colours are sRGB; three.js converts them to its linear working
 * space here.
 */
import { Color, SRGBColorSpace } from 'three';

/** A colour plus the opacity CSS gave it (`rgba(…)` alpha, else 1). */
export interface Paint {
  color: Color;
  opacity: number;
}

export interface Palette3D {
  background: Paint;
  field: Paint;
  fieldLine: Paint;
  zone: Paint;
  /** Pursuing fielders when target colours are off. */
  fielder: Paint;
  fielderIdle: Paint;
  fielderDead: Paint;
  ball: Paint;
  shadow: Paint;
  landing: Paint;
  arc: Paint;
  targetLine: Paint;
  commsLink: Paint;
  nearMiss: Paint;
  selected: Paint;
  sensing: Paint;
}

const RGBA = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

/**
 * Parse a CSS colour. `rgb()`/`rgba()` are parsed here so their alpha becomes `opacity`; other
 * forms (hex, named, `hsl()`) go through three's own parser. An empty string uses `fallback`.
 */
export function parseCssColour(text: string, fallback: string): Paint {
  const source = text.trim() || fallback;
  const m = RGBA.exec(source);
  if (m !== null) {
    const a = m[4];
    const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return {
      color: new Color().setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, SRGBColorSpace),
      opacity: Math.min(1, Math.max(0, alpha)),
    };
  }
  return { color: new Color().setStyle(source), opacity: 1 };
}

/** Read the 3D palette from the custom properties visible to `element`. */
export function readPalette3D(element: Element): Palette3D {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): Paint =>
    parseCssColour(style.getPropertyValue(name), fallback);
  return {
    background: read('--view-bg', '#3b4452'),
    field: read('--field', '#5aa860'),
    fieldLine: read('--field-line', 'rgba(255,255,255,0.3)'),
    zone: read('--zone', '#c9741c'),
    fielder: read('--fielder', '#1f4fb5'),
    fielderIdle: read('--fielder-idle', '#90a9d8'),
    fielderDead: read('--fielder-dead', '#6b6b66'),
    ball: read('--ball', '#ffffff'),
    shadow: read('--shadow', 'rgba(0,0,0,0.45)'),
    landing: read('--landing', 'rgba(255,255,255,0.8)'),
    arc: read('--arc', 'rgba(255,255,255,0.5)'),
    targetLine: read('--target-line', 'rgba(20,40,90,0.45)'),
    commsLink: read('--comms-link', 'rgba(140,210,255,0.35)'),
    nearMiss: read('--near-miss', '#e5484d'),
    selected: read('--accent', '#e0a800'),
    sensing: read('--sensing', 'rgba(255,255,255,0.5)'),
  };
}
