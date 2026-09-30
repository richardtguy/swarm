/**
 * The simulation: owns the world, the RNG, strategy memories, events and metrics, and advances
 * everything one fixed step at a time. `step()` runs the ten stages of CLAUDE.md section 7 in
 * exactly that order. Stages that later phases fill in are present as empty methods so the
 * order is fixed now.
 */
import { blendAvoidance, separation } from './agents/avoidance';
import { steerArrive } from './agents/steering';
import type {
  AgentMemory,
  BumpObservation,
  Decision,
  LocalView,
  NeighbourObservation,
} from './agents/types';
import { EMPTY_INBOX, MessageBus } from './comms/messageBus';
import type { Message, MessageBody } from './comms/types';
import type { SimCommand } from './commands';
import { DEFAULT_CONFIG, cloneConfig, setParam, type SimConfig } from './config';
import { hashWorld } from './hash';
import {
  INSPECTOR_INBOX_LENGTH,
  buildInspection,
  inspectMessages,
  type InspectedMessage,
  type Inspection,
} from './inspection';
import { EventLog } from './metrics/eventLog';
import {
  computeMetrics,
  emptyRunCounters,
  recordOutcome,
  type MetricsSummary,
  type RunCounters,
} from './metrics/metrics';
import { buildLocalView } from './perception/localView';
import {
  checkNeighboursUnchanged,
  observeFielders,
  senseBalls,
  senseNeighbours,
} from './perception/sensing';
import { integrateBallistic, predictLandingAt } from './physics/ballistics';
import { createLaunchPlan, type LaunchPlan } from './physics/launcher';
import { Rng, type RngStream } from './rng';
import { createSnapshot, type WorldSnapshot } from './snapshot';
import { HashGrid } from './spatial/hashGrid';
import { BallState, createWorld, type World } from './state';
import { getStrategy } from './strategies/index';
import { isOracle, type AnyStrategy } from './strategies/types';
import { load, vec3 } from './vec3';

/** The idle decision, shared because it is never mutated. */
const IDLE_DECISION: Readonly<Decision> = Object.freeze({
  target: null,
  targetBallId: null,
  outbox: [],
});

const NO_BUMPS: BumpObservation[] = [];

/** Cell size (m) of the fielder grid: separation, catch and near-miss queries. */
const FIELDER_GRID_CELL = 4;
/** Cell size (m) of the flying-ball grid used by perception. */
const BALL_GRID_CELL = 10;

/**
 * Cell size (m) of the neighbour grid for a given comms range (m). Cells about as wide as the
 * query radius keep a comms-range query to a handful of cells; small fielder-grid cells would
 * make it walk hundreds.
 */
function neighbourGridCell(commsRange: number): number {
  return Math.max(commsRange, FIELDER_GRID_CELL);
}

/** One run of the fielding scenario. */
export class Simulation {
  /** The live configuration. Mutate only through `apply({ type: 'setParam' })`. */
  config!: SimConfig;
  world!: World;
  rng!: Rng;
  readonly events = new EventLog();
  /** Whether `advance()` steps. Commands `pause`/`resume` toggle this. */
  paused = false;
  /**
   * Development and test aid: after each `decide()`, throw if the strategy wrote into the
   * neighbour observations its view shares with other views. Costs O(neighbours) per fielder
   * per tick and never changes the outcome of a well-behaved run. Off by default.
   */
  verifyViews = false;
  /**
   * Test aid for CLAUDE.md rule 4: collect decisions in reverse index order. A correct run gives
   * a bit-identical result either way. Only meaningful with `sensing.noise = 0`, because noise
   * is drawn in decision order. Off by default.
   */
  reverseDecideOrder = false;

  private strategy!: AnyStrategy;
  private memories: AgentMemory[] = [];
  /** Last tick's decision per fielder; `IDLE_DECISION` for dead fielders. */
  private decisions: Decision[] = [];
  /** This tick's outbox per fielder, handed to the message bus. */
  private outboxes: (readonly MessageBody[])[] = [];
  /** Ball each fielder pursued in the last tick, or -1. */
  private targetBall!: Int32Array;
  /** Per-fielder inboxes for the current tick, filled by the message bus. */
  private inboxes: Message[][] = [];
  private readonly bus = new MessageBus();
  private commsStream!: RngStream;

  /** Fielder whose view is kept for the inspector, or null. */
  private inspected: number | null = null;
  private inspectedView: LocalView | null = null;
  private inspectedInbox: InspectedMessage[] = [];

  private plan!: LaunchPlan;
  private nextLaunch = 0;
  /** Oracle assignment: fielder → ball id or -1. Unused for autonomous strategies. */
  private assignment!: Int32Array;
  private replanDue = true;

  private perception!: RngStream;
  private fielderGrid!: HashGrid;
  /** Alive fielders at start of tick, with cells sized for comms-range queries. */
  private neighbourGrid!: HashGrid;
  /** This tick's shared neighbour observation per fielder (null when dead). */
  private fielderObservations: (NeighbourObservation | null)[] = [];
  private ballGrid!: HashGrid;
  private flyingMask!: Uint8Array;
  private fielderBuffer!: Int32Array;
  private ballBuffer!: Int32Array;
  /** Accelerations for the current tick, computed before any fielder moves. */
  private accelBuffer!: Float64Array;

  private nearMissFlags!: Uint8Array;
  private nearMissActive = new Set<number>();
  private counters: RunCounters = emptyRunCounters();

  // Scratch vectors for per-tick work; never escape this class.
  private readonly sPos = vec3();
  private readonly sVel = vec3();
  private readonly sTarget = vec3();
  private readonly sAccel = vec3();
  private readonly sPush = vec3();

  constructor(config: Readonly<SimConfig> = DEFAULT_CONFIG) {
    this.init(config);
  }

  /** Discard the current run and start afresh from `config`. */
  init(config: Readonly<SimConfig>): void {
    this.config = cloneConfig(config);
    this.rng = new Rng(this.config.seed);
    this.world = createWorld(this.config);
    this.strategy = getStrategy(this.config.strategy.name);
    this.events.clear();
    this.plan = createLaunchPlan(this.config, this.rng);
    this.nextLaunch = 0;
    this.perception = this.rng.stream('perception');
    this.commsStream = this.rng.stream('comms');
    const n = this.world.fielderCount;
    const m = this.world.ballCapacity;
    this.memories = new Array<AgentMemory>(n);
    this.decisions = new Array<Decision>(n);
    this.outboxes = new Array<readonly MessageBody[]>(n);
    this.inboxes = new Array<Message[]>(n);
    this.bus.reset();
    if (this.inspected !== null && this.inspected >= n) this.inspected = null;
    this.inspectedView = null;
    this.inspectedInbox = [];
    this.targetBall = new Int32Array(n).fill(-1);
    this.assignment = new Int32Array(n).fill(-1);
    this.replanDue = true;
    this.fielderGrid = new HashGrid(FIELDER_GRID_CELL, n);
    this.neighbourGrid = new HashGrid(neighbourGridCell(this.config.comms.range), n);
    this.fielderObservations = new Array<NeighbourObservation | null>(n).fill(null);
    this.ballGrid = new HashGrid(BALL_GRID_CELL, m);
    this.flyingMask = new Uint8Array(m);
    this.fielderBuffer = new Int32Array(Math.max(1, n));
    this.ballBuffer = new Int32Array(Math.max(1, m));
    this.accelBuffer = new Float64Array(3 * n);
    this.nearMissFlags = new Uint8Array(n);
    this.nearMissActive = new Set<number>();
    this.counters = emptyRunCounters();
    this.counters.comms = this.bus.counters;
    for (let i = 0; i < n; i++) {
      this.memories[i] = isOracle(this.strategy)
        ? { strategy: this.strategy.name }
        : this.strategy.initMemory(i);
      this.decisions[i] = IDLE_DECISION;
      this.outboxes[i] = IDLE_DECISION.outbox;
      this.inboxes[i] = EMPTY_INBOX;
    }
  }

  /** Restart from tick 0 with the current config (including any `setParam` changes). */
  reset(): void {
    this.init(this.config);
  }

  /** Apply one command from the UI or a script. Throws on invalid input. */
  apply(command: SimCommand): void {
    switch (command.type) {
      case 'init':
        this.init(command.config);
        break;
      case 'setParam':
        setParam(this.config, command.path, command.value);
        break;
      case 'killAgent':
        this.killAgent(command.id);
        break;
      case 'pause':
        this.paused = true;
        break;
      case 'resume':
        this.paused = false;
        break;
      case 'step':
        this.run(command.ticks ?? 1);
        break;
      case 'reset':
        this.reset();
        break;
    }
  }

  /** Mark fielder `id` dead. No-op if already dead. */
  killAgent(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.world.fielderCount) {
      throw new RangeError(`killAgent: no fielder with id ${id}`);
    }
    if (this.world.fielderAlive[id] === 0) return;
    this.world.fielderAlive[id] = 0;
    this.world.fielderVel.fill(0, 3 * id, 3 * id + 3);
    this.targetBall[id] = -1;
    this.nearMissFlags[id] = 0;
    this.replanDue = true;
    this.events.append({ type: 'KILL', tick: this.world.tick, fielderId: id });
  }

  /** True once sim time has reached the configured duration. */
  isFinished(): boolean {
    return this.world.time >= this.config.duration - 1e-9;
  }

  /** Step once unless paused. Returns whether a step ran. */
  advance(): boolean {
    if (this.paused) return false;
    this.step();
    return true;
  }

  /** Run exactly `ticks` steps regardless of the paused state. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Advance the world by one fixed timestep. See CLAUDE.md section 7 for the stage order. */
  step(): void {
    const world = this.world;
    this.stageLaunch();
    this.stagePerception();
    this.stageCommsDeliver();
    this.stageOraclePlan();
    this.stageDecide();
    this.stageCommsSend();
    this.stageMotion();
    this.stageCollisions();
    this.stageBallPhysics();
    this.stageResolve();
    world.tick++;
    world.time = world.tick * this.config.dt;
    this.stageMetrics();
  }

  /** Stage 1: spawn balls whose launch tick has come. */
  private stageLaunch(): void {
    const world = this.world;
    const plan = this.plan;
    while (this.nextLaunch < plan.count && plan.tick[this.nextLaunch] <= world.tick) {
      const b = this.nextLaunch;
      const o = 3 * b;
      world.ballPos[o] = plan.pos[o];
      world.ballPos[o + 1] = plan.pos[o + 1];
      world.ballPos[o + 2] = plan.pos[o + 2];
      world.ballVel[o] = plan.vel[o];
      world.ballVel[o + 1] = plan.vel[o + 1];
      world.ballVel[o + 2] = plan.vel[o + 2];
      world.ballState[b] = BallState.FLYING;
      world.ballCount = b + 1;
      this.events.append({ type: 'LAUNCH', tick: world.tick, ballId: b });
      this.replanDue = true;
      this.nextLaunch++;
    }
  }

  /**
   * Stage 2: index start-of-tick state for perception. The views themselves are assembled per
   * fielder in stageDecide, still from this unmodified state.
   */
  private stagePerception(): void {
    const world = this.world;
    this.fielderGrid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
    for (let b = 0; b < world.ballCount; b++) {
      this.flyingMask[b] = world.ballState[b] === BallState.FLYING ? 1 : 0;
    }
    this.ballGrid.build(world.ballPos, world.ballCount, this.flyingMask);
    if (isOracle(this.strategy)) return; // oracle fielders never sense neighbours
    const cell = neighbourGridCell(this.config.comms.range);
    if (this.neighbourGrid.cellSize !== cell) {
      this.neighbourGrid = new HashGrid(cell, world.fielderCount); // comms.range changed
    }
    this.neighbourGrid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
    observeFielders(world, this.fielderObservations);
  }

  /** Stage 3: put messages due this tick into inboxes. */
  private stageCommsDeliver(): void {
    this.bus.deliver(this.world, this.inboxes);
  }

  /**
   * Oracle replan, before stage 4: on launch, catch, drop and kill events, and every
   * `replanInterval` ticks. Writes the assignment that oracle fielders follow in stageDecide.
   */
  private stageOraclePlan(): void {
    if (!isOracle(this.strategy)) return;
    const interval = this.config.strategy.replanInterval;
    if (!this.replanDue && this.world.tick % interval !== 0) return;
    this.assignment = this.strategy.assign(this.snapshot());
    this.replanDue = false;
  }

  /**
   * Stage 4: build each alive fielder's view of the start-of-tick world and collect its
   * decision. Nothing is applied here. Fielders are visited in index order (rule 3), and
   * because every view is built from the same unmodified world, the order cannot affect the
   * outcome (rule 4).
   */
  private stageDecide(): void {
    const world = this.world;
    const strategy = this.strategy;
    const noisy = this.config.sensing.noise > 0;
    const n = world.fielderCount;
    this.inspectedView = null;
    for (let k = 0; k < n; k++) {
      const i = this.reverseDecideOrder ? n - 1 - k : k;
      this.decideFor(i, strategy, noisy);
      this.outboxes[i] = this.decisions[i].outbox;
    }
  }

  /** Build fielder `i`'s view and collect its decision. */
  private decideFor(i: number, strategy: AnyStrategy, noisy: boolean): void {
    const world = this.world;
    if (i === this.inspected && this.inboxes[i].length > 0) {
      const recent = inspectMessages(this.inboxes[i], world.tick).reverse();
      this.inspectedInbox = recent.concat(this.inspectedInbox).slice(0, INSPECTOR_INBOX_LENGTH);
    }
    if (world.fielderAlive[i] === 0) {
      this.decisions[i] = IDLE_DECISION;
      return;
    }
    if (isOracle(strategy)) {
      this.decisions[i] = this.oracleDecision(i);
      return;
    }
    const balls = senseBalls(
      world,
      this.config,
      i,
      this.ballGrid,
      this.ballBuffer,
      noisy ? this.perception : null,
    );
    const neighbours = senseNeighbours(
      world,
      this.config,
      i,
      this.neighbourGrid,
      this.fielderObservations,
      this.fielderBuffer,
    );
    const view = buildLocalView(
      world,
      this.config,
      i,
      this.memories[i],
      this.inboxes[i],
      balls,
      neighbours,
      NO_BUMPS,
    );
    if (this.verifyViews) {
      const given = neighbours.slice(); // decide() may reorder its own list
      this.decisions[i] = strategy.decide(view);
      checkNeighboursUnchanged(world, i, given);
    } else {
      this.decisions[i] = strategy.decide(view);
    }
    if (i === this.inspected) this.inspectedView = view;
  }

  /** Follow the oracle's assignment: head for the assigned ball's current predicted landing. */
  private oracleDecision(i: number): Decision {
    const world = this.world;
    const b = this.assignment[i];
    if (b < 0 || world.ballState[b] !== BallState.FLYING) return IDLE_DECISION;
    const target = vec3();
    const t = predictLandingAt(target, world.ballPos, world.ballVel, b, this.config.catch.height);
    if (Number.isNaN(t)) return IDLE_DECISION;
    return { target, targetBallId: b, outbox: [] };
  }

  /**
   * Stage 5: broadcast this tick's outboxes with range, latency, loss and bandwidth. Positions
   * are still start-of-tick here, which is what "range at send time" means.
   */
  private stageCommsSend(): void {
    if (isOracle(this.strategy)) return; // the oracle sends nothing
    this.bus.send(
      this.world,
      this.config,
      this.outboxes,
      this.neighbourGrid,
      this.fielderBuffer,
      this.commsStream,
    );
  }

  /**
   * Stage 6: steer each alive fielder towards its decision's target (or home when idle), blend
   * in separation from nearby fielders (which takes priority: steering never pushes into a
   * neighbour), clamp to `maxAccel`, then integrate with semi-implicit Euler. Every acceleration is computed from start-of-tick state before any fielder moves,
   * so the result does not depend on index order. Fielders are ground-bound: z stays 0.
   */
  private stageMotion(): void {
    const world = this.world;
    const dt = this.config.dt;
    const { maxSpeed, maxAccel } = this.config.fielders;
    const separationRadius = this.config.strategy.separationRadius;
    const pos = world.fielderPos;
    const vel = world.fielderVel;
    const accel = this.accelBuffer;
    const { sPos, sVel, sTarget, sAccel, sPush } = this;

    for (let i = 0; i < world.fielderCount; i++) {
      if (world.fielderAlive[i] === 0) {
        this.targetBall[i] = -1;
        continue;
      }
      const decision = this.decisions[i];
      this.targetBall[i] = decision.targetBallId ?? -1;
      load(sPos, pos, i);
      load(sVel, vel, i);
      if (decision.target !== null) {
        sTarget[0] = decision.target[0];
        sTarget[1] = decision.target[1];
      } else {
        load(sTarget, world.fielderHome, i);
      }
      steerArrive(sAccel, sPos, sVel, sTarget, maxSpeed, maxAccel, dt);
      if (separationRadius > 0) {
        const found = this.fielderGrid.query(
          sPos[0],
          sPos[1],
          separationRadius,
          this.fielderBuffer,
        );
        separation(sPush, pos, vel, i, this.fielderBuffer, found, separationRadius, maxAccel);
        blendAvoidance(sAccel, sPush, maxAccel);
      }
      accel[3 * i] = sAccel[0];
      accel[3 * i + 1] = sAccel[1];
    }

    for (let i = 0; i < world.fielderCount; i++) {
      if (world.fielderAlive[i] === 0) continue;
      const o = 3 * i;
      let vx = vel[o] + accel[o] * dt;
      let vy = vel[o + 1] + accel[o + 1] * dt;
      const speedSq = vx * vx + vy * vy;
      if (speedSq > maxSpeed * maxSpeed) {
        const k = maxSpeed / Math.sqrt(speedSq);
        vx *= k;
        vy *= k;
      }
      const dx = vx * dt;
      const dy = vy * dt;
      vel[o] = vx;
      vel[o + 1] = vy;
      vel[o + 2] = 0;
      pos[o] += dx;
      pos[o + 1] += dy;
      pos[o + 2] = 0;
      world.fielderDistance[i] += Math.sqrt(dx * dx + dy * dy);
    }
  }

  /** Stage 7: fielder–fielder contacts. Phase 5. No-op while `collisions.mode` is `off`. */
  private stageCollisions(): void {}

  /** Stage 8: integrate every flying ball analytically (no drag yet). */
  private stageBallPhysics(): void {
    const world = this.world;
    const dt = this.config.dt;
    for (let b = 0; b < world.ballCount; b++) {
      if (world.ballState[b] === BallState.FLYING) {
        integrateBallistic(world.ballPos, world.ballVel, b, dt);
      }
    }
  }

  /**
   * Stage 9: settle catches, drops and separation violations. A descending ball at or below
   * catch height is caught by the nearest alive fielder within the catch radius (ties to the
   * lowest id); a descending ball at or below the ground that nobody caught is dropped. Pairs
   * of alive fielders closer than `minSeparation` are flagged, and logged once per episode.
   */
  private stageResolve(): void {
    const world = this.world;
    const { radius, height } = this.config.catch;
    const grid = this.fielderGrid;
    grid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
    const buffer = this.fielderBuffer;

    for (let b = 0; b < world.ballCount; b++) {
      if (world.ballState[b] !== BallState.FLYING) continue;
      const o = 3 * b;
      const z = world.ballPos[o + 2];
      const vz = world.ballVel[o + 2];
      if (vz >= 0 || z > height) continue;

      const x = world.ballPos[o];
      const y = world.ballPos[o + 1];
      const found = grid.query(x, y, radius, buffer);
      let best = -1;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (let k = 0; k < found; k++) {
        const f = buffer[k];
        const dx = world.fielderPos[3 * f] - x;
        const dy = world.fielderPos[3 * f + 1] - y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq || (dSq === bestDistSq && f < best)) {
          best = f;
          bestDistSq = dSq;
        }
      }
      if (best >= 0) {
        world.ballState[b] = BallState.CAUGHT;
        this.events.append({ type: 'CATCH', tick: world.tick, ballId: b, fielderId: best });
        recordOutcome(this.counters, true);
        this.replanDue = true;
      } else if (z <= 0) {
        world.ballState[b] = BallState.DROPPED;
        this.events.append({ type: 'DROP', tick: world.tick, ballId: b });
        recordOutcome(this.counters, false);
        this.replanDue = true;
      }
    }

    const minSeparation = this.config.strategy.minSeparation;
    const flags = this.nearMissFlags;
    flags.fill(0);
    const active = new Set<number>();
    if (minSeparation > 0) {
      const n = world.fielderCount;
      for (let i = 0; i < n; i++) {
        if (world.fielderAlive[i] === 0) continue;
        const x = world.fielderPos[3 * i];
        const y = world.fielderPos[3 * i + 1];
        const found = grid.query(x, y, minSeparation, buffer);
        for (let k = 0; k < found; k++) {
          const j = buffer[k];
          if (j <= i) continue;
          const dx = world.fielderPos[3 * j] - x;
          const dy = world.fielderPos[3 * j + 1] - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= minSeparation) continue;
          const key = i * n + j;
          active.add(key);
          flags[i] = 1;
          flags[j] = 1;
          if (!this.nearMissActive.has(key)) {
            this.counters.nearMisses++;
            this.events.append({ type: 'NEAR_MISS', tick: world.tick, a: i, b: j, distance });
          }
        }
      }
    }
    this.nearMissActive = active;
  }

  /** Stage 10: per-tick metric updates. Summaries are computed on demand by `metrics()`. */
  private stageMetrics(): void {}

  /** Last tick's decision for fielder `id`, for the inspector. */
  decisionOf(id: number): Readonly<Decision> {
    return this.decisions[id];
  }

  /** Strategy memory of fielder `id`, for the inspector. Do not mutate. */
  memoryOf(id: number): Readonly<AgentMemory> {
    return this.memories[id];
  }

  /** Name of the running strategy, and whether it is the oracle. */
  get strategyInfo(): { name: string; isOracle: boolean } {
    return { name: this.strategy.name, isOracle: isOracle(this.strategy) };
  }

  /** Summary metrics for the run so far. */
  metrics(): MetricsSummary {
    return computeMetrics(this.world, this.counters, this.targetBall);
  }

  /** Choose the fielder the inspector follows, or null for none. Takes effect next tick. */
  setInspected(id: number | null): void {
    if (id !== null && (!Number.isInteger(id) || id < 0 || id >= this.world.fielderCount)) {
      throw new RangeError(`setInspected: no fielder with id ${id}`);
    }
    if (id !== this.inspected) {
      this.inspectedView = null;
      this.inspectedInbox = [];
    }
    this.inspected = id;
  }

  /** The inspected fielder's view and state as of the last tick, or null if none is chosen. */
  inspection(): Inspection | null {
    const id = this.inspected;
    if (id === null) return null;
    const world = this.world;
    const o = 3 * id;
    const vx = world.fielderVel[o];
    const vy = world.fielderVel[o + 1];
    return buildInspection(
      id,
      world.tick,
      world.fielderAlive[id] === 1,
      this.strategy.name,
      [world.fielderPos[o], world.fielderPos[o + 1], world.fielderPos[o + 2]],
      Math.hypot(vx, vy),
      this.inspectedView,
      this.decisions[id],
      this.memories[id],
      this.config.strategy,
      this.inspectedInbox,
    );
  }

  /** A fresh snapshot of the world. */
  snapshot(): WorldSnapshot {
    return createSnapshot(this.world, this.config, this.targetBall, this.nearMissFlags);
  }

  /** Hash of the complete world state, for determinism checks. */
  hash(): string {
    return hashWorld(this.world);
  }
}
