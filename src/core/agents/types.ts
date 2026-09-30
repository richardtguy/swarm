/**
 * What an autonomous fielder sees and what it decides.
 * These are project contracts (CLAUDE.md section 13): ask before changing them.
 */
import type { StrategyParams } from '../config';
import type { Message, MessageBody } from '../comms/types';
import type { Vec3 } from '../vec3';

/** A ball as observed by one fielder, possibly with noise. */
export interface BallObservation {
  id: number;
  /** Observed position (m). */
  position: Vec3;
  /** Observed velocity (m/s). */
  velocity: Vec3;
  /** Predicted position (m) where the ball descends through catch height. */
  predictedLanding: Vec3;
  /** Predicted absolute sim time (s) of that landing. */
  predictedArrivalTime: number;
  /** 1-sigma landing error (m). */
  uncertainty: number;
}

/** A collision this fielder felt during the last tick. Its only knowledge of the contact. */
export interface BumpObservation {
  otherId: number;
  /** Unit vector from the other fielder towards this one. */
  normal: Vec3;
  /** Relative speed along the normal at impact (m/s). */
  impactSpeed: number;
}

/** A neighbour within comms range, as seen by one fielder. */
export interface NeighbourObservation {
  id: number;
  /** Position (m). */
  position: Vec3;
}

/**
 * Persistent per-agent strategy state. Each strategy extends this with its own fields and
 * narrows `view.memory` to its own type. Strategies must keep all persistent state here,
 * never in module scope or closures.
 */
export interface AgentMemory {
  /** Registry name of the strategy that created this memory. */
  strategy: string;
}

/** Everything a fielder may know. Built fresh each tick by perception. */
export interface LocalView {
  tick: number;
  /** Simulation time (s). */
  time: number;
  self: {
    id: number;
    /** Position (m). */
    position: Vec3;
    /** Velocity (m/s). */
    velocity: Vec3;
    /** Maximum speed (m/s). */
    maxSpeed: number;
    /** Maximum acceleration (m/s²). */
    maxAccel: number;
    /** Sim time (s) until which this fielder is stunned, or null if not stunned. */
    stunnedUntil: number | null;
  };
  /** Own collisions during the last tick. */
  bumps: BumpObservation[];
  /** Balls within sensing range. */
  balls: BallObservation[];
  /** Fielders within comms range. */
  neighbours: NeighbourObservation[];
  /** Messages delivered this tick. */
  inbox: Message[];
  /** Persistent strategy state for this fielder. */
  memory: AgentMemory;
  params: Readonly<StrategyParams>;
}

/** What a fielder decided this tick. */
export interface Decision {
  /** Position (m) to steer towards, or null for the idle policy. */
  target: Vec3 | null;
  /** The ball being pursued, or null. */
  targetBallId: number | null;
  /** Messages to broadcast this tick. */
  outbox: MessageBody[];
}
