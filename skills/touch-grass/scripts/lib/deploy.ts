import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { ProgressStep } from './events.ts';
import { StepError } from './exec.ts';

/** Values a deploy needs that never enter the repository. The Supabase access token stays in the CLI's own store. */
export const secretNames = ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET', 'LLM_API_KEY'] as const;
/** Langfuse tracing stays off until both keys are stored, so a deploy needs neither. */
export const optionalSecretNames = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'] as const;
/** Bookkeeping kept beside the secrets: the chosen Cloudflare account, and where and when a project creation started. */
export const noteNames = ['CLOUDFLARE_ACCOUNT_ID', 'SUPABASE_ORG', 'SUPABASE_CREATE_STARTED'] as const;
export const storedNames = [...secretNames, ...optionalSecretNames, ...noteNames] as const;
export type SecretName = (typeof secretNames)[number] | (typeof optionalSecretNames)[number];
export type StoredName = (typeof storedNames)[number];
export type Stored = Partial<Record<StoredName, string>>;

/** deploy.md's steps in its order, as `tg watch` lists them. */
export const deploySteps: readonly ProgressStep[] = [
  { id: 'login-cloudflare', title: 'Cloudflare login', seconds: 45, person: 'approve the Cloudflare login in your browser' },
  { id: 'login-supabase', title: 'Supabase login', seconds: 60, person: 'approve the Supabase login and type its code in the terminal' },
  { id: 'supabase', title: 'Supabase project', seconds: 150 },
  { id: 'configure', title: 'Configuration', seconds: 15 },
  { id: 'google', title: 'Google OAuth client', seconds: 420, person: 'sign in to Google Cloud when the console asks' },
  { id: 'llm', title: 'LLM key', seconds: 60, person: 'paste your LLM API key into the terminal' },
  { id: 'langfuse', title: 'Langfuse tracing (optional)', seconds: 180, person: 'sign in to Langfuse and paste its two keys' },
  { id: 'deploy', title: 'Deploy', seconds: 240, person: 'approve the deploy in chat' },
  { id: 'verify-deployed', title: 'Deployed verifier', seconds: 120 },
  { id: 'acceptance', title: 'Acceptance journey', seconds: 240, person: 'choose your Google account and consent' },
];

/** Deletes each match of `pattern` that is not inside a JSON string. */
const outsideStrings = (text: string, pattern: string) => text.replace(new RegExp(`"(?:\\\\.|[^"\\\\])*"|${pattern}`, 'g'), token => token.startsWith('"') ? token : '');
const jsoncComments = String.raw`//[^\n]*|/\*[\s\S]*?\*/`;
const trailingCommas = String.raw`,(?=\s*[}\]])`;

/** The hosted environments: the keys under `env` in wrangler.jsonc, read without the generated repository's dependencies. */
export function environmentNames(wranglerText: string): string[] {
  let config: { env?: unknown };
  try { config = JSON.parse(outsideStrings(outsideStrings(wranglerText, jsoncComments), trailingCommas)) as typeof config; }
  catch { throw new StepError('wrangler.jsonc is not valid JSONC.'); }
  return config.env && typeof config.env === 'object' ? Object.keys(config.env) : [];
}

/** The `--env` value, which must name a wrangler.jsonc environment. Without one, the only environment. */
export function parseEnvironment(value: string | undefined, available: readonly string[]): string {
  const invalid = available.find(name => !/^[a-z0-9][a-z0-9_-]*$/.test(name));
  if (invalid) throw new StepError(`wrangler.jsonc environment "${invalid}" must use only lowercase letters, digits, hyphens and underscores.`);
  if (!available.length) throw new StepError('wrangler.jsonc has no hosted environment under "env".');
  if (value === undefined && available.length === 1) return available[0] as string;
  if (value !== undefined && available.includes(value)) return value;
  throw new StepError(`${value === undefined ? 'Pass --env with' : 'Environment must be'} one of ${available.join(', ')}.`);
}

export function parseSecretName(value: string | undefined): SecretName {
  const names: readonly string[] = [...secretNames, ...optionalSecretNames];
  if (!value || !names.includes(value)) throw new StepError(`Secret name must be one of ${names.join(', ')}.`);
  return value as SecretName;
}

/** The settings the template's Langfuse e2e reads to run against a deployed environment: its public vars and two stored secrets. */
export function traceCheckEnv(vars: Record<string, string>, stored: Stored): Record<string, string> {
  const { SUPABASE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = stored;
  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) throw new StepError('Langfuse keys are not stored. Run `tg deploy set LANGFUSE_PUBLIC_KEY` and `tg deploy set LANGFUSE_SECRET_KEY`, then `tg deploy push`.');
  if (!SUPABASE_SECRET_KEY) throw new StepError('No SUPABASE_SECRET_KEY stored. Run `tg deploy supabase` first.');
  const { APP_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LANGFUSE_BASE_URL } = vars;
  if (!APP_URL || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || [APP_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY].some(value => placeholderVar.test(value))) {
    throw new StepError('wrangler.jsonc still holds placeholders for this environment. Run `tg deploy configure` first.');
  }
  return { EXTERNAL_APP: '1', APP_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, ...(LANGFUSE_BASE_URL && { LANGFUSE_BASE_URL }) };
}

/** The Worker secrets a deploy installs: the required two, and the Langfuse pair when both are stored. */
export function workerSecrets(stored: Stored): Array<[string, string]> {
  const { SUPABASE_SECRET_KEY, LLM_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = stored;
  if (!SUPABASE_SECRET_KEY || !LLM_API_KEY) throw new StepError('SUPABASE_SECRET_KEY and LLM_API_KEY must be stored.');
  if (!LANGFUSE_PUBLIC_KEY !== !LANGFUSE_SECRET_KEY) throw new StepError('Store both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, or neither.');
  const langfuse: Array<[string, string]> = LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY ? [['LANGFUSE_PUBLIC_KEY', LANGFUSE_PUBLIC_KEY], ['LANGFUSE_SECRET_KEY', LANGFUSE_SECRET_KEY]] : [];
  return [['SUPABASE_SECRET_KEY', SUPABASE_SECRET_KEY], ['LLM_API_KEY', LLM_API_KEY], ...langfuse];
}

/** Vite loads `.env.<mode>`, so the name avoids `.env.production`. The template's `.env*` rule ignores it. */
export function secretsPath(root: string, environment: string): string {
  return join(root, `.env.deploy.${environment}`);
}

export function readStored(path: string): Stored {
  if (!existsSync(path)) return {};
  const stored: Stored = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    const name = line.slice(0, separator) as StoredName;
    if (separator > 0 && storedNames.includes(name)) stored[name] = line.slice(separator + 1);
  }
  return stored;
}

/** Merges into the file as it is now, so concurrent commands never drop each other's keys. Writes a 0600 temp file, then renames it. */
export function updateStored(path: string, update: Stored): Stored {
  for (const value of Object.values(update)) if (/[\r\n]/.test(value ?? '')) throw new StepError('A stored value contains a line break.');
  const stored = { ...readStored(path), ...update };
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeSync(fd, storedNames.filter(name => stored[name]).map(name => `${name}=${stored[name]}\n`).join('')); }
  catch (error) { closeSync(fd); rmSync(temp, { force: true }); throw error; }
  closeSync(fd);
  renameSync(temp, path);
  return stored;
}

export function redact(text: string, values: Iterable<string | undefined>): string {
  return [...values].filter((value): value is string => !!value && value.length >= 8).reduce((out, value) => out.replaceAll(value, '<redacted>'), text);
}

/** The `[start, end)` span of `"<environment>": { ... }` in wrangler.jsonc, braces matched outside strings. */
function envBlock(text: string, environment: string): [number, number] {
  const open = new RegExp(`"${environment}"\\s*:\\s*\\{`).exec(text);
  if (!open) throw new StepError(`wrangler.jsonc has no "${environment}" environment.`);
  let depth = 0;
  let inString = false;
  for (let i = open.index + open[0].length - 1; i < text.length; i++) {
    const char = text[i];
    if (inString) { if (char === '\\') i++; else if (char === '"') inString = false; }
    else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return [open.index, i + 1];
  }
  throw new StepError(`wrangler.jsonc has an unterminated "${environment}" environment.`);
}

function setString(block: string, pattern: RegExp, label: string, value: string): string {
  if (!pattern.test(block)) throw new StepError(`wrangler.jsonc environment has no ${label}.`);
  return block.replace(pattern, (_, prefix: string) => `${prefix}${JSON.stringify(value)}`);
}

const setVar = (block: string, key: string, value: string) => setString(block, new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`), `${key} var`, value);

export const placeholderEnvironmentId = /^00000000-0000-4000-8000-0000000000\d\d$/;

/** A wrangler.jsonc var that `configure` has not filled yet. */
export const placeholderVar = /configure-|\.example\.|[a-z]+-project\.supabase\.co/;

export type WranglerSettings = { repo: string; subdomain: string; projectRef: string; publishableKey: string; environmentId: string };

/**
 * Fills one environment's hosted vars. On first configuration (placeholder ENVIRONMENT_ID) it also names the Worker and
 * Workflow `<repo>-<environment>`, because every generated repo starts with the same names and would deploy over another's.
 */
export function configureWrangler(text: string, environment: string, settings: WranglerSettings): { text: string; appUrl: string; worker: string; environmentId: string } {
  if (!/^[a-z0-9-]+$/.test(settings.subdomain)) throw new StepError('Cloudflare subdomain is invalid.');
  if (!/^[a-z]{20}$/.test(settings.projectRef)) throw new StepError('Supabase project ref must be 20 lowercase letters.');
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(settings.repo)) throw new StepError('Repository name must be 2 to 39 lowercase letters, digits or hyphens.');
  const [start, end] = envBlock(text, environment);
  let block = text.slice(start, end);
  const currentId = /"ENVIRONMENT_ID"\s*:\s*"([^"]*)"/.exec(block)?.[1] ?? '';
  const first = !currentId || placeholderEnvironmentId.test(currentId);
  const environmentId = first ? settings.environmentId : currentId;
  if (first) {
    block = setString(block, /(\{\s*"name"\s*:\s*)"[^"]*"/, 'Worker name', `${settings.repo}-${environment}`);
    block = setString(block, /("workflows"\s*:\s*\[\s*\{\s*"name"\s*:\s*)"[^"]*"/, 'Workflow name', `${settings.repo}-agent-chat-${environment}`);
    block = setVar(block, 'ENVIRONMENT_ID', environmentId);
  }
  const worker = /^\s*"[^"]+"\s*:\s*\{\s*"name"\s*:\s*"([a-z0-9-]+)"/.exec(block)?.[1];
  if (!worker) throw new StepError(`wrangler.jsonc "${environment}" environment must start with its Worker name.`);
  const appUrl = `https://${worker}.${settings.subdomain}.workers.dev`;
  block = setVar(block, 'APP_URL', appUrl);
  block = setVar(block, 'SUPABASE_URL', `https://${settings.projectRef}.supabase.co`);
  block = setVar(block, 'SUPABASE_PUBLISHABLE_KEY', settings.publishableKey);
  return { text: text.slice(0, start) + block + text.slice(end), appUrl, worker, environmentId };
}

/** Points `[remotes.<environment>]` at the project and its Auth URLs at the deployed app, keeping redirect URLs on other hosts. */
export function configureSupabase(text: string, environment: string, projectRef: string, appUrl: string): string {
  let section = '';
  const seen = new Set<string>();
  const lines = text.split('\n').map(line => {
    const header = /^\[([^\]]+)\]\s*$/.exec(line.trim());
    if (header) { section = header[1] ?? ''; return line; }
    const match = /^([a-z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) return line;
    const [, key, value = ''] = match;
    seen.add(`${section}.${key}`);
    if (section === `remotes.${environment}` && key === 'project_id') return `project_id = ${JSON.stringify(projectRef)}`;
    if (section === `remotes.${environment}.auth` && key === 'site_url') return `site_url = ${JSON.stringify(appUrl)}`;
    if (section === `remotes.${environment}.auth` && key === 'additional_redirect_urls') {
      let existing: unknown;
      try { existing = JSON.parse(value); } catch { throw new StepError(`additional_redirect_urls in [remotes.${environment}.auth] must be a one-line array of strings.`); }
      if (!Array.isArray(existing) || existing.some(url => typeof url !== 'string')) throw new StepError(`additional_redirect_urls in [remotes.${environment}.auth] must be an array of strings.`);
      const others = existing.filter(url => !/\.workers\.dev(\/|$)/.test(url));
      return `additional_redirect_urls = ${JSON.stringify([`${appUrl}/auth/callback`, ...others])}`;
    }
    return line;
  });
  for (const key of [`remotes.${environment}.project_id`, `remotes.${environment}.auth.site_url`, `remotes.${environment}.auth.additional_redirect_urls`]) {
    if (!seen.has(key)) throw new StepError(`supabase/config.toml has no ${key}.`);
  }
  return lines.join('\n');
}

export type PoolerEntry = { db_host: string; db_user: string; db_name: string; db_port?: number; pool_mode?: string; database_type?: string };

/** Session mode, as `supabase db push` needs. The pooler API may list only the transaction entry; session mode is the same host on 5432. */
export function sessionPoolerUrl(entries: readonly PoolerEntry[], password: string): string {
  const primary = entries.filter(e => !e.database_type || e.database_type === 'PRIMARY');
  const entry = primary.find(e => e.pool_mode === 'session') ?? primary[0];
  if (!entry) throw new StepError('Supabase returned no primary pooler configuration.');
  return `postgresql://${entry.db_user}:${encodeURIComponent(password)}@${entry.db_host}:5432/${entry.db_name}`;
}

/** The project ref a deploy would touch through each channel. They must agree before anything is pushed. */
export function deployRefs(stored: Stored, supabaseUrl: string | undefined): { stored?: string; config?: string; database?: string } {
  return {
    stored: stored.SUPABASE_PROJECT_REF,
    config: /^https:\/\/([a-z]{20})\.supabase\.co\/?$/.exec(supabaseUrl ?? '')?.[1],
    database: /^postgresql:\/\/postgres\.([a-z]{20}):/.exec(stored.SUPABASE_DB_URL ?? '')?.[1],
  };
}
