/**
 * Headless single run. Prints summary metrics and the final state hash as JSON.
 *
 *   npm run sim -- --seed 42 --ticks 500
 *   npm run sim -- --seed 7 --fielders 250 --duration 30
 *
 * Scenario files (`--scenario path.json`) arrive with the scenario loader in Phase 1.
 */
import { DEFAULT_CONFIG, cloneConfig } from '../src/core/config';
import { Simulation } from '../src/core/sim';

interface Args {
  seed: number;
  ticks: number | null;
  fielders: number;
  duration: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    seed: DEFAULT_CONFIG.seed,
    ticks: null,
    fielders: DEFAULT_CONFIG.fielders.count,
    duration: DEFAULT_CONFIG.duration,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const number = (): number => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${flag} needs a number, got "${value}"`);
      i++;
      return n;
    };
    switch (flag) {
      case '--seed':
        args.seed = number();
        break;
      case '--ticks':
        args.ticks = number();
        break;
      case '--fielders':
        args.fielders = number();
        break;
      case '--duration':
        args.duration = number();
        break;
      case '--scenario':
        throw new Error('--scenario is not supported until the scenario loader lands (Phase 1)');
      default:
        throw new Error(`Unknown argument "${flag}"`);
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const config = cloneConfig(DEFAULT_CONFIG);
  config.seed = args.seed;
  config.fielders.count = args.fielders;
  config.duration = args.duration;

  const sim = new Simulation(config);
  if (args.ticks !== null) {
    sim.run(args.ticks);
  } else {
    while (!sim.isFinished()) sim.step();
  }

  const output = {
    scenario: config.name,
    seed: config.seed,
    strategy: sim.strategyInfo,
    metrics: sim.metrics(),
    events: sim.events.count,
    hash: sim.hash(),
  };
  console.log(JSON.stringify(output, null, 2));
}

main();
