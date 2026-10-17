import { relative } from 'node:path';
import { defineRule, eslintCompatPlugin } from '@oxlint/plugins';
import { rules, type Diagnostic } from '../policy.ts';
import { checkSource } from './check-source.ts';

const cache = new Map<string, { source: string; diagnostics: Diagnostic[] }>();

const lintRules = Object.fromEntries(rules.flatMap(rule => {
  if (rule.check !== 'lint') return [];

  return [[rule.id, defineRule({
    meta: { type: 'problem', docs: { description: rule.text }, messages: { violation: '{{message}}' } },
    createOnce(context) {
      return {
        Program(node) {
          const path = relative(process.cwd(), context.filename).split('\\').join('/');

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
