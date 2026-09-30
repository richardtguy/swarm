import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BallObservation, LocalView } from '../../../src/core/agents/types';
import type { Message } from '../../../src/core/comms/types';
import {
  DEFAULT_CONFIG,
  cloneConfig,
  type SimConfig,
  type StrategyParams,
} from '../../../src/core/config';
import { parseScenario } from '../../../src/core/scenario/loader';
import { Simulation } from '../../../src/core/sim';
import {
  claimHolder,
  claimsStrategy,
  expireClaims,
  ingestMessages,
  type ClaimsMemory,
} from '../../../src/core/strategies/claims';
import { vec3 } from '../../../src/core/vec3';

const SCENARIOS = join(__dirname, '../../../scenarios');
const MARGIN = 0.15;

function ball(id: number, x: number, y: number, arrival: number): BallObservation {
  return {
    id,
    position: vec3(x, y, 20),
    velocity: vec3(0, 0, -10),
    predictedLanding: vec3(x, y, 1.5),
    predictedArrivalTime: arrival,
    uncertainty: 0,
  };
}

function view(
  memory: ClaimsMemory,
  balls: BallObservation[],
  inbox: Message[] = [],
  tick = 100,
  id = 5,
  params: Partial<StrategyParams> = {},
): LocalView {
  return {
    tick,
    time: tick * 0.02,
    self: {
      id,
      position: vec3(0, 0, 0),
      velocity: vec3(),
      maxSpeed: 7,
      maxAccel: 4,
      stunnedUntil: null,
    },
    bumps: [],
    balls,
    neighbours: [],
    inbox,
    memory,
    params: { ...DEFAULT_CONFIG.strategy, ...params },
  };
}

const fresh = (): ClaimsMemory => claimsStrategy.initMemory(5) as ClaimsMemory;
const claimMsg = (from: number, ballId: number, eta: number, sentTick: number): Message => ({
  type: 'CLAIM',
  ballId,
  eta,
  from,
  sentTick,
});

describe('claimHolder', () => {
  it('has no holder without claimants', () => {
    expect(claimHolder([], MARGIN)).toBe(-1);
  });

  it('matches the pairwise rule for two claimants', () => {
    // A clearly earlier: A wins regardless of id.
    expect(
      claimHolder(
        [
          { id: 9, eta: 10 },
          { id: 1, eta: 10.5 },
        ],
        MARGIN,
      ),
    ).toBe(9);
    // Within the margin: lower id wins.
    expect(
      claimHolder(
        [
          { id: 9, eta: 10 },
          { id: 1, eta: 10.1 },
        ],
        MARGIN,
      ),
    ).toBe(1);
    // Exactly at the margin counts as tied (A.eta < B.eta - margin is false).
    expect(
      claimHolder(
        [
          { id: 9, eta: 10 },
          { id: 1, eta: 10.15 },
        ],
        MARGIN,
      ),
    ).toBe(1);
  });

  it('resolves the three-way cycle the pairwise rule would create, in any order', () => {
    const claims = [
      { id: 0, eta: 10.0 },
      { id: 1, eta: 9.9 },
      { id: 2, eta: 9.8 },
    ];
    // Pairwise: 0 beats 1, 1 beats 2, 2 beats 0. The tie group of 9.8 + 0.15 is {1, 2}.
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      expect(
        claimHolder(
          order.map((k) => claims[k]),
          MARGIN,
        ),
      ).toBe(1);
    }
  });
});

describe('claims table', () => {
  it('records the newest claim per claimant and ignores its own messages', () => {
    const m = fresh();
    ingestMessages(m, [claimMsg(3, 7, 4.0, 10), claimMsg(3, 7, 3.5, 12), claimMsg(5, 8, 1, 12)], 5);
    ingestMessages(m, [claimMsg(3, 7, 9.9, 11)], 5); // older than what we have
    expect(m.claims.get(7)?.get(3)).toEqual({ eta: 3.5, sentTick: 12 });
    expect(m.claims.has(8)).toBe(false);
  });

  it('removes a claim on RELEASE and a ball on CAUGHT', () => {
    const m = fresh();
    ingestMessages(m, [claimMsg(3, 7, 4, 10), claimMsg(4, 7, 4.2, 10), claimMsg(4, 8, 2, 10)], 5);
    ingestMessages(m, [{ type: 'RELEASE', ballId: 7, from: 3, sentTick: 11 }], 5);
    expect([...(m.claims.get(7)?.keys() ?? [])]).toEqual([4]);
    ingestMessages(m, [{ type: 'CAUGHT', ballId: 7, from: 9, sentTick: 11 }], 5);
    expect(m.claims.has(7)).toBe(false);
    expect(m.claims.has(8)).toBe(true);
  });

  it('expires a claim exactly claimTtl ticks after it was sent', () => {
    const m = fresh();
    ingestMessages(m, [claimMsg(3, 7, 4, 10)], 5);
    expireClaims(m, 10 + 50, 50);
    expect(m.claims.get(7)?.has(3)).toBe(true);
    expireClaims(m, 10 + 51, 50);
    expect(m.claims.has(7)).toBe(false);
  });
});

describe('claimsStrategy.decide', () => {
  it('claims the nearest feasible ball and announces it', () => {
    const m = fresh();
    const d = claimsStrategy.decide(view(m, [ball(1, 20, 0, 100), ball(2, 5, 0, 100)]));
    expect(d.targetBallId).toBe(2);
    expect(d.outbox).toHaveLength(1);
    expect(d.outbox[0]).toMatchObject({ type: 'CLAIM', ballId: 2 });
    expect(m.targetBallId).toBe(2);
  });

  it('yields a ball to a clearly earlier claimant and takes the next one', () => {
    const m = fresh();
    // Fielder 3 will be at ball 2 at t = 2.1 s, long before we could (we are at t = 2.0 now).
    const inbox = [claimMsg(3, 2, 2.1, 99)];
    const d = claimsStrategy.decide(view(m, [ball(1, 20, 0, 100), ball(2, 5, 0, 100)], inbox));
    expect(d.targetBallId).toBe(1);
  });

  it('keeps a ball against a later claimant, and wins ties by lower id', () => {
    const m = fresh();
    const d1 = claimsStrategy.decide(view(m, [ball(2, 5, 0, 100)], [claimMsg(9, 2, 50, 99)]));
    expect(d1.targetBallId).toBe(2);
    // A tie within the margin against a lower id loses.
    const m2 = fresh();
    const first = claimsStrategy.decide(view(m2, [ball(2, 5, 0, 100)]));
    const myEta = (first.outbox[0] as { eta: number }).eta;
    const m3 = fresh();
    const tied = [claimMsg(4, 2, myEta + 0.05, 99)];
    expect(claimsStrategy.decide(view(m3, [ball(2, 5, 0, 100)], tied)).targetBallId).toBeNull();
  });

  it('releases a target it loses and one that vanishes', () => {
    const m = fresh();
    claimsStrategy.decide(view(m, [ball(1, 20, 0, 100), ball(2, 5, 0, 100)], [], 100));
    expect(m.targetBallId).toBe(2);
    const lost = claimsStrategy.decide(
      view(m, [ball(1, 20, 0, 100), ball(2, 5, 0, 100)], [claimMsg(3, 2, 2.03, 100)], 101),
    );
    expect(lost.targetBallId).toBe(1);
    expect(lost.outbox.map((o) => o.type)).toEqual(['RELEASE', 'CLAIM']);
    expect(lost.outbox[0]).toMatchObject({ type: 'RELEASE', ballId: 2 });

    const gone = claimsStrategy.decide(view(m, [], [], 102));
    expect(gone.targetBallId).toBeNull();
    expect(gone.outbox).toEqual([{ type: 'RELEASE', ballId: 1 }]);
  });

  it('re-broadcasts every heartbeat interval', () => {
    // A huge etaEpsilon isolates the heartbeat from arrival-time drift.
    const params = { etaEpsilon: 1e9, heartbeatInterval: 10 };
    const m = fresh();
    const balls = [ball(2, 5, 0, 100)];
    claimsStrategy.decide(view(m, balls, [], 100, 5, params));
    for (let t = 101; t < 110; t++) {
      expect(claimsStrategy.decide(view(m, balls, [], t, 5, params)).outbox).toEqual([]);
    }
    expect(claimsStrategy.decide(view(m, balls, [], 110, 5, params)).outbox).toHaveLength(1);
  });

  it('re-broadcasts when its arrival time drifts past etaEpsilon', () => {
    // A stationary fielder's absolute arrival moves 0.02 s per tick; the heartbeat is disabled.
    const params = { etaEpsilon: 0.1, heartbeatInterval: 1e9 };
    const m = fresh();
    const balls = [ball(2, 5, 0, 100)];
    claimsStrategy.decide(view(m, balls, [], 100, 5, params));
    for (let t = 101; t <= 105; t++) {
      expect(claimsStrategy.decide(view(m, balls, [], t, 5, params)).outbox).toEqual([]);
    }
    expect(claimsStrategy.decide(view(m, balls, [], 106, 5, params)).outbox).toHaveLength(1);
  });
});

function scenario(file: string, strategy: string, tweak?: (c: SimConfig) => void): SimConfig {
  const config = parseScenario(readFileSync(join(SCENARIOS, file), 'utf8'), file);
  config.strategy.name = strategy;
  tweak?.(config);
  return config;
}

function finish(config: SimConfig): Simulation {
  const sim = new Simulation(config);
  while (!sim.isFinished()) sim.step();
  return sim;
}

describe('claims in the simulation', () => {
  it('reproduces greedy bit for bit when no message can be sent', () => {
    const greedy = finish(scenario('baseline.json', 'greedy'));
    const silent = finish(
      scenario('baseline.json', 'claims', (c) => {
        c.comms.bandwidth = 0;
      }),
    );
    expect(silent.hash()).toBe(greedy.hash());
    expect(silent.metrics().messagesSent).toBe(0);
  });

  it('resolves every conflict within one tick under ideal comms', () => {
    // With one-tick latency, two fielders can pick the same free ball in the same tick; they
    // hear each other next tick and exactly one keeps it. No conflict may outlive that.
    const config = scenario('dense-salvo.json', 'claims', (c) => {
      c.comms.range = 500;
      c.sensing.range = 500;
      c.comms.latency = 0;
      c.comms.bandwidth = 64;
    });
    const sim = new Simulation(config);
    let contestedTicks = 0;
    let longest = 0;
    let run = 0;
    while (!sim.isFinished()) {
      sim.step();
      run = sim.metrics().contestedBalls > 0 ? run + 1 : 0;
      if (run > 0) contestedTicks++;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(1);
    expect(contestedTicks).toBeLessThan(10);
  });

  it('lets another fielder take over a dead holder’s ball once its claim expires', () => {
    const config = scenario('dense-salvo.json', 'claims', (c) => {
      c.comms.range = 500;
      c.sensing.range = 500;
      c.comms.latency = 0;
    });
    const sim = new Simulation(config);
    sim.run(10);
    // Pick a ball with exactly one pursuer and kill that pursuer.
    let victim = -1;
    let ballId = -1;
    for (let i = 0; i < sim.world.fielderCount && victim < 0; i++) {
      const b = sim.decisionOf(i).targetBallId;
      if (b !== null) {
        victim = i;
        ballId = b;
      }
    }
    expect(victim).toBeGreaterThanOrEqual(0);
    sim.killAgent(victim);
    const ttl = config.strategy.claimTtl;
    const pursued = (): boolean => {
      for (let i = 0; i < sim.world.fielderCount; i++) {
        if (sim.world.fielderAlive[i] === 1 && sim.decisionOf(i).targetBallId === ballId) {
          return true;
        }
      }
      return false;
    };
    // While the dead fielder's claim is live, nobody should take the ball over.
    sim.run(ttl - 12);
    expect(pursued()).toBe(false);
    // Once it has expired, someone who can still make it takes the ball, if the ball is still up.
    sim.run(20);
    if (sim.world.ballState[ballId] === 1) expect(pursued()).toBe(true);
  });

  it('does not depend on the order fielders decide in', () => {
    const forward = new Simulation(scenario('baseline.json', 'claims'));
    const reverse = new Simulation(scenario('baseline.json', 'claims'));
    reverse.reverseDecideOrder = true;
    forward.run(1500);
    reverse.run(1500);
    expect(reverse.hash()).toBe(forward.hash());
    expect(reverse.metrics()).toEqual(forward.metrics());
  });

  it('never mutates shared view data', () => {
    const sim = new Simulation(scenario('baseline.json', 'claims'));
    sim.verifyViews = true;
    expect(() => sim.run(600)).not.toThrow();
  });

  it('recovers at least 70% of the greedy-to-oracle gap on baseline, averaged over seeds', () => {
    let greedy = 0;
    let oracle = 0;
    let claims = 0;
    for (const seed of [42, 1, 2, 3]) {
      const withSeed = (c: SimConfig): void => {
        c.seed = seed;
      };
      greedy += finish(scenario('baseline.json', 'greedy', withSeed)).metrics().ballsCaught;
      oracle += finish(scenario('baseline.json', 'centralised', withSeed)).metrics().ballsCaught;
      claims += finish(scenario('baseline.json', 'claims', withSeed)).metrics().ballsCaught;
    }
    expect((claims - greedy) / (oracle - greedy)).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  it('degrades as comms worsen', () => {
    const caught = (tweak: (c: SimConfig) => void): number =>
      finish(scenario('baseline.json', 'claims', tweak)).metrics().ballsCaught;
    const good = caught(() => {});
    const lossy = caught((c) => {
      c.comms.lossProb = 0.9;
    });
    const deaf = caught((c) => {
      c.comms.range = 0;
    });
    expect(good).toBeGreaterThan(lossy);
    expect(lossy).toBeGreaterThanOrEqual(deaf);
  });
});

// Documented config dependency: the tests above assume the shipped defaults.
it('uses the documented defaults for claims', () => {
  const s = cloneConfig(DEFAULT_CONFIG).strategy;
  expect([s.claimMargin, s.claimTtl, s.heartbeatInterval, s.etaEpsilon]).toEqual([
    0.15, 50, 10, 0.1,
  ]);
});
