/**
 * Turns scenario text into a validated config. Pure: file reading is the caller's job
 * (`scripts/` use `node:fs`; the browser would use `fetch`).
 */
import type { SimConfig } from '../config';
import { ScenarioError, validateScenario } from './schema';

/** Parse and validate scenario JSON. `source` labels errors, e.g. with a file name. */
export function parseScenario(text: string, source = 'scenario'): SimConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ScenarioError(source, `invalid JSON (${detail})`);
  }
  return validateScenario(json);
}
