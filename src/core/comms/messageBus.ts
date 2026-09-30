/**
 * The message bus: broadcast delivery with range, latency, loss and a bandwidth cap
 * (CLAUDE.md section 10). It runs in two tick stages:
 *
 * - stage 5, `send`: each alive fielder's outbox is trimmed to `comms.bandwidth` (the newest
 *   messages are dropped first), then broadcast to every alive fielder within `comms.range` of
 *   the sender at start-of-tick positions, which is "range at send time" because nobody has moved
 *   yet. Each recipient independently loses the message with probability `comms.lossProb`.
 * - stage 3, `deliver`: messages due this tick go into recipients' inboxes. A recipient that died
 *   while the message was in flight does not receive it. A sender that died after sending still
 *   has its messages delivered.
 *
 * Latency is `comms.latency` in whole ticks, rounded up, and never less than one tick: a message
 * sent in stage 5 cannot reach an inbox already filled in stage 3 of the same tick.
 *
 * Determinism: senders are visited in index order, messages in outbox order, recipients in index
 * order, and loss draws come only from the `comms` stream in that same order. Each broadcast is
 * a single frozen message object shared by every recipient's inbox.
 */
import type { SimConfig } from '../config';
import type { RngStream } from '../rng';
import type { HashGrid } from '../spatial/hashGrid';
import type { World } from '../state';
import type { Message, MessageBody } from './types';

/** Message counts since init. Units are messages, or recipients where stated. */
export interface CommsCounters {
  /** Broadcasts that passed the bandwidth cap. */
  sent: number;
  /** Arrivals in an inbox (one per recipient). */
  delivered: number;
  /** Broadcasts cut by the bandwidth cap. */
  droppedBandwidth: number;
  /** Recipients that lost a message to packet loss. */
  droppedLoss: number;
  /** Recipients that died while a message to them was in flight. */
  droppedRecipientDead: number;
}

export function emptyCommsCounters(): CommsCounters {
  return { sent: 0, delivered: 0, droppedBandwidth: 0, droppedLoss: 0, droppedRecipientDead: 0 };
}

/**
 * Tolerance used when converting a latency to ticks. Floating-point division turns 0.14 / 0.02
 * into 7.000000000000001, which would otherwise round up to 8 ticks.
 */
const TICK_TOLERANCE = 1e-6;

/** Delivery delay in whole ticks for `latency` (s) at timestep `dt` (s): at least one tick. */
export function latencyTicks(latency: number, dt: number): number {
  return Math.max(1, Math.ceil(latency / dt - TICK_TOLERANCE));
}

/** The inbox of a fielder that received nothing this tick. Shared and frozen. */
export const EMPTY_INBOX = Object.freeze([]) as unknown as Message[];

interface Delivery {
  message: Readonly<Message>;
  /** Recipients that survived packet loss, in index order. */
  recipients: number[];
}

export class MessageBus {
  counters: CommsCounters = emptyCommsCounters();
  /** Deliveries keyed by the tick at which they arrive. */
  private pending = new Map<number, Delivery[]>();

  /** Drop everything in flight and zero the counters. */
  reset(): void {
    this.counters = emptyCommsCounters();
    this.pending = new Map();
  }

  /** Messages still in flight (one per broadcast, not per recipient). */
  get inFlight(): number {
    let n = 0;
    for (const list of this.pending.values()) n += list.length;
    return n;
  }

  /**
   * Stage 5: broadcast the outboxes collected this tick. `outboxes[i]` is fielder i's outbox.
   * `grid` must index alive fielders at start-of-tick positions (cells about `comms.range` wide),
   * `buffer` is scratch space for at least `world.fielderCount` ids, and `comms` is the run's
   * `rng.stream('comms')`.
   */
  send(
    world: Readonly<World>,
    config: Readonly<SimConfig>,
    outboxes: readonly (readonly MessageBody[])[],
    grid: HashGrid,
    buffer: Int32Array,
    comms: RngStream,
  ): void {
    const { range, lossProb, bandwidth, latency } = config.comms;
    const deliveryTick = world.tick + latencyTicks(latency, config.dt);
    const counters = this.counters;
    let queue: Delivery[] | null = null;

    for (let i = 0; i < world.fielderCount; i++) {
      const outbox = outboxes[i];
      if (outbox.length === 0 || world.fielderAlive[i] === 0) continue;
      const accepted = Math.min(outbox.length, Math.max(0, Math.floor(bandwidth)));
      counters.droppedBandwidth += outbox.length - accepted;
      if (accepted === 0) continue;

      const found = grid.query(world.fielderPos[3 * i], world.fielderPos[3 * i + 1], range, buffer);
      const inRange = buffer.subarray(0, found).sort(); // grid order depends on cells
      for (let k = 0; k < accepted; k++) {
        const message = Object.freeze({ ...outbox[k], from: i, sentTick: world.tick }) as Message;
        const recipients: number[] = [];
        for (let q = 0; q < found; q++) {
          const r = inRange[q];
          if (r === i) continue;
          if (lossProb > 0 && comms.next() < lossProb) {
            counters.droppedLoss++;
            continue;
          }
          recipients.push(r);
        }
        counters.sent++;
        if (recipients.length === 0) continue;
        if (queue === null) {
          queue = this.pending.get(deliveryTick) ?? [];
          this.pending.set(deliveryTick, queue);
        }
        queue.push({ message, recipients });
      }
    }
  }

  /**
   * Stage 3: fill `inboxes` with the messages due at `world.tick`, in the order they were sent
   * (send tick, then sender, then outbox position). Fielders that receive nothing get
   * `EMPTY_INBOX`.
   */
  deliver(world: Readonly<World>, inboxes: Message[][]): void {
    inboxes.fill(EMPTY_INBOX);
    const due = this.pending.get(world.tick);
    if (due === undefined) return;
    this.pending.delete(world.tick);
    const counters = this.counters;
    for (const { message, recipients } of due) {
      for (const r of recipients) {
        if (world.fielderAlive[r] === 0) {
          counters.droppedRecipientDead++;
          continue;
        }
        if (inboxes[r] === EMPTY_INBOX) inboxes[r] = [];
        inboxes[r].push(message);
        counters.delivered++;
      }
    }
  }
}
