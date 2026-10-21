import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Diagnostic } from './policy.ts';

const graphSchema = z.object({
  modules: z.array(z.object({ source: z.string(), dependencies: z.array(z.object({ resolved: z.string() })) })),
  summary: z.object({ violations: z.array(z.object({ rule: z.object({ name: z.string() }), from: z.string(), to: z.string() })) }),
});

export function featureCycles(modules: { source: string; dependencies: { resolved: string }[] }[]): Diagnostic[] {
  const graph = new Map<string, Set<string>>();

  for (const module of modules) {
    const source = /^src\/features\/([^/]+)\//.exec(module.source)?.[1];

    if (!source) continue;
    const outgoing = graph.get(source) ?? new Set<string>();

    for (const dependency of module.dependencies) {
      const target = /^src\/features\/([^/]+)\//.exec(dependency.resolved)?.[1];

      if (target && target !== source) outgoing.add(target);
    }

    graph.set(source, outgoing);
  }

  const diagnostics: Diagnostic[] = [];
  const settled = new Set<string>();
  const active = new Set<string>();

  const visit = (feature: string, path: readonly string[]) => {
    if (active.has(feature)) {
      diagnostics.push({ rule: 'feature-cycle', path: `src/features/${feature}`, message: `Feature dependency cycle: ${[...path, feature].join(' -> ')}` });

      return;
    }

    if (settled.has(feature)) return;
    active.add(feature);

    for (const next of graph.get(feature) ?? []) visit(next, [...path, feature]);
    active.delete(feature);
    settled.add(feature);
  };

  for (const feature of graph.keys()) visit(feature, []);

  return diagnostics;
}

export function checkBoundaries(root: string, config = 'dependency-cruiser.config.cjs'): Diagnostic[] {
  const cli = fileURLToPath(new URL('../../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--config', config, '--output-type', 'json', 'src'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  if (result.error) throw result.error;

  if (result.status !== 0 && result.status !== 1) {
    if (!result.stdout.trim().startsWith('{')) throw new Error(`dependency-cruiser failed: ${result.stderr}`);
  }

  const graph = graphSchema.parse(JSON.parse(result.stdout));
  const diagnostics = graph.summary.violations.map(violation => ({ rule: violation.rule.name, path: violation.from, message: `Forbidden import ${violation.from} -> ${violation.to}` }));

  return [...diagnostics, ...featureCycles(graph.modules)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const diagnostics = checkBoundaries(process.cwd());

    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.path} ${diagnostic.rule}: ${diagnostic.message}\n`);

    if (diagnostics.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Boundary checker failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
