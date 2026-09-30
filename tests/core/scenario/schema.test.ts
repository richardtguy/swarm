import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/core/config';
import { parseScenario } from '../../../src/core/scenario/loader';
import { ScenarioError, validateScenario } from '../../../src/core/scenario/schema';

const SCENARIOS = join(__dirname, '../../../scenarios');

describe('validateScenario', () => {
  it('fills an empty scenario from the defaults', () => {
    expect(validateScenario({})).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial sections over the defaults', () => {
    const config = validateScenario({ seed: 9, comms: { range: 12 }, strategy: { name: 'idle' } });
    expect(config.seed).toBe(9);
    expect(config.comms.range).toBe(12);
    expect(config.comms.latency).toBe(DEFAULT_CONFIG.comms.latency);
    expect(config.strategy.name).toBe('idle');
    expect(config.strategy.claimTtl).toBe(DEFAULT_CONFIG.strategy.claimTtl);
  });

  it('does not alias the defaults', () => {
    const config = validateScenario({});
    config.launch.zones[0].x = 999;
    expect(DEFAULT_CONFIG.launch.zones[0].x).toBe(0);
  });

  it('rejects unknown fields with their path', () => {
    expect(() => validateScenario({ comms: { rnage: 1 } })).toThrow(/^comms\.rnage: unknown field/);
    expect(() => validateScenario({ bogus: 1 })).toThrow(/^bogus: unknown field/);
    expect(() =>
      validateScenario({ launch: { zones: [{ x: 0, y: 0, radius: 1, z: 2 }] } }),
    ).toThrow(/^launch\.zones\[0\]\.z: unknown field/);
  });

  it('rejects wrong types', () => {
    expect(() => validateScenario({ seed: '42' })).toThrow(/^seed: must be a finite number/);
    expect(() => validateScenario({ name: 3 })).toThrow(/^name: must be a string/);
    expect(() => validateScenario({ comms: 5 })).toThrow(/^comms: must be an object/);
    expect(() => validateScenario('nope')).toThrow(/^scenario: must be an object/);
    expect(() => validateScenario({ launch: { zones: [] } })).toThrow(
      /^launch\.zones: must be a non-empty/,
    );
  });

  it('enforces ranges and integers', () => {
    expect(() => validateScenario({ dt: 0 })).toThrow(/^dt: must be greater than 0/);
    expect(() => validateScenario({ seed: 1.5 })).toThrow(/^seed: must be an integer/);
    expect(() => validateScenario({ comms: { lossProb: 1.2 } })).toThrow(
      /^comms\.lossProb: must be at most 1/,
    );
    expect(() => validateScenario({ launch: { speed: { min: 30, max: 20 } } })).toThrow(
      /^launch\.speed: min \(30\) must not exceed max \(20\)/,
    );
    expect(() => validateScenario({ collisions: { stunSpeed: 5, crashSpeed: 4 } })).toThrow(
      /^collisions\.crashSpeed/,
    );
  });

  it('enforces enums and strategy names', () => {
    expect(() => validateScenario({ launch: { pattern: 'burst' } })).toThrow(
      /^launch\.pattern: must be one of/,
    );
    expect(() => validateScenario({ collisions: { mode: 'ouch' } })).toThrow(
      /^collisions\.mode: must be one of/,
    );
    expect(() => validateScenario({ strategy: { name: 'telepathy' } })).toThrow(
      /^strategy\.name: unknown strategy "telepathy"/,
    );
  });

  it('throws ScenarioError instances', () => {
    try {
      validateScenario({ dt: -1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioError);
      expect((error as ScenarioError).path).toBe('dt');
    }
  });
});

describe('parseScenario', () => {
  it('loads the shipped scenario files', () => {
    for (const file of ['baseline.json', 'dense-salvo.json']) {
      const config = parseScenario(readFileSync(join(SCENARIOS, file), 'utf8'), file);
      expect(config.name).toBe(file.replace('.json', ''));
      expect(config.fielders.count).toBeGreaterThan(0);
    }
  });

  it('reports invalid JSON with the source name', () => {
    expect(() => parseScenario('{ nope', 'broken.json')).toThrow(/^broken\.json: invalid JSON/);
  });
});
