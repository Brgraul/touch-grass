import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { browserPackages, closureBarrier } from './policy.ts';

const manifestSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });

const keyPattern = /^(?:'([^']+)'|"([^"]+)"|([^\s:]+)):/;

function keyOf(line: string): string | undefined {
  const match = keyPattern.exec(line.trim());

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

// `@scope/name@1.2.3(peer@4.5.6)` -> `@scope/name`
function packageName(snapshot: string): string {
  const bare = snapshot.replace(/\(.*$/, '');

  return bare.slice(0, bare.lastIndexOf('@'));
}

// Reads the `dependencies` of every entry in the lockfile's `snapshots` section, by package name.
export function lockfileDependencies(lockfile: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  let inSnapshots = false;
  let current: Set<string> | undefined;
  let inDependencies = false;

  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) {
      inSnapshots = line.startsWith('snapshots:');
      current = undefined;
      continue;
    }

    const key = inSnapshots ? keyOf(line) : undefined;
    const indent = line.length - line.trimStart().length;

    if (key === undefined) continue;

    if (indent === 2) {
      const name = packageName(key);
      current = graph.get(name) ?? new Set<string>();
      graph.set(name, current);
      inDependencies = false;
    } else if (indent === 4) inDependencies = key === 'dependencies';
    else if (indent === 6 && inDependencies) current?.add(key);
  }

  return graph;
}

// The packages a browser chunk may contain beyond the named browser packages: their dependency closure in the lockfile.
// The closure stops at packages the framework only runs on the server or at build time.
export function browserClosure(project: string): Set<string> {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')));
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
  const graph = lockfileDependencies(readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8'));
  const pending: string[] = browserPackages.filter(name => declared.has(name));
  const closure = new Set<string>();

  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (closure.has(name) || closureBarrier.test(name)) continue;
    closure.add(name);
    pending.push(...graph.get(name) ?? []);
  }

  return closure;
}
