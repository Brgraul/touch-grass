import type { Plugin } from 'vite';

export function clientGraph(): Plugin {
  return {
    name: 'touch-grass-client-graph',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return;
      const chunks = [];

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') chunks.push({ fileName, modules: Object.keys(output.modules) });
      }

      this.emitFile({ type: 'asset', fileName: 'client-module-graph.json', source: JSON.stringify({ version: 1, chunks }, null, 2) });
    },
  };
}
