# Swarm Fielding

**A browser-based simulation of drone-swarm coordination, in which autonomous fielders work out among themselves how to catch a sky full of balls.**

Balls are launched on predictable ballistic trajectories. An equally large team of fielders must be in the right place at the right time to catch them. There is no controller telling each fielder where to go. Each one senses nearby balls, talks to nearby teammates, decides for itself, and moves. The simulation shows how local rules and limited communication can produce coordinated, efficient, robust group behaviour. It also shows where that approach breaks down.

---

## Why a fielding scenario?

Catching balls is an intuitive stand-in for a whole class of real swarm problems: drones intercepting targets, delivery robots dividing up parcels, search teams dividing up an area. All of them share the same core challenge, **decentralised dynamic task allocation**:

- There are many tasks (balls) and many agents (fielders), and tasks appear over time.
- Each task has a deadline (the moment the ball lands) and a location.
- Agents have limited speed, limited sensing and imperfect communication.
- If agents do not coordinate, several chase the same task while others go unserved.

The simulation makes these principles visible:

| Principle | How you see it |
|---|---|
| Local sensing | Fielders react only to balls within their sensing range. |
| Decentralised decision-making | Every fielder runs its own decision loop, and there is no global planner. The oracle benchmark is the only exception. |
| Conflict resolution | Watch fielders converge on a ball and then peel away once claims are exchanged. |
| Limited communication | Sliders for comms range, latency and packet loss show how coordination depends on information flow. |
| Graceful degradation | Catch rate falls smoothly, not catastrophically, as comms worsen. |
| Robustness | Kill fielders mid-run; the swarm reallocates without any central repair. |
| Physical consequences | With collisions switched on, poor deconfliction has a cost: fielders bounce off each other, are stunned or crash. |
| Emergence | Zonal coverage and orderly hand-offs arise from simple local rules. |

---

## The scenario

- **Balls** are launched from one or more launch zones, in salvos or staggered over time. Each follows a ballistic arc: gravity only at first, with drag and wind added later.
- **Fielders** start in a formation on the field. Each has a maximum speed and maximum acceleration.
- **Catching.** A ball is caught if a fielder is within the catch radius as the ball descends through catch height. A ball that hits the ground uncaught is dropped.
- **Deciding.** Each fielder estimates, for each ball it can see, whether it could get to the landing point in time. It then decides which ball to go for, taking into account what it hears from its neighbours.

---

## Coordination strategies

The simulation includes a ladder of strategies. Each rung shows why the next one is needed, and all of them can be switched live in the UI.

| Level | Strategy | Comms | What it shows |
|---|---|---|---|
| L0 | **Centralised oracle** | n/a (global knowledge) | The optimal assignment (Hungarian algorithm). Not a swarm, but it is the yardstick every other strategy is measured against. |
| L1 | **Greedy** | None | Each fielder chases its best ball alone. Expect clumping, collisions and abandoned balls. This is the failure mode that motivates coordination. |
| L2 | **Claims** | Local broadcast | Fielders announce "I'm taking ball N, ETA t". Conflicts resolve by a shared deterministic rule, and losers re-plan. This simple scheme recovers most of the lost performance. |
| L3 | **Auction / CBBA** | Local, iterative | Consensus-based bidding. It handles cases greedy claiming gets wrong, such as when two fielders should swap targets. |

Planned additions include a coverage-seeking idle behaviour, multi-hop information relay and heterogeneous fielders.

---

## Communication model

Every message passes through a single message bus with tunable characteristics:

| Parameter | Effect |
|---|---|
| **Range** | Only fielders within range hear a broadcast. |
| **Latency** | Messages arrive a fixed delay after sending. |
| **Packet loss** | Each delivery can independently fail. |
| **Bandwidth** | Caps the number of messages a fielder can send per tick. |

Because every message is counted, the metrics show the cost of coordination as well as its benefit.

---

## Metrics

- **Catch rate**, overall and relative to the oracle on the identical launch sequence.
- **Messages** sent, delivered and dropped.
- **Total and per-fielder distance travelled**, as a proxy for energy.
- **Near-misses**: fielders closer than the minimum separation.
- **Collisions** (when enabled): collisions per minute, impact speeds, fielder-seconds lost to stuns, fielders lost to crashes, and catches lost as a result.
- **Claim conflicts and reassignments**, as a measure of churn.
- **Time to convergence** after a disruption, such as a fielder being killed.

All metrics are shown live in the UI and exported as JSON or CSV from headless runs.

---

## Architecture

```
                ┌──────────────────────── Web Worker / Node ─────────────────────────┐
                │                                                                    │
  commands ───▶ │   Simulation core (pure TypeScript — no DOM, no randomness leaks)  │
 (UI / scripts) │                                                                    │
                │   launch → perceive → deliver msgs → decide → send msgs            │
                │          → move → ball physics → resolve catches → metrics         │
                │                                                                    │
                │   ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────────┐  │
                │   │ physics  │ │ perception │ │ comms bus │ │ strategies (L0–L3)│  │
                │   └──────────┘ └────────────┘ └───────────┘ └───────────────────┘  │
                └───────────────────────────────┬────────────────────────────────────┘
                                                │ snapshots + events
                           ┌────────────────────┴───────────────────┐
                           ▼                                        ▼
                ┌──────────────────────┐                ┌──────────────────────┐
                │ Browser renderers    │                │ Headless scripts     │
                │  • 3D (three.js)     │                │  • single runs       │
                │  • 2D top-down       │                │  • parameter sweeps  │
                │  • controls, metrics │                │  • CSV/JSON results  │
                └──────────────────────┘                └──────────────────────┘
```

### Key design decisions

- **Pure, deterministic core.** The simulation engine knows nothing about browsers or graphics. That means:
  - the same code powers the live demo and headless experiments;
  - a seeded random number generator makes every run exactly reproducible, so strategies can be compared on identical conditions.
- **Genuine autonomy.** A fielder's decision function receives only its own local view: what it can sense, what it has heard, and its own memory. It has no access to global state. Only the oracle benchmark is allowed to see everything, and it is labelled as such.
- **Synchronous ticks.** All fielders decide from the same snapshot, so the order in which agents are processed can never bias the outcome.
- **3D from day one.** Positions are 3D vectors even while fielders run on the ground. The step to airborne drones therefore changes the motion model and catch rule, not the engine.
- **Modular, multi-file source.** Code is organised as many small TypeScript modules grouped by concern, and each can be developed and tested in isolation. See *Source layout* below.
- **Pluggable modules.** Strategies, the comms model, motion and avoidance, and renderers can each be replaced independently.
- **Scales up.** State is held in typed arrays, spatial hashing handles range queries, instanced rendering draws the entities, and the simulation runs in a Web Worker so the UI stays smooth. The target is 500 v 500 in real time.

---

### Source layout

The project is developed as a conventional multi-file codebase. Related functions are grouped into folders by concern:

| Folder | Responsibility |
|---|---|
| `src/core/physics/` | Ball flight, launch patterns, fielder–fielder collisions |
| `src/core/perception/` | What each fielder can sense, including noise |
| `src/core/comms/` | Message types and the message bus |
| `src/core/agents/` | Local view, reachability/ETA, steering, collision avoidance |
| `src/core/strategies/` | Coordination strategies (oracle, greedy, claims, auction) |
| `src/core/metrics/` | Metrics and event log |
| `src/core/scenario/` | Scenario schema and loading |
| `src/worker/` | Hosts the simulation in a Web Worker |
| `src/render/` | 2D and 3D renderers, camera, overlays |
| `src/ui/` | Controls, inspector, metrics panel |
| `scripts/` | Headless runs, batch sweeps, benchmarks |
| `tests/` | Unit and regression tests, mirroring `src/` |

Each file holds one concept, and tests sit in a matching path under `tests/`. The full tree and module rules are in `CLAUDE.md`.

## Visualisation

- **3D view** (three.js) with interactive orbit, pan and zoom by mouse or touch.
- **Camera presets:**
  - top-down, for reading the allocation logic;
  - stadium, a low angle for dramatic arcs;
  - follow, which rides along with a selected fielder.
- **2D top-down view**, often clearer for explaining why a conflict resolved the way it did.
- **Toggleable overlays:**
  - ball flight arcs;
  - predicted landing rings that tighten as estimates improve;
  - claim lines from each fielder to its target;
  - live comms links;
  - near-miss highlights;
  - collision flashes, stunned fielders and crash sites.
- **Inspector.** Click any fielder to see its local view, its claims table and its recent messages.
- **Live controls:**
  - a strategy selector;
  - sliders for fielder speed, comms range, latency, packet loss, and launch rate and pattern;
  - a collision mode selector;
  - a "kill fielders" button;
  - pause, step, reset, and seed selection.

---

## Getting started

Requires Node 20 or later.

```bash
npm install
npm run dev            # open the interactive simulation
npm test               # run the test suite
npm run sim -- --scenario scenarios/baseline.json --seed 42
npm run batch -- --sweep scenarios/sweeps/comms-loss.json --out results/
npm run build          # multi-file production build in dist/
npm run build:single   # optional: one self-contained HTML file for sharing
```

### Scenario files

Scenarios are JSON files in `scenarios/`. For example:

```json
{
  "name": "baseline",
  "seed": 42,
  "dt": 0.02,
  "duration": 60,
  "field": { "width": 120, "length": 120 },
  "fielders": { "count": 100, "layout": "grid", "maxSpeed": 7, "maxAccel": 4 },
  "launch": {
    "pattern": "staggered",
    "count": 100,
    "ratePerSecond": 3,
    "zones": [{ "x": 0, "y": -70, "radius": 5 }],
    "speed": { "min": 18, "max": 28 },
    "elevation_deg": { "min": 35, "max": 65 },
    "azimuthSpread_deg": 50
  },
  "catch": { "radius": 1.0, "height": 1.5 },
  "collisions": { "mode": "graded", "bodyRadius": 0.4, "restitution": 0.3,
                  "stunDuration": 1.5, "stunSpeed": 1.5, "crashSpeed": 4.0 },
  "sensing": { "range": 60, "noise": 0 },
  "comms": { "range": 30, "latency": 0.1, "lossProb": 0, "bandwidth": 8 },
  "strategy": { "name": "claims", "claimMargin": 0.15, "claimTtl": 50, "switchMargin": 0.3 }
}
```

Sweep files vary one or more parameters across ranges and seeds, then write a results table for comparison.

---

## Development pathway

Development proceeds in phases. Each phase ends with something that runs and can be demonstrated.

### Phase 0 — Scaffolding
Set up the toolchain (TypeScript, Vite, Vitest, ESLint), the core types, the seeded RNG, vector utilities and the fixed-timestep loop. Add lint rules that keep the core pure, and a determinism test.
*Done when:* an empty simulation steps deterministically in both Node and the browser.

### Phase 1 — World and benchmark
Implement ballistic physics and the launch patterns. Run the simulation in a Web Worker and add the 2D top-down renderer. Implement the centralised Hungarian oracle.
*Done when:* balls fly, the oracle's fielders catch them, and the catch rate is displayed.

### Phase 2 — Autonomous fielders
Add perception with sensing range and the local-view interface. Implement the shared reachability and ETA calculation, steering and separation, the greedy strategy, and the metrics panel.
*Done when:* greedy fielders visibly clump and miss balls, and the gap to the oracle is measured.

### Phase 3 — Communication and claims
Build the message bus with range, latency, loss and bandwidth. Implement the claims protocol with conflict resolution, claim expiry and hysteresis. Add the comms sliders, the kill-fielders command and the fielder inspector.
*Done when:* claims recover most of the gap to the oracle, and degradation under worsening comms is visible live.

### Phase 4 — 3D visualisation
Build the three.js scene with instanced fielders and balls, plus orbit/touch camera controls and the presets. Add the overlays (arcs, landing rings, claim lines, comms links) and the 2D/3D toggle.
*Done when:* the full demo runs smoothly in 3D on a laptop and is usable on a phone.

### Phase 5 — Collisions
Model physical contact between fielders, kept separate from avoidance (which is behaviour: trying *not* to collide).

- **Bodies and detection.** Fielders get spherical bodies. Detection reuses the spatial hash grid, so cost stays roughly linear in swarm size, with capped relaxation passes to handle dense clumps.
- **Response.** The first version is simple: overlapping fielders are pushed apart and their approach velocity is reflected with a restitution factor. There is no mass yet.
- **Consequence modes** (configurable and switchable live):
  - `off`;
  - `bounce`, physical response only;
  - `penalty`, which bounces and stuns both fielders briefly, so they can't move or catch;
  - `destructive`, where both fielders crash and are removed;
  - `graded`, where the outcome depends on impact speed: bounce, stun or crash.
- **Autonomy preserved.** A fielder learns of its own collisions only through a "bump" in its local view. It decides for itself whether to give up its claim.
- **Visuals and metrics.** Collision flashes, stunned and crashed fielder rendering, and the collision metrics.

*Done when:* greedy fielders visibly collide and suffer for it, coordinated strategies measurably avoid that cost, and all modes are deterministic and tested.

### Phase 6 — Experiment harness
Add headless single runs and batch parameter sweeps across seeds, with CSV and JSON export and a summary comparison report.
*Done when:* one command produces a catch-rate-versus-packet-loss curve for every strategy.

### Phase 7 — Advanced coordination and realism
- The auction/CBBA strategy.
- Noisy perception with Kalman-filtered landing prediction.
- Drag and wind.
- Multi-hop message relay.
- Heterogeneous fielders (speed and sensing).
- A coverage-seeking idle behaviour.
- ORCA collision avoidance.
- Momentum-based collision response with per-fielder mass.

*Done when:* each addition has tests, a scenario, and a documented effect on metrics.

### Phase 8 — Toward real drones
- Airborne fielders with quadrotor-like dynamics.
- Mid-air intercept rather than ground catches.
- Energy and endurance limits.
- Terrain or no-fly zones.
- Swept (continuous) collision detection for fast airborne agents.

*Done when:* the same strategies run unmodified on flying agents, and differences are measured.

### Roadmap status

- [x] Phase 0 — Scaffolding
- [x] Phase 1 — World and benchmark
- [x] Phase 2 — Autonomous fielders
- [ ] Phase 3 — Communication and claims
- [ ] Phase 4 — 3D visualisation
- [ ] Phase 5 — Collisions
- [ ] Phase 6 — Experiment harness
- [ ] Phase 7 — Advanced coordination and realism
- [ ] Phase 8 — Toward real drones

---

## Experiment ideas

- **Comms cliff.** At what packet-loss rate does the claims strategy fall to greedy performance? Does auction/CBBA hold up better?
- **Range versus density.** How does the comms range needed for good coordination scale with fielder density?
- **Attrition.** Kill 10%, 25% or 50% of fielders mid-run. How fast does the catch rate recover, and how close does it get to the oracle on the reduced team?
- **Overload.** What happens when balls outnumber fielders? Which strategy triages best?
- **Salvo versus stream.** Compare simultaneous launches (a static assignment problem) with staggered ones (continuous reallocation).
- **Price of coordination.** Plot messages sent against catch rate gained for each strategy.
- **Cost of crashes.** Under destructive or graded collisions, which strategy loses the fewest fielders? Does stronger avoidance trade catches for safety?
- **Uncertainty.** With noisy landing predictions, is it better to commit early or wait for estimates to firm up?

---

## Working with Claude Code

`CLAUDE.md` contains detailed guidance for Claude Code: architecture rules, core interfaces, tick order, algorithms, testing expectations and the current phase. Keep it up to date as the design evolves. It is the contract that keeps the core pure, deterministic and genuinely decentralised as the project grows.

---

## Publishing

Development and testing always use the multi-file source with the Vite dev server (`npm run dev`). Builds are generated outputs and are never edited by hand:

- **`npm run build`** produces a standard multi-file static site in `dist/`, ready to host anywhere.
- **`npm run build:single`** (optional) bundles everything into one self-contained HTML file with no runtime network requests. It's handy for emailing the demo or sharing it as a single page link. It is purely a packaging convenience and does not constrain how the source is organised.

## Licence

To be decided.
