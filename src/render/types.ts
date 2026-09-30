/**
 * The interface every renderer implements. Renderers read snapshots and never mutate
 * simulation state (CLAUDE.md rule 6).
 */
import type { WorldSnapshot } from '../core/snapshot';

/** Which overlays to draw. A renderer ignores the ones it does not support. */
export interface OverlaySettings {
  /** Remaining flight path of each ball (3D only). */
  arcs: boolean;
  /** Predicted landing rings, sized by landing uncertainty. */
  landingRings: boolean;
  /**
   * Lines from each fielder to the landing point of the ball it pursues. These stand in for
   * claim lines until the claims protocol (Phase 3) exists.
   */
  targetLines: boolean;
  /**
   * Colour each pursuing fielder by the ball it chases, so fielders converging on the same ball
   * share a colour. When off, all pursuing fielders share one colour (idle ones stay distinct).
   */
  targetColours: boolean;
  /** Links between fielders within comms range, capped to avoid clutter (3D only). */
  commsLinks: boolean;
  /** Highlight fielders closer than `minSeparation` to another. */
  nearMisses: boolean;
}

export const DEFAULT_OVERLAYS: Readonly<OverlaySettings> = Object.freeze({
  arcs: true,
  landingRings: true,
  targetLines: true,
  targetColours: true,
  commsLinks: false,
  nearMisses: true,
});

/** What a renderer draws each frame. */
export interface RenderFrame {
  snapshot: WorldSnapshot;
  /** Fielder to highlight, or null. */
  selectedFielder: number | null;
  overlays: Readonly<OverlaySettings>;
}

export interface Renderer {
  /** The element to place in the page. */
  readonly element: HTMLElement;
  /** Draw one frame. */
  render(frame: RenderFrame): void;
  /** Re-fit to the element's current size. */
  resize(): void;
  /** Fielder id under a viewport point, or null. */
  pick(clientX: number, clientY: number): number | null;
  /** Release resources. */
  dispose(): void;
}
