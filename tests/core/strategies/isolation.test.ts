/**
 * Guards CLAUDE.md rule 2 alongside the ESLint rule: no autonomous strategy module may import
 * the world (`sim.ts`, `state.ts`, `snapshot.ts`). The oracle is the one exception.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STRATEGIES_DIR = join(__dirname, '../../../src/core/strategies');
const ALLOWED = new Set(['centralised.ts', 'types.ts']);
const FORBIDDEN = /from\s+['"][^'"]*\/(sim|state|snapshot)['"]/;

describe('strategy isolation', () => {
  const files = readdirSync(STRATEGIES_DIR).filter((f) => f.endsWith('.ts') && !ALLOWED.has(f));

  it('finds strategy modules to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} does not import the world`, () => {
      const source = readFileSync(join(STRATEGIES_DIR, file), 'utf8');
      expect(source).not.toMatch(FORBIDDEN);
    });
  }
});
