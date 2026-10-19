// Runs with plain Node, before `pnpm install`, so it imports only Node built-ins.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

type Status = 'passed' | 'failed' | 'not run';

type Outcome = { name: string; status: Status; detail: string };

type Check = { name: string; run(): Omit<Outcome, 'name'> };

function exec(command: string, args: readonly string[], stdio: 'inherit' | 'ignore' = 'inherit'): number {
  const result = spawnSync(command, args, { stdio, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

  if (result.error) return 127;

  return result.status ?? 1;
}

function step(command: string, args: readonly string[]): Omit<Outcome, 'name'> {
  const code = exec(command, args);
  const shown = [command, ...args].join(' ');

  return code === 0 ? { status: 'passed', detail: `${shown} exited 0` } : { status: 'failed', detail: `${shown} exited ${code}` };
}

const checks: readonly Check[] = [
  {
    name: 'repository access',
    run() {
      const missing = ['package.json', 'wrangler.jsonc'].filter(file => !existsSync(file));

      if (missing.length > 0) return { status: 'failed', detail: `missing ${missing.join(', ')}; run from the repository root` };

      if (exec('git', ['remote', 'get-url', 'origin'], 'ignore') !== 0) return { status: 'not run', detail: 'the repository has no origin' };

      return step('git', ['ls-remote', '--exit-code', '--quiet', 'origin', 'HEAD']);
    },
  },
  { name: 'install', run: () => step('pnpm', ['install', '--frozen-lockfile']) },
  { name: 'build', run: () => step('pnpm', ['build']) },
  {
    name: 'check',
    run() {
      if (exec('docker', ['info'], 'ignore') !== 0) return { status: 'not run', detail: 'Docker is missing or not running; pnpm check needs the local Supabase stack' };
      const code = exec('pnpm', ['check']);

      if (code === 0) return { status: 'passed', detail: 'pnpm check exited 0' };

      return code === 2 ? { status: 'not run', detail: 'pnpm check exited 2 (INCOMPLETE); see its summary above' } : { status: 'failed', detail: `pnpm check exited ${code}; see its summary above` };
    },
  },
];

const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'unknown';

const outcomes: Outcome[] = [];

for (const check of checks) {
  if (outcomes.some(outcome => outcome.status === 'failed')) {
    outcomes.push({ name: check.name, status: 'not run', detail: 'an earlier check failed' });
    continue;
  }

  process.stdout.write(`\n=== ${check.name} ===\n`);
  outcomes.push({ name: check.name, ...check.run() });
}

process.stdout.write(`\n=== pnpm verify summary at ${head} ===\n`);

for (const outcome of outcomes) process.stdout.write(`${outcome.status.padEnd(8)} ${outcome.name}: ${outcome.detail}\n`);

const named = (status: Status) => outcomes.flatMap(outcome => (outcome.status === status ? [outcome.name] : [])).join(', ');

if (named('failed')) {
  process.stderr.write(`\nFAILED at ${named('failed')}.\n`);
  process.exitCode = 1;
} else if (named('not run')) {
  process.stderr.write(`\nINCOMPLETE. Not run: ${named('not run')}. Do not report success.\n`);
  process.exitCode = 2;
} else {
  process.stdout.write('\nAll four checks passed.\n');
}
