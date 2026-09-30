/**
 * Hand-written scenario validator. Accepts a partial scenario object, fills gaps from
 * `DEFAULT_CONFIG`, and rejects unknown keys, wrong types and out-of-range values with an error
 * that names the offending path.
 */
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../config';
import { hasStrategy, strategyNames } from '../strategies/index';

/** Thrown for any invalid scenario. `path` is the dotted location of the problem. */
export class ScenarioError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = 'ScenarioError';
  }
}

interface NumberRule {
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  integer?: boolean;
}

/** Range rules for numeric fields, keyed by dotted path. Unlisted numbers must only be finite. */
const NUMBER_RULES: Readonly<Record<string, NumberRule>> = {
  seed: { integer: true, min: 0 },
  dt: { min: 0, exclusiveMin: true },
  duration: { min: 0 },
  'field.width': { min: 0, exclusiveMin: true },
  'field.length': { min: 0, exclusiveMin: true },
  'fielders.count': { integer: true, min: 0 },
  'fielders.maxSpeed': { min: 0, exclusiveMin: true },
  'fielders.maxAccel': { min: 0, exclusiveMin: true },
  'launch.count': { integer: true, min: 0 },
  'launch.ratePerSecond': { min: 0 },
  'launch.speed.min': { min: 0 },
  'launch.speed.max': { min: 0 },
  'launch.elevation_deg.min': { min: 0, max: 90 },
  'launch.elevation_deg.max': { min: 0, max: 90 },
  'launch.azimuthSpread_deg': { min: 0, max: 360 },
  'catch.radius': { min: 0, exclusiveMin: true },
  'catch.height': { min: 0 },
  'collisions.bodyRadius': { min: 0, exclusiveMin: true },
  'collisions.restitution': { min: 0, max: 1 },
  'collisions.collisionIterations': { integer: true, min: 1 },
  'collisions.stunDuration': { min: 0 },
  'collisions.stunSpeed': { min: 0 },
  'collisions.crashSpeed': { min: 0 },
  'sensing.range': { min: 0 },
  'sensing.noise': { min: 0 },
  'comms.range': { min: 0 },
  'comms.latency': { min: 0 },
  'comms.lossProb': { min: 0, max: 1 },
  'comms.bandwidth': { integer: true, min: 0 },
  'strategy.claimTtl': { integer: true, min: 0 },
  'strategy.heartbeatInterval': { integer: true, min: 1 },
  'strategy.replanInterval': { integer: true, min: 1 },
  'strategy.separationRadius': { min: 0 },
  'strategy.minSeparation': { min: 0 },
};

/** Allowed values for string enum fields, keyed by dotted path. */
const ENUM_RULES: Readonly<Record<string, readonly string[]>> = {
  'fielders.layout': ['grid'],
  'launch.pattern': ['salvo', 'staggered', 'random'],
  'collisions.mode': ['off', 'bounce', 'penalty', 'destructive', 'graded'],
};

/** Validate `input` and return a complete config. Throws `ScenarioError` on any problem. */
export function validateScenario(input: unknown): SimConfig {
  const config = cloneConfig(DEFAULT_CONFIG);
  mergeObject(config as unknown as Record<string, unknown>, input, 'scenario', '');
  checkRange(config.launch.speed, 'launch.speed');
  checkRange(config.launch.elevation_deg, 'launch.elevation_deg');
  if (config.collisions.crashSpeed < config.collisions.stunSpeed) {
    throw new ScenarioError('collisions.crashSpeed', 'must be at least collisions.stunSpeed');
  }
  return config;
}

function mergeObject(
  target: Record<string, unknown>,
  input: unknown,
  label: string,
  prefix: string,
): void {
  if (!isPlainObject(input)) throw new ScenarioError(label, 'must be an object');
  for (const key of Object.keys(input)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      throw new ScenarioError(path, `unknown field (known: ${Object.keys(target).join(', ')})`);
    }
    const current = target[key];
    const value = input[key];
    if (typeof current === 'number') {
      target[key] = checkNumber(value, path);
    } else if (typeof current === 'string') {
      target[key] = checkString(value, path);
    } else if (Array.isArray(current)) {
      if (path !== 'launch.zones') throw new ScenarioError(path, 'unexpected array field');
      target[key] = checkZones(value, path);
    } else if (isPlainObject(current)) {
      mergeObject(current, value, path, path);
    } else {
      throw new ScenarioError(path, 'unsupported field type');
    }
  }
}

function checkNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScenarioError(path, `must be a finite number, got ${describe(value)}`);
  }
  const rule = NUMBER_RULES[path];
  if (rule !== undefined) {
    if (rule.integer && !Number.isInteger(value)) {
      throw new ScenarioError(path, `must be an integer, got ${value}`);
    }
    if (rule.min !== undefined) {
      if (rule.exclusiveMin ? value <= rule.min : value < rule.min) {
        throw new ScenarioError(
          path,
          `must be ${rule.exclusiveMin ? 'greater than' : 'at least'} ${rule.min}, got ${value}`,
        );
      }
    }
    if (rule.max !== undefined && value > rule.max) {
      throw new ScenarioError(path, `must be at most ${rule.max}, got ${value}`);
    }
  }
  return value;
}

function checkString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ScenarioError(path, `must be a string, got ${describe(value)}`);
  }
  if (path === 'strategy.name') {
    if (!hasStrategy(value)) {
      throw new ScenarioError(
        path,
        `unknown strategy "${value}" (known: ${strategyNames().join(', ')})`,
      );
    }
    return value;
  }
  const allowed = ENUM_RULES[path];
  if (allowed !== undefined && !allowed.includes(value)) {
    throw new ScenarioError(path, `must be one of ${allowed.join(', ')}, got "${value}"`);
  }
  return value;
}

function checkZones(value: unknown, path: string): SimConfig['launch']['zones'] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ScenarioError(path, 'must be a non-empty array of { x, y, radius }');
  }
  return value.map((zone, i) => {
    const zonePath = `${path}[${i}]`;
    if (!isPlainObject(zone)) throw new ScenarioError(zonePath, 'must be an object');
    for (const key of Object.keys(zone)) {
      if (key !== 'x' && key !== 'y' && key !== 'radius') {
        throw new ScenarioError(`${zonePath}.${key}`, 'unknown field (known: x, y, radius)');
      }
    }
    const x = checkNumber(zone.x, `${zonePath}.x`);
    const y = checkNumber(zone.y, `${zonePath}.y`);
    const radius = checkNumber(zone.radius, `${zonePath}.radius`);
    if (radius < 0)
      throw new ScenarioError(`${zonePath}.radius`, `must be at least 0, got ${radius}`);
    return { x, y, radius };
  });
}

function checkRange(range: { min: number; max: number }, path: string): void {
  if (range.min > range.max) {
    throw new ScenarioError(path, `min (${range.min}) must not exceed max (${range.max})`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${String(value)}`;
}
