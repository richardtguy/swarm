import { describe, expect, it } from 'vitest';
import { EMPTY_INBOX, MessageBus, latencyTicks } from '../../../src/core/comms/messageBus';
import type { Message, MessageBody } from '../../../src/core/comms/types';
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../../../src/core/config';
import { Rng } from '../../../src/core/rng';
import { HashGrid } from '../../../src/core/spatial/hashGrid';
import { createWorld } from '../../../src/core/state';

/** A line of `n` fielders along x, `spacing` metres apart, with the given comms settings. */
function setup(n: number, spacing: number, comms: Partial<SimConfig['comms']> = {}) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.fielders.count = n;
  config.launch.count = 0;
  Object.assign(config.comms, comms);
  const world = createWorld(config);
  for (let i = 0; i < n; i++) world.fielderPos.set([i * spacing, 0, 0], 3 * i);
  const grid = new HashGrid(Math.max(config.comms.range, 1), n);
  const buffer = new Int32Array(n);
  const bus = new MessageBus();
  const inboxes: Message[][] = new Array<Message[]>(n).fill(EMPTY_INBOX);
  const stream = new Rng(config.seed).stream('comms');
  const send = (outboxes: MessageBody[][]): void => {
    grid.build(world.fielderPos, n, world.fielderAlive);
    bus.send(world, config, outboxes, grid, buffer, stream);
  };
  const tick = (): void => {
    world.tick++;
    bus.deliver(world, inboxes);
  };
  return { config, world, bus, inboxes, send, tick };
}

function only(n: number, from: number, ...bodies: MessageBody[]): MessageBody[][] {
  const out: MessageBody[][] = Array.from({ length: n }, () => []);
  out[from] = bodies;
  return out;
}

const claim = (ballId: number, eta = 5): MessageBody => ({ type: 'CLAIM', ballId, eta });

describe('latencyTicks', () => {
  it('rounds up to whole ticks with a minimum of one', () => {
    expect(latencyTicks(0, 0.02)).toBe(1);
    expect(latencyTicks(0.01, 0.02)).toBe(1);
    expect(latencyTicks(0.02, 0.02)).toBe(1);
    expect(latencyTicks(0.03, 0.02)).toBe(2);
    expect(latencyTicks(0.1, 0.02)).toBe(5);
  });

  it('is not pushed up a tick by floating-point division', () => {
    expect(0.14 / 0.02).toBeGreaterThan(7); // 7.000000000000001
    expect(latencyTicks(0.14, 0.02)).toBe(7);
  });
});

describe('MessageBus', () => {
  it('delivers only to alive fielders within range at send time, never to the sender', () => {
    const { world, inboxes, send, tick } = setup(5, 10, { range: 25, latency: 0 });
    world.fielderAlive[3] = 0;
    send(only(5, 1, claim(7)));
    world.fielderPos.set([1000, 0, 0], 0); // moving after sending must not matter
    tick();
    // Fielder 1 at x=10 reaches 0 (10 m) and 2 (10 m), and 3 (20 m) is dead; 4 is 30 m away.
    expect(inboxes.map((b) => b.length)).toEqual([1, 0, 1, 0, 0]);
    expect(inboxes[0][0]).toMatchObject({ type: 'CLAIM', ballId: 7, from: 1, sentTick: 0 });
  });

  it('arrives exactly the configured number of ticks after sending', () => {
    for (const latency of [0, 0.02, 0.1, 0.14, 0.5]) {
      const { inboxes, send, tick } = setup(2, 1, { latency });
      send(only(2, 0, claim(1)));
      const expected = latencyTicks(latency, 0.02);
      let arrived = -1;
      for (let t = 1; t <= 40 && arrived < 0; t++) {
        tick();
        if (inboxes[1].length > 0) arrived = t;
      }
      expect(arrived).toBe(expected);
    }
  });

  it('shares one frozen message object between recipients', () => {
    const { inboxes, send, tick } = setup(3, 1, { latency: 0 });
    send(only(3, 1, claim(4)));
    tick();
    expect(inboxes[0][0]).toBe(inboxes[2][0]);
    expect(Object.isFrozen(inboxes[0][0])).toBe(true);
    expect(() => {
      (inboxes[0][0] as { ballId: number }).ballId = 99;
    }).toThrow(TypeError);
  });

  it('caps each sender at the bandwidth, dropping the newest messages', () => {
    const { bus, inboxes, send, tick } = setup(2, 1, { latency: 0, bandwidth: 2 });
    send(only(2, 0, claim(1), claim(2), claim(3), claim(4)));
    tick();
    expect(inboxes[1].map((m) => ('ballId' in m ? m.ballId : -1))).toEqual([1, 2]);
    expect(bus.counters).toMatchObject({ sent: 2, delivered: 2, droppedBandwidth: 2 });
  });

  it('sends nothing with zero bandwidth', () => {
    const { bus, inboxes, send, tick } = setup(2, 1, { bandwidth: 0 });
    send(only(2, 0, claim(1)));
    tick();
    expect(inboxes[1]).toBe(EMPTY_INBOX);
    expect(bus.counters).toMatchObject({ sent: 0, droppedBandwidth: 1 });
  });

  it('loses messages independently per recipient at the configured rate', () => {
    const n = 51;
    const { bus, send, tick } = setup(n, 0.01, { latency: 0, range: 10, lossProb: 0.3 });
    for (let round = 0; round < 40; round++) {
      send(only(n, 0, claim(round)));
      tick();
    }
    const attempts = 40 * (n - 1);
    expect(bus.counters.droppedLoss + bus.counters.delivered).toBe(attempts);
    expect(bus.counters.droppedLoss / attempts).toBeCloseTo(0.3, 1);
  });

  it('is deterministic for a seed', () => {
    const counts = (): number[] => {
      const { inboxes, send, tick } = setup(20, 1, { latency: 0, range: 50, lossProb: 0.5 });
      const seen: number[] = [];
      for (let round = 0; round < 10; round++) {
        send(only(20, round % 20, claim(round)));
        tick();
        seen.push(...inboxes.map((b) => b.length));
      }
      return seen;
    };
    expect(counts()).toEqual(counts());
  });

  it('drops messages to fielders that die in flight, but delivers from dead senders', () => {
    const { world, bus, inboxes, send, tick } = setup(3, 1, { latency: 0.1 });
    send(only(3, 0, claim(1)));
    world.fielderAlive[0] = 0; // sender dies after sending
    world.fielderAlive[2] = 0; // recipient dies in flight
    for (let t = 0; t < 5; t++) tick();
    expect(inboxes[1]).toHaveLength(1);
    expect(inboxes[2]).toBe(EMPTY_INBOX);
    expect(bus.counters.droppedRecipientDead).toBe(1);
  });

  it('orders an inbox by send tick, then sender, then outbox position', () => {
    const { inboxes, send, tick, world } = setup(3, 1, { latency: 0.04 });
    const outboxes: MessageBody[][] = [[claim(1), claim(2)], [], [claim(3)]];
    send(outboxes); // tick 0, two-tick latency
    world.tick++;
    send(only(3, 0, claim(9))); // tick 1
    world.tick--;
    tick();
    tick();
    expect(inboxes[1].map((m) => [m.sentTick, m.from, 'ballId' in m ? m.ballId : -1])).toEqual([
      [0, 0, 1],
      [0, 0, 2],
      [0, 2, 3],
    ]);
    tick();
    expect(inboxes[1].map((m) => ('ballId' in m ? m.ballId : -1))).toEqual([9]);
  });

  it('keeps messages in flight on their schedule when latency changes', () => {
    const { config, inboxes, send, tick } = setup(2, 1, { latency: 0.1 });
    send(only(2, 0, claim(1)));
    config.comms.latency = 0;
    for (let t = 1; t < 5; t++) {
      tick();
      expect(inboxes[1]).toBe(EMPTY_INBOX);
    }
    tick();
    expect(inboxes[1]).toHaveLength(1);
  });

  it('forgets everything on reset', () => {
    const { bus, send } = setup(2, 1);
    send(only(2, 0, claim(1)));
    expect(bus.inFlight).toBe(1);
    bus.reset();
    expect(bus.inFlight).toBe(0);
    expect(bus.counters.sent).toBe(0);
  });
});
