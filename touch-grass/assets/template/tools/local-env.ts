import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const stackStatus = z.object({
  API_URL: z.string(),
  DB_URL: z.string(),
  PUBLISHABLE_KEY: z.string().optional(),
  ANON_KEY: z.string().optional(),
  SECRET_KEY: z.string().optional(),
  SERVICE_ROLE_KEY: z.string().optional(),
});

export const workerSecretNames = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'LLM_API_KEY'] as const;

const settingsSchema = z.object({
  ENVIRONMENT_ID: z.string().default('00000000-0000-4000-8000-000000000001'),
  APP_URL: z.string().default('http://127.0.0.1:3000'),
  SUPABASE_URL: z.string(),
  SUPABASE_PUBLISHABLE_KEY: z.string(),
  SUPABASE_SECRET_KEY: z.string(),
  LLM_BASE_URL: z.string().default('http://127.0.0.1:4010/v1'),
  LLM_API_KEY: z.string().default('local-test-llm-key'),
  LLM_MODEL: z.string().default('test-model'),
  TEST_DATABASE_URL: z.string(),
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: z.string().default('local-test-client'),
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: z.string().default('local-test-secret'),
});

export type LocalSettings = z.infer<typeof settingsSchema>;

function readStackStatus(): z.infer<typeof stackStatus> {
  let output: string;

  try {
    output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('The local Supabase stack is not running. Start it with `pnpm exec supabase start`, or put the local settings in .env.test.');
  }

  const parsed = stackStatus.safeParse(JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)));

  if (!parsed.success) throw new Error(`Unexpected \`supabase status\` output: ${parsed.error.message}`);

  return parsed.data;
}

function derivedFromStack() {
  const status = readStackStatus();
  const publishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;

  if (!publishable || !secret) throw new Error('`supabase status` reported no publishable or secret key.');

  return { SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: publishable, SUPABASE_SECRET_KEY: secret, TEST_DATABASE_URL: status.DB_URL };
}

/** Settings for the local stack. Precedence: process environment, then `.env.test`, then the running Supabase stack. */
export function localEnv(root = process.cwd()): LocalSettings {
  const file = resolve(root, '.env.test');
  const base = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : derivedFromStack();
  const overrides = Object.fromEntries(Object.keys(settingsSchema.shape).flatMap(name => (process.env[name] ? [[name, process.env[name]]] : [])));

  return settingsSchema.parse({ ...base, ...overrides });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = resolve('.dev.vars');

  if (existsSync(target) && !process.argv.includes('--force')) {
    process.stderr.write('.dev.vars already exists. Pass --force to overwrite it.\n');
    process.exitCode = 1;
  } else {
    const settings = localEnv();
    writeFileSync(target, `${workerSecretNames.map(name => `${name}=${settings[name]}`).join('\n')}\n`, { mode: 0o600 });
    process.stdout.write('Wrote .dev.vars with the local Supabase keys and a placeholder LLM key.\n');
  }
}
