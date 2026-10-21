import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { bannedPackages, ciCommands, ignoredDirectories, renderArchitecture, type Diagnostic } from './policy.ts';

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
  packageManager: z.string(),
});

const wranglerSchema = z.object({ env: z.record(z.string(), z.object({ vars: z.object({ APP_URL: z.string() }) })).default({}) });

const skillLockSchema = z.object({ skills: z.record(z.string(), z.object({ ref: z.string().optional(), computedHash: z.string() })) });

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function remoteAuthBlocks(toml: string): Map<string, { siteUrl?: string; redirectUrls?: string }> {
  const blocks = new Map<string, { siteUrl?: string; redirectUrls?: string }>();
  let current: { siteUrl?: string; redirectUrls?: string } | undefined;

  for (const line of toml.split('\n')) {
    const header = /^\[(.+)\]\s*$/.exec(line.trim());

    if (header) {
      const environment = /^remotes\.([^.]+)\.auth$/.exec(header[1] ?? '')?.[1];
      current = undefined;

      if (environment) {
        current = {};
        blocks.set(environment, current);
      }
    } else if (current) {
      const site = /^site_url\s*=\s*"([^"]*)"/.exec(line.trim());
      const redirects = /^additional_redirect_urls\s*=\s*(\[.*\])/.exec(line.trim());

      if (site) current.siteUrl = site[1];

      if (redirects) current.redirectUrls = redirects[1];
    }
  }

  return blocks;
}

function checkAuthUrls(wrangler: string, toml: string): Diagnostic[] {
  const parsed = wranglerSchema.safeParse(ts.parseConfigFileTextToJson('wrangler.jsonc', wrangler).config);

  if (!parsed.success) return [{ rule: 'auth-urls', path: 'wrangler.jsonc', message: 'Could not read env.<environment>.vars.APP_URL' }];

  const blocks = remoteAuthBlocks(toml);
  const diagnostics: Diagnostic[] = [];

  for (const [environment, { vars }] of Object.entries(parsed.data.env)) {
    const block = blocks.get(environment);
    const expectedRedirects = JSON.stringify([`${vars.APP_URL}/auth/callback`]);

    if (block?.siteUrl !== vars.APP_URL) diagnostics.push({ rule: 'auth-urls', path: 'supabase/config.toml', message: `[remotes.${environment}.auth] site_url must equal APP_URL ${vars.APP_URL} from wrangler.jsonc` });
    else if (block.redirectUrls?.replace(/\s+/g, '') !== expectedRedirects) diagnostics.push({ rule: 'auth-urls', path: 'supabase/config.toml', message: `[remotes.${environment}.auth] additional_redirect_urls must be ${expectedRedirects}` });
  }

  return diagnostics;
}

// Mirrors computeSkillFolderHash in the skills CLI, which hashes the upstream folder, so a copy matches only when it is byte for byte upstream.
function skillFolderHash(files: ReadonlyMap<string, Uint8Array>, prefix: string): string | undefined {
  const entries = [...files].flatMap(([path, content]) => path.startsWith(prefix) ? [[path.slice(prefix.length), content] as const] : []).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return undefined;
  const hash = createHash('sha256');

  for (const [path, content] of entries) hash.update(path).update(content);

  return hash.digest('hex');
}

function checkVendoredSkills(lock: string, files: ReadonlyMap<string, Uint8Array>): Diagnostic[] {
  let json: unknown;

  try {
    json = JSON.parse(lock);
  } catch {
    json = undefined;
  }

  const parsed = skillLockSchema.safeParse(json);

  if (!parsed.success) return [{ rule: 'vendored-skill', path: 'skills-lock.json', message: 'Could not read skills.<name>.computedHash' }];

  return Object.entries(parsed.data.skills).flatMap(([name, entry]): Diagnostic[] => {
    const path = `.agents/skills/${name}`;

    if (!/^[0-9a-f]{40}$/.test(entry.ref ?? '')) return [{ rule: 'vendored-skill', path: 'skills-lock.json', message: `${name} must be pinned to a full commit SHA. Install it from a GitHub tree URL that names the commit` }];

    if (skillFolderHash(files, `${path}/`) !== entry.computedHash) return [{ rule: 'vendored-skill', path, message: 'Files differ from the hash recorded in skills-lock.json. Never edit a vendored skill; reinstall it as .agents/skills/UPSTREAM.md describes, or put local changes in a new skill' }];

    return [];
  });
}

export function checkRepoFiles(files: ReadonlyMap<string, string>, baseMigrations: ReadonlyMap<string, string> = new Map(), skillFiles: ReadonlyMap<string, Uint8Array> = new Map()): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const report = (rule: string, path: string, message: string) => diagnostics.push({ rule, path, message });
  const manifest = manifestSchema.safeParse(JSON.parse(files.get('package.json') ?? '{}'));

  if (!manifest.success) throw new Error(`Invalid package.json: ${manifest.error.message}`);

  for (const group of [manifest.data.dependencies, manifest.data.devDependencies, manifest.data.optionalDependencies, manifest.data.peerDependencies]) {
    for (const [name, version] of Object.entries(group)) {
      if (bannedPackages.some(banned => banned.endsWith('/') ? name.startsWith(banned) : banned === 'eslint' ? name === banned || name.startsWith('eslint-') : name === banned)) report('banned-package', 'package.json', `Forbidden dependency ${name}`);

      if (!exactVersion.test(version)) report('version-pin', 'package.json', `${name} must have an exact version, received ${version}`);
    }
  }

  if (!/^pnpm@\d+\.\d+\.\d+(?:\+sha\d+\.[a-f0-9]+)?$/.test(manifest.data.packageManager)) report('version-pin', 'package.json', 'Pin the pnpm packageManager version');

  for (const cli of ['wrangler', 'supabase', 'shadcn']) {
    if (!(cli in manifest.data.devDependencies)) report('version-pin', 'package.json', `Pin ${cli} as a local development dependency`);
  }

  for (const path of files.keys()) {
    if (/(?:^|\/)(?:tailwind\.config\.[^/]+|postcss\.config\.[^/]+|eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?)$/.test(path) || /\.(?:css|scss|sass|less|styl)$/.test(path) && path !== 'src/styles/app.css') report('forbidden-file', path, 'This config or stylesheet is forbidden');
  }

  const workflow = files.get('.github/workflows/ci.yml') ?? '';
  const steps = new Set([...workflow.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map(match => match[1]));

  for (const command of ciCommands) {
    if (!steps.has(command)) report('ci-gates', '.github/workflows/ci.yml', `Add a \`run: ${command}\` step so pull requests are gated on it`);
  }

  if (files.get('ARCHITECTURE.md') !== renderArchitecture()) report('generated-architecture', 'ARCHITECTURE.md', 'Run pnpm gen:architecture to update the generated policy tables');
  const migrationFiles = [...files.keys()].filter(path => /^supabase\/migrations\/[^/]+\.sql$/.test(path)).sort();
  const latestBase = [...baseMigrations.keys()].sort().at(-1);

  for (const [path, sql] of baseMigrations) {
    if (files.get(path) !== sql) report('migration-ledger', path, 'An applied migration was changed or deleted');
  }

  const migrationVersions = new Set<string>();

  for (const path of migrationFiles) {
    const version = path.slice('supabase/migrations/'.length, 'supabase/migrations/'.length + 14);

    if (migrationVersions.has(version)) report('migration-ledger', path, 'Migration timestamps must be unique');
    migrationVersions.add(version);

    if (!/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(path)) report('migration-ledger', path, 'Migration names require a globally ordered 14-digit timestamp');

    if (latestBase && !baseMigrations.has(path) && path <= latestBase) report('migration-ledger', path, `New migration must sort after ${latestBase}`);
  }

  const wrangler = files.get('wrangler.jsonc');
  const config = files.get('supabase/config.toml');

  if (wrangler !== undefined && config !== undefined) diagnostics.push(...checkAuthUrls(wrangler, config));
  const skillLock = files.get('skills-lock.json');

  if (skillLock !== undefined) diagnostics.push(...checkVendoredSkills(skillLock, skillFiles));

  return diagnostics;
}

export function repositoryFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.includes(entry.name) || ['.agents', '.audit'].includes(entry.name)) continue;
      const path = join(directory, entry.name);

      if (entry.isDirectory()) walk(path);
      else if (!/\.(?:png|jpg|jpeg|gif|ico|woff2?|ttf|webp|mp4|pdf)$/.test(entry.name)) files.set(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8'));
    }
  };

  walk(root);

  return files;
}

// Raw bytes under .agents/skills, walked with the skills CLI's rules: regular files only, skipping .git and node_modules.
export function skillFolderFiles(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name)) walk(path);
      else if (entry.isFile()) files.set(relative(root, path).split('\\').join('/'), readFileSync(path));
    }
  };

  if (existsSync(join(root, '.agents/skills'))) walk(join(root, '.agents/skills'));

  return files;
}

export function baselineMigrations(root: string, base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'): Map<string, string> {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const top = git('rev-parse', '--show-toplevel').trimEnd();
  const prefix = relative(top, realpathSync(root)).split('\\').join('/');
  const ledger = `${prefix ? `${prefix}/` : ''}supabase/migrations/`;
  const entries = git('ls-tree', '--full-tree', '-r', '--name-only', base, '--', ledger).split('\n').filter(Boolean);

  return new Map(entries.map(path => [path.slice(prefix ? prefix.length + 1 : 0), git('show', `${base}:${path}`)]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const diagnostics = checkRepoFiles(repositoryFiles(root), baselineMigrations(root, process.env.MIGRATION_BASE_REF), skillFolderFiles(root));

    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.path} ${diagnostic.rule}: ${diagnostic.message}\n`);

    if (diagnostics.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Repository checker failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
