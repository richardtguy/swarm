/**
 * Simulation configuration: the in-memory form of a scenario file.
 *
 * Units are SI (m, s, m/s, m/s²). Angles are radians internally; fields ending in `_deg`
 * hold degrees because they come straight from scenario files and UI controls.
 * Every field has a default in `DEFAULT_CONFIG`. Scenario validation lives in
 * `scenario/schema.ts` (Phase 1); this file only defines the shape and defaults.
 */

/** Launch pattern names. Implemented in `physics/launcher.ts` (Phase 1). */
export type LaunchPattern = 'salvo' | 'staggered' | 'random';

/** Initial fielder formation. */
export type FielderLayout = 'grid';

/** Collision consequence modes (CLAUDE.md section 9, Phase 5). */
export type CollisionMode = 'off' | 'bounce' | 'penalty' | 'destructive' | 'graded';

/** A circular launch zone on the ground plane (m). */
export interface LaunchZone {
  x: number;
  y: number;
  radius: number;
}

/** A closed numeric interval. */
export interface Range {
  min: number;
  max: number;
}

/** Tunable parameters visible to every strategy through `LocalView.params`. */
export interface StrategyParams {
  /** Minimum slack (s) for a ball to count as feasible. */
  feasibilityMargin: number;
  /** Hysteresis (s): switch target only if the improvement exceeds this. */
  switchMargin: number;
  /** Claims: A beats B if `A.eta < B.eta - claimMargin` (s); otherwise the lower id wins. */
  claimMargin: number;
  /** Claims: ticks without a refresh after which a claim expires. */
  claimTtl: number;
  /** Claims: re-broadcast when the holder's eta changes by more than this (s). */
  etaEpsilon: number;
  /** Claims: ticks between heartbeat re-broadcasts of held claims. */
  heartbeatInterval: number;
  /** Oracle: ticks between periodic replans. */
  replanInterval: number;
  /** Avoidance: separation force acts within this distance (m). */
  separationRadius: number;
  /** Avoidance: distances below this are logged as near-misses (m). */
  minSeparation: number;
}

/** The `strategy` block of a scenario: which strategy, plus its parameters. */
export interface StrategyConfig extends StrategyParams {
  /** Registry name, see `strategies/index.ts`. */
  name: string;
}

/** Complete simulation configuration. */
export interface SimConfig {
  /** Human-readable scenario name. */
  name: string;
  /** Integer run seed. The same config and seed reproduce a run bit for bit. */
  seed: number;
  /** Fixed timestep (s). */
  dt: number;
  /** Run length (s). `Simulation.isFinished()` becomes true at this sim time. */
  duration: number;
  /** Field extents (m), centred on the origin: x in [-width/2, width/2], y in [-length/2, length/2]. */
  field: { width: number; length: number };
  fielders: {
    count: number;
    layout: FielderLayout;
    /** Maximum speed (m/s). */
    maxSpeed: number;
    /** Maximum acceleration (m/s²). */
    maxAccel: number;
  };
  launch: {
    pattern: LaunchPattern;
    /** Total balls to launch during the run. */
    count: number;
    /** Staggered/random patterns: mean launches per second. */
    ratePerSecond: number;
    zones: LaunchZone[];
    /** Launch speed range (m/s). */
    speed: Range;
    /** Elevation angle range (degrees above horizontal). */
    elevation_deg: Range;
    /** Total azimuth spread (degrees) about the direction towards the field centre. */
    azimuthSpread_deg: number;
  };
  catch: {
    /** Horizontal catch radius (m). */
    radius: number;
    /** Height (m) at which a descending ball can be caught. */
    height: number;
  };
  collisions: {
    mode: CollisionMode;
    /** Fielder body radius (m). */
    bodyRadius: number;
    /** 0 = dead stop along the contact normal, 1 = fully elastic. */
    restitution: number;
    /** Relaxation passes per tick. */
    collisionIterations: number;
    /** Duration of a penalty stun (s). */
    stunDuration: number;
    /** `graded`: minimum impact speed for a stun (m/s). */
    stunSpeed: number;
    /** `graded`: minimum impact speed for a crash (m/s). */
    crashSpeed: number;
  };
  sensing: {
    /** Sensing range (m). */
    range: number;
    /** Observation noise, 1-sigma (m). */
    noise: number;
  };
  comms: {
    /** Broadcast range at send time (m). */
    range: number;
    /** Delivery delay (s), rounded up to whole ticks. */
    latency: number;
    /** Independent per-recipient loss probability. */
    lossProb: number;
    /** Maximum messages sent per agent per tick. */
    bandwidth: number;
  };
  strategy: StrategyConfig;
}

/** Defaults for every field. Scenario files override these. */
export const DEFAULT_CONFIG: Readonly<SimConfig> = Object.freeze({
  name: 'default',
  seed: 42,
  dt: 0.02,
  duration: 60,
  field: { width: 120, length: 120 },
  fielders: { count: 100, layout: 'grid', maxSpeed: 7, maxAccel: 4 },
  launch: {
    pattern: 'staggered',
    count: 100,
    ratePerSecond: 3,
    zones: [{ x: 0, y: -70, radius: 5 }],
    speed: { min: 18, max: 28 },
    elevation_deg: { min: 35, max: 65 },
    azimuthSpread_deg: 50,
  },
  catch: { radius: 1.0, height: 1.5 },
  collisions: {
    mode: 'off',
    bodyRadius: 0.4,
    restitution: 0.3,
    collisionIterations: 4,
    stunDuration: 1.5,
    stunSpeed: 1.5,
    crashSpeed: 4.0,
  },
  sensing: { range: 60, noise: 0 },
  comms: { range: 30, latency: 0.1, lossProb: 0, bandwidth: 8 },
  strategy: {
    name: 'centralised',
    feasibilityMargin: 0.1,
    switchMargin: 0.3,
    claimMargin: 0.15,
    claimTtl: 50,
    etaEpsilon: 0.1,
    heartbeatInterval: 10,
    replanInterval: 25,
    separationRadius: 2.0,
    minSeparation: 1.0,
  },
} satisfies SimConfig);

/** A value that `setParam` may assign. */
export type ParamValue = number | string | boolean;

/** Deep copy of a config, so callers can mutate without touching the source. */
export function cloneConfig(config: Readonly<SimConfig>): SimConfig {
  return {
    ...config,
    field: { ...config.field },
    fielders: { ...config.fielders },
    launch: {
      ...config.launch,
      zones: config.launch.zones.map((z) => ({ ...z })),
      speed: { ...config.launch.speed },
      elevation_deg: { ...config.launch.elevation_deg },
    },
    catch: { ...config.catch },
    collisions: { ...config.collisions },
    sensing: { ...config.sensing },
    comms: { ...config.comms },
    strategy: { ...config.strategy },
  };
}

/**
 * Assign a scalar config field by dotted path, e.g. `setParam(cfg, 'comms.range', 25)`.
 *
 * The path must name an existing scalar field, and the value must have the same type as the
 * current one. Array elements are not addressable. Throws a descriptive error otherwise.
 */
export function setParam(config: SimConfig, path: string, value: ParamValue): void {
  const parts = path.split('.');
  let node: unknown = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(node) || !(parts[i] in node)) {
      throw new Error(`setParam: unknown path "${path}"`);
    }
    node = node[parts[i]];
  }
  const key = parts[parts.length - 1];
  if (!isPlainObject(node) || !(key in node)) {
    throw new Error(`setParam: unknown path "${path}"`);
  }
  const current = node[key];
  if (typeof current !== typeof value || isPlainObject(current) || Array.isArray(current)) {
    throw new Error(
      `setParam: "${path}" expects ${describe(current)}, got ${typeof value} ${String(value)}`,
    );
  }
  node[key] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'an array (not addressable)';
  if (isPlainObject(value)) return 'an object (not addressable)';
  return typeof value;
}
