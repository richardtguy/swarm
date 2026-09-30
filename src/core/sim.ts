/**
 * The simulation: owns the world, the RNG, strategy memories, events and metrics, and advances
 * everything one fixed step at a time. `step()` runs the ten stages of CLAUDE.md section 7 in
 * exactly that order. Stages that later phases fill in are present as empty methods so the
 * order is fixed now.
 */
import { steerArrive } from './agents/steering';
import type { AgentMemory, Decision } from './agents/types';
import type { Message } from './comms/types';
import type { SimCommand } from './commands';
import { DEFAULT_CONFIG, cloneConfig, setParam, type SimConfig } from './config';
import { hashWorld } from './hash';
import { EventLog } from './metrics/eventLog';
import { computeMetrics, type MetricsSummary } from './metrics/metrics';
import { buildLocalView } from './perception/localView';
import { integrateBallistic, predictLandingAt } from './physics/ballistics';
import { createLaunchPlan, type LaunchPlan } from './physics/launcher';
import { Rng } from './rng';
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

const EMPTY_INBOX: Message[] = [];

/** Cell size (m) of the fielder grid used for catch resolution. */
const CATCH_GRID_CELL = 4;

/** One run of the fielding scenario. */
export class Simulation {
  /** The live configuration. Mutate only through `apply({ type: 'setParam' })`. */
  config!: SimConfig;
  world!: World;
  rng!: Rng;
  readonly events = new EventLog();
  /** Whether `advance()` steps. Commands `pause`/`resume` toggle this. */
  paused = false;

  private strategy!: AnyStrategy;
  private memories: AgentMemory[] = [];
  /** Last tick's decision per fielder; `IDLE_DECISION` for dead fielders. */
  private decisions: Decision[] = [];
  /** Ball each fielder pursued in the last tick, or -1. */
  private targetBall!: Int32Array;
  /** Per-fielder inboxes for the current tick. Filled by the message bus from Phase 3. */
  private inboxes: Message[][] = [];

  private plan!: LaunchPlan;
  private nextLaunch = 0;
  /** Oracle assignment: fielder → ball id or -1. Unused for autonomous strategies. */
  private assignment!: Int32Array;
  private replanDue = true;
  private grid!: HashGrid;
  private queryBuffer!: Int32Array;

  // Scratch vectors for per-tick work; never escape this class.
  private readonly sPos = vec3();
  private readonly sVel = vec3();
  private readonly sTarget = vec3();
  private readonly sAccel = vec3();

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
    const n = this.world.fielderCount;
    this.memories = new Array<AgentMemory>(n);
    this.decisions = new Array<Decision>(n);
    this.inboxes = new Array<Message[]>(n);
    this.targetBall = new Int32Array(n).fill(-1);
    this.assignment = new Int32Array(n).fill(-1);
    this.replanDue = true;
    this.grid = new HashGrid(CATCH_GRID_CELL, n);
    this.queryBuffer = new Int32Array(Math.max(1, n));
    for (let i = 0; i < n; i++) {
      this.memories[i] = isOracle(this.strategy)
        ? { strategy: this.strategy.name }
        : this.strategy.initMemory(i);
      this.decisions[i] = IDLE_DECISION;
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
    // Stages 2–4 use start-of-tick state. Perception happens inside stageDecide, per fielder,
    // but always from the unmodified world; nothing is applied until stageMotion.
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

  /** Stage 3: put messages due this tick into inboxes. Phase 3. */
  private stageCommsDeliver(): void {}

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
   * Stages 2 and 4: build each alive fielder's view of the start-of-tick world and collect its
   * decision. Nothing is applied here. Fielders are visited in index order (rule 3), and
   * because every view is built from the same unmodified world, the order cannot affect the
   * outcome (rule 4).
   */
  private stageDecide(): void {
    const world = this.world;
    const strategy = this.strategy;
    for (let i = 0; i < world.fielderCount; i++) {
      if (world.fielderAlive[i] === 0) {
        this.decisions[i] = IDLE_DECISION;
        continue;
      }
      if (isOracle(strategy)) {
        this.decisions[i] = this.oracleDecision(i);
        continue;
      }
      const view = buildLocalView(world, this.config, i, this.memories[i], this.inboxes[i]);
      this.decisions[i] = strategy.decide(view);
    }
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

  /** Stage 5: enqueue outboxes with range, latency, loss and bandwidth. Phase 3. */
  private stageCommsSend(): void {}

  /**
   * Stage 6: steer each alive fielder towards its decision's target (or home when idle) with
   * acceleration and speed limits, then integrate with semi-implicit Euler. Fielders are
   * ground-bound: z stays 0. Separation/avoidance arrives in Phase 2.
   */
  private stageMotion(): void {
    const world = this.world;
    const dt = this.config.dt;
    const { maxSpeed, maxAccel } = this.config.fielders;
    const pos = world.fielderPos;
    const vel = world.fielderVel;
    const { sPos, sVel, sTarget, sAccel } = this;
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

      const o = 3 * i;
      let vx = sVel[0] + sAccel[0] * dt;
      let vy = sVel[1] + sAccel[1] * dt;
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
   * Stage 9: settle catches and drops. A descending ball at or below catch height is caught by
   * the nearest alive fielder within the catch radius (ties to the lowest id); a descending
   * ball at or below the ground that nobody caught is dropped.
   */
  private stageResolve(): void {
    const world = this.world;
    const { radius, height } = this.config.catch;
    this.grid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
    const buffer = this.queryBuffer;
    for (let b = 0; b < world.ballCount; b++) {
      if (world.ballState[b] !== BallState.FLYING) continue;
      const o = 3 * b;
      const z = world.ballPos[o + 2];
      const vz = world.ballVel[o + 2];
      if (vz >= 0 || z > height) continue;

      const x = world.ballPos[o];
      const y = world.ballPos[o + 1];
      const found = this.grid.query(x, y, radius, buffer);
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
        this.replanDue = true;
      } else if (z <= 0) {
        world.ballState[b] = BallState.DROPPED;
        this.events.append({ type: 'DROP', tick: world.tick, ballId: b });
        this.replanDue = true;
      }
    }
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
    return computeMetrics(this.world);
  }

  /** A fresh snapshot of the world. */
  snapshot(): WorldSnapshot {
    return createSnapshot(this.world, this.config, this.targetBall);
  }

  /** Hash of the complete world state, for determinism checks. */
  hash(): string {
    return hashWorld(this.world);
  }
}
