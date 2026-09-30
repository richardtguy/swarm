/**
 * The command interface through which all outside influence reaches the simulation
 * (CLAUDE.md rule 6). The worker protocol wraps these; scripts call them directly.
 */
import type { ParamValue, SimConfig } from './config';

/** A command applied through `Simulation.apply()`. */
export type SimCommand =
  /** Discard the current run and start a new one from `config`. */
  | { type: 'init'; config: SimConfig }
  /**
   * Set one scalar config field by dotted path. Fields read every tick (comms, sensing,
   * strategy parameters, speeds) take effect immediately; structural fields (seed, counts,
   * dt, layout) take effect on the next `reset`.
   */
  | { type: 'setParam'; path: string; value: ParamValue }
  /** Mark a fielder dead. It keeps its index with `alive = 0`. */
  | { type: 'killAgent'; id: number }
  /** Stop `advance()` from stepping. `step` still works while paused. */
  | { type: 'pause' }
  | { type: 'resume' }
  /** Run exactly `ticks` steps (default 1) regardless of the paused state. */
  | { type: 'step'; ticks?: number }
  /** Restart the run from tick 0 with the current config. */
  | { type: 'reset' };
