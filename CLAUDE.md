# CLAUDE.md — Swarm Fielding

Guidance for Claude Code working in this repository. Read this file in full before making changes. `README.md` describes the project for humans; this file describes how to work on it.

---

## 1. What this project is

A browser-based simulation that demonstrates drone-swarm coordination principles through a fielding scenario. Many balls are launched on ballistic trajectories. A similar number of autonomous fielders must catch them. Each fielder senses, communicates with nearby fielders, decides and moves independently.

The central question the simulation answers is this: **how close can decentralised agents with imperfect sensing and communication get to the centralised optimal assignment, and how gracefully do they degrade when conditions worsen?**

The project serves two purposes from a single simulation core:

1. **An interactive visual demo.** It renders in 3D or 2D in the browser, with live controls.
2. **An experimental testbed.** It runs headless in Node for batch runs, parameter sweeps and strategy comparison.

---

## 2. Non-negotiable architecture rules

These rules protect the two goals above. Do not break them, even temporarily. If a task seems to require breaking one, stop and ask.

1. **`src/core/` is pure.**
   - Nothing in it may reference `window`, `document`, the DOM, canvas, three.js, Worker APIs, `fetch`, `Date.now()`, `performance.now()` or `Math.random()`.
   - It must run unchanged in Node and in a Web Worker.
   - ESLint `no-restricted-globals` and `no-restricted-imports` rules enforce this. Do not disable them.

2. **Autonomous agents see only their `LocalView`.**
   - Strategy code for fielders must never import, receive or close over the `World` or any global state.
   - The single exception is the centralised oracle (`strategies/centralised.ts`), which is explicitly a benchmark. It is flagged `isOracle: true`, and the UI and metrics label its results as oracle results.

3. **Determinism.** The same scenario plus the same seed must produce a bit-identical run.
   - Use `Rng` from `core/rng.ts` only.
   - Each subsystem draws from its own named stream: `rng.stream('launch')`, `'perception'`, `'comms'`, `'strategy'`. Enabling noise in one subsystem therefore never changes another's sequence.
   - Iterate agents and balls in index order.
   - Any sort must be stable with an explicit final tie-break by id.

4. **Synchronous decision semantics.**
   - Within a tick, every agent decides from the same snapshot: world state at the start of the tick, plus the messages delivered this tick.
   - Decisions are collected first and applied afterwards.
   - The order in which agents are processed must never affect the outcome.

5. **3D everywhere in the core.** Positions and velocities are always 3-vectors, even while fielders are ground-bound. Future flying drones depend on this.

6. **Renderers and UI are consumers.**
   - They read snapshots and events, and never mutate simulation state.
   - All UI influence goes through the command interface (`init`, `setParam`, `killAgent`, `pause`, `resume`, `step`, `reset`).

---

## 3. Conventions

- **Units.** Use SI throughout: metres, seconds, m/s, m/s². Angles are radians internally. Degrees appear only in config and UI fields whose names end in `_deg`.
- **Coordinates.**
  - The core uses a right-handed, **z-up** frame: ground plane at z = 0, x east, y north.
  - three.js is y-up. The conversion lives only in `src/render/three/coords.ts`: core `(x, y, z)` becomes three `(x, z, -y)`.
  - Never scatter axis swaps elsewhere.
- **Time.**
  - The simulation uses a fixed timestep `dt` (default 0.02 s, i.e. 50 Hz). `tick` is an integer, and `simTime = tick * dt`.
  - Rendering interpolates between snapshots. It never changes `dt`.
- **IDs.**
  - Fielders and balls use integer indices that stay stable for the lifetime of a run.
  - A killed fielder keeps its index with `alive = 0`.
- **TypeScript.**
  - Use `strict` mode, with no `any` in `src/core/`.
  - Use named exports only.
  - Every public type and function in the core gets a doc comment that states its units.
- **Spelling.** UI text and docs use British English ("centralised", "behaviour"). For identifiers, match what already exists.
- **Dependencies.** Do not add any npm dependency without asking first. Prefer small hand-written utilities.

---

## 4. Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Dev server / bundler | Vite |
| 3D rendering | three.js (npm, exact pinned version) |
| 2D rendering | Canvas 2D |
| UI | Vanilla TS with small DOM helpers. No framework; ask before introducing one. |
| Tests | Vitest |
| Node scripts | tsx |
| Lint / format | ESLint + Prettier |
| Optional distribution build | vite-plugin-singlefile, used only by `build:single`. It never affects how source is organised. |

---

## 5. Commands

```bash
npm install
npm run dev            # Vite dev server with the interactive UI
npm run build          # production build to dist/
npm run build:single   # OPTIONAL: bundle everything into one HTML file in dist-single/ for sharing
npm run typecheck
npm run lint
npm test               # vitest, run once
npm run test:watch
npm run bench          # performance benchmarks for core hot paths
npm run sim -- --scenario scenarios/baseline.json --seed 42      # headless single run, prints metrics
npm run batch -- --sweep scenarios/sweeps/comms-loss.json --out results/
```

**Definition of done for any task:** `typecheck`, `lint` and `test` all pass. For visual changes, also state the exact steps to verify the change in the browser.

---

## 6. Repository layout

The source is a **multi-file, modular codebase**. This is how the project is developed, tested and debugged. Any single-file output is only a build artefact (section 16).

- **Group by concern.** Each folder under `src/core/` owns one concern (physics, perception, comms, agents, strategies, metrics, scenario). Related functions live together in that folder.
- **One concept per file.** Split a file when it grows past roughly 300 lines or starts mixing concerns.
- **No barrel files.** Import from the specific file, not from a folder-level `index.ts`. This keeps dependency direction visible and makes the purity lint rules reliable. The one exception is `strategies/index.ts`, which is a registry, not a re-export.
- **Dependency direction.**
  - `render/` and `ui/` may import `core/` types.
  - `worker/` imports `core/`.
  - `core/` imports nothing outside itself.
  - Inside `core/`, strategies depend on `agents/` and `comms/` types, never on `sim.ts` or `state.ts`.
- **Tests mirror source.** `tests/core/physics/ballistics.test.ts` tests `src/core/physics/ballistics.ts`.
- **No manual bundling.** Never concatenate or inline source files by hand. Vite's dev server serves the modules directly during development.

```
swarm-fielding/
├── CLAUDE.md
├── README.md
├── package.json / tsconfig.json / vite.config.ts / vite.single.config.ts / eslint.config.js
├── scenarios/                  # JSON scenario files
│   ├── baseline.json
│   ├── dense-salvo.json
│   └── sweeps/                 # parameter sweep definitions
├── scripts/
│   ├── runSim.ts               # headless single run (npm run sim)
│   ├── runBatch.ts             # sweeps → results/*.csv|json
│   └── bench.ts
├── src/
│   ├── core/                   # PURE — see rule 1
│   │   ├── sim.ts              # Simulation class, step(), command handling
│   │   ├── commands.ts         # SimCommand union (init, setParam, killAgent, pause, …)
│   │   ├── config.ts           # SimConfig type + defaults + setParam
│   │   ├── rng.ts              # seeded PRNG with named streams
│   │   ├── vec3.ts             # allocation-free vector helpers on typed arrays
│   │   ├── state.ts            # SoA typed-array state for fielders and balls
│   │   ├── snapshot.ts         # WorldSnapshot (Float32 copies for renderers/worker/oracle)
│   │   ├── hash.ts             # deterministic state hash for determinism checks
│   │   ├── loop.ts             # FixedStepAccumulator: wall-clock time → whole ticks
│   │   ├── physics/
│   │   │   ├── ballistics.ts   # integration, analytic landing prediction
│   │   │   ├── launcher.ts     # launch schedules (salvo, staggered, random)
│   │   │   └── collisions.ts   # fielder–fielder contact detection and response (Phase 5)
│   │   ├── spatial/
│   │   │   └── hashGrid.ts     # uniform grid for neighbour/range queries
│   │   ├── perception/
│   │   │   ├── localView.ts    # builds LocalView from start-of-tick state
│   │   │   └── sensing.ts      # builds BallObservation[] with range + noise
│   │   ├── comms/
│   │   │   ├── messageBus.ts   # range, latency, loss, bandwidth
│   │   │   └── types.ts        # Message union
│   │   ├── agents/
│   │   │   ├── types.ts        # LocalView, Decision, AgentMemory
│   │   │   ├── kinematics.ts   # timeToReach(), feasibility, slack
│   │   │   ├── steering.ts     # target seeking with accel/speed limits
│   │   │   └── avoidance.ts    # separation (later: ORCA)
│   │   ├── strategies/
│   │   │   ├── index.ts        # registry
│   │   │   ├── types.ts        # Strategy, OracleStrategy
│   │   │   ├── idle.ts         # null strategy: idle policy, no messages (control)
│   │   │   ├── hungarian.ts    # rectangular assignment solver
│   │   │   ├── centralised.ts  # L0 oracle benchmark
│   │   │   ├── greedy.ts       # L1 no comms
│   │   │   ├── claims.ts       # L2 claim broadcast + conflict resolution
│   │   │   └── auction.ts      # L3 auction / CBBA (later phase)
│   │   ├── metrics/
│   │   │   ├── metrics.ts      # per-tick and summary metrics
│   │   │   └── eventLog.ts     # launch, claim, conflict, catch, drop, kill…
│   │   └── scenario/
│   │       ├── schema.ts       # hand-written validator with clear errors
│   │       └── loader.ts
│   ├── worker/
│   │   ├── simWorker.ts        # Web Worker entry: binds SimHost to self + a timer
│   │   ├── simHost.ts          # protocol handling + fixed-step pumping, testable in Node
│   │   └── protocol.ts         # command + frame message types
│   ├── render/
│   │   ├── types.ts            # Renderer interface
│   │   ├── interpolate.ts
│   │   ├── topdown2d/          # Canvas 2D renderer
│   │   └── three/
│   │       ├── scene3d.ts
│   │       ├── instancing.ts   # InstancedMesh management
│   │       ├── cameraRig.ts    # presets (top-down, stadium, follow); wraps OrbitControls
│   │       ├── overlays.ts     # arcs, landing rings, claim lines, comms links
│   │       └── coords.ts       # the ONLY core→three axis conversion
│   ├── ui/
│   │   ├── dom.ts              # tiny element helpers
│   │   ├── controls.ts         # strategy dropdown, sliders, buttons
│   │   ├── inspector.ts        # selected fielder: local view, claims, inbox
│   │   └── metricsPanel.ts
│   └── main.ts
├── tests/                      # mirrors src/core structure
└── results/                    # gitignored batch outputs
```

---

## 7. Simulation loop (order within one tick)

`Simulation.step()` executes these steps in exactly this order. Changing the order is an interface change (see section 13).

1. **Launch.** Spawn any balls scheduled for this tick (`rng.stream('launch')`).
2. **Perception.** Build a `LocalView` for each alive fielder from start-of-tick state, including sensing range and observation noise.
3. **Comms delivery.** Put into each inbox the messages whose delivery tick is now.
4. **Decide.** Call `strategy.decide(view)` for every alive fielder and collect every `Decision`. Nothing is applied yet.
5. **Comms send.** Enqueue each outbox, applying range at send time, latency, loss and the bandwidth cap.
6. **Motion.** Apply steering towards each decision's target plus avoidance, subject to `maxAccel` and `maxSpeed`, and integrate fielder state.
7. **Collisions.** Detect fielder–fielder contacts and apply the configured response (section 9, *Collisions*). This step is a no-op when `collisions.mode` is `off`, which is the default until Phase 5.
8. **Ball physics.** Integrate balls: analytic without drag, semi-implicit Euler or RK4 with drag.
9. **Resolve.** Settle catches, drops and separation violations.
   - A ball is **caught** when an alive fielder is within `catchRadius` of it horizontally while the ball is descending with `z <= catchHeight`.
   - If several fielders qualify, the nearest wins, with ties going to the lowest id.
   - A ball is **dropped** when `z <= 0` without having been caught.
10. **Metrics and events.** Update metrics and append events. Emit a snapshot when requested.

The centralised oracle runs its `assign()` before step 4, when a replan is due, and writes targets into each fielder's memory. Its fielders then follow those targets in `decide()`.

---

## 8. Core types (reference shape)

Keep these stable. Changing them affects every strategy.

```ts
/** Everything a fielder may know. Built fresh each tick by perception. */
export interface LocalView {
  tick: number;
  time: number;                       // s
  self: {
    id: number;
    position: Vec3; velocity: Vec3;   // m, m/s
    maxSpeed: number; maxAccel: number;
    stunnedUntil: number | null;      // sim time, s; null if not stunned (Phase 5)
  };
  bumps: BumpObservation[];           // own collisions during the last tick (Phase 5)
  balls: BallObservation[];           // only balls within sensing range
  neighbours: { id: number; position: Vec3 }[];   // within comms range
  inbox: Message[];
  memory: AgentMemory;                // persistent per-agent strategy state
  params: Readonly<StrategyParams>;
}

export interface BallObservation {
  id: number;
  position: Vec3; velocity: Vec3;     // possibly noisy
  predictedLanding: Vec3;             // at catchHeight on descent
  predictedArrivalTime: number;       // absolute sim time, s
  uncertainty: number;                // 1-sigma landing error, m
}

/** A collision this fielder felt. Its only knowledge of the contact. */
export interface BumpObservation {
  otherId: number;
  normal: Vec3;                       // unit vector, from other towards self
  impactSpeed: number;                // m/s, relative speed along the normal
}

export type Message = { from: number; sentTick: number } & (
  | { type: 'CLAIM'; ballId: number; eta: number }
  | { type: 'RELEASE'; ballId: number }
  | { type: 'CAUGHT'; ballId: number }
  | { type: 'HEARTBEAT' }
  | { type: 'BID'; ballId: number; score: number; round: number }   // L3
);

export interface Decision {
  target: Vec3 | null;                // null → idle policy
  targetBallId: number | null;
  outbox: Array<Omit<Message, 'from' | 'sentTick'>>;
}

export interface Strategy {
  readonly name: string;
  readonly isOracle?: false;
  initMemory(selfId: number): AgentMemory;
  decide(view: LocalView): Decision;  // must be a pure function of view
}

export interface OracleStrategy {
  readonly name: string;
  readonly isOracle: true;
  assign(world: Readonly<WorldSnapshot>): Int32Array; // fielder → ballId or -1
}
```

Strategies must not hold per-agent state in module scope or closures. Everything persistent lives in `view.memory`.

---

## 9. Key algorithms and rules

### Reachability (shared by all strategies)

`agents/kinematics.ts` exports `timeToReach(pos, vel, target, maxSpeed, maxAccel)`, which uses an accel-limited profile starting from the current velocity: velocity across the approach line is cancelled first (the fielder drifts while that happens), then the fielder cancels any velocity away from the target, accelerates, cruises and brakes to rest. `agents/steering.ts` executes exactly that policy, so the estimate and the motion agree; keep the two consistent when changing either. Two derived quantities build on it:

- `slack = predictedArrivalTime - (now + timeToReach)`
- a ball is **feasible** for a fielder when `slack >= feasibilityMargin`

Every strategy must use this same function so comparisons between strategies are fair.

### L0 — Centralised oracle

- Solves a rectangular assignment problem (`hungarian.ts`). The cost is `timeToReach`; infeasible pairs cost `INFEASIBLE` (a large constant).
- Replans on launch and catch events and every `replanInterval` ticks.
- Has global perfect knowledge and sends no messages. It is the benchmark: always report other strategies' catch rates relative to it on the same seed.

### L1 — Greedy

- Each fielder picks the feasible observed ball with the lowest `timeToReach`. It sends no messages.
- Hysteresis applies: switch target only if the improvement exceeds `switchMargin` seconds.
- This strategy exists to show clumping and conflict. Do not "fix" it.

### L2 — Claims

- Each fielder maintains a claims table in memory: `ballId → { holder, eta, lastHeardTick }`.
- It broadcasts `CLAIM` when it adopts a target, when its eta changes by more than `etaEpsilon`, and every `heartbeatInterval` ticks.
- **Conflict rule:** claim A beats claim B if `A.eta < B.eta - claimMargin`; otherwise the lower id wins. This rule must be deterministic and identical at every agent.
- A fielder that loses a conflict marks the ball as taken and re-plans among unclaimed or beatable balls.
- Claims expire after `claimTtl` ticks without a refresh. This handles lost messages and dead fielders.
- On catch, the fielder broadcasts `CAUGHT`. On abandoning a target, it broadcasts `RELEASE`.
- Hysteresis (`switchMargin`) prevents target thrashing.

### L3 — Auction / CBBA (later phase)

- Fielders exchange bids with neighbours and converge to a conflict-free assignment through consensus.
- Implement from the published CBBA description.
- Document any simplifications at the top of `auction.ts`.

### Idle policy

- Fielders without a target return to a home position (initial layout).
- **Later:** a coverage behaviour, such as a centroidal-Voronoi step using neighbour positions only.

### Avoidance

- The first version uses a separation force within `separationRadius`: a spring `maxAccel * (1 - d / separationRadius)` plus damping on closing speed, with the coefficient derived for critical damping. Without the damping, fielders sharing a home oscillate indefinitely.
- Separation has priority over steering: the component of steering that pushes into a neighbour is discarded before the two are summed and clamped to `maxAccel`.
- All accelerations are computed from start-of-tick state before any fielder moves, so motion is independent of index order.
- A pair closer than `minSeparation` is flagged in the snapshot every tick and logged as a `NEAR_MISS` event once per episode, when it first enters.
- **Later:** ORCA / velocity obstacles.

### Collisions (Phase 5)

Avoidance is *behaviour*: fielders try not to collide. Collisions are *physics*: what happens when they do. Keep the two in separate modules. Avoidance lives in `agents/avoidance.ts`, and collisions live in `physics/collisions.ts`.

- **Bodies.** Each fielder is a sphere of radius `bodyRadius`. While fielders are ground-bound, this acts as a circle in the ground plane. The same code serves airborne drones later.
- **Detection.**
  - The broad phase uses `spatial/hashGrid.ts`. The narrow phase is a sphere-overlap test.
  - Only alive fielders collide. Crashed fielders are removed from the field and are not obstacles.
  - Discrete detection is sufficient at current speeds. Swept (continuous) detection is a Phase 8 upgrade.
- **Response in the first version.**
  - There is no mass. Overlapping pairs are pushed apart equally along the contact normal.
  - The normal component of relative velocity is reflected, scaled by `restitution`.
  - The solver runs `collisionIterations` relaxation passes (default 4) to settle clumps.
  - Pairs are processed in a fixed order (i < j, sorted by i then j) so results are deterministic.
  - Momentum-based impulses with per-fielder mass are a Phase 7 upgrade. Keep the response function swappable.
- **Consequence modes** (`collisions.mode`):

| Mode | Effect |
|---|---|
| `off` | No collision physics. Near-misses are still logged. |
| `bounce` | Physical response only. |
| `penalty` | Bounce, and both fielders are stunned for `stunDuration`. |
| `destructive` | Both fielders crash: `alive = 0`, and a `CRASH` event is logged. |
| `graded` | Consequence depends on impact speed: bounce below `stunSpeed`, penalty from `stunSpeed` to `crashSpeed`, destructive at or above `crashSpeed`. |

- **Stun.** A stunned fielder cannot move or catch until `stunnedUntil`, but it still perceives, receives and sends messages. Strategies see the stun in `LocalView.self.stunnedUntil` and decide for themselves whether to release their claim, for example when the stun exceeds their slack. The simulation never releases claims on an agent's behalf.
- **Carrying.** Balls are removed at the moment of catch, so there is nothing to drop. If a later phase adds carried balls, a penalty collision will drop them.
- **Autonomy.** A fielder learns of its own collisions only through `LocalView.bumps`, never by reading global state.
- **Events and metrics.**
  - Events: `COLLISION` (ids, impact speed, mode outcome), `STUN`, `CRASH`.
  - Metrics: collisions per minute, mean and maximum impact speed, fielder-seconds lost to stun, fielders lost to crashes, and catches plausibly lost (a claimed ball dropped while its holder was stunned or crashed).

| Parameter | Default | Meaning |
|---|---|---|
| `collisions.mode` | `off` | `off` \| `bounce` \| `penalty` \| `destructive` \| `graded` |
| `bodyRadius` | 0.4 m | Fielder body radius |
| `restitution` | 0.3 | 0 = dead stop along the normal, 1 = fully elastic |
| `collisionIterations` | 4 | Relaxation passes per tick |
| `stunDuration` | 1.5 s | Duration of a penalty stun |
| `stunSpeed` | 1.5 m/s | `graded`: minimum impact speed for a stun |
| `crashSpeed` | 4.0 m/s | `graded`: minimum impact speed for a crash |

---

## 10. Communication model

| Parameter | Default | Meaning |
|---|---|---|
| `commsRange` | 30 m | Broadcast reaches alive fielders within range **at send time** |
| `latency` | 0.1 s | Converted to whole ticks, rounded up |
| `lossProb` | 0 | Independent per-recipient drop, from `rng.stream('comms')` |
| `bandwidth` | 8 | Max messages sent per agent per tick; excess dropped, newest first |

- Messages are broadcast only; there is no addressing in the first version.
- Count every sent, delivered and dropped message, with the drop reason.
- **Later:** multi-hop relay, jamming zones, directional links, and per-message size budgets.

---

## 11. Performance guidelines

- **State layout.** World state lives in struct-of-arrays typed arrays (`Float64Array` in the core, `Float32Array` in snapshots).
- **Allocation.** Do not allocate in per-tick hot paths for world state. `LocalView` construction may allocate for now; pool it only if `npm run bench` shows it matters. Do not optimise prematurely.
- **Range queries.** All neighbour and range queries use `spatial/hashGrid.ts`. No O(n²) loops over agents outside tests.
- **Collisions.** Use the same hash grid. Relaxation passes are capped by `collisionIterations`, so cost stays bounded even when strategies cause dense clumps. Include a crowded-clump case in `npm run bench`.
- **Targets:**
  - 500 fielders and 500 balls at 50 Hz in real time inside the Worker on a laptop;
  - headless runs of 100 v 100 at 20× real time or better.
- **Worker protocol.**
  - Main → worker: commands.
  - Worker → main: snapshots at render rate, using transferable `Float32Array` buffers, plus the events since the last snapshot.
  - Never post the whole world object.

---

## 12. Rendering and UI

- Two renderers implement the same `Renderer` interface:
  - `TopDown2D` (Canvas 2D), which is the clearest view for explaining allocation;
  - `Scene3D` (three.js).
- Fielders and balls use `InstancedMesh`: one draw call per entity type.
- **Camera presets:**
  - top-down;
  - stadium (low oblique);
  - follow (tracks the selected fielder).
- Camera interaction uses three.js's own `OrbitControls` (imported from `three/examples/jsm/controls/OrbitControls.js` via npm), wrapped by `cameraRig.ts`. Other three.js addons are fine too, because Vite bundles them.
- **Overlays**, each toggleable:
  - ball arcs;
  - predicted landing rings, with radius scaled by uncertainty;
  - claim lines from fielder to ball;
  - comms links (cap the number drawn to avoid clutter);
  - near-miss highlights;
  - collision flashes at contact points, dimmed stunned fielders (with a countdown ring), and fading markers where fielders crashed.
- **Collision controls.** The UI has a collision mode selector and sliders for the collision parameters.
- **Inspector.** Clicking a fielder shows its `LocalView`, claims table and recent inbox.
- **Themes.** Support light and dark themes through CSS custom properties.
- **Layout.** The UI must stay usable on a narrow phone screen: collapsible control panel, touch camera controls.

---

## 13. How to work in this repo

- Before any multi-file change, give a short plan that names the modules and interfaces affected.
- **Ask before** changing `LocalView`, `Message`, `Decision`, `Strategy`, the tick order in section 7, or the worker protocol. These are the project's contracts.
- **Adding a strategy:**
  1. Create a new file in `strategies/` and register it in `index.ts`.
  2. Add unit tests plus a baseline-scenario test.
  3. Add it to the UI dropdown.
  4. Add a row to the README strategy table.
- **Adding a parameter:** give it a default in `config.ts`, validate it in `scenario/schema.ts`, add a UI control if it is user-facing, and document it (sections 9–10 here, plus the README).
- Never tune strategy constants just to make a test pass. If behaviour changed, explain why.
- For performance work, run `npm run bench` before and after, and report both numbers.
- Keep commits focused and use conventional commit messages (`feat(core): …`, `fix(render): …`).
- When a development phase is complete, tick it in section 15 and in the README roadmap.

---

## 14. Testing expectations

- **Determinism.** The same scenario and seed produce an identical final-state hash across two runs, and across Node and the Worker path.
- **Ballistics.** Integrated trajectories match the analytic solution (no drag) within tolerance, and landing prediction matches the simulated landing.
- **Kinematics.** `timeToReach` agrees with a brute-force numerical simulation, and never underestimates by more than the tolerance.
- **Hungarian.** The solver matches brute-force optimal cost on random matrices up to 7×7, including rectangular and infeasible cases.
- **Comms.**
  - Range is respected.
  - Latency is exact in ticks.
  - The observed loss rate matches `lossProb` statistically for a fixed seed.
  - The bandwidth cap is enforced.
- **Claims.**
  - Under ideal comms, once converged, no ball has two holders.
  - A dead fielder's claims expire after `claimTtl`.
  - The outcome is independent of agent processing order.
- **Isolation.** A lint rule or test ensures that non-oracle strategy modules do not import `sim.ts`, `state.ts` or `World`.
- **Collisions.**
  - Two fielders moving head-on separate with the expected velocities for a given restitution.
  - After relaxation, no pair overlaps by more than a tolerance, including a dense clump of 50 fielders.
  - Results are independent of fielder index order.
  - `graded` thresholds map impact speeds to the correct outcome.
  - Stunned fielders neither move nor catch, and crashed fielders are removed.
  - A strategy module sees its collisions only through `LocalView.bumps`.
- **Regression.** Golden summary metrics for the baseline scenarios must match within tolerance. Update the goldens only deliberately, with the reason stated in the commit.

---

## 15. Development phases

Work on the current phase unless asked otherwise. The detailed goals for each phase are in `README.md`.

- [x] **Phase 0 — Scaffolding.** Toolchain, core types, RNG, vec3, fixed-step loop, determinism test, lint purity rules.
- [x] **Phase 1 — World and oracle.** Ballistics, launcher, the 2D renderer, the Worker, the centralised Hungarian oracle. (Also pulled forward: `timeToReach`, arrive steering, the hash grid, the scenario validator and the metrics panel, because the oracle's fielders need them.)
- [x] **Phase 2 — Autonomous agents.** Perception, `LocalView`, greedy strategy, separation, near-misses, live gap to the oracle (a shadow oracle run on the same seed in the Worker and in `npm run sim`).
- [ ] **Phase 3 — Communication and claims.** Message bus, claims protocol, comms sliders, the kill-fielders command, the inspector.
- [ ] **Phase 4 — 3D view.** three.js scene, instancing, camera rig and presets, overlays, 2D/3D toggle.
- [ ] **Phase 5 — Collisions.** Collision detection, simple push-apart response, configurable consequence modes (bounce, penalty, destructive, graded), bumps in `LocalView`, collision metrics, rendering and controls.
- [ ] **Phase 6 — Experiment harness.** Headless sim and batch scripts, sweeps, CSV/JSON export, comparison report.
- [ ] **Phase 7 — Advanced coordination and realism.** Auction/CBBA, noisy perception with a Kalman filter, drag and wind, multi-hop relay, heterogeneous fielders, coverage idle policy, ORCA, momentum-based collisions with mass.
- [ ] **Phase 8 — Drones.** Airborne fielders, quadrotor-like dynamics, mid-air intercept, swept collision detection, energy/endurance limits.

**Current phase:** Phase 3.

---

## 16. Build outputs

Development and testing always use the multi-file source (section 6). Builds are generated artefacts: never edit them, and never commit `dist/` or `dist-single/`.

- **`npm run dev`** is the normal way to work. Vite serves the individual modules with hot reload. The Worker is loaded as a separate module (`new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' })`).
- **`npm run build`** produces the standard multi-file production build in `dist/`, suitable for hosting as a static site.
- **`npm run build:single`** is **optional**, for sharing the demo as one HTML file (for example as an email attachment or a hosted page link). It bundles and inlines everything, including the Worker, so the file needs no network access at runtime.
  - It is a convenience output only. Do not change source structure, imports or dependencies to suit it.
  - If a change breaks it, say so rather than restructuring code to fix it. Fixing it is a low-priority task unless asked.
  - Do not add runtime CDN imports or fetches in any case. All dependencies come from npm and are bundled.

---

## 17. Glossary

- **Fielder:** an autonomous agent (a stand-in for a drone).
- **Landing point:** the predicted position where a ball descends through `catchHeight`.
- **ETA:** a fielder's `timeToReach` to a landing point.
- **Slack:** the ball's arrival time minus the fielder's arrival time. Negative slack means the ball is infeasible for that fielder.
- **Claim:** a broadcast statement that a fielder intends to catch a ball.
- **Holder:** the fielder whose claim on a ball currently wins, as seen by a given agent.
- **Oracle:** the centralised benchmark strategy with global knowledge.
- **Collision:** physical contact between two fielder bodies (as distinct from a near-miss, which is a separation violation without contact).
- **Stun:** a penalty state in which a fielder cannot move or catch.
- **Tick:** one fixed simulation step of length `dt`.
- **Snapshot:** the compact state copy sent from the Worker to the renderer.
