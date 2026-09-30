/**
 * The simulation: owns the world, the RNG, strategy memories, events and metrics, and advances
 * everything one fixed step at a time. `step()` runs the ten stages of CLAUDE.md section 7 in
 * exactly that order. Stages that later phases fill in are present as empty methods so the
 * order is fixed now.
 */
import type { AgentMemory, Decision } from './agents/types';
import type { Message } from './comms/types';
import type { SimCommand } from './commands';
import { DEFAULT_CONFIG, cloneConfig, setParam, type SimConfig } from './config';
import { hashWorld } from './hash';
import { EventLog } from './metrics/eventLog';
import { computeMetrics, type MetricsSummary } from './metrics/metrics';
import { buildLocalView } from './perception/localView';
import { Rng } from './rng';
import { createSnapshot, type WorldSnapshot } from './snapshot';
import { createWorld, type World } from './state';
import { getStrategy } from './strategies/index';
import { isOracle, type AnyStrategy } from './strategies/types';

/** The idle decision, shared because it is never mutated. */
const IDLE_DECISION: Readonly<Decision> = Object.freeze({
  target: null,
  targetBallId: null,
  outbox: [],
});

const EMPTY_INBOX: Message[] = [];

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
  /** Per-fielder inboxes for the current tick. Filled by the message bus from Phase 3. */
  private inboxes: Message[][] = [];

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
    const n = this.world.fielderCount;
    this.memories = new Array<AgentMemory>(n);
    this.decisions = new Array<Decision>(n);
    this.inboxes = new Array<Message[]>(n);
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

  /** Stage 1: spawn balls scheduled for this tick. Phase 1. */
  private stageLaunch(): void {}

  /** Stage 3: put messages due this tick into inboxes. Phase 3. */
  private stageCommsDeliver(): void {}

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
        // Phase 1: follow the target the oracle wrote into memory before this stage.
        this.decisions[i] = IDLE_DECISION;
        continue;
      }
      const view = buildLocalView(world, this.config, i, this.memories[i], this.inboxes[i]);
      this.decisions[i] = strategy.decide(view);
    }
  }

  /** Stage 5: enqueue outboxes with range, latency, loss and bandwidth. Phase 3. */
  private stageCommsSend(): void {}

  /**
   * Stage 6: steer towards each decision's target with avoidance, then integrate fielders.
   * Steering arrives in Phase 2; for now fielders simply integrate their (zero) velocity.
   */
  private stageMotion(): void {
    const world = this.world;
    const dt = this.config.dt;
    const pos = world.fielderPos;
    const vel = world.fielderVel;
    for (let i = 0; i < world.fielderCount; i++) {
      if (world.fielderAlive[i] === 0) continue;
      const o = 3 * i;
      const dx = vel[o] * dt;
      const dy = vel[o + 1] * dt;
      const dz = vel[o + 2] * dt;
      pos[o] += dx;
      pos[o + 1] += dy;
      pos[o + 2] += dz;
      world.fielderDistance[i] += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  /** Stage 7: fielder–fielder contacts. Phase 5. No-op while `collisions.mode` is `off`. */
  private stageCollisions(): void {}

  /** Stage 8: integrate balls. Phase 1. */
  private stageBallPhysics(): void {}

  /** Stage 9: settle catches, drops and separation violations. Phase 1 and 2. */
  private stageResolve(): void {}

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
    return createSnapshot(this.world);
  }

  /** Hash of the complete world state, for determinism checks. */
  hash(): string {
    return hashWorld(this.world);
  }
}
