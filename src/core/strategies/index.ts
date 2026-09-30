/**
 * Strategy registry. This is the one folder-level index allowed in the codebase, and it is a
 * registry rather than a re-export: import strategy modules directly if you need their types.
 */
import { idleStrategy } from './idle';
import type { AnyStrategy } from './types';

const registry: ReadonlyMap<string, AnyStrategy> = new Map<string, AnyStrategy>([
  [idleStrategy.name, idleStrategy],
]);

/** Names of all registered strategies, in registration order. */
export function strategyNames(): string[] {
  return [...registry.keys()];
}

/** Look up a strategy by name. Throws if unknown. */
export function getStrategy(name: string): AnyStrategy {
  const strategy = registry.get(name);
  if (strategy === undefined) {
    throw new Error(`Unknown strategy "${name}". Known: ${strategyNames().join(', ')}`);
  }
  return strategy;
}
