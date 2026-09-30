/**
 * Discrete events emitted by the simulation, for the UI, metrics and experiment logs.
 * The union grows with each phase.
 */

/** A simulation event. Every event carries the tick at which it happened. */
export type SimEvent =
  /** A ball was launched. */
  | { type: 'LAUNCH'; tick: number; ballId: number }
  /** A fielder caught a ball. */
  | { type: 'CATCH'; tick: number; ballId: number; fielderId: number }
  /** A ball hit the ground uncaught. */
  | { type: 'DROP'; tick: number; ballId: number }
  /** A fielder was killed by command. */
  | { type: 'KILL'; tick: number; fielderId: number };

/** Append-only event log with a drain for incremental consumers such as the worker. */
export class EventLog {
  private events: SimEvent[] = [];
  private drained = 0;
  private total = 0;

  /** Record an event. */
  append(event: SimEvent): void {
    this.events.push(event);
    this.total++;
  }

  /** Events appended since the previous `drain()`. */
  drain(): SimEvent[] {
    const fresh = this.events.slice(this.drained);
    this.drained = this.events.length;
    return fresh;
  }

  /** All events recorded so far. */
  all(): readonly SimEvent[] {
    return this.events;
  }

  /** Number of events recorded since init. */
  get count(): number {
    return this.total;
  }

  /** Forget everything. */
  clear(): void {
    this.events = [];
    this.drained = 0;
    this.total = 0;
  }
}
