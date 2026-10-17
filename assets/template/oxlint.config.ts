import { defineConfig } from 'oxlint';
import { pureRoles, rules } from './tools/boundary-enforcement/policy.ts';

export default defineConfig({
  plugins: ['typescript', 'react', 'import', 'oxc'],
  categories: { correctness: 'error' },
  ignorePatterns: ['node_modules/**', 'dist/**', '.wrangler/**', '.agents/**', '.audit/**', 'test-results/**', 'playwright-report/**', 'tools/oxlint/anti-slop/**', 'src/routeTree.gen.ts', 'worker-configuration.d.ts', 'src/platform/database.types.ts', 'tools/boundary-enforcement/fixtures/**'],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }, { name: 'boundaries', specifier: './tools/boundary-enforcement/lint-rules/index.ts' }],
  rules: {
    ...Object.fromEntries(rules.flatMap(rule => rule.check === 'lint' ? [[`boundaries/${rule.id}`, 'error' as const]] : [])),
    'oxc/no-accumulating-spread': 'error',
    'anti-slop/no-array-filter-map': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-readable-spacing': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error',
  },
  overrides: [
    {
      files: [...pureRoles.map(role => role === 'domain' ? 'src/domain/**/*.ts' : `src/**/*.${role}.ts`), 'src/**/*.server.ts', 'tests/fixtures/**/*.ts', 'tools/boundary-enforcement/**/*.ts'],
      rules: {
        // Adapter parsers and error classifiers receive unknown external values before Zod validates them.
        'anti-slop/no-unknown-parameters': 'off',
        // Boundary handling must discriminate external SDK and provider errors without asserting a shape.
        'anti-slop/no-runtime-typeof': 'off',
      },
    },
  ],
});

