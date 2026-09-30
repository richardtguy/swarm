/**
 * Messages exchanged between fielders. Broadcast only; there is no addressing.
 * This is a project contract (CLAUDE.md section 13): ask before changing it.
 */

/** Fields the message bus stamps on every message at send time. */
export interface MessageHeader {
  /** Sender fielder id. */
  from: number;
  /** Tick at which the message was sent. */
  sentTick: number;
}

/** The message body a strategy puts in its outbox. */
export type MessageBody =
  /** "I intend to catch this ball and expect to reach its landing point at `eta` (sim time, s)." */
  | { type: 'CLAIM'; ballId: number; eta: number }
  /** "I no longer intend to catch this ball." */
  | { type: 'RELEASE'; ballId: number }
  /** "I caught this ball." */
  | { type: 'CAUGHT'; ballId: number }
  /** Liveness signal. */
  | { type: 'HEARTBEAT' }
  /** L3 auction bid (Phase 7). */
  | { type: 'BID'; ballId: number; score: number; round: number };

/** A delivered message as it appears in an inbox. */
export type Message = MessageHeader & MessageBody;
