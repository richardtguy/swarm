/**
 * Headless single run. Prints summary metrics and the final state hash as JSON.
 *
 *   npm run sim -- --scenario scenarios/baseline.json --seed 42
 *   npm run sim -- --seed 7 --fielders 250 --duration 30 --ticks 500
 *
 * Flags after `--scenario` override the file's values.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../src/core/config';
import { parseScenario } from '../src/core/scenario/loader';
import { Simulation } from '../src/core/sim';

interface Args {
  scenario: string | null;
  seed: number | null;
  ticks: number | null;
  fielders: number | null;
  duration: number | null;
  strategy: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scenario: null,
    seed: null,
    ticks: null,
    fielders: null,
    duration: null,
    strategy: null,
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
    const string = (): string => {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      i++;
      return value;
    };
    switch (flag) {
      case '--scenario':
        args.scenario = string();
        break;
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
      case '--strategy':
        args.strategy = string();
        break;
      default:
        throw new Error(`Unknown argument "${flag}"`);
    }
  }
  return args;
}

function buildConfig(args: Args): SimConfig {
  const config =
    args.scenario === null
      ? cloneConfig(DEFAULT_CONFIG)
      : parseScenario(readFileSync(args.scenario, 'utf8'), args.scenario);
  if (args.seed !== null) config.seed = args.seed;
  if (args.fielders !== null) config.fielders.count = args.fielders;
  if (args.duration !== null) config.duration = args.duration;
  if (args.strategy !== null) config.strategy.name = args.strategy;
  return config;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfig(args);
  const sim = new Simulation(config);
  if (args.ticks !== null) {
    sim.run(args.ticks);
  } else {
    while (!sim.isFinished()) sim.step();
  }

  const metrics = sim.metrics();
  let reference: { strategy: string; catchRate: number; relativeCatchRate: number } | null = null;
  if (!sim.strategyInfo.isOracle) {
    // Oracle benchmark on the identical launch sequence, for the same number of ticks.
    const refConfig = cloneConfig(config);
    refConfig.strategy.name = 'centralised';
    const ref = new Simulation(refConfig);
    ref.run(sim.world.tick);
    const refMetrics = ref.metrics();
    reference = {
      strategy: 'centralised',
      catchRate: refMetrics.catchRate,
      relativeCatchRate: refMetrics.catchRate > 0 ? metrics.catchRate / refMetrics.catchRate : 0,
    };
  }

  const output = {
    scenario: config.name,
    seed: config.seed,
    strategy: sim.strategyInfo,
    metrics,
    reference,
    events: sim.events.count,
    hash: sim.hash(),
  };
  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
