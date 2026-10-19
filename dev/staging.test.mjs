import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { configureSupabase, configureWrangler, deployRefs, parseSecretName, readStored, redact, secretsPath, sessionPoolerUrl, traceCheckEnv, updateStored, workerSecrets } from '../skills/touch-grass/scripts/lib/staging.ts';
import { pipe } from '../skills/touch-grass/scripts/lib/events.ts';
import { supabase } from '../skills/touch-grass/scripts/staging.ts';
import { findPlaceholder } from '../template/tools/placeholders.ts';
import { parseTarget } from '../template/tools/deploy.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(repo, 'skills/touch-grass/scripts');
const template = join(repo, 'template');
const wrangler = readFileSync(join(template, 'wrangler.jsonc'), 'utf8');
const supabaseToml = readFileSync(join(template, 'supabase/config.toml'), 'utf8');
const settings = { repo: 'fresh-app', subdomain: 'acme', projectRef: 'abcdefghijklmnopqrst', publishableKey: 'sb_publishable_test', environmentId: '11111111-2222-4333-8444-555555555555' };

/** The vars wrangler would read for one environment, pulled from the patched text the same way for both files under test. */
function envVars(text, env) {
  const start = text.indexOf(`"${env}": {`);
  const block = text.slice(start, env === 'dev' ? text.indexOf('"production": {') : undefined);
  return Object.fromEntries([...block.matchAll(/"([A-Z_]+)": "([^"]*)"/g)].map(m => [m[1], m[2]]));
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'touch grass staging '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('first configure fills the chosen environment, names its Worker after the repo, and passes the template deploy checks', () => {
  const result = configureWrangler(wrangler, 'dev', settings);
  assert.equal(result.worker, 'fresh-app-dev');
  assert.equal(result.appUrl, 'https://fresh-app-dev.acme.workers.dev');
  assert.match(result.text, /"name": "fresh-app-dev",\n\s+"workflows": \[\{ "name": "fresh-app-agent-chat-dev"/);
  const vars = envVars(result.text, 'dev');
  assert.equal(findPlaceholder(vars), undefined);
  assert.equal(vars.ENVIRONMENT_ID, settings.environmentId);
  assert.ok(findPlaceholder(envVars(result.text, 'production')), 'production keeps its placeholders');
  assert.ok(result.text.startsWith(wrangler.slice(0, wrangler.indexOf('"env"'))), 'top-level local config unchanged');

  const toml = configureSupabase(supabaseToml, 'dev', settings.projectRef, result.appUrl);
  assert.deepEqual(parseTarget('dev', vars, toml), { environment: 'dev', projectRef: settings.projectRef });
  assert.match(toml, /additional_redirect_urls = \["https:\/\/fresh-app-dev\.acme\.workers\.dev\/auth\/callback"\]/);
  assert.match(toml, /project_id = "prodprojectrefplacho"/);
  assert.match(toml, /^site_url = "http:\/\/127\.0\.0\.1:3000"$/m, 'local Auth URL unchanged');
});

test('reconfiguring keeps the Worker name and environment ID of an already configured environment', () => {
  const first = configureWrangler(wrangler, 'dev', settings).text;
  const second = configureWrangler(first, 'dev', { ...settings, repo: 'other-app', environmentId: '99999999-9999-4999-8999-999999999999' });
  assert.equal(second.text, first);
  assert.equal(second.worker, 'fresh-app-dev');
});

test('configure keeps redirect URLs on other hosts and refuses a multi-line list instead of corrupting it', () => {
  const custom = supabaseToml.replace('additional_redirect_urls = ["https://touch-grass-dev.example.workers.dev/auth/callback"]', 'additional_redirect_urls = ["https://touch-grass-dev.example.workers.dev/auth/callback", "https://app.example.com/auth/callback"]');
  assert.match(configureSupabase(custom, 'dev', settings.projectRef, 'https://a.b.workers.dev'), /\["https:\/\/a\.b\.workers\.dev\/auth\/callback","https:\/\/app\.example\.com\/auth\/callback"\]/);
  const multiline = supabaseToml.replace('additional_redirect_urls = ["https://touch-grass-dev.example.workers.dev/auth/callback"]', 'additional_redirect_urls = [\n  "https://touch-grass-dev.example.workers.dev/auth/callback",\n]');
  assert.throws(() => configureSupabase(multiline, 'dev', settings.projectRef, 'https://a.b.workers.dev'), /one-line array/);
});

test('configure rejects malformed identities instead of writing them', () => {
  assert.throws(() => configureWrangler(wrangler, 'dev', { ...settings, projectRef: 'short' }));
  assert.throws(() => configureWrangler(wrangler, 'dev', { ...settings, subdomain: 'bad/sub' }));
  assert.throws(() => configureSupabase('[remotes.dev]\nproject_id = "x"\n', 'dev', settings.projectRef, 'https://a'));
});

test('stored values merge with the file as it is now, stay private, and ignore unknown names', t => {
  const dir = tempDir(t);
  const path = secretsPath(dir, 'dev');
  assert.equal(path, join(dir, '.env.deploy.dev'));
  writeFileSync(path, 'OTHER=1\nLLM_API_KEY=old\n', { mode: 0o644 });
  const slowCommand = readStored(path);
  updateStored(path, { SUPABASE_DB_PASSWORD: 'only-copy' });
  assert.equal(slowCommand.SUPABASE_DB_PASSWORD, undefined);
  updateStored(path, { SUPABASE_SECRET_KEY: 'sb_secret_value' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readStored(path), { LLM_API_KEY: 'old', SUPABASE_DB_PASSWORD: 'only-copy', SUPABASE_SECRET_KEY: 'sb_secret_value' });
  assert.throws(() => updateStored(path, { LLM_API_KEY: 'a\nb' }));
  assert.equal(readStored(path).LLM_API_KEY, 'old');
});

test('the template ignores the secrets files', t => {
  const dir = tempDir(t);
  copyFileSync(join(template, '.gitignore'), join(dir, '.gitignore'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const env of ['dev', 'production']) assert.equal(spawnSync('git', ['check-ignore', '-q', `.env.deploy.${env}`], { cwd: dir }).status, 0);
});

test('pooler URL uses the primary database in session mode on 5432 even when only transaction entries are listed', () => {
  const entry = { db_host: 'aws-1-eu-central-1.pooler.supabase.com', db_user: 'postgres.ref', db_name: 'postgres', db_port: 6543, pool_mode: 'transaction' };
  const url = sessionPoolerUrl([{ ...entry, db_host: 'replica.example', database_type: 'READ_REPLICA' }, { ...entry, database_type: 'PRIMARY' }], 'p@ss/word');
  assert.equal(url, 'postgresql://postgres.ref:p%40ss%2Fword@aws-1-eu-central-1.pooler.supabase.com:5432/postgres');
  assert.throws(() => sessionPoolerUrl([], 'x'));
});

test('deploy refs expose a database URL or config that points at another project', () => {
  const ref = 'abcdefghijklmnopqrst';
  const stored = { SUPABASE_PROJECT_REF: ref, SUPABASE_DB_URL: `postgresql://postgres.${ref}:pw@host:5432/postgres` };
  assert.deepEqual(deployRefs(stored, `https://${ref}.supabase.co`), { stored: ref, config: ref, database: ref });
  assert.equal(deployRefs(stored, 'https://zyxwvutsrqponmlkjihg.supabase.co').config, 'zyxwvutsrqponmlkjihg');
});

test('redact hides stored values but leaves short and absent ones', () => {
  assert.equal(redact('key=sb_secret_123456 ref=abc', ['sb_secret_123456', 'abc', undefined]), 'key=<redacted> ref=abc');
});

test('piped command output never shows a hidden value in its tail, log or progress events', async t => {
  const secret = 'sk-live-should-not-print';
  const dir = tempDir(t);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const { code, tail, log } = await pipe(dir, 'deploy', process.execPath, ['-e', `console.log("a ${secret} b"); console.error("${secret}")`], { hidden: [secret] });
  assert.equal(code, 0);
  const events = readFileSync(join(dirname(dirname(log)), 'events.jsonl'), 'utf8');
  for (const text of [tail.join('\n'), readFileSync(log, 'utf8'), events]) assert.doesNotMatch(text, new RegExp(secret));
  assert.ok(tail.includes('a <redacted> b'));
  assert.match(events, /"step":"deploy","line":"a <redacted> b"/);
});

function supabaseApi(t, routes) {
  const calls = [];
  const saved = { fetch: globalThis.fetch, token: process.env.SUPABASE_ACCESS_TOKEN };
  process.env.SUPABASE_ACCESS_TOKEN = 'sbp_fixture_token';
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(handler(calls.at(-1))), { status: 200 });
  };
  t.after(() => { globalThis.fetch = saved.fetch; if (saved.token === undefined) delete process.env.SUPABASE_ACCESS_TOKEN; else process.env.SUPABASE_ACCESS_TOKEN = saved.token; });
  return calls;
}

const ref = 'newprojectrefabcdefg';
const healthyRoutes = {
  [`GET /v1/projects/${ref}/api-keys`]: () => [{ type: 'publishable', api_key: 'sb_publishable_x' }, { type: 'secret', api_key: 'sb_secret_fixture' }],
  [`GET /v1/projects/${ref}/config/database/pooler`]: () => [{ db_host: 'pool.example', db_user: `postgres.${ref}`, db_name: 'postgres', pool_mode: 'transaction' }],
};

function context(t, stored = {}) {
  const root = tempDir(t);
  const path = secretsPath(root, 'dev');
  if (Object.keys(stored).length) updateStored(path, stored);
  return { root, repo: 'fresh-app', environment: 'dev', path, stored: readStored(path) };
}

test('supabase creates a project only after storing its password, then stores keys and the session pooler URL', async t => {
  const calls = supabaseApi(t, {
    'GET /v1/projects': () => [],
    'GET /v1/organizations': () => [{ id: 'org-one', slug: 'org-one', name: 'One' }],
    'GET /v1/organizations/org-one': () => ({ plan: 'free' }),
    'POST /v1/projects': ({ body }) => { assert.ok(readStored(ctx.path).SUPABASE_DB_PASSWORD, 'password stored before create'); assert.equal(body.name, 'fresh-app-dev'); return { ref, name: body.name, status: 'ACTIVE_HEALTHY', region: 'eu-central-1' }; },
    ...healthyRoutes,
  });
  const ctx = context(t);
  await supabase(ctx, { region: 'eu-central-1' });
  const stored = readStored(ctx.path);
  assert.equal(stored.SUPABASE_PROJECT_REF, ref);
  assert.equal(stored.SUPABASE_SECRET_KEY, 'sb_secret_fixture');
  assert.match(stored.SUPABASE_DB_URL, new RegExp(`^postgresql://postgres\\.${ref}:.+@pool\\.example:5432/postgres$`));
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('supabase refuses an unowned same-name project, a full Free plan, and a paid plan without cost confirmation', async t => {
  const org = { id: 'org-one', slug: 'org-one', name: 'One' };
  const foreign = { ref, name: 'fresh-app-dev', status: 'ACTIVE_HEALTHY', region: 'eu-central-1', organization_slug: 'org-one', created_at: '2026-01-01T00:00:00Z' };
  supabaseApi(t, { 'GET /v1/projects': () => [foreign], 'GET /v1/organizations': () => [org] });
  await assert.rejects(supabase(context(t, { SUPABASE_DB_PASSWORD: 'leftover' }), { region: 'eu-central-1' }), /no record of creating it/);

  const busy = [{ ref: 'aaaaaaaaaaaaaaaaaaaa', name: 'a', status: 'ACTIVE_HEALTHY', organization_slug: 'org-one' }, { ref: 'bbbbbbbbbbbbbbbbbbbb', name: 'b', status: 'COMING_UP', organization_slug: 'org-one' }];
  const calls = supabaseApi(t, { 'GET /v1/projects': () => busy, 'GET /v1/organizations': () => [org], 'GET /v1/organizations/org-one': () => ({ plan: 'free' }) });
  await assert.rejects(supabase(context(t), { region: 'eu-central-1' }), /Free plan/);
  assert.equal(calls.some(c => c.method === 'POST'), false);

  const paid = supabaseApi(t, { 'GET /v1/projects': () => [], 'GET /v1/organizations': () => [org], 'GET /v1/organizations/org-one': () => ({ plan: 'pro' }) });
  await assert.rejects(supabase(context(t), { region: 'eu-central-1' }), /--confirm-cost/);
  assert.equal(paid.some(c => c.method === 'POST'), false);
});

test('supabase adopts a same-name project it recorded starting, after a lost create response', async t => {
  supabaseApi(t, {
    'GET /v1/projects': () => [{ ref, name: 'fresh-app-dev', status: 'ACTIVE_HEALTHY', region: 'eu-central-1', organization_slug: 'org-one', created_at: '2026-10-19T15:04:30.375642Z' }],
    'GET /v1/organizations': () => [{ id: 'org-one', name: 'One' }],
    ...healthyRoutes,
  });
  const ctx = context(t, { SUPABASE_DB_PASSWORD: 'generated', SUPABASE_ORG: 'org-one', SUPABASE_CREATE_STARTED: '2026-10-19T15:03:00.000Z' });
  await supabase(ctx, {});
  assert.equal(readStored(ctx.path).SUPABASE_PROJECT_REF, ref);
});

test('staging CLI prints help, names a bad flag, and refuses to run outside a generated repository', t => {
  const cli = (...args) => spawnSync(process.execPath, [join(scripts, 'tg.ts'), 'staging', ...args], { cwd: tempDir(t), encoding: 'utf8' });
  assert.equal(cli('--help').status, 0);
  const bad = cli('status', '--regio', 'x');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown option '--regio'[\s\S]*Usage: tg staging/);
  const outside = cli('status');
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /generated repository root/);
});

test('a deploy installs the Langfuse keys only as a pair, and set accepts them', () => {
  const required = { SUPABASE_SECRET_KEY: 'sb_secret_value', LLM_API_KEY: 'llm' };
  assert.deepEqual(workerSecrets(required).map(([name]) => name), ['SUPABASE_SECRET_KEY', 'LLM_API_KEY']);
  assert.deepEqual(workerSecrets({ ...required, LANGFUSE_PUBLIC_KEY: 'pk-lf', LANGFUSE_SECRET_KEY: 'sk-lf' }).map(([name]) => name), ['SUPABASE_SECRET_KEY', 'LLM_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']);
  assert.throws(() => workerSecrets({ ...required, LANGFUSE_PUBLIC_KEY: 'pk-lf' }), /both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY/);
  assert.equal(parseSecretName('LANGFUSE_SECRET_KEY'), 'LANGFUSE_SECRET_KEY');
  assert.throws(() => parseSecretName('LANGFUSE_HOST'));
});

test('trace-check runs the Langfuse e2e against the configured app with the stored secrets, and refuses until both are ready', () => {
  const vars = envVars(configureWrangler(wrangler, 'dev', settings).text, 'dev');
  const stored = { SUPABASE_SECRET_KEY: 'sb_secret_value', LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' };
  assert.deepEqual(traceCheckEnv(vars, stored), {
    EXTERNAL_APP: '1', APP_URL: 'https://fresh-app-dev.acme.workers.dev', SUPABASE_URL: `https://${settings.projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: settings.publishableKey, ...stored,
  });
  assert.equal(traceCheckEnv({ ...vars, LANGFUSE_BASE_URL: 'https://us.cloud.langfuse.com' }, stored).LANGFUSE_BASE_URL, 'https://us.cloud.langfuse.com');
  assert.throws(() => traceCheckEnv(vars, { ...stored, LANGFUSE_SECRET_KEY: undefined }), /tg staging set LANGFUSE_SECRET_KEY/);
  assert.throws(() => traceCheckEnv(envVars(wrangler, 'dev'), stored), /tg staging configure/);
});
