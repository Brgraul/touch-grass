import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emit, pipe, type Status, statuses } from './lib/events.ts';
import { run, StepError } from './lib/exec.ts';
import {
  configureSupabase, configureWrangler, deployRefs, type Environment, parseEnvironment, parseSecretName, placeholderEnvironmentId,
  placeholderVar, type PoolerEntry, readStored, redact, secretNames, secretsPath, sessionPoolerUrl, stagingSteps, type Stored, storedNames, traceCheckEnv, updateStored, workerSecrets,
} from './lib/staging.ts';

export const usage = `Usage: tg staging <command> [--env dev|production]
  login-supabase                  Run \`supabase login\` here and press its Enter prompt. Needs a visible terminal.
  login-cloudflare                Run \`wrangler login\` here. Needs a visible terminal.
  supabase --region <code> [--org <slug>] [--confirm-cost]
                                  Create or reuse the environment's Supabase project and store its keys privately.
                                  A paid organization needs --confirm-cost after the person agrees to the cost.
  configure [--account <id>]      Fill wrangler.jsonc and supabase/config.toml for the environment.
  google <client_secret.json>     Store a downloaded OAuth client's ID and secret privately.
  set <NAME>                      Read one secret from stdin, hidden in a terminal.
  llm-check                       Check LLM_API_KEY against the environment's LLM_BASE_URL and LLM_MODEL.
  deploy                          Build, push migrations and Auth config, deploy the Worker, install Worker secrets.
  verify                          Run \`pnpm verify:deployed\` for the environment.
  trace-check                     Send one chat message to the deployed app and check that its trace lands in Langfuse.
  mark <step> <status>            Record progress on a step you drive in the browser, for \`tg watch\`.
  status                          Show stored names and remaining placeholders. Prints no values.
Run from the generated repository root. Each write merges into the current file.
Secrets live in .env.deploy.<env> with mode 0600.`;

const supabaseApi = 'https://api.supabase.com';
const cloudflareApi = 'https://api.cloudflare.com/client/v4';

type Context = { root: string; repo: string; environment: Environment; path: string; stored: Stored };

async function call<T>(base: string, token: string, method: string, path: string, body?: unknown, allowMissing = false): Promise<T | undefined> {
  const label = `${method} ${base}${path.split('?')[0]}`;
  let response: Response;
  try {
    response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'touch-grass' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new StepError(`${label} did not answer. Check connectivity and retry.`); }
  const text = await response.text();
  if (allowMissing && response.status === 404) return undefined;
  // Management and Cloudflare error bodies describe the request, not secrets.
  if (!response.ok) throw new StepError(`${label} answered ${response.status}: ${text.slice(0, 300)}`);
  try { return (text ? JSON.parse(text) : null) as T; } catch { throw new StepError(`${label} returned invalid JSON.`); }
}

async function must<T>(base: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  return (await call<T>(base, token, method, path, body)) as T;
}

function pnpm(): [string, string[]] {
  return run('corepack', ['--version']).status === 0 ? ['corepack', ['pnpm']] : ['pnpm', []];
}

function bin(root: string, name: 'supabase' | 'wrangler'): string {
  const path = join(root, 'node_modules', '.bin', name);
  if (!existsSync(path)) throw new StepError('Dependencies are missing. Run `pnpm install --frozen-lockfile` first.');
  return path;
}

function supabaseToken(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const stores: Array<() => string> = [
    () => run('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w']).stdout.trim(),
    () => run('secret-tool', ['lookup', 'service', 'Supabase CLI', 'username', 'supabase']).stdout.trim(),
    () => { const file = join(homedir(), '.supabase', 'access-token'); return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''; },
  ];
  for (const store of stores) {
    const raw = store();
    if (raw) return raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8') : raw;
  }
  throw new StepError('No Supabase CLI login found. Run `tg staging login-supabase` in a visible terminal first.');
}

function cloudflareToken(root: string): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // whoami refreshes an expired OAuth token before it is read from wrangler's config.
  if (run(bin(root, 'wrangler'), ['whoami'], { cwd: root }).status !== 0) throw new StepError('Wrangler is not logged in. Run `tg staging login-cloudflare` in a visible terminal first.');
  const dirs = [join(homedir(), 'Library', 'Preferences', '.wrangler'), join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), '.wrangler'), join(homedir(), '.wrangler')];
  for (const dir of dirs) {
    const file = join(dir, 'config', 'default.toml');
    const token = existsSync(file) ? /^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'))?.[1] : undefined;
    if (token) return token;
  }
  throw new StepError('Wrangler is logged in, but its OAuth token was not found. Export CLOUDFLARE_API_TOKEN instead.');
}

async function readWranglerEnv(root: string, environment: Environment): Promise<{ name?: string; vars: Record<string, string> }> {
  const resolved = createRequire(join(root, 'package.json')).resolve('wrangler');
  const { unstable_readConfig: readConfig } = await import(pathToFileURL(resolved).href) as { unstable_readConfig(options: { config: string; env: string }): { name?: string; vars?: Record<string, unknown> } };
  const config = readConfig({ config: join(root, 'wrangler.jsonc'), env: environment });
  return { name: config.name, vars: Object.fromEntries(Object.entries(config.vars ?? {}).map(([key, value]) => [key, String(value)])) };
}

function save(context: Context, update: Stored): void {
  context.stored = updateStored(context.path, update);
}

/** Runs a step's command with its output in the log, printing only its last lines: always when `show` is set, otherwise on failure. */
async function piped(context: Context, step: string, command: string, args: string[], env: NodeJS.ProcessEnv, hidden: readonly (string | undefined)[], show = false): Promise<void> {
  const { code, tail, log } = await pipe(context.root, step, command, args, { env, hidden });
  if (show || code !== 0) process.stderr.write(tail.slice(-15).join('\n') + '\n');
  if (code !== 0) throw new StepError(`${[basename(command), ...args.slice(-1)].join(' ')} exited with ${code}.${log ? ` Its full output is in ${log}.` : ''}`);
}

async function readHidden(name: string): Promise<string> {
  const tty = process.stdin.isTTY;
  const restore = () => { if (tty) spawnSync('stty', ['echo'], { stdio: 'inherit' }); };
  const interrupted = () => { restore(); process.exit(130); };
  if (tty) { process.stderr.write(`${name} (input hidden): `); spawnSync('stty', ['-echo'], { stdio: 'inherit' }); process.once('SIGINT', interrupted); }
  try {
    const lines = createInterface({ input: process.stdin });
    const line = await new Promise<string>(resolve => { lines.once('line', resolve); lines.once('close', () => resolve('')); });
    lines.close();
    const value = line.trim();
    return value.startsWith(`${name}=`) ? value.slice(name.length + 1) : value;
  } finally {
    if (tty) { process.off('SIGINT', interrupted); restore(); process.stderr.write('\n'); }
  }
}

type Project = { ref: string; name: string; status: string; region: string; created_at?: string; organization_slug?: string; organization_id?: string };
const orgOf = (project: Project) => project.organization_slug ?? project.organization_id;

export async function supabase(context: Context, options: { region?: string; org?: string; 'confirm-cost'?: boolean }): Promise<void> {
  const token = supabaseToken();
  const name = `${context.repo}-${context.environment}`;
  const projects = await must<Project[]>(supabaseApi, token, 'GET', '/v1/projects');
  let project = context.stored.SUPABASE_PROJECT_REF ? projects.find(p => p.ref === context.stored.SUPABASE_PROJECT_REF) : undefined;
  if (context.stored.SUPABASE_PROJECT_REF && !project) throw new StepError(`The stored project ${context.stored.SUPABASE_PROJECT_REF} no longer exists. Inspect it before retrying; no replacement will be created.`);

  if (!project) {
    const orgs = await must<Array<{ id: string; slug?: string; name: string }>>(supabaseApi, token, 'GET', '/v1/organizations');
    const slugs = orgs.map(o => ({ slug: o.slug ?? o.id, name: o.name }));
    const org = options.org ?? context.stored.SUPABASE_ORG ?? (slugs.length === 1 ? slugs[0]?.slug : undefined);
    if (!org) throw new StepError(`Pass --org with one of: ${slugs.map(o => `${o.slug} (${o.name})`).join(', ')}.`);
    const sameName = projects.find(p => p.name === name && orgOf(p) === org);
    const started = context.stored.SUPABASE_CREATE_STARTED;
    // A same-name project is ours only if this file recorded starting its creation in that org before it appeared.
    const ours = sameName && started && context.stored.SUPABASE_ORG === org && context.stored.SUPABASE_DB_PASSWORD && (sameName.created_at ?? '') >= started;
    if (sameName && !ours) throw new StepError(`Project ${name} (${sameName.ref}) already exists and this helper has no record of creating it. It will not be adopted.`);
    project = sameName;

    if (!project) {
      if (!options.region) throw new StepError('Pass --region with a Supabase region code, for example eu-central-1.');
      const details = await must<{ plan?: string }>(supabaseApi, token, 'GET', `/v1/organizations/${org}`);
      const active = projects.filter(p => orgOf(p) === org && p.status !== 'INACTIVE' && p.status !== 'REMOVED');
      if (details.plan === 'free' && active.length >= 2) throw new StepError(`Organization ${org} is on the Free plan and already has 2 active projects: ${active.map(p => p.name).join(', ')}. Pause one or choose another organization.`);
      if (details.plan !== 'free' && !options['confirm-cost']) throw new StepError(`Organization ${org} is on the ${details.plan ?? 'unknown'} plan, so a new project adds compute cost. Ask the person, then rerun with --confirm-cost.`);
      save(context, { SUPABASE_DB_PASSWORD: context.stored.SUPABASE_DB_PASSWORD ?? randomBytes(24).toString('base64url'), SUPABASE_ORG: org, SUPABASE_CREATE_STARTED: new Date(Date.now() - 60_000).toISOString() });
      project = await must<Project>(supabaseApi, token, 'POST', '/v1/projects', { organization_slug: org, name, db_pass: context.stored.SUPABASE_DB_PASSWORD, region_selection: { type: 'specific', code: options.region } });
      process.stdout.write(`created project ${name} (${project.ref})\n`);
    }
    save(context, { SUPABASE_PROJECT_REF: project.ref });
  }

  const ref = project.ref;
  const password = context.stored.SUPABASE_DB_PASSWORD;
  if (!password) throw new StepError(`No stored database password for project ${ref}.`);
  for (let attempt = 0; project.status !== 'ACTIVE_HEALTHY'; attempt++) {
    if (project.status === 'INACTIVE' || project.status === 'PAUSED') throw new StepError(`Project ${ref} is paused. Ask the person to restore it in the Supabase dashboard, then rerun.`);
    if (attempt === 90) throw new StepError(`Project ${ref} is still ${project.status} after 15 minutes. Rerun this command later.`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    project = await must<Project>(supabaseApi, token, 'GET', `/v1/projects/${ref}`);
  }

  type Key = { type?: string; api_key?: string };
  const keys = await must<Key[]>(supabaseApi, token, 'GET', `/v1/projects/${ref}/api-keys?reveal=true`);
  const secret = keys.find(k => k.type === 'secret') ?? await must<Key>(supabaseApi, token, 'POST', `/v1/projects/${ref}/api-keys?reveal=true`, { type: 'secret', name: 'worker' });
  if (!secret.api_key) throw new StepError('Supabase did not reveal a secret API key. The account may lack secret-key permission.');
  const pooler = await must<PoolerEntry[]>(supabaseApi, token, 'GET', `/v1/projects/${ref}/config/database/pooler`);
  save(context, { SUPABASE_SECRET_KEY: secret.api_key, SUPABASE_DB_URL: sessionPoolerUrl(pooler, password) });
  process.stdout.write(`project ${project.name} ${ref} ${project.region} ${project.status}\nstored in ${basename(context.path)}: ${secretNames.filter(n => context.stored[n]).join(', ')}\n`);
}

async function cloudflareAccount(context: Context, token: string, requested?: string): Promise<string> {
  if (requested ?? context.stored.CLOUDFLARE_ACCOUNT_ID) return (requested ?? context.stored.CLOUDFLARE_ACCOUNT_ID) as string;
  const accounts = (await must<{ result: Array<{ id: string; name: string }> }>(cloudflareApi, token, 'GET', '/accounts')).result;
  if (accounts.length !== 1 || !accounts[0]) throw new StepError(`Pass --account with one of: ${accounts.map(a => `${a.id} (${a.name})`).join(', ')}.`);
  return accounts[0].id;
}

async function configure(context: Context, options: { account?: string }): Promise<void> {
  const ref = context.stored.SUPABASE_PROJECT_REF;
  if (!ref) throw new StepError('Run `tg staging supabase` first.');
  const keys = await must<Array<{ type?: string; api_key?: string }>>(supabaseApi, supabaseToken(), 'GET', `/v1/projects/${ref}/api-keys?reveal=false`);
  const publishableKey = keys.find(k => k.type === 'publishable')?.api_key;
  if (!publishableKey) throw new StepError(`Project ${ref} has no publishable key.`);

  const token = cloudflareToken(context.root);
  const account = await cloudflareAccount(context, token, options.account);
  const subdomain = (await must<{ result: { subdomain?: string } }>(cloudflareApi, token, 'GET', `/accounts/${account}/workers/subdomain`)).result.subdomain;
  if (!subdomain) throw new StepError('This Cloudflare account has no workers.dev subdomain. Choose one in the dashboard under Workers & Pages, then rerun.');

  const wranglerPath = join(context.root, 'wrangler.jsonc');
  const supabasePath = join(context.root, 'supabase', 'config.toml');
  const wrangler = configureWrangler(readFileSync(wranglerPath, 'utf8'), context.environment, { repo: context.repo, subdomain, projectRef: ref, publishableKey, environmentId: randomUUID() });
  const toml = configureSupabase(readFileSync(supabasePath, 'utf8'), context.environment, ref, wrangler.appUrl);
  writeFileSync(wranglerPath, wrangler.text);
  writeFileSync(supabasePath, toml);
  save(context, { CLOUDFLARE_ACCOUNT_ID: account });
  process.stdout.write(`configured ${context.environment}: Worker ${wrangler.worker} at ${wrangler.appUrl} -> https://${ref}.supabase.co (Cloudflare account ${account})\n`);

  const [command, prefix] = pnpm();
  for (const args of [['check:repo'], ['exec', 'tsx', 'tools/placeholders.ts', context.environment]]) {
    const result = run(command, [...prefix, ...args], { cwd: context.root });
    if (result.status !== 0) throw new StepError(`pnpm ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  }
  process.stdout.write('check:repo and placeholder check passed\n');
}

function google(context: Context, file: string | undefined): void {
  if (!file) throw new StepError('Pass the downloaded client_secret_*.json path.');
  let web: { client_id?: string; client_secret?: string; redirect_uris?: string[] } | undefined;
  try { web = (JSON.parse(readFileSync(file, 'utf8')) as { web?: typeof web }).web; } catch { throw new StepError('The file is not readable OAuth client JSON.'); }
  if (!web?.client_id || !web.client_secret) throw new StepError('The file is not a Web application OAuth client.');
  const callback = context.stored.SUPABASE_PROJECT_REF && `https://${context.stored.SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback`;
  if (callback && !web.redirect_uris?.includes(callback)) throw new StepError(`The client's redirect URIs do not include ${callback}. Add it in the console, download again and rerun.`);
  save(context, { SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: web.client_id, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: web.client_secret });
  process.stdout.write(`stored Google client ${web.client_id}\n`);
}

async function llmCheck(context: Context): Promise<void> {
  const key = context.stored.LLM_API_KEY;
  if (!key) throw new StepError('No LLM_API_KEY stored. Run `tg staging set LLM_API_KEY` in a visible terminal.');
  const { vars } = await readWranglerEnv(context.root, context.environment);
  let response: Response;
  try { response = await fetch(`${vars.LLM_BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) }); }
  catch { throw new StepError(`${vars.LLM_BASE_URL}/models did not answer.`); }
  if (!response.ok) throw new StepError(`${vars.LLM_BASE_URL}/models answered ${response.status}. Check the key, its project and billing.`);
  const ids = ((await response.json().catch(() => ({}))) as { data?: Array<{ id?: string }> }).data?.map(m => m.id) ?? [];
  if (ids.length && !ids.includes(vars.LLM_MODEL)) throw new StepError(`The key works, but ${vars.LLM_MODEL} is not among its models. Set LLM_MODEL in wrangler.jsonc to an available model.`);
  process.stdout.write(`LLM key accepted by ${vars.LLM_BASE_URL}; model ${vars.LLM_MODEL} ${ids.length ? 'available' : 'not listed by this provider'}\n`);
}

type Binding = { type?: string; name?: string; text?: string };

/** Resolves to the deployed APP_URL, which `tg watch` shows when setup is complete. */
async function deploy(context: Context): Promise<string | undefined> {
  const missing = secretNames.filter(name => !context.stored[name]);
  if (missing.length) throw new StepError(`Missing in ${basename(context.path)}: ${missing.join(', ')}.`);
  const secrets = workerSecrets(context.stored);
  const { name: worker, vars } = await readWranglerEnv(context.root, context.environment);
  const refs = deployRefs(context.stored, vars.SUPABASE_URL);
  if (!refs.config || refs.stored !== refs.config || refs.database !== refs.config) throw new StepError(`Project refs disagree: stored ${refs.stored}, wrangler.jsonc ${refs.config}, database URL ${refs.database}. Rerun \`tg staging supabase\` and \`configure\`.`);
  if (!worker || !vars.ENVIRONMENT_ID || placeholderEnvironmentId.test(vars.ENVIRONMENT_ID)) throw new StepError('Run `tg staging configure` first.');

  const cfToken = cloudflareToken(context.root);
  const account = await cloudflareAccount(context, cfToken);
  const settings = await call<{ result?: { bindings?: Binding[] } }>(cloudflareApi, cfToken, 'GET', `/accounts/${account}/workers/scripts/${worker}/settings`, undefined, true);
  const deployedId = settings?.result?.bindings?.find(b => b.name === 'ENVIRONMENT_ID')?.text;
  if (settings && deployedId !== vars.ENVIRONMENT_ID) throw new StepError(`Worker ${worker} already exists on account ${account} for another environment (ENVIRONMENT_ID ${deployedId ?? 'unset'}). It will not be overwritten. Rename this environment's Worker in wrangler.jsonc.`);

  const token = supabaseToken();
  const { SUPABASE_DB_URL, SUPABASE_SECRET_KEY, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET, LLM_API_KEY, SUPABASE_DB_PASSWORD } = context.stored;
  const hidden = [SUPABASE_DB_PASSWORD, SUPABASE_DB_URL, SUPABASE_SECRET_KEY, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET, LLM_API_KEY, context.stored.LANGFUSE_SECRET_KEY, token].filter((v): v is string => !!v);
  const cloudflare = { CLOUDFLARE_ENV: context.environment, CLOUDFLARE_ACCOUNT_ID: account };
  const [command, prefix] = pnpm();
  await piped(context, 'deploy', command, [...prefix, 'build'], { ...process.env, ...cloudflare }, hidden);
  const buildSecrets = { SUPABASE_ACCESS_TOKEN: token, SUPABASE_DB_URL, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET };
  await piped(context, 'deploy', command, [...prefix, 'cf:deploy'], { ...process.env, ...cloudflare, ...buildSecrets }, hidden, true);
  for (const [name, value] of secrets) {
    const result = run(bin(context.root, 'wrangler'), ['secret', 'put', name, '--env', context.environment], { cwd: context.root, input: value, env: cloudflare });
    if (result.status !== 0) throw new StepError(`wrangler secret put ${name} exited with ${result.status}. ${redact(result.stderr, hidden).trim().split('\n').slice(-2).join(' | ')}`);
    process.stdout.write(`Worker secret ${name} installed\n`);
  }
  return vars.APP_URL;
}

async function verify(context: Context): Promise<void> {
  const key = context.stored.SUPABASE_SECRET_KEY;
  if (!key) throw new StepError('No SUPABASE_SECRET_KEY stored.');
  const [command, prefix] = pnpm();
  await piped(context, 'verify-deployed', command, [...prefix, 'verify:deployed', '--env', context.environment], { ...process.env, SUPABASE_SECRET_KEY: key }, [key], true);
}

// The Worker reads LANGFUSE_BASE_URL only from wrangler.jsonc, so the test must not take one from the shell.
async function traceCheck(context: Context): Promise<void> {
  const { vars } = await readWranglerEnv(context.root, context.environment);
  const settings = traceCheckEnv(vars, context.stored);
  const { LANGFUSE_BASE_URL: _shell, ...inherited } = process.env;
  const [command, prefix] = pnpm();
  await piped(context, 'acceptance', command, [...prefix, 'exec', 'playwright', 'test', 'agent-chat.langfuse'], { ...inherited, ...settings }, [settings.SUPABASE_SECRET_KEY, settings.LANGFUSE_SECRET_KEY], true);
}

async function status(context: Context): Promise<void> {
  const mode = existsSync(context.path) ? (statSync(context.path).mode & 0o777).toString(8) : 'absent';
  process.stdout.write(`${basename(context.path)} (${mode}): ${storedNames.map(n => `${n} ${context.stored[n] ? 'set' : 'missing'}`).join(', ')}\n`);
  const { name, vars } = await readWranglerEnv(context.root, context.environment);
  const stale = Object.entries(vars).filter(([, v]) => placeholderVar.test(v) || placeholderEnvironmentId.test(v)).map(([k]) => k);
  process.stdout.write(`wrangler.jsonc ${context.environment}: Worker ${name}, ${stale.length ? `placeholders in ${stale.join(', ')}` : `APP_URL ${vars.APP_URL}`}\n`);
}

function login(root: string, vendor: 'supabase' | 'cloudflare'): void {
  if (!process.stdin.isTTY) throw new StepError('Logins need an interactive terminal the person can see. Run this command in a visible terminal tab.');
  const done = (result: { status: number | null }) => { if (result.status !== 0) throw new StepError(`${vendor} login exited with ${result.status ?? 'a signal'}. Rerun it.`); };
  if (vendor === 'cloudflare') { done(spawnSync(bin(root, 'wrangler'), ['login'], { cwd: root, stdio: 'inherit' })); return; }
  const binary = bin(root, 'supabase');
  // The CLI waits for Enter before it opens the browser. expect presses it, then hands the prompt for the verification code back to the person.
  if (run('expect', ['-v']).status === 0) done(spawnSync('expect', ['-c', `set timeout 60\nspawn {${binary}} login\nexpect "Press Enter"\nsleep 1\nsend "\\r"\nset timeout 900\ninteract`], { cwd: root, stdio: 'inherit' }));
  else done(spawnSync(binary, ['login'], { cwd: root, stdio: 'inherit' }));
}

export async function staging(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      env: { type: 'string' }, region: { type: 'string' }, org: { type: 'string' }, account: { type: 'string' }, 'confirm-cost': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (error) { throw new StepError(`${error instanceof Error ? error.message : 'Invalid arguments.'}\n${usage}`); }
  const { positionals, values } = parsed;
  const [command, argument] = positionals;
  if (values.help || !command) { process.stdout.write(usage + '\n'); return values.help ? 0 : 1; }
  const root = process.cwd();
  if (!existsSync(join(root, 'wrangler.jsonc')) || !existsSync(join(root, 'supabase', 'config.toml'))) throw new StepError('Run this from the generated repository root.');
  const environment = parseEnvironment(values.env);
  const path = secretsPath(root, environment);
  const context: Context = { root, repo: basename(root).toLowerCase(), environment, path, stored: readStored(path) };

  const step = progressStep(command, argument);
  if (step) emit(root, { step, status: waits(command) ? 'waiting' : 'running', detail: waits(command) ? stagingSteps.find(s => s.id === step)?.person : undefined });
  let detail: string | undefined;
  try { detail = await dispatch(context, command, argument, values, positionals[2]); }
  catch (error) { if (step) emit(root, { step, status: 'failed', detail: error instanceof StepError ? error.message : undefined }); throw error; }
  if (step) emit(root, { step, status: 'done', detail });
  return 0;
}

const commandSteps: Partial<Record<string, string>> = { 'login-cloudflare': 'login-cloudflare', 'login-supabase': 'login-supabase', supabase: 'supabase', configure: 'configure', google: 'google', 'llm-check': 'llm', deploy: 'deploy', verify: 'verify-deployed' };

/** The `tg watch` step a command advances. */
function progressStep(command: string, argument: string | undefined): string | undefined {
  if (command !== 'set') return commandSteps[command];
  return argument === 'LLM_API_KEY' ? 'llm' : argument?.startsWith('LANGFUSE_') ? 'langfuse' : undefined;
}

/** Logins and `set` wait on the person for their whole run. */
const waits = (command: string) => command === 'set' || command.startsWith('login-');

function mark(root: string, step: string | undefined, status: string | undefined): void {
  if (!stagingSteps.some(s => s.id === step)) throw new StepError(`Step must be one of ${stagingSteps.map(s => s.id).join(', ')}.`);
  if (!statuses.includes(status as Status)) throw new StepError(`Status must be one of ${statuses.join(', ')}.`);
  emit(root, { step: step!, status: status as Status });
}

async function dispatch(context: Context, command: string, argument: string | undefined, values: { region?: string; org?: string; account?: string; 'confirm-cost'?: boolean }, extra: string | undefined): Promise<string | undefined> {
  const { root } = context;
  switch (command) {
    case 'mark': mark(root, argument, extra); break;
    case 'login-supabase': login(root, 'supabase'); break;
    case 'login-cloudflare': login(root, 'cloudflare'); break;
    case 'supabase': await supabase(context, values); break;
    case 'configure': await configure(context, values); break;
    case 'google': google(context, argument); break;
    case 'set': { const name = parseSecretName(argument); const value = await readHidden(name); if (!value) throw new StepError('No value read.'); save(context, { [name]: value }); process.stdout.write(`stored ${name}\n`); break; }
    case 'llm-check': await llmCheck(context); break;
    case 'deploy': return deploy(context);
    case 'verify': await verify(context); break;
    case 'trace-check': await traceCheck(context); break;
    case 'status': await status(context); break;
    default: throw new StepError(usage);
  }
}
