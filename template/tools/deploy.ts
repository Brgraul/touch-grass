import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { environmentVars, findPlaceholder, type EnvironmentVars } from './placeholders.ts';

/** Secrets that Workers Builds exposes to the build and deploy commands. */
export const buildSecretNames = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET'] as const;

/** The environment being deployed and the Supabase project it targets. */
export type DeployTarget = { environment: string; projectRef: string };

/** A deploy precondition or step that failed. The message is safe to print. */
export class DeployError extends Error {}

const supabaseUrl = /^https:\/\/([a-z]{20})\.supabase\.co\/?$/;

/** The 20-letter project reference in a hosted Supabase URL. */
export function projectRefFromUrl(url: string): string {
  const ref = supabaseUrl.exec(url)?.[1];

  if (!ref) throw new DeployError(`SUPABASE_URL must look like https://<20 lowercase letters>.supabase.co, not "${url}".`);

  return ref;
}

/** The `project_id` of the `[remotes.<environment>]` block, or undefined when the block or the key is missing. */
export function remoteProjectId(toml: string, environment: string): string | undefined {
  let inside = false;

  for (const line of toml.split('\n')) {
    const header = /^\[(.+)\]\s*$/.exec(line.trim());

    if (header) inside = header[1] === `remotes.${environment}`;
    else if (inside) {
      const id = /^project_id\s*=\s*"([^"]*)"/.exec(line.trim());

      if (id) return id[1];
    }
  }

  return undefined;
}

/**
 * The target for one environment. `supabase config push` applies only the `[remotes.*]` block whose
 * `project_id` matches the project, so a missing or different block would push the local Auth URLs.
 */
export function parseTarget(environment: string, vars: EnvironmentVars, configToml: string): DeployTarget {
  const stale = findPlaceholder(vars);

  if (stale) throw new DeployError(`wrangler.jsonc still holds a placeholder for ${stale} in the "${environment}" environment. Replace it before deploying.`);
  const projectRef = projectRefFromUrl(vars.SUPABASE_URL ?? '');
  const configured = remoteProjectId(configToml, environment);

  if (configured === undefined) throw new DeployError(`supabase/config.toml has no [remotes.${environment}] block with a project_id. Add one set to ${projectRef}.`);

  if (configured !== projectRef) throw new DeployError(`project_id in [remotes.${environment}] of supabase/config.toml is "${configured}", but SUPABASE_URL in wrangler.jsonc names ${projectRef}. Make them match.`);

  return { environment, projectRef };
}

/** The names of the build secrets that are unset or empty. */
export function missingBuildSecrets(env: Readonly<Record<string, string | undefined>>): string[] {
  return buildSecretNames.filter(name => !env[name]);
}

function run(step: string, binary: 'supabase' | 'wrangler', args: string[]): void {
  process.stderr.write(`cf:deploy: ${step}\n`);

  try {
    execFileSync(join('node_modules', '.bin', binary), args, { stdio: 'inherit' });
  } catch (error) {
    // The error message would repeat the command line, which holds SUPABASE_DB_URL.
    const status = z.object({ status: z.number() }).safeParse(error).data?.status ?? 1;
    throw new DeployError(`${step} failed with exit code ${status}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const environment = process.env.CLOUDFLARE_ENV;

    if (!environment) throw new DeployError('CLOUDFLARE_ENV must name the wrangler.jsonc environment to deploy, such as "production". Set it as a Workers Builds build variable.');
    const { unstable_readConfig: readConfig } = await import('wrangler');
    let vars: EnvironmentVars;

    try {
      vars = environmentVars.parse(readConfig({ config: 'wrangler.jsonc', env: environment }).vars);
    } catch (error) {
      throw new DeployError(`Cannot read the "${environment}" environment from wrangler.jsonc. ${error instanceof Error ? error.message : ''}`.trim());
    }

    const target = parseTarget(environment, vars, readFileSync('supabase/config.toml', 'utf8'));
    const missing = missingBuildSecrets(process.env);

    if (missing.length > 0) throw new DeployError(`Missing build secrets: ${missing.join(', ')}. Set them as Workers Builds build secrets.`);

    // Migrations go first: the Auth config enables a hook that calls a migrated function.
    // --yes keeps a non-interactive run from skipping a push that waits for an answer.
    run('supabase db push', 'supabase', ['db', 'push', '--yes', '--db-url', process.env.SUPABASE_DB_URL ?? '']);
    run('supabase config push', 'supabase', ['config', 'push', '--project-ref', target.projectRef, '--yes']);
    run('wrangler deploy', 'wrangler', ['deploy']);
  } catch (error) {
    if (!(error instanceof DeployError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
