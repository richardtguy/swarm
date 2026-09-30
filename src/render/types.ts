/**
 * The interface every renderer implements. Renderers read snapshots and never mutate
 * simulation state (CLAUDE.md rule 6).
 */
import type { WorldSnapshot } from '../core/snapshot';

/** What a renderer draws each frame. */
export interface RenderFrame {
  snapshot: WorldSnapshot;
  /** Fielder to highlight, or null. */
  selectedFielder: number | null;
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
