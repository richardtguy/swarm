/**
 * Strategy interfaces. Project contracts (CLAUDE.md section 13): ask before changing them.
 */
import type { AgentMemory, Decision, LocalView } from '../agents/types';
import type { WorldSnapshot } from '../snapshot';

/** An autonomous strategy: every fielder decides from its own `LocalView` alone. */
export interface Strategy {
  readonly name: string;
  readonly isOracle?: false;
  /** Create the persistent memory for fielder `selfId`. */
  initMemory(selfId: number): AgentMemory;
  /**
   * Decide for one fielder. Must be a pure function of `view`; the only permitted side effect
   * is mutating `view.memory`.
   */
  decide(view: LocalView): Decision;
}

/**
 * The centralised benchmark. It sees the whole world and assigns every fielder a ball.
 * It is explicitly not a swarm strategy, and the UI and metrics label its results as oracle results.
 */
export interface OracleStrategy {
  readonly name: string;
  readonly isOracle: true;
  /** Fielder index → ball id, or -1 for no assignment. */
  assign(world: Readonly<WorldSnapshot>): Int32Array;
}

/** Any registered strategy. */
export type AnyStrategy = Strategy | OracleStrategy;

/** Type guard for the oracle. */
export function isOracle(strategy: AnyStrategy): strategy is OracleStrategy {
  return strategy.isOracle === true;
}
