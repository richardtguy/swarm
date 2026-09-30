/**
 * Golden summary metrics for the shipped scenarios. Update these only deliberately, with the
 * reason stated in the commit (CLAUDE.md section 14).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenario } from '../../src/core/scenario/loader';
import { Simulation } from '../../src/core/sim';

const SCENARIOS = join(__dirname, '../../scenarios');

interface Golden {
  file: string;
  strategy: string;
  caught: number;
  dropped: number;
  /** Allowed deviation in caught/dropped counts. */
  tolerance: number;
}

const GOLDENS: Golden[] = [
  { file: 'baseline.json', strategy: 'centralised', caught: 88, dropped: 12, tolerance: 2 },
  { file: 'baseline.json', strategy: 'idle', caught: 7, dropped: 93, tolerance: 2 },
  { file: 'dense-salvo.json', strategy: 'centralised', caught: 42, dropped: 18, tolerance: 2 },
];

describe('golden metrics', () => {
  for (const g of GOLDENS) {
    it(`${g.file} with ${g.strategy}: ${g.caught} caught, ${g.dropped} dropped`, () => {
      const config = parseScenario(readFileSync(join(SCENARIOS, g.file), 'utf8'), g.file);
      config.strategy.name = g.strategy;
      const sim = new Simulation(config);
      while (!sim.isFinished()) sim.step();
      const m = sim.metrics();
      expect(m.ballsInFlight).toBe(0);
      expect(Math.abs(m.ballsCaught - g.caught)).toBeLessThanOrEqual(g.tolerance);
      expect(Math.abs(m.ballsDropped - g.dropped)).toBeLessThanOrEqual(g.tolerance);
    });
  }
});
