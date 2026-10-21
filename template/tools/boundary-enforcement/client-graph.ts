import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

// The graph holds absolute build paths, so it sits beside the client output rather than in it: Workers serves every file in dist/client.
export function clientGraphPath(clientDirectory: string): string {
  return join(dirname(clientDirectory), 'client-module-graph.json');
}

export function clientGraph(): Plugin {
  return {
    name: 'touch-grass-client-graph',
    apply: 'build',
    writeBundle(options, bundle) {
      if (this.environment.name !== 'client' || options.dir === undefined) return;
      const chunks = [];

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') chunks.push({ fileName, modules: Object.keys(output.modules) });
      }

      const path = clientGraphPath(options.dir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ version: 1, chunks }, null, 2));
    },
  };
}
