import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { defineRule, eslintCompatPlugin } from '@oxlint/plugins';
import { rules, type Diagnostic } from '../policy.ts';
import { checkSource } from './check-source.ts';

const cache = new Map<string, { source: string; diagnostics: Diagnostic[] }>();

const roots = new Map<string, string>();

// Rules key on project paths such as `src/platform/mutations.ts`, so a file's path is taken from the nearest package.json above it, wherever Oxlint runs.
function projectPath(filename: string): string {
  const directory = dirname(filename);
  let root = roots.get(directory);

  if (root === undefined) {
    root = directory;

    while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root);
    roots.set(directory, root);
  }

  return relative(root, filename).split('\\').join('/');
}

const lintRules = Object.fromEntries(rules.flatMap(rule => {
  if (rule.check !== 'lint') return [];

  return [[rule.id, defineRule({
    meta: { type: 'problem', docs: { description: rule.text }, messages: { violation: '{{message}}' } },
    createOnce(context) {
      return {
        Program(node) {
          const path = projectPath(context.filename);

          if (path.startsWith('tools/') || path === 'src/routeTree.gen.ts' || path.endsWith('.d.ts')) return;
          const source = context.sourceCode.text;
          let entry = cache.get(path);

          if (!entry || entry.source !== source) {
            entry = { source, diagnostics: checkSource(path, source) };
            cache.set(path, entry);
          }

          for (const diagnostic of entry.diagnostics) {
            if (diagnostic.rule === rule.id) context.report({ node, loc: { line: diagnostic.line ?? 1, column: 0 }, messageId: 'violation', data: { message: diagnostic.message } });
          }
        },
      };
    },
  })]];
}));

export default eslintCompatPlugin({ meta: { name: 'boundaries' }, rules: lintRules });
