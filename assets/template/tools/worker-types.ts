import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// `wrangler types` infers two types from the Worker entry module. Importing src/server.ts into the
// global Env makes TypeScript lose the router's request context type, so both become plain types.
const output = 'worker-configuration.d.ts';

const secretNames = '.dev.vars.example';

const inferred = [
  {
    pattern: /Workflow<Parameters<import\("\.\/src\/server"\)\.AgentChatWorkflow\['run'\]>\[0\]\['payload'\]>/gu,
    replacement: 'Workflow',
  },
  {
    pattern: /\tinterface GlobalProps \{\n\t\tmainModule: typeof import\("\.\/src\/server"\);\n\t\}\n/gu,
    replacement: '',
  },
];

function generate(): string {
  // Wrangler skips the write when the header hash matches, which would hide a hand edit.
  rmSync(output, { force: true });
  execFileSync('pnpm', ['exec', 'wrangler', 'types', output, `--env-file=${secretNames}`], { stdio: ['ignore', 'ignore', 'inherit'] });

  const generated = inferred.reduce((text, { pattern, replacement }) => text.replace(pattern, replacement), readFileSync(output, 'utf8'));

  if (generated.includes('import("./src/server")')) {
    throw new Error(`${output} imports src/server.ts in a form tools/worker-types.ts does not rewrite. Update its patterns.`);
  }

  return generated;
}

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const committed = readFileSync(output, 'utf8');

const generated = generate();

if (values.check && generated !== committed) {
  writeFileSync(output, committed);
  process.stderr.write(`${output} is stale. Run pnpm cf:types and commit the result.\n`);
  process.exit(1);
}

writeFileSync(output, generated);
