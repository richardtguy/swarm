/**
 * Hosts a `Simulation` behind the worker protocol without touching any worker global, so the
 * same code runs (and is tested) in Node. `simWorker.ts` binds it to `self`.
 *
 * When the main run uses an autonomous strategy, the host also runs a shadow oracle simulation
 * on the same config and seed, in lockstep, and reports its metrics as the reference.
 */
import { cloneConfig } from '../core/config';
import { FixedStepAccumulator } from '../core/loop';
import { Simulation } from '../core/sim';
import { snapshotBuffers } from '../core/snapshot';
import type { WorkerCommand, WorkerMessage } from './protocol';

/** Sends a message to the main thread, optionally transferring buffers. */
export type PostFn = (message: WorkerMessage, transfer?: ArrayBuffer[]) => void;

/** Ticks the worker may run per pump before dropping surplus wall-clock time. */
const MAX_STEPS_PER_PUMP = 25;

/** Name of the benchmark strategy used for the reference run. */
const REFERENCE_STRATEGY = 'centralised';

export class SimHost {
  readonly sim = new Simulation();
  /** Shadow oracle run, or null when the main run is the oracle. */
  reference: Simulation | null = null;
  private clock: FixedStepAccumulator;
  private dirty = true;

  constructor(private readonly post: PostFn) {
    this.clock = new FixedStepAccumulator(this.sim.config.dt, MAX_STEPS_PER_PUMP);
    this.syncReference();
  }

  /** Handle one message from the main thread. Errors are reported, never thrown. */
  handle(message: WorkerCommand): void {
    try {
      switch (message.type) {
        case 'command': {
          const command = message.command;
          this.sim.apply(command);
          switch (command.type) {
            case 'init':
            case 'reset':
              this.clock = new FixedStepAccumulator(this.sim.config.dt, MAX_STEPS_PER_PUMP);
              this.syncReference();
              break;
            case 'setParam':
              if (this.reference !== null && !command.path.startsWith('strategy.name')) {
                this.reference.apply(command);
              }
              break;
            case 'killAgent':
            case 'step':
              this.reference?.apply(command);
              break;
            case 'pause':
            case 'resume':
              break;
          }
          this.clock.clear();
          this.dirty = true;
          break;
        }
        case 'setTimeScale':
          this.clock.setTimeScale(message.timeScale);
          this.clock.clear();
          break;
        case 'requestHash':
          this.post({ type: 'hash', tick: this.sim.world.tick, hash: this.sim.hash() });
          break;
      }
    } catch (error) {
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Account for `elapsedSeconds` of wall-clock time, run the ticks that are due, and post a
   * frame if anything changed. Returns the number of ticks run.
   */
  pump(elapsedSeconds: number): number {
    const sim = this.sim;
    let ran = 0;
    if (!sim.paused && !sim.isFinished()) {
      const steps = this.clock.advance(elapsedSeconds);
      for (let i = 0; i < steps && !sim.isFinished(); i++) {
        sim.step();
        this.reference?.step();
        ran++;
      }
    }
    if (ran > 0 || this.dirty) {
      this.postFrame();
      this.dirty = false;
    }
    return ran;
  }

  /** Post the current state as a frame, transferring the snapshot buffers. */
  postFrame(): void {
    const sim = this.sim;
    const snapshot = sim.snapshot();
    this.post(
      {
        type: 'frame',
        snapshot,
        events: sim.events.drain(),
        metrics: sim.metrics(),
        reference: this.reference === null ? null : this.reference.metrics(),
        strategy: sim.strategyInfo,
        paused: sim.paused,
        finished: sim.isFinished(),
      },
      snapshotBuffers(snapshot),
    );
  }

  /** (Re)create the shadow oracle run to match the main run's config. */
  private syncReference(): void {
    if (this.sim.strategyInfo.isOracle) {
      this.reference = null;
      return;
    }
    const config = cloneConfig(this.sim.config);
    config.strategy.name = REFERENCE_STRATEGY;
    this.reference = new Simulation(config);
  }
}
