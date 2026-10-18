import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkSource } from './lint-rules/check-source.ts';
import { baselineMigrations, checkRepoFiles } from './check-repo.ts';
import { checkBoundaries } from './check-boundaries.ts';
import { browserClosure } from './browser-closure.ts';
import { checkClientChunks } from './check-client-bundle.ts';
import { fixtureExpectations, renderArchitecture, rules, type Diagnostic } from './policy.ts';

const expectedSchema = z.array(z.object({ rule: z.string(), path: z.string() }));

const manifestPatchSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });

const fixtureSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('source'), path: z.string(), source: z.string(), expected: expectedSchema }),
  z.object({ id: z.string(), kind: z.literal('repo'), files: z.record(z.string(), z.union([z.string(), z.null(), manifestPatchSchema])), expected: expectedSchema }),
  z.object({ id: z.string(), kind: z.literal('edge'), files: z.record(z.string(), z.string()), expected: expectedSchema }),
  z.object({ id: z.string(), kind: z.literal('bundle'), modules: z.array(z.string()), source: z.string(), graph: z.record(z.string(), z.array(z.string())).optional(), direct: z.array(z.string()).optional(), expected: expectedSchema }),
]);

const fixtures = z.array(fixtureSchema).parse(JSON.parse(readFileSync(new URL('./fixtures/cases.json', import.meta.url), 'utf8')));

const directories: string[] = [];

const initialMigration = 'supabase/migrations/20260101000000_initial.sql';

const baseline = new Map([[initialMigration, 'select 1;\n']]);

const manifest = { packageManager: 'pnpm@11.25.0', dependencies: { react: '19.3.1' }, devDependencies: { wrangler: '4.151.1', supabase: '2.121.0', shadcn: '4.22.0' } };

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'touch-grass-boundaries-'));
  directories.push(path);

  return path;
}

// A lockfile in the pnpm format, with the peer suffixes a real one carries, for the dependency graph a fixture describes.
function lockfile(graph: Record<string, string[]>): string {
  const lines = ['lockfileVersion: \'9.0\'', '', 'snapshots:', ''];

  for (const [name, dependencies] of Object.entries(graph)) {
    if (dependencies.length === 0) {
      lines.push(`  '${name}@1.0.0(react@19.3.1)': {}`, '');
      continue;
    }

    lines.push(`  '${name}@1.0.0(react@19.3.1)':`, '    dependencies:', ...dependencies.map(dependency => `      '${dependency}': 1.0.0(react@19.3.1)`), '');
  }

  return `${lines.join('\n')}\n`;
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('architecture enforcement fixtures', () => {
  it('has a negative fixture for every mechanically checked rule', () => {
    const covered = new Set<string>();

    for (const fixture of fixtures) {
      for (const diagnostic of fixture.expected) covered.add(diagnostic.rule.startsWith('ownership-') ? 'ownership' : diagnostic.rule);
    }

    for (const rule of rules) {
      if (['dependency-cruiser', 'lint', 'check-repo', 'check-client-bundle'].includes(rule.check)) expect(covered.has(rule.id), `Missing negative fixture for ${rule.id}`).toBe(true);
    }

    for (const [rule, identifiers] of Object.entries(fixtureExpectations)) {
      for (const id of identifiers) expect(fixtures.find(fixture => fixture.id === id)?.expected.some(diagnostic => diagnostic.rule.startsWith(rule))).toBe(true);
    }

    for (const kind of ['source', 'repo', 'edge', 'bundle']) expect(fixtures.some(fixture => fixture.kind === kind && fixture.expected.length === 0)).toBe(true);
  });

  for (const fixture of fixtures) {
    it(fixture.id, () => {
      let diagnostics: Diagnostic[];

      switch (fixture.kind) {
        case 'source':
          diagnostics = checkSource(fixture.path, fixture.source);
          break;
        case 'repo': {
          const files = new Map([['package.json', JSON.stringify(manifest)], ['ARCHITECTURE.md', renderArchitecture()], [initialMigration, 'select 1;\n']]);

          for (const [path, content] of Object.entries(fixture.files)) {
            if (content === null) files.delete(path);
            else if (typeof content === 'string') files.set(path, content);
            else files.set(path, JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, ...content.dependencies }, devDependencies: { ...manifest.devDependencies, ...content.devDependencies } }));
          }

          diagnostics = checkRepoFiles(files, baseline);
          break;
        }

        case 'edge': {
          const root = temporaryDirectory();

          for (const [path, source] of Object.entries(fixture.files)) write(root, path, source);
          write(root, 'package.json', JSON.stringify({ type: 'module' }));
          write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { module: 'ESNext', target: 'ESNext', moduleResolution: 'bundler' } }));
          symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
          const policy = resolve('tools/boundary-enforcement/policy.ts');
          write(root, 'dependency-cruiser.config.cjs', `const { dependencyRules } = require(${JSON.stringify(policy)}); module.exports = { forbidden: dependencyRules(['demo','other']), options: { tsPreCompilationDeps: true, doNotFollow: { path: 'node_modules' }, tsConfig: {fileName:'tsconfig.json'} } };`);
          diagnostics = checkBoundaries(root);
          break;
        }

        case 'bundle': {
          const root = temporaryDirectory();
          write(root, 'assets/main.js', fixture.source);
          write(root, 'client-module-graph.json', JSON.stringify({ version: 1, chunks: [{ fileName: 'assets/main.js', modules: fixture.modules }] }));

          if (fixture.graph) {
            const project = temporaryDirectory();
            write(project, 'package.json', JSON.stringify({ dependencies: Object.fromEntries((fixture.direct ?? []).map(name => [name, '1.0.0'])) }));
            write(project, 'pnpm-lock.yaml', lockfile(fixture.graph));
            diagnostics = checkClientChunks(root, project);
          } else {
            diagnostics = checkClientChunks(root);
          }

          break;
        }
      }

      expect(diagnostics.some(diagnostic => diagnostic.rule === 'syntax-error'), 'A syntax error is not proof that a policy rule rejects a fixture').toBe(false);

      if (fixture.expected.length === 0) expect(diagnostics).toEqual([]);
      else for (const expected of fixture.expected) expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
    }, 30_000);
  }

  it('runs member, assertion and JSX rules through the pinned Oxlint JS plugin', () => {
    const root = temporaryDirectory();
    write(root, 'src/features/demo/demo.tools.ts', 'export const value = Date.now();');
    write(root, 'src/features/demo/demo.service.server.ts', 'export const read = (env: Env) => env.LLM_API_KEY;');
    write(root, 'src/features/demo/ui/page.tsx', 'export const Page = () => <div className="bg-zinc-900" />; export const id = "x" as UserId;');
    write(root, 'package.json', JSON.stringify({ type: 'module' }));
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '--config', resolve('oxlint.config.ts'), '--format', 'json', 'src'], { cwd: root, encoding: 'utf8' });

    if (result.error) throw result.error;
    const output = z.object({ diagnostics: z.array(z.object({ code: z.string(), filename: z.string() })) }).parse(JSON.parse(result.stdout));
    expect(result.status).toBe(1);

    for (const rule of ['pure-module', 'env-access', 'styling', 'brand-cast']) expect(output.diagnostics.some(diagnostic => diagnostic.code === `boundaries(${rule})`)).toBe(true);
  });

  it('treats invalid source as a checker failure, rather than a policy rejection', () => {
    expect(checkSource('src/features/demo/demo.model.ts', 'export const = ;')).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'syntax-error' })]));
  });

  it('compares applied migrations byte for byte against the actual Git baseline', () => {
    const root = temporaryDirectory();
    const sql = 'select 1;\n\n';
    write(root, initialMigration, sql);
    write(root, `assets/template/${initialMigration}`, 'select 2;\n');
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '--quiet');
    git('add', 'supabase/migrations', 'assets/template/supabase/migrations');
    git('-c', 'user.name=Template Test', '-c', 'user.email=template@example.test', 'commit', '--quiet', '-m', 'Record initial migration');
    expect(baselineMigrations(root, 'HEAD').get(initialMigration)).toBe(sql);
    expect(baselineMigrations(join(root, 'assets/template'), 'HEAD').get(initialMigration)).toBe('select 2;\n');
    expect(() => baselineMigrations(root, 'missing-base')).toThrow();
  });

  it('derives the browser allowlist from the committed lockfile', () => {
    const closure = browserClosure(process.cwd());

    for (const name of ['@tanstack/start-client-core', '@tanstack/router-core', 'seroval', 'scheduler', 'use-sync-external-store', '@radix-ui/react-compose-refs', '@radix-ui/react-focus-scope']) expect(closure.has(name), name).toBe(true);

    for (const name of ['@tanstack/start-server-core', '@tanstack/react-start-server', '@tanstack/start-plugin-core', '@babel/core', 'vite', 'openai', '@supabase/supabase-js']) expect(closure.has(name), name).toBe(false);
  });

  it('refuses a missing client graph instead of accepting an unexamined bundle', () => {
    expect(() => checkClientChunks(temporaryDirectory())).toThrow();
  });
});
