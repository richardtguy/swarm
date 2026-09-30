// ESLint flat config. The rules for src/core enforce CLAUDE.md section 2:
// the core is pure (rule 1) and autonomous strategies see only their LocalView (rule 2).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PURITY = 'src/core must stay pure (CLAUDE.md rule 1): no DOM, timers, clocks or Math.random.';

const bannedGlobals = [
  'window',
  'document',
  'navigator',
  'location',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'self',
  'postMessage',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'process',
  'require',
].map((name) => ({ name, message: `${name}: ${PURITY}` }));

const bannedProperties = [
  { object: 'Math', property: 'random' },
  { object: 'Date', property: 'now' },
  { object: 'performance', property: 'now' },
  { object: 'globalThis', property: 'window' },
  { object: 'globalThis', property: 'document' },
  { object: 'globalThis', property: 'performance' },
  { object: 'crypto', property: 'getRandomValues' },
].map((entry) => ({ ...entry, message: PURITY }));

/** Import patterns that are never allowed inside src/core. */
const coreImportPatterns = [
  { group: ['three', 'three/*'], message: `three.js: ${PURITY}` },
  { group: ['**/render/**', '**/ui/**', '**/worker/**', '**/main'], message: PURITY },
  { group: ['node:*', 'fs', 'path', 'os', 'child_process', 'worker_threads'], message: PURITY },
];

/** Autonomous strategies must not reach the world or global state (CLAUDE.md rule 2). */
const strategyImportPatterns = [
  ...coreImportPatterns,
  {
    group: ['**/sim', '**/sim.ts', '**/state', '**/state.ts', '**/snapshot', '**/snapshot.ts'],
    message:
      'Autonomous strategies see only their LocalView (CLAUDE.md rule 2). Only centralised.ts may see the world.',
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-single/**', 'results/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      // Named exports only (CLAUDE.md section 3).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports only (CLAUDE.md section 3).',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Build config files are consumed by Vite and must use a default export.
    files: ['vite.config.ts', 'vite.single.config.ts', 'eslint.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/core/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Rule 1: the core is pure. It must run unchanged in Node and in a Web Worker.
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': ['error', ...bannedGlobals],
      'no-restricted-properties': ['error', ...bannedProperties],
      'no-restricted-imports': ['error', { patterns: coreImportPatterns }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports only (CLAUDE.md section 3).',
        },
        { selector: "NewExpression[callee.name='Date']", message: `new Date(): ${PURITY}` },
        { selector: "NewExpression[callee.name='Worker']", message: `new Worker(): ${PURITY}` },
        {
          selector: "MemberExpression[object.type='MetaProperty']",
          message: `import.meta: ${PURITY}`,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Rule 2: autonomous strategies never import the world. The oracle is the one exception,
    // and types.ts declares the oracle's interface (a type-only import of the snapshot).
    files: ['src/core/strategies/**/*.ts'],
    ignores: ['src/core/strategies/centralised.ts', 'src/core/strategies/types.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: strategyImportPatterns }],
    },
  },
);
