/**
 * Performance benchmarks for core hot paths. Run before and after any performance work and
 * report both numbers (CLAUDE.md section 13).
 *
 *   npm run bench
 */
import { performance } from 'node:perf_hooks';
import { DEFAULT_CONFIG, cloneConfig } from '../src/core/config';
import { Simulation } from '../src/core/sim';

interface Case {
  name: string;
  fielders: number;
  balls: number;
  ticks: number;
}

const CASES: Case[] = [
  { name: 'baseline 100 v 100', fielders: 100, balls: 100, ticks: 3000 },
  { name: 'target   500 v 500', fielders: 500, balls: 500, ticks: 3000 },
];

function runCase(c: Case): void {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.fielders.count = c.fielders;
  config.launch.count = c.balls;
  config.duration = c.ticks * config.dt;

  const sim = new Simulation(config);
  // Warm up the JIT on a throwaway run.
  sim.run(200);
  sim.reset();

  const start = performance.now();
  sim.run(c.ticks);
  const elapsed = (performance.now() - start) / 1000;

  const simSeconds = c.ticks * config.dt;
  const ticksPerSecond = c.ticks / elapsed;
  const realTimeFactor = simSeconds / elapsed;
  console.log(
    `${c.name}: ${c.ticks} ticks in ${elapsed.toFixed(3)} s` +
      ` (${ticksPerSecond.toFixed(0)} ticks/s, ${realTimeFactor.toFixed(1)}x real time)`,
  );
}

for (const c of CASES) runCase(c);
