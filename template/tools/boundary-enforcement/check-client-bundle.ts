import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { browserClosure } from './browser-closure.ts';
import { clientGraphPath } from './client-graph.ts';
import { browserPackages, bundleSentinel, privateEnvironmentNames, type Diagnostic } from './policy.ts';

const graphSchema = z.object({ version: z.literal(1), chunks: z.array(z.object({ fileName: z.string(), modules: z.array(z.string()) })).min(1) });

export function checkClientChunks(root: string, project = process.cwd()): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const closure = browserClosure(project);
  const graph = graphSchema.parse(JSON.parse(readFileSync(clientGraphPath(root), 'utf8')));
  const examined = new Set<string>();
  const report = (path: string, message: string) => diagnostics.push({ rule: 'client-reachability', path, message });

  for (const chunk of graph.chunks) {
    examined.add(chunk.fileName);

    for (const module of chunk.modules) {
      const normalized = module.split('\\').join('/');

      if (/\.server\.[cm]?[jt]sx?(?:\?|$)/.test(normalized) || /\/(?:@supabase|@openai)\//.test(normalized) || /(?:node:|cloudflare:)/.test(normalized)) report(chunk.fileName, `Server module emitted in browser chunk: ${module}`);
      const dependency = normalized.split('/node_modules/').at(-1);

      if (dependency && dependency !== normalized && !dependency.startsWith('.vite/')) {
        const parts = dependency.split('/');
        const name = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        const approved = name === 'zod' || browserPackages.some(allowed => allowed === name) || closure.has(name);

        if (!approved) report(chunk.fileName, `Server package emitted in browser chunk: ${name}`);
      }
    }
  }

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'client-module-graph.json') report(path.slice(root.length + 1), 'The build module graph is in the public asset directory');
      else if (/\.[cm]?js$/.test(entry.name)) {
        const relative = path.slice(root.length + 1).split('\\').join('/');

        if (!examined.has(relative)) report(relative, 'Emitted browser chunk is absent from the build module graph');
        const code = readFileSync(path, 'utf8');

        for (const marker of [...privateEnvironmentNames, bundleSentinel]) {
          if (code.includes(marker)) report(relative, `Private marker emitted in browser chunk: ${marker}`);
        }

        if (/(?:@supabase\/|@openai\/|cloudflare:workers|\.repo\.server\.ts|\.workflow\.server\.ts)/.test(code)) report(relative, 'Server package or source path remains in browser code');
      }
    }
  };

  walk(root);

  return diagnostics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv.includes('--skip-build')) execFileSync('pnpm', ['build'], { stdio: 'inherit' });
    const diagnostics = checkClientChunks(resolve('dist/client'));

    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.path} ${diagnostic.rule}: ${diagnostic.message}\n`);

    if (diagnostics.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Client bundle checker failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
