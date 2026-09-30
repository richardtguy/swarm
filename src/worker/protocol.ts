/**
 * Messages between the main thread and the simulation worker.
 * Main → worker: commands. Worker → main: frames (snapshot + events + metrics) and replies.
 * This is a project contract (CLAUDE.md section 13): ask before changing it.
 */
import type { SimCommand } from '../core/commands';
import type { SimEvent } from '../core/metrics/eventLog';
import type { MetricsSummary } from '../core/metrics/metrics';
import type { WorldSnapshot } from '../core/snapshot';

/** Main → worker. */
export type WorkerCommand =
  /** Forward a simulation command. */
  | { type: 'command'; command: SimCommand }
  /** Sim seconds per wall-clock second. 0 stops the clock without pausing the sim. */
  | { type: 'setTimeScale'; timeScale: number }
  /** Ask for the current state hash (for determinism checks against headless runs). */
  | { type: 'requestHash' };

/** One rendered frame's worth of simulation output. */
export interface FrameMessage {
  type: 'frame';
  snapshot: WorldSnapshot;
  /** Events since the previous frame. */
  events: SimEvent[];
  metrics: MetricsSummary;
  /**
   * Metrics of a shadow oracle run on the same seed, stepped in lockstep, so the gap to the
   * benchmark is visible live. Null when the main run is itself the oracle.
   */
  reference: MetricsSummary | null;
  strategy: { name: string; isOracle: boolean };
  paused: boolean;
  finished: boolean;
}

/** Worker → main. */
export type WorkerMessage =
  | { type: 'ready' }
  | FrameMessage
  | { type: 'hash'; tick: number; hash: string }
  /** A command failed. The simulation continues in its previous state. */
  | { type: 'error'; message: string };
