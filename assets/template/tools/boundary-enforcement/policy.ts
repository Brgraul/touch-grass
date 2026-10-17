export const browserPackages = [
  'react', 'react-dom', '@tanstack/react-router', '@tanstack/react-start',
  '@tanstack/react-query', '@tanstack/react-router-ssr-query', 'lucide-react',
  'clsx', 'tailwind-merge', 'class-variance-authority', 'radix-ui',
  '@radix-ui/react-slot', '@radix-ui/react-label', '@radix-ui/react-separator',
  '@radix-ui/react-dropdown-menu', '@radix-ui/react-dialog',
] as const;

export const browserTransitivePackages = [
  '@radix-ui/react-compose-refs', '@radix-ui/react-primitive', '@tanstack/history',
  '@tanstack/query-core', '@tanstack/react-start-client', '@tanstack/react-store',
  '@tanstack/router-core', '@tanstack/router-ssr-query-core', '@tanstack/start-client-core',
  '@tanstack/store', 'cookie-es', 'scheduler', 'seroval', 'seroval-plugins', 'use-sync-external-store',
] as const;

export const serverPackages = ['@supabase/supabase-js', '@supabase/ssr', '@openai/agents', 'openai', 'cloudflare:workers'] as const;

export const compositionRoot = 'src/server.ts';

export const pureRoles = ['schema', 'model', 'tools', 'agent', 'domain'] as const;

export const privateEnvironmentNames = ['SUPABASE_SECRET_KEY', 'LLM_API_KEY'];

export const bundleSentinel = 'TOUCH_GRASS_SERVER_SECRET_SENTINEL_4b8ae730';

export const brandNames = ['UserId', 'EnvironmentId', 'ConversationId', 'RunId', 'TurnId', 'RequestKey', 'Instant', 'PageCursor', 'ToolCallId'];

export const bannedPackages = ['eslint', '@eslint/', 'zustand', 'redux', '@reduxjs/', 'jotai', 'mobx', 'valtio', 'recoil', 'inversify', 'tsyringe'];

export const ignoredDirectories = ['node_modules', '.git', '.wrangler', 'dist', 'coverage', 'test-results', 'playwright-report'];

export const roles = [
  { id: 'route', path: 'src/routes/.*\\.tsx$', owns: 'URLs, params, loaders, redirects, composing feature UI', never: 'Direct transport, domain decisions, persistence', allows: 'Feature UI, queries and schemas; layouts; components; browser packages' },
  { id: 'server-route', path: 'src/routes/.*\\.ts$', owns: 'Server route handlers', never: 'Feature rules or persistence', allows: 'platform/auth.server.ts; browser packages' },
  { id: 'ui', path: 'src/features/[^/]+/ui/', owns: 'Rendering, interaction, ephemeral state', never: 'Fetching, persistence, transport', allows: 'Components; own UI, queries and schemas; browser packages' },
  { id: 'queries', path: '\\.queries\\.ts$', owns: 'Query keys, options, polling, mutations and invalidation', never: 'Domain decisions', allows: 'Own functions and schemas; platform/mutations.ts; @tanstack/react-query' },
  { id: 'functions', path: '\\.functions\\.ts$', owns: 'Parse input, resolve actor, delegate', never: 'Ownership checks or domain decisions', allows: 'Own schema, service or repository; platform/auth.server.ts; @tanstack/react-start' },
  { id: 'schema', path: '\\.schema\\.ts$', owns: 'Client-safe runtime contracts and inferred types', never: 'Runtime implementations or SQL', allows: 'Other schemas' },
  { id: 'service', path: '\\.service\\.server\\.ts$', owns: 'Server use cases and background processes', never: 'UI, transport or Workflow steps', allows: 'Own schema, model, agent and repository; other schemas; domain; platform; SDK' },
  { id: 'model', path: '\\.model\\.ts$', owns: 'Pure domain decisions, limits and outcome classification', never: 'I/O or transactional rules', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'tools', path: '\\.tools\\.ts$', owns: 'Pure deterministic tools', never: 'I/O', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'agent', path: '\\.agent\\.ts$', owns: 'SDK agent definition, instructions and tools', never: 'I/O', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'repo', path: '\\.repo\\.server\\.ts$', owns: 'Database routine calls and row parsing', never: 'Domain decisions', allows: 'Own schema; platform/supabase.server.ts; platform/database.types.ts' },
  { id: 'workflow', path: '\\.workflow\\.server\\.ts$', owns: 'Durability, step names, retries and payload parsing', never: 'Domain decisions', allows: 'Own service, model, agent and schema; SDK; cloudflare:workers' },
  { id: 'components', path: 'src/components/', owns: 'Generic UI primitives and patterns', never: 'Feature knowledge or transport', allows: 'Other components; browser packages' },
  { id: 'layouts', path: 'src/layouts/', owns: 'Application shell and navigation', never: 'Persistence or transport', allows: 'Components; feature UI and queries; browser packages' },
  { id: 'domain', path: 'src/domain/', owns: 'Shared business capabilities used by multiple features', never: 'Feature imports', allows: 'Same domain; SDK definitions and types' },
  { id: 'platform-client', path: 'src/platform/(ids|mutations)\\.ts$', owns: 'Shared identities and client mutation mechanism', never: 'Feature knowledge', allows: 'Other client-safe platform modules; browser packages' },
  { id: 'platform', path: 'src/platform/', owns: 'Environment, Supabase, auth, model adapter and logging', never: 'Feature knowledge', allows: 'Platform; server and browser packages' },
  { id: 'bootstrap', path: 'src/(router|client|start)\\.tsx?$', owns: 'Framework bootstrap and one QueryClient per request', never: 'Feature knowledge', allows: 'Generated route tree; browser packages' },
  { id: 'composition', path: '^src/server\\.ts$', owns: 'Runtime wiring and entrypoint exports', never: 'Domain rules', allows: 'Everything it wires' },
] as const;

export type Role = typeof roles[number]['id'];

export type Diagnostic = { rule: string; path: string; message: string; line?: number };

export const rules = [
  { id: 'ownership', check: 'dependency-cruiser', text: 'Import only the modules and packages allowed for the source role. Cross-feature imports reach only schemas.' },
  { id: 'package', check: 'dependency-cruiser', text: 'Client roles import only browser packages.' },
  { id: 'feature-cycle', check: 'dependency-cruiser', text: 'Feature dependencies have no cycles.' },
  { id: 'composition-root', check: 'dependency-cruiser', text: 'Only src/server.ts wires feature Workflows into runtime entrypoints. Platform has no feature knowledge.' },
  { id: 'client-reachability', check: 'check-client-bundle', text: 'Every emitted browser chunk excludes server modules, server packages, private environment names and the planted secret sentinel.' },
  { id: 'pure-module', check: 'lint', text: 'Schemas, models, tools, agents and pure domain modules perform no I/O and read no clocks, randomness or runtime.' },
  { id: 'client-data-path', check: 'lint', text: 'Client views never fetch. Query functions belong to queries modules. Only platform/mutations.ts calls useMutation.' },
  { id: 'model-adapter', check: 'lint', text: 'Only platform/model.server.ts imports openai or constructs the model provider.' },
  { id: 'env-access', check: 'lint', text: 'Only platform/env.server.ts reads environment fields. The composition root reads only the Workflow binding.' },
  { id: 'test-sign-in', check: 'lint', text: 'Only tests/fixtures/test-users.ts calls password sign-in or auth.admin.' },
  { id: 'brand-cast', check: 'lint', text: 'Brands come from parsers. Brand assertions occur only in platform, schemas or repositories.' },
  { id: 'no-reexport', check: 'lint', text: 'Application modules contain no re-export statements or barrel files.' },
  { id: 'styling', check: 'lint', text: 'Components use Tailwind utilities and theme tokens. No raw palette colors, white or black, arbitrary color values, hex literals or literal inline styles.' },
  { id: 'banned-package', check: 'check-repo', text: 'No ESLint, second global state manager or dependency injection container.' },
  { id: 'version-pin', check: 'check-repo', text: 'Every direct dependency and the package manager are pinned to exact versions. CLI tools are local dependencies.' },
  { id: 'forbidden-file', check: 'check-repo', text: 'No Tailwind, PostCSS or ESLint config and no stylesheet except src/styles/app.css.' },
  { id: 'migration-ledger', check: 'check-repo', text: 'Applied migrations never change or disappear. New migrations sort after the base branch ledger.' },
  { id: 'auth-urls', check: 'check-repo', text: 'Each wrangler.jsonc environment APP_URL matches the site_url and callback URL in its [remotes.<environment>.auth] block of supabase/config.toml.' },
  { id: 'generated-architecture', check: 'check-repo', text: 'ARCHITECTURE.md exactly matches the policy renderer.' },
  { id: 'database-types', check: 'pnpm check', text: 'Database types are regenerated after the isolated reset and fail on a diff.' },
  { id: 'exhaustive-blocks', check: 'tsc', text: 'Turn rendering uses an exhaustive never check for all stored block kinds.' },
  { id: 'ownership-sql', check: 'two-user SQL and E2E proofs', text: 'Verified sessions supply owner IDs. RLS owns reads and each mutation routine owns write authorization.' },
  { id: 'turn-writer', check: 'SQL grants proof', text: 'Only commit_step writes turns. The committer owns exactly one routine and service_role cannot insert turns.' },
  { id: 'deterministic-replay', check: 'Workflow replay and deploy proofs', text: 'Outside steps execution is deterministic. Saved step names never change. Saved model calls are not resent.' },
  { id: 'timing', check: 'constants test', text: 'Model step timeout exceeds model call timeout. Dispatch delay is below duration. Step and history limits fit Workflows.' },
  { id: 'auth-config', check: 'deploy', text: 'Auth settings live in supabase/config.toml and each deploy applies them.' },
  { id: 'review', check: 'review', text: 'No forwarding services or placeholders. Functions delegate ownership. Block changes include data migrations. Secrets never enter source or logs. Production databases are never reset.' },
] as const;

export function roleOf(path: string): Role | undefined {
  if (/\.(test|spec)\.tsx?$/.test(path) || path === 'src/routeTree.gen.ts' || path.endsWith('.d.ts')) return undefined;

  return roles.find(role => new RegExp(role.path).test(path))?.id;
}

export function isPure(path: string): boolean {
  const role = roleOf(path);

  return role !== undefined && pureRoles.some(pure => pure === role) && !path.endsWith('.server.ts');
}

export function renderArchitecture(): string {
  const lines = ['# Application architecture', '', 'Generated from `tools/boundary-enforcement/policy.ts`. Run `pnpm gen:architecture` after changing that policy.', '', '## File roles and ownership', '', '| Role | Owns | Never owns |', '|---|---|---|'];

  for (const role of roles) lines.push(`| ${role.id} | ${role.owns} | ${role.never} |`);
  lines.push('', '## Dependency allowlist', '', 'All roles may import `platform/ids.ts` and `zod`. Framework bootstrap modules are explicit owners of generated routing and hydration wiring.', '', '| Source | May import only |', '|---|---|');

  for (const role of roles) lines.push(`| ${role.id} | ${role.allows} |`);
  lines.push('', `Browser packages: ${browserPackages.map(name => `\`${name}\``).join(', ')}.`, '', `Known server packages: ${serverPackages.map(name => `\`${name}\``).join(', ')}. Every package outside the browser allowlist is server-only.`, '', `Browser transitive packages verified in emitted chunks: ${browserTransitivePackages.map(name => `\`${name}\``).join(', ')}.`, '', '## Rule checks', '', '| Rule | Check | Requirement |', '|---|---|---|');

  for (const rule of rules) lines.push(`| ${rule.id} | ${rule.check} | ${rule.text} |`);

  return `${lines.join('\n')}\n`;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function packages(names: readonly string[]): string {
  return `(?:^|/)node_modules/(?:${names.map(escaped).join('|')})(?:/|$)`;
}

export function allowedTargets(role: Role, feature = '[^/]+'): string {
  const own = `src/features/${escaped(feature)}/`;
  const schemas = 'src/features/[^/]+/[^/]+\\.schema\\.ts$';
  const common = ['^src/platform/ids\\.ts$', packages(['zod'])];
  const browser = packages(browserPackages);
  const agents = packages(['@openai/agents']);
  const ownRole = (suffixes: string) => `${own}[^/]+\\.(?:${suffixes})\\.ts$`;

  const choices: Record<Role, readonly string[]> = {
    route: ['src/features/[^/]+/(?:ui/|[^/]+\\.(?:queries|schema)\\.ts$)', '^src/(?:components|layouts)/', browser, '^src/styles/app\\.css(?:\\?url)?$'],
    'server-route': ['^src/platform/auth\\.server\\.ts$', browser],
    ui: ['^src/components/', `${own}ui/`, ownRole('queries|schema'), browser],
    queries: [ownRole('functions|schema'), '^src/platform/mutations\\.ts$', packages(['@tanstack/react-query'])],
    functions: [ownRole('schema|service\\.server|repo\\.server'), '^src/platform/auth\\.server\\.ts$', packages(['@tanstack/react-start'])],
    schema: [schemas],
    service: [ownRole('schema|model|agent|repo\\.server'), schemas, '^src/(?:domain|platform)/', agents],
    model: [ownRole('schema|model|tools|agent'), schemas, '^src/domain/(?!.*\\.server\\.ts$)', agents],
    tools: [ownRole('schema|model|tools|agent'), schemas, '^src/domain/(?!.*\\.server\\.ts$)', agents],
    agent: [ownRole('schema|model|tools|agent'), schemas, '^src/domain/(?!.*\\.server\\.ts$)', agents],
    repo: [ownRole('schema'), '^src/platform/(?:supabase\\.server|database\\.types)\\.ts$'],
    workflow: [ownRole('service\\.server|model|agent|schema'), agents, '^cloudflare:workers$'],
    components: ['^src/components/', browser],
    layouts: ['^src/components/', 'src/features/[^/]+/(?:ui/|[^/]+\\.queries\\.ts$)', browser],
    domain: [`^src/domain/${escaped(feature)}/`, agents],
    'platform-client': ['^src/platform/(?:ids|mutations)\\.ts$', browser],
    platform: ['^src/platform/', '^(?:node_modules/|.*?/node_modules/|cloudflare:|node:)'],
    bootstrap: ['^src/routeTree\\.gen\\.ts$', browser],
    composition: ['.'],
  };

  return [...common, ...choices[role]].map(choice => `(?:${choice})`).join('|');
}

export function dependencyRules(features: readonly string[], domains: readonly string[] = []) {
  const result = [];
  const excluded = '\\.(?:test|spec)\\.tsx?$|^src/routeTree\\.gen\\.ts$|\\.d\\.ts$';

  for (const role of roles) {
    if (role.id === 'composition') continue;
    const owners = ['ui', 'queries', 'functions', 'schema', 'service', 'model', 'tools', 'agent', 'repo', 'workflow'].includes(role.id) ? features : role.id === 'domain' ? domains : [''];

    for (const owner of owners) {
      const from = owner ? `^src/${role.id === 'domain' ? 'domain' : 'features'}/${escaped(owner)}/.*` : role.path;
      const path = owner ? `(?=${from})(?=.*${role.path})` : role.path;
      const roleExclude = role.id === 'platform' ? `${excluded}|^src/platform/(?:ids|mutations)\\.ts$` : excluded;
      result.push({ name: `ownership-${role.id}${owner ? `-${owner}` : ''}`, severity: 'error', from: { path, pathNot: roleExclude }, to: { pathNot: allowedTargets(role.id, owner) } });
    }
  }

  result.push({ name: 'package', severity: 'error', from: { path: '^src/(?:routes|components|layouts)/|^src/features/[^/]+/ui/|\\.queries\\.ts$|^src/platform/(?:ids|mutations)\\.ts$', pathNot: excluded }, to: { path: '(?:^|/)node_modules/', pathNot: packages([...browserPackages, 'zod']) } });
  result.push({ name: 'composition-root', severity: 'error', from: { path: '^src/platform/', pathNot: excluded }, to: { path: '^src/features/' } });
  result.push({ name: 'feature-cycle', severity: 'error', from: { path: '^src/features/', pathNot: excluded }, to: { circular: true, path: '^src/features/' } });
  result.push({ name: 'unresolved-import', severity: 'error', from: { path: '^src/', pathNot: excluded }, to: { couldNotResolve: true, pathNot: '^cloudflare:' } });

  return result;
}

export const fixtureExpectations = {
  "pure-module": [
    "pure-fetch",
    "pure-clock",
    "pure-random",
    "pure-runtime",
    "pure-import"
  ],
  "client-data-path": [
    "client-fetch",
    "client-mutation",
    "client-query"
  ],
  "model-adapter": [
    "adapter-import",
    "adapter-alias"
  ],
  "env-access": [
    "environment-read",
    "environment-destructure",
    "environment-workflow"
  ],
  "test-sign-in": [
    "signin-password",
    "signin-admin"
  ],
  "brand-cast": [
    "brand-caller"
  ],
  "no-reexport": [
    "export-module",
    "export-imported"
  ],
  "styling": [
    "styling-palette",
    "styling-hex",
    "styling-style",
    "styling-white",
    "styling-black",
    "styling-opacity",
    "styling-border-side",
    "styling-divide",
    "styling-ring",
    "styling-fill",
    "styling-stroke",
    "styling-arbitrary-function",
    "styling-arbitrary-variant",
    "styling-template-head",
    "styling-template-tail"
  ],
  "banned-package": [
    "repo-eslint",
    "repo-state"
  ],
  "version-pin": [
    "repo-range"
  ],
  "forbidden-file": [
    "repo-style",
    "repo-config"
  ],
  "generated-architecture": [
    "repo-doc"
  ],
  "auth-urls": [
    "repo-auth-urls"
  ],
  "migration-ledger": [
    "repo-migration-change",
    "repo-migration-delete",
    "repo-migration-order"
  ],
  "ownership": [
    "edge-demo.repo.server",
    "edge-demo.functions",
    "edge-demo.model",
    "edge-route-function",
    "edge-cross-feature"
  ],
  "package": [
    "edge-server-package"
  ],
  "composition-root": [
    "edge-composition"
  ],
  "feature-cycle": [
    "edge-cycle"
  ],
  "client-reachability": [
    "bundle-repository",
    "bundle-helper",
    "bundle-exported-helper",
    "bundle-sentinel",
    "bundle-secret-name",
    "bundle-framework-server-package",
    "bundle-runtime-module"
  ]
} as const;
