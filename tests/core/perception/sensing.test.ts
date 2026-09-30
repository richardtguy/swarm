import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../../../src/core/config';
import { senseBalls, senseNeighbours } from '../../../src/core/perception/sensing';
import { predictLandingAt } from '../../../src/core/physics/ballistics';
import { Rng } from '../../../src/core/rng';
import { Simulation } from '../../../src/core/sim';
import { HashGrid } from '../../../src/core/spatial/hashGrid';
import { BallState } from '../../../src/core/state';
import { vec3 } from '../../../src/core/vec3';

/** A world with a salvo in the air, plus the grids perception needs. */
function airborne(configure?: (c: SimConfig) => void) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.launch.pattern = 'salvo';
  config.launch.count = 40;
  config.strategy.name = 'idle';
  configure?.(config);
  const sim = new Simulation(config);
  sim.run(100); // 2 s: the salvo is high over the southern half of the field
  const world = sim.world;
  const fielderGrid = new HashGrid(4, world.fielderCount);
  fielderGrid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
  const flying = new Uint8Array(world.ballCapacity);
  for (let b = 0; b < world.ballCount; b++)
    flying[b] = world.ballState[b] === BallState.FLYING ? 1 : 0;
  const ballGrid = new HashGrid(10, world.ballCapacity);
  ballGrid.build(world.ballPos, world.ballCount, flying);
  return {
    config: sim.config,
    world,
    fielderGrid,
    ballGrid,
    fBuf: new Int32Array(world.fielderCount),
    bBuf: new Int32Array(world.ballCapacity),
  };
}

describe('senseBalls', () => {
  it('returns exactly the flying balls within range, in id order, without noise', () => {
    const { config, world, ballGrid, bBuf } = airborne((c) => {
      c.sensing.range = 25;
    });
    let seen = 0;
    // Fielders 0–9 form the southern row, nearest the launch zone; 55 sits mid-field.
    for (const id of [0, 3, 5, 9, 55]) {
      const obs = senseBalls(world, config, id, ballGrid, bBuf, null);
      const fx = world.fielderPos[3 * id];
      const fy = world.fielderPos[3 * id + 1];
      const expected: number[] = [];
      for (let b = 0; b < world.ballCount; b++) {
        if (world.ballState[b] !== BallState.FLYING) continue;
        if (Math.hypot(world.ballPos[3 * b] - fx, world.ballPos[3 * b + 1] - fy) <= 25) {
          expected.push(b);
        }
      }
      expect(obs.map((o) => o.id)).toEqual(expected);
      seen += obs.length;
      for (const o of obs) {
        expect([...o.position]).toEqual([...world.ballPos.subarray(3 * o.id, 3 * o.id + 3)]);
        expect([...o.velocity]).toEqual([...world.ballVel.subarray(3 * o.id, 3 * o.id + 3)]);
        const landing = vec3();
        const t = predictLandingAt(
          landing,
          world.ballPos,
          world.ballVel,
          o.id,
          config.catch.height,
        );
        expect([...o.predictedLanding]).toEqual([...landing]);
        expect(o.predictedArrivalTime).toBeCloseTo(world.time + t, 12);
        expect(o.uncertainty).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('sees nothing when the range is too short and everything when it is huge', () => {
    const tiny = airborne((c) => {
      c.sensing.range = 0.01;
    });
    expect(senseBalls(tiny.world, tiny.config, 5, tiny.ballGrid, tiny.bBuf, null)).toEqual([]);
    const huge = airborne((c) => {
      c.sensing.range = 1000;
    });
    const flying = [...huge.world.ballState].filter((s) => s === BallState.FLYING).length;
    expect(senseBalls(huge.world, huge.config, 5, huge.ballGrid, huge.bBuf, null)).toHaveLength(
      flying,
    );
  });

  it('adds deterministic noise that grows the landing uncertainty', () => {
    const { config, world, ballGrid, bBuf } = airborne((c) => {
      c.sensing.noise = 0.5;
    });
    const a = senseBalls(world, config, 5, ballGrid, bBuf, new Rng(1).stream('perception'));
    const b = senseBalls(world, config, 5, ballGrid, bBuf, new Rng(1).stream('perception'));
    const exact = senseBalls(world, config, 5, ballGrid, bBuf, null);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((o) => [...o.position])).toEqual(b.map((o) => [...o.position]));
    expect(a.map((o) => [...o.position])).not.toEqual(exact.map((o) => [...o.position]));
    for (let k = 0; k < a.length; k++) {
      expect(a[k].uncertainty).toBeGreaterThan(0.5);
      expect(a[k].uncertainty).toBeCloseTo(
        0.5 * Math.sqrt(1 + (a[k].predictedArrivalTime - world.time) ** 2),
        9,
      );
    }
    const c = senseBalls(world, config, 5, ballGrid, bBuf, new Rng(2).stream('perception'));
    expect(c.map((o) => [...o.position])).not.toEqual(a.map((o) => [...o.position]));
  });
});

describe('senseNeighbours', () => {
  it('returns alive fielders within comms range, excluding self, in id order', () => {
    const { config, world, fielderGrid, fBuf } = airborne((c) => {
      c.comms.range = 15;
    });
    world.fielderAlive[45] = 0;
    fielderGrid.build(world.fielderPos, world.fielderCount, world.fielderAlive);
    const id = 44;
    const got = senseNeighbours(world, config, id, fielderGrid, fBuf);
    const fx = world.fielderPos[3 * id];
    const fy = world.fielderPos[3 * id + 1];
    const expected: number[] = [];
    for (let j = 0; j < world.fielderCount; j++) {
      if (j === id || world.fielderAlive[j] === 0) continue;
      if (Math.hypot(world.fielderPos[3 * j] - fx, world.fielderPos[3 * j + 1] - fy) <= 15) {
        expected.push(j);
      }
    }
    expect(expected.length).toBeGreaterThan(0);
    expect(got.map((n) => n.id)).toEqual(expected);
    expect(got.some((n) => n.id === 45)).toBe(false);
    for (const n of got) {
      expect([...n.position]).toEqual([...world.fielderPos.subarray(3 * n.id, 3 * n.id + 3)]);
    }
  });
});
