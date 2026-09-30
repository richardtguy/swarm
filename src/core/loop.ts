/**
 * Fixed-timestep scheduling.
 *
 * The simulation always advances in whole ticks of `dt`. Hosts (the worker, the browser page,
 * headless scripts) measure wall-clock time however they like and feed elapsed seconds into a
 * `FixedStepAccumulator`, which answers how many ticks to run now. Rendering may use `alpha()`
 * to interpolate between the last two snapshots. The accumulator itself never reads a clock.
 */

/** Converts elapsed wall-clock time into a whole number of fixed steps. */
export class FixedStepAccumulator {
  private residual = 0;

  /**
   * @param dt fixed timestep (s)
   * @param maxStepsPerAdvance cap on steps returned by one `advance()`, so a stalled host
   *   (e.g. a background tab) catches up gradually instead of freezing. Surplus time is dropped.
   * @param timeScale sim seconds per wall-clock second; 1 = real time.
   */
  constructor(
    readonly dt: number,
    private maxStepsPerAdvance = 10,
    private timeScale = 1,
  ) {
    if (!(dt > 0)) throw new RangeError(`dt must be positive, got ${dt}`);
  }

  /** Change the speed multiplier. Values <= 0 stop advancing. */
  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  /** Change the per-advance step cap. */
  setMaxSteps(max: number): void {
    this.maxStepsPerAdvance = Math.max(1, Math.floor(max));
  }

  /**
   * Account for `elapsedSeconds` of wall-clock time and return the number of steps to run.
   * Negative or non-finite input is ignored.
   */
  advance(elapsedSeconds: number): number {
    if (!(elapsedSeconds > 0) || !(this.timeScale > 0)) return 0;
    this.residual += elapsedSeconds * this.timeScale;
    let steps = Math.floor(this.residual / this.dt);
    if (steps > this.maxStepsPerAdvance) {
      steps = this.maxStepsPerAdvance;
      this.residual = 0;
    } else {
      this.residual -= steps * this.dt;
    }
    return steps;
  }

  /** Fraction of a step that has accumulated but not run yet, in [0, 1). For interpolation. */
  alpha(): number {
    return this.residual / this.dt;
  }

  /** Discard any accumulated time, e.g. after a pause or reset. */
  clear(): void {
    this.residual = 0;
  }
}
