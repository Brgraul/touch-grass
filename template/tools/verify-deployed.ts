import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';
import { localEnv } from './local-env.ts';
import { environmentVars, findPlaceholder } from './placeholders.ts';

const { values: options } = parseArgs({
  options: {
    env: { type: 'string' },
    'run-timeout': { type: 'string', default: '120' },
  },
});

const settingsSchema = z.object({
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  LLM_BASE_URL: z.url().optional(),
});

type Settings = z.infer<typeof settingsSchema>;

type TestUsers = typeof import('../tests/fixtures/test-users.ts');

type TestUser = Awaited<ReturnType<TestUsers['createTestUser']>>;

type Check = { name: string; run: () => Promise<string> };

const authSettings = z.object({ external: z.object({ google: z.boolean().optional() }).optional() });

const runTimeoutMs = Number(options['run-timeout']) * 1000;

class PrerequisiteError extends Error {}

async function loadSettings(environment: string): Promise<Settings> {
  if (environment === 'local') return settingsSchema.parse(localEnv());

  const { unstable_readConfig: readConfig } = await import('wrangler');
  const vars = environmentVars.parse(readConfig({ config: 'wrangler.jsonc', env: environment }).vars);
  const stale = findPlaceholder(vars);

  if (stale) throw new PrerequisiteError(`wrangler.jsonc still holds a placeholder for ${stale} in the "${environment}" environment. Replace it before deploying.`);
  const settings = settingsSchema.safeParse({ ...vars, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY });

  if (!settings.success) {
    const names = settings.error.issues.map(issue => issue.path.join('.')).join(', ');
    throw new PrerequisiteError(`Missing or invalid settings: ${names}. Non-secret settings come from the "${environment}" block of wrangler.jsonc. Export SUPABASE_SECRET_KEY for the secret.`);
  }

  return settings.data;
}

async function requireSupabase(settings: Settings): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${settings.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: settings.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new PrerequisiteError('The Supabase project is unreachable. A Free project pauses after inactivity. Restore it in the Supabase dashboard, then run this check again.');
  }

  if (response.status >= 500) throw new PrerequisiteError(`The Supabase project answered ${response.status}. If the project is paused, restore it in the Supabase dashboard.`);

  if (!response.ok) throw new PrerequisiteError(`Supabase Auth settings answered ${response.status}. Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.`);

  const parsed = authSettings.safeParse(await response.json());

  if (!parsed.success || !parsed.data.external?.google) {
    throw new PrerequisiteError('The Google provider is disabled on this Supabase project. Run `supabase config push` with the Google client ID and secret set.');
  }

  return 'Supabase Auth reachable, Google provider enabled';
}

async function expectSignedOutRedirect(page: Page): Promise<string> {
  const response = await page.goto('/chat');

  if (!response?.ok()) throw new Error(`The app answered ${response?.status()} for /chat`);

  if (new URL(page.url()).pathname !== '/login') throw new Error(`/chat did not redirect a signed-out visitor to /login (ended at ${page.url()})`);

  return 'signed-out visitors are redirected to /login';
}

async function expectProtectedPages(page: Page, user: TestUser): Promise<string> {
  await page.goto('/chat');
  await page.getByLabel('Message').waitFor();

  if (new URL(page.url()).pathname !== '/chat') throw new Error(`/chat redirected to ${page.url()} for a signed-in user`);
  await page.goto('/account');

  if (await page.getByLabel('Google account').inputValue() !== user.email) throw new Error('/account did not show the signed-in test user');

  return '/chat and /account served to the signed-in user';
}

async function sendMessageAndAwaitRun(page: Page, marker: string): Promise<string> {
  await page.goto('/chat');
  await page.getByLabel('Message').fill(`Reply with the single word "ready". Reference: ${marker}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.waitForURL(/\/chat\/[^/]+$/);

  const outcome = await Promise.race([
    page.getByText('Completed', { exact: true }).waitFor({ timeout: runTimeoutMs }).then(() => 'completed' as const),
    page.getByRole('button', { name: 'Send again' }).waitFor({ timeout: runTimeoutMs }).then(() => 'unfinished' as const),
  ]).catch(() => 'timeout' as const);

  if (outcome === 'timeout') throw new Error(`The run did not finish within ${runTimeoutMs / 1000}s. It was still queued or running.`);

  if (outcome === 'unfinished') throw new Error(`The run did not complete: ${(await page.getByRole('status').allInnerTexts()).join(' ').trim() || 'no reason shown'}`);

  return `run completed at ${new URL(page.url()).pathname}`;
}

async function expectProviderRequest(settings: Settings, marker: string): Promise<string> {
  const origin = new URL(settings.LLM_BASE_URL ?? '').origin;
  const recorded = await (await fetch(`${origin}/requests`)).text();

  if (!recorded.includes(marker)) throw new Error('The provider double recorded no request carrying this run\'s marker');

  return 'provider double recorded the request';
}

async function runChecks(checks: readonly Check[]): Promise<boolean> {
  for (const { name, run } of checks) {
    try {
      process.stdout.write(`ok    ${name}: ${await run()}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`FAIL  ${name}: ${error instanceof PrerequisiteError ? `Failed prerequisite. ${message}` : message}\n`);

      return false;
    }
  }

  return true;
}

async function verify(environment: string, settings: Settings): Promise<boolean> {
  Object.assign(process.env, { SUPABASE_URL: settings.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: settings.SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: settings.SUPABASE_SECRET_KEY, APP_URL: settings.APP_URL });
  const users: TestUsers = await import('../tests/fixtures/test-users.ts');

  if (!await runChecks([{ name: 'supabase', run: () => requireSupabase(settings) }])) return false;

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (await browser.newContext({ baseURL: settings.APP_URL })).newPage();
  const marker = `verify-deployed-${crypto.randomUUID()}`;
  let user: TestUser | undefined;

  const requireUser = () => {
    if (!user) throw new Error('No test user exists');

    return user;
  };

  const checks: Check[] = [
    { name: 'app', run: () => expectSignedOutRedirect(page) },
    { name: 'test user', run: async () => {
      user = await users.createTestUser();

      return 'created through the admin API';
    } },
    { name: 'sign in', run: async () => {
      await users.signInAs(page, requireUser());

      return 'password session accepted';
    } },
    { name: 'protected pages', run: () => expectProtectedPages(page, requireUser()) },
    { name: 'message and run', run: () => sendMessageAndAwaitRun(page, marker) },
  ];

  if (environment === 'local') checks.push({ name: 'provider request', run: () => expectProviderRequest(settings, marker) });

  try {
    return await runChecks(checks);
  } finally {
    await browser.close();

    if (user) {
      const created = user;

      const cleaned = await runChecks([{ name: 'cleanup', run: async () => {
        await users.deleteTestUser(created);

        return 'test user deleted';
      } }]);

      if (!cleaned) process.exitCode = 1;
    }
  }
}

const environment = options.env;

if (!environment) {
  process.stderr.write('Usage: pnpm verify:deployed --env <local|environment>\n');
  process.exit(2);
}

let verified = false;

try {
  verified = await verify(environment, await loadSettings(environment));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`FAIL  settings: ${error instanceof PrerequisiteError ? `Failed prerequisite. ${message}` : message}\n`);
}

if (!verified || process.exitCode) {
  process.stderr.write(`\nUNVERIFIED. "${environment}" did not pass every check.\n`);
  process.exit(1);
}

process.stdout.write(`\nVERIFIED. "${environment}" passed every check.\n`);
