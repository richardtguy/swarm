import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/core/config';
import { Simulation } from '../../src/core/sim';
import type { WorkerMessage } from '../../src/worker/protocol';
import { SimHost } from '../../src/worker/simHost';

function makeHost() {
  const posted: WorkerMessage[] = [];
  const host = new SimHost((message) => posted.push(message));
  return { host, posted };
}

describe('SimHost', () => {
  it('runs the same ticks as a direct simulation and reports the same hash', () => {
    const { host, posted } = makeHost();
    const config = cloneConfig(DEFAULT_CONFIG);
    host.handle({ type: 'command', command: { type: 'init', config } });
    // 0.5 s of wall-clock time in 16 ms pumps → 25 ticks at 50 Hz.
    let elapsed = 0;
    while (elapsed < 0.5 - 1e-9) {
      host.pump(0.016);
      elapsed += 0.016;
    }
    const ticks = host.sim.world.tick;
    expect(ticks).toBeGreaterThan(20);
    host.handle({ type: 'requestHash' });
    const hashMessage = posted.find((m) => m.type === 'hash');
    expect(hashMessage).toBeDefined();

    const direct = new Simulation(config);
    direct.run(ticks);
    expect(hashMessage).toEqual({ type: 'hash', tick: ticks, hash: direct.hash() });
  });

  it('posts frames with transferable snapshots, events and metrics', () => {
    const { host, posted } = makeHost();
    host.handle({ type: 'command', command: { type: 'init', config: DEFAULT_CONFIG } });
    host.pump(0.1);
    const frames = posted.filter((m) => m.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    const frame = frames[frames.length - 1];
    if (frame.type !== 'frame') throw new Error('unreachable');
    expect(frame.snapshot.tick).toBe(host.sim.world.tick);
    expect(frame.metrics.tick).toBe(host.sim.world.tick);
    expect(frame.strategy).toEqual({ name: 'centralised', isOracle: true });
    expect(frame.paused).toBe(false);
    expect(frame.finished).toBe(false);
  });

  it('does not post frames while paused and idle, but does after a command', () => {
    const { host, posted } = makeHost();
    host.handle({ type: 'command', command: { type: 'pause' } });
    host.pump(0.1); // posts the frame made dirty by the pause command
    const before = posted.length;
    host.pump(0.1);
    host.pump(0.1);
    expect(posted.length).toBe(before);
    expect(host.sim.world.tick).toBe(0);
    host.handle({ type: 'command', command: { type: 'step', ticks: 3 } });
    host.pump(0.016);
    expect(posted.length).toBe(before + 1);
    expect(host.sim.world.tick).toBe(3);
  });

  it('honours the time scale', () => {
    const { host } = makeHost();
    host.handle({ type: 'setTimeScale', timeScale: 2 });
    host.pump(0.1);
    expect(host.sim.world.tick).toBe(10);
    host.handle({ type: 'setTimeScale', timeScale: 0 });
    host.pump(0.1);
    expect(host.sim.world.tick).toBe(10);
  });

  it('reports command errors instead of throwing', () => {
    const { host, posted } = makeHost();
    host.handle({ type: 'command', command: { type: 'killAgent', id: 99999 } });
    expect(posted.at(-1)).toMatchObject({ type: 'error' });
    expect(host.sim.world.tick).toBe(0);
  });

  it('runs a shadow oracle in lockstep for autonomous strategies only', () => {
    const { host, posted } = makeHost();
    const config = cloneConfig(DEFAULT_CONFIG);
    config.launch.pattern = 'salvo';
    config.strategy.name = 'greedy';
    host.handle({ type: 'command', command: { type: 'init', config } });
    expect(host.reference).not.toBeNull();
    host.pump(0.1);
    host.handle({ type: 'command', command: { type: 'step', ticks: 7 } });
    const killTick = host.sim.world.tick;
    host.handle({ type: 'command', command: { type: 'killAgent', id: 3 } });
    host.pump(0.1);
    const frame = posted.filter((m) => m.type === 'frame').at(-1);
    if (frame === undefined || frame.type !== 'frame') throw new Error('no frame');
    expect(frame.reference).not.toBeNull();
    expect(frame.reference?.tick).toBe(frame.metrics.tick);
    expect(frame.reference?.fieldersAlive).toBe(frame.metrics.fieldersAlive);
    expect(host.reference?.strategyInfo).toEqual({ name: 'centralised', isOracle: true });

    // The shadow run is exactly an oracle run that received the same commands at the same ticks.
    const oracleConfig = cloneConfig(config);
    oracleConfig.strategy.name = 'centralised';
    const direct = new Simulation(oracleConfig);
    direct.run(killTick);
    direct.killAgent(3);
    direct.run(frame.metrics.tick - killTick);
    expect(host.reference?.hash()).toBe(direct.hash());

    host.handle({
      type: 'command',
      command: { type: 'setParam', path: 'strategy.name', value: 'centralised' },
    });
    host.handle({ type: 'command', command: { type: 'reset' } });
    expect(host.reference).toBeNull();
    host.pump(0.016);
    const oracleFrame = posted.filter((m) => m.type === 'frame').at(-1);
    if (oracleFrame === undefined || oracleFrame.type !== 'frame') throw new Error('no frame');
    expect(oracleFrame.reference).toBeNull();
  });

  it('includes the inspected fielder in frames, and stops when inspection ends', () => {
    const { host, posted } = makeHost();
    const config = cloneConfig(DEFAULT_CONFIG);
    config.strategy.name = 'claims';
    config.launch.pattern = 'salvo';
    host.handle({ type: 'command', command: { type: 'init', config } });
    host.handle({ type: 'inspect', fielderId: 3 });
    host.pump(0.1);
    const frame = posted.filter((m) => m.type === 'frame').at(-1);
    if (frame === undefined || frame.type !== 'frame') throw new Error('no frame');
    expect(frame.inspection).toMatchObject({ id: 3, hasView: true, strategy: 'claims' });

    host.handle({ type: 'inspect', fielderId: null });
    host.pump(0.02);
    const after = posted.filter((m) => m.type === 'frame').at(-1);
    if (after === undefined || after.type !== 'frame') throw new Error('no frame');
    expect(after.inspection).toBeNull();

    host.handle({ type: 'inspect', fielderId: 99_999 });
    expect(posted.at(-1)).toMatchObject({ type: 'error' });
  });

  it('stops stepping once the run is finished', () => {
    const { host } = makeHost();
    const config = cloneConfig(DEFAULT_CONFIG);
    config.duration = 0.2;
    host.handle({ type: 'command', command: { type: 'init', config } });
    for (let i = 0; i < 20; i++) host.pump(0.1);
    expect(host.sim.world.tick).toBe(10);
    expect(host.sim.isFinished()).toBe(true);
  });
});
