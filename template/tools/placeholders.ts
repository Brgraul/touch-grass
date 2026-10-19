import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const placeholder = /configure-|\.example\.|[a-z]+-project\.supabase\.co/;

/** The `vars` block of one wrangler.jsonc environment. The template keeps every var a string. */
export const environmentVars = z.record(z.string(), z.string());

export type EnvironmentVars = z.infer<typeof environmentVars>;

/** The name of the first setting that still holds a template placeholder, or undefined when none does. */
export function findPlaceholder(vars: EnvironmentVars): string | undefined {
  return Object.entries(vars).find(([, value]) => placeholder.test(value))?.[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const environments = process.argv.slice(2);

  if (environments.length === 0) {
    process.stderr.write('Usage: tsx tools/placeholders.ts <environment>...\n');
    process.exit(2);
  }

  const { unstable_readConfig: readConfig } = await import('wrangler');
  let stale = false;

  for (const environment of environments) {
    const name = findPlaceholder(environmentVars.parse(readConfig({ config: 'wrangler.jsonc', env: environment }).vars));

    if (name) {
      process.stderr.write(`wrangler.jsonc still holds a placeholder for ${name} in the "${environment}" environment. Replace it before deploying.\n`);
      stale = true;
    }
  }

  if (stale) process.exit(1);
}
