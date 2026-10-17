import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { parseArgs } from 'node:util';
import { localEnv, workerSecretNames, type LocalSettings } from './local-env.ts';

type Requirement = 'static' | 'stack' | 'stack-and-provider' | 'stack-provider-and-app';

type Step = { name: string; command: readonly string[]; requires: Requirement };

type Outcome = { name: string; status: 'passed' | 'failed' | 'not run'; seconds: number; detail?: string };

const typesFile = 'src/platform/database.types.ts';

const steps: readonly Step[] = [
  { name: 'lint', command: ['pnpm', 'lint'], requires: 'static' },
  { name: 'check:boundaries', command: ['pnpm', 'check:boundaries'], requires: 'static' },
  { name: 'check:repo', command: ['pnpm', 'check:repo'], requires: 'static' },
  { name: 'cf:types', command: ['pnpm', 'cf:types', '--check'], requires: 'static' },
  { name: 'typecheck', command: ['pnpm', 'typecheck'], requires: 'static' },
  { name: 'test', command: ['pnpm', 'test'], requires: 'static' },
  { name: 'check:bundle', command: ['pnpm', 'check:bundle'], requires: 'static' },
  { name: 'db:reset', command: ['pnpm', 'db:reset'], requires: 'stack' },
  { name: 'test:db', command: ['pnpm', 'test:db'], requires: 'stack' },
  { name: 'test:db:races', command: ['pnpm', 'test:db:races'], requires: 'stack' },
  { name: 'test:workers', command: ['pnpm', 'test:workers'], requires: 'stack-and-provider' },
  { name: 'test:e2e', command: ['pnpm', 'test:e2e'], requires: 'stack-provider-and-app' },
  { name: 'db:types', command: ['pnpm', 'db:types'], requires: 'stack' },
];

const { values: options } = parseArgs({
  options: {
    skip: { type: 'string', default: '' },
    only: { type: 'string', default: '' },
    list: { type: 'boolean', default: false },
  },
});

const split = (value: string) => value.split(',').map(name => name.trim()).filter(Boolean);

const skipped = new Set(split(options.skip));

const only = new Set(split(options.only));

for (const name of [...skipped, ...only]) {
  if (!steps.some(step => step.name === name)) fail(`Unknown step "${name}". Steps: ${steps.map(step => step.name).join(', ')}`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function run(command: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(done => {
    const [file, ...args] = command;
    const child = spawn(file, args, { stdio: 'inherit', env });

    child.on('error', error => {
      process.stderr.write(`Could not start ${command.join(' ')}: ${error.message}\n`);
      done(127);
    });
    child.on('exit', code => done(code ?? 1));
  });
}

function isListening(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect({ host: '127.0.0.1', port });

    socket.on('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.on('error', () => done(false));
  });
}

async function waitForListening(port: number, label: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isListening(port)) return;
    await new Promise(wait => setTimeout(wait, 500));
  }

  throw new Error(`${label} did not start listening on port ${port}`);
}

const providerPort = 4010;

let providerDouble: ChildProcess | undefined;

let createdDevVars = false;

async function ensureProviderDouble(env: NodeJS.ProcessEnv): Promise<void> {
  if (await isListening(providerPort)) return;
  providerDouble = spawn('node', ['--import', 'tsx', 'tests/fixtures/provider-double.ts'], { stdio: 'inherit', env });
  await waitForListening(providerPort, 'The provider double');
}

function ensureDevVars(settings: LocalSettings): void {
  if (existsSync('.dev.vars')) return;
  writeFileSync('.dev.vars', `${workerSecretNames.map(name => `${name}=${settings[name]}`).join('\n')}\n`, { mode: 0o600 });
  createdDevVars = true;
}

function cleanUp(): void {
  providerDouble?.kill();

  if (createdDevVars) rmSync('.dev.vars', { force: true });
}

let stack: LocalSettings | Error | undefined;

function stackSettings(): LocalSettings {
  if (!stack) {
    try {
      stack = localEnv();
    } catch (error) {
      stack = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (stack instanceof Error) throw stack;

  return stack;
}

async function runStep(step: Step): Promise<string | undefined> {
  const env: NodeJS.ProcessEnv = step.requires === 'static' ? process.env : Object.assign({}, process.env, stackSettings());

  if (step.requires === 'stack-and-provider' || step.requires === 'stack-provider-and-app') await ensureProviderDouble(env);

  if (step.requires === 'stack-provider-and-app') ensureDevVars(stackSettings());
  const stale = step.name === 'db:types' ? readFileSync(typesFile, 'utf8') : undefined;
  const code = await run(step.command, env);

  if (code !== 0) return `exit code ${code}`;

  if (stale !== undefined && readFileSync(typesFile, 'utf8') !== stale) return `${typesFile} differs from the regenerated types. Commit the regenerated file.`;
}

async function main(): Promise<void> {
  if (options.list) {
    process.stdout.write(`${steps.map(step => step.name).join('\n')}\n`);

    return;
  }

  const outcomes: Outcome[] = [];
  let failed = false;

  for (const step of steps) {
    const selected = only.size === 0 ? !skipped.has(step.name) : only.has(step.name);

    if (!selected) {
      outcomes.push({ name: step.name, status: 'not run', seconds: 0, detail: only.size === 0 ? 'skipped with --skip' : 'not selected with --only' });
      continue;
    }

    if (failed) {
      outcomes.push({ name: step.name, status: 'not run', seconds: 0, detail: 'an earlier step failed' });
      continue;
    }

    process.stdout.write(`\n=== ${step.name} ===\n`);
    const started = Date.now();
    let detail: string | undefined;

    try {
      detail = await runStep(step);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    outcomes.push({ name: step.name, status: detail === undefined ? 'passed' : 'failed', seconds, detail });

    if (detail !== undefined) failed = true;
  }

  report(outcomes);
}

function report(outcomes: readonly Outcome[]): void {
  process.stdout.write('\n=== pnpm check summary ===\n');

  for (const outcome of outcomes) {
    const timing = outcome.status === 'not run' ? '' : ` (${outcome.seconds}s)`;
    process.stdout.write(`${outcome.status.padEnd(8)} ${outcome.name}${timing}${outcome.detail ? `: ${outcome.detail}` : ''}\n`);
  }

  const failures = outcomes.filter(outcome => outcome.status === 'failed');
  const notRun = outcomes.filter(outcome => outcome.status === 'not run');

  if (failures.length > 0) {
    process.stderr.write(`\nFAILED at ${failures.map(outcome => outcome.name).join(', ')}.\n`);
    process.exitCode = 1;
  } else if (notRun.length > 0) {
    process.stderr.write(`\nINCOMPLETE. Not run: ${notRun.map(outcome => outcome.name).join(', ')}. Do not report success.\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write('\nAll steps passed.\n');
  }
}

process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});

try {
  await main();
} finally {
  cleanUp();
}
