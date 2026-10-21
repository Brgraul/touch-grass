export const browserPackages = [
  'react', 'react-dom', '@tanstack/react-router', '@tanstack/react-start',
  '@tanstack/react-query', '@tanstack/react-router-ssr-query', 'lucide-react',
  'clsx', 'tailwind-merge', 'class-variance-authority', 'radix-ui',
  '@radix-ui/react-slot', '@radix-ui/react-label', '@radix-ui/react-separator',
  '@radix-ui/react-dropdown-menu', '@radix-ui/react-dialog',
] as const;

// The dependency closure of the browser packages is allowed in browser chunks, except through these framework packages that run only on the server or at build time.
export const closureBarrier = /^@tanstack\/(?:[\w-]*-)?(?:server|plugin|rsc)(?:-[\w-]+)?$|^@tanstack\/router-(?:utils|generator|plugin)$|^(?:vite|rolldown|esbuild)$/;

export const serverPackages = ['@supabase/supabase-js', '@supabase/ssr', '@openai/agents', 'openai', 'cloudflare:workers'] as const;

export const compositionRoot = 'src/server.ts';

export const pureRoles = ['schema', 'model', 'tools', 'agent', 'domain'] as const;

// Pure modules may import these values from the agent SDK: definitions and the error classes that outcome classification matches. Everything else comes in as a type.
export const pureAgentExports = ['Agent', 'tool', 'handoff', 'AgentsError', 'GuardrailExecutionError', 'InputGuardrailTripwireTriggered', 'InvalidToolInputError', 'InvalidToolOutputError', 'MaxTurnsExceededError', 'ModelBehaviorError', 'ModelRefusalError', 'ModelTimeoutError', 'OutputGuardrailTripwireTriggered', 'SystemError', 'ToolCallError', 'ToolInputGuardrailTripwireTriggered', 'ToolOutputGuardrailTripwireTriggered', 'ToolTimeoutError', 'UserError'];

// Roles whose modules can reach the browser. They import only browser packages, never a server entry of one.
export const clientRoles = ['route', 'server-route', 'ui', 'queries', 'components', 'layouts', 'platform-client', 'bootstrap'] as const;

export const testModule = '\\.(?:test|spec)\\.tsx?$';

// Files outside every role: tests, the generated route tree and declaration files.
export const unownedModule = `${testModule}|^src/routeTree\\.gen\\.ts$|\\.d\\.ts$`;

export const ciCommands = ['pnpm check:fast', 'pnpm typecheck', 'pnpm test', 'pnpm check:bundle'];

export const privateEnvironmentNames = ['SUPABASE_SECRET_KEY', 'LLM_API_KEY', 'LANGFUSE_SECRET_KEY'];

export const bundleSentinel = 'TOUCH_GRASS_SERVER_SECRET_SENTINEL_4b8ae730';

export const bannedPackages = ['eslint', '@eslint/', 'zustand', 'redux', '@reduxjs/', 'jotai', 'mobx', 'valtio', 'recoil', 'inversify', 'tsyringe'];

export const ignoredDirectories = ['node_modules', '.git', '.wrangler', 'dist', 'coverage', 'test-results', 'playwright-report'];

const featureModule = (suffix: string) => `^src/features/[^/]+/[^/]+\\.${suffix}\\.ts$`;

export const roles = [
  { id: 'route', path: '^src/routes/.*\\.tsx$', owns: 'URLs, params, loaders, redirects, composing feature UI', never: 'Direct transport, domain decisions, persistence', allows: 'Feature UI, queries and schemas; layouts; components; browser packages' },
  { id: 'server-route', path: '^src/routes/.*\\.ts$', owns: 'Server route handlers', never: 'Feature rules or persistence', allows: 'platform/auth.server.ts; browser packages' },
  { id: 'ui', path: '^src/features/[^/]+/ui/', owns: 'Rendering, interaction, ephemeral state', never: 'Fetching, persistence, transport', allows: 'Components; own UI, queries and schemas; browser packages' },
  { id: 'queries', path: featureModule('queries'), owns: 'Query keys, options, polling, mutations and invalidation', never: 'Domain decisions', allows: 'Own functions and schemas; platform/mutations.ts; @tanstack/react-query' },
  { id: 'functions', path: featureModule('functions'), owns: 'Parse input, resolve actor, delegate', never: 'Ownership checks or domain decisions', allows: 'Own schema, service or repository; platform/auth.server.ts; @tanstack/react-start' },
  { id: 'schema', path: featureModule('schema'), owns: 'Client-safe runtime contracts and inferred types', never: 'Runtime implementations or SQL', allows: 'Other schemas' },
  { id: 'service', path: featureModule('service\\.server'), owns: 'Server use cases and background processes', never: 'UI, transport or Workflow steps', allows: 'Own schema, model, agent and repository; other schemas; domain; platform; SDK' },
  { id: 'model', path: featureModule('model'), owns: 'Pure domain decisions, limits and outcome classification', never: 'I/O or transactional rules', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'tools', path: featureModule('tools'), owns: 'Pure deterministic tools', never: 'I/O', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'agent', path: featureModule('agent'), owns: 'SDK agent definition, instructions and tools', never: 'I/O', allows: 'Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types' },
  { id: 'repo', path: featureModule('repo\\.server'), owns: 'Database routine calls and row parsing', never: 'Domain decisions', allows: 'Own schema; platform/supabase.server.ts; platform/database.types.ts' },
  { id: 'workflow', path: featureModule('workflow\\.server'), owns: 'Durability, step names, retries and payload parsing', never: 'Domain decisions', allows: 'Own service, model, agent and schema; SDK; cloudflare:workers' },
  { id: 'components', path: '^src/components/', owns: 'Generic UI primitives and patterns', never: 'Feature knowledge or transport', allows: 'Other components; browser packages' },
  { id: 'layouts', path: '^src/layouts/', owns: 'Application shell and navigation', never: 'Persistence or transport', allows: 'Components; feature UI and queries; browser packages' },
  { id: 'domain', path: '^src/domain/[^/]+/', owns: 'Shared business capabilities used by multiple features, one directory per capability', never: 'Feature imports or modules directly under src/domain', allows: 'Same domain; SDK definitions and types' },
  { id: 'platform-client', path: '^src/platform/(?:ids|mutations)\\.ts$', owns: 'Shared identities and client mutation mechanism', never: 'Feature knowledge', allows: 'Other client-safe platform modules; browser packages' },
  { id: 'platform', path: '^src/platform/(?!(?:ids|mutations)\\.ts$)', owns: 'Environment, Supabase, auth, model adapter, tracing and logging', never: 'Feature knowledge', allows: 'Platform; server and browser packages' },
  { id: 'bootstrap', path: '^src/(?:router|client|start)\\.tsx?$', owns: 'Framework bootstrap and one QueryClient per request', never: 'Feature knowledge', allows: 'Generated route tree; browser packages' },
  { id: 'composition', path: '^src/server\\.ts$', owns: 'Runtime wiring and entrypoint exports', never: 'Domain rules', allows: 'Everything it wires' },
] as const;

export type Role = typeof roles[number]['id'];

export type Diagnostic = { rule: string; path: string; message: string; line?: number };

export const rules = [
  { id: 'ownership', check: 'dependency-cruiser', text: 'Import only the modules and packages allowed for the source role. Cross-feature imports reach only schemas.' },
  { id: 'test-import', check: 'dependency-cruiser', text: 'Application modules never import test or spec files or anything under tests/.' },
  { id: 'package', check: 'dependency-cruiser', text: 'Client roles import only browser packages, and never their server, SSR or plugin entry points.' },
  { id: 'feature-cycle', check: 'dependency-cruiser', text: 'Feature dependencies have no cycles.' },
  { id: 'composition-root', check: 'dependency-cruiser', text: 'Only src/server.ts wires feature Workflows into runtime entrypoints. Platform has no feature knowledge.' },
  { id: 'client-reachability', check: 'check-client-bundle', text: 'Every emitted browser chunk excludes server modules, server packages, private environment names and the planted secret sentinel.' },
  { id: 'file-role', check: 'lint', text: 'Every module under src matches exactly one role. Only tests, declaration files and the generated route tree have none.' },
  { id: 'pure-module', check: 'lint', text: 'Schemas, models, tools, agents and pure domain modules perform no I/O and read no clocks, randomness or runtime. They import only agent definitions, SDK error classes and types.' },
  { id: 'client-data-path', check: 'lint', text: 'Client views never fetch. Query functions belong to queries modules. Only platform/mutations.ts calls useMutation.' },
  { id: 'server-function', check: 'lint', text: 'Only functions modules create server functions or server middleware.' },
  { id: 'model-adapter', check: 'lint', text: 'Only platform/model.server.ts imports openai or constructs the model provider.' },
  { id: 'env-access', check: 'lint', text: 'Only platform/env.server.ts reads environment fields or copies the environment. The composition root reads only the Workflow binding.' },
  { id: 'test-sign-in', check: 'lint', text: 'Only tests/fixtures/test-users.ts calls password sign-in or auth.admin.' },
  { id: 'brand-cast', check: 'lint', text: 'Brands come from parsers. Brand assertions occur only in platform, schemas or repositories.' },
  { id: 'no-reexport', check: 'lint', text: 'Application modules contain no re-export statements or barrel files.' },
  { id: 'styling', check: 'lint', text: 'Components use Tailwind utilities and theme tokens. No raw palette colors, white or black, arbitrary color values, hex literals or literal inline styles.' },
  { id: 'comment-marker', check: 'lint', text: 'Comments in src/ start with SAFETY: on a cast, WHY: for a constraint from an SDK, PostgreSQL or an external API, or a tool directive. Other comments are deleted or encoded as a type, test or lint rule.' },
  { id: 'banned-package', check: 'check-repo', text: 'No ESLint, second global state manager or dependency injection container.' },
  { id: 'version-pin', check: 'check-repo', text: 'Every direct dependency and the package manager are pinned to exact versions. CLI tools are local dependencies.' },
  { id: 'forbidden-file', check: 'check-repo', text: 'No Tailwind, PostCSS or ESLint config and no stylesheet except src/styles/app.css.' },
  { id: 'migration-ledger', check: 'check-repo', text: 'Applied migrations never change or disappear. New migrations sort after the base branch ledger.' },
  { id: 'auth-urls', check: 'check-repo', text: 'Each wrangler.jsonc environment APP_URL matches the site_url and callback URL in its [remotes.<environment>.auth] block of supabase/config.toml.' },
  { id: 'ci-gates', check: 'check-repo', text: `The pull request workflow runs ${ciCommands.map(command => `\`${command}\``).join(', ')}.` },
  { id: 'generated-architecture', check: 'check-repo', text: 'ARCHITECTURE.md exactly matches the policy renderer.' },
  { id: 'vendored-skill', check: 'check-repo', text: 'Each skill in skills-lock.json is pinned to a commit and matches its recorded upstream hash.' },
  { id: 'database-types', check: 'pnpm check', text: 'Database types are regenerated after the isolated reset and fail on a diff.' },
  { id: 'exhaustive-blocks', check: 'tsc', text: 'Turn rendering uses an exhaustive never check for all stored block kinds.' },
  { id: 'ownership-sql', check: 'two-user SQL and E2E proofs', text: 'Verified sessions supply owner IDs. RLS owns reads and each mutation routine owns write authorization.' },
  { id: 'turn-writer', check: 'SQL grants proof', text: 'Only commit_step writes turns. The committer owns exactly one routine and service_role cannot insert turns.' },
  { id: 'deterministic-replay', check: 'Workflow replay and deploy proofs', text: 'Outside steps execution is deterministic. Saved step names never change. Saved model calls are not resent.' },
  { id: 'timing', check: 'constants test', text: 'Model step timeout exceeds model call timeout plus trace export timeout. Dispatch delay is below duration. Step and history limits fit Workflows.' },
  { id: 'auth-config', check: 'deploy', text: 'Auth settings live in supabase/config.toml and each deploy applies them.' },
  { id: 'review', check: 'review', text: 'No forwarding services or placeholders. Functions delegate ownership. Block changes include data migrations. Secrets never enter source or logs. Production databases are never reset.' },
] as const;

export function roleOf(path: string): Role | undefined {
  if (new RegExp(unownedModule).test(path)) return undefined;
  const matches = roles.filter(role => new RegExp(role.path).test(path));

  if (matches.length > 1) throw new Error(`${path} matches the roles ${matches.map(role => role.id).join(' and ')}. Role paths must not overlap`);

  return matches[0]?.id;
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
  lines.push('', `Browser packages: ${browserPackages.map(name => `\`${name}\``).join(', ')}.`, '', `Known server packages: ${serverPackages.map(name => `\`${name}\``).join(', ')}. Every package outside the browser allowlist is server-only.`, '', 'Emitted browser chunks may also contain the dependency closure of the browser packages that `package.json` declares, read from `pnpm-lock.yaml`. The closure excludes the TanStack server, plugin and router-utils packages and the build tools Vite, Rolldown and esbuild, which stay server-only even though a browser package depends on them.', '', '## Rule checks', '', '| Rule | Check | Requirement |', '|---|---|---|');

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
  const own = `^src/features/${escaped(feature)}/`;
  const schemas = '^src/features/[^/]+/[^/]+\\.schema\\.ts$';
  const pureDomain = '^src/domain/[^/]+/(?!.*\\.server\\.ts$)';
  const common = ['^src/platform/ids\\.ts$', packages(['zod'])];
  const browser = packages(browserPackages);
  const agents = packages(['@openai/agents']);
  const ownRole = (suffixes: string) => `${own}[^/]+\\.(?:${suffixes})\\.ts$`;

  const choices: Record<Role, readonly string[]> = {
    route: ['^src/features/[^/]+/(?:ui/|[^/]+\\.(?:queries|schema)\\.ts$)', '^src/(?:components|layouts)/', browser, '^src/styles/app\\.css(?:\\?url)?$'],
    'server-route': ['^src/platform/auth\\.server\\.ts$', browser],
    ui: ['^src/components/', `${own}ui/`, ownRole('queries|schema'), browser],
    queries: [ownRole('functions|schema'), '^src/platform/mutations\\.ts$', packages(['@tanstack/react-query'])],
    functions: [ownRole('schema|service\\.server|repo\\.server'), '^src/platform/auth\\.server\\.ts$', packages(['@tanstack/react-start'])],
    schema: [schemas],
    service: [ownRole('schema|model|agent|repo\\.server'), schemas, '^src/domain/[^/]+/', '^src/platform/', agents],
    model: [ownRole('schema|model|tools|agent'), schemas, pureDomain, agents],
    tools: [ownRole('schema|model|tools|agent'), schemas, pureDomain, agents],
    agent: [ownRole('schema|model|tools|agent'), schemas, pureDomain, agents],
    repo: [ownRole('schema'), '^src/platform/(?:supabase\\.server|database\\.types)\\.ts$'],
    workflow: [ownRole('service\\.server|model|agent|schema'), agents, '^cloudflare:workers$'],
    components: ['^src/components/', browser],
    layouts: ['^src/components/', '^src/features/[^/]+/(?:ui/|[^/]+\\.queries\\.ts$)', browser],
    domain: [`^src/domain/${escaped(feature)}/`, agents],
    'platform-client': ['^src/platform/(?:ids|mutations)\\.ts$', browser],
    platform: ['^src/platform/', '^(?:node_modules/|.*?/node_modules/|cloudflare:|node:)'],
    bootstrap: ['^src/routeTree\\.gen\\.ts$', browser],
    composition: ['.'],
  };

  return [...common, ...choices[role]].map(choice => `(?:${choice})`).join('|');
}

const featureRoles: readonly Role[] = ['ui', 'queries', 'functions', 'schema', 'service', 'model', 'tools', 'agent', 'repo', 'workflow'];

// A browser package's server, SSR or build entry: `@tanstack/react-start/server`, `react-dom/server`, `@tanstack/react-router/ssr/server`.
const serverEntry = `(?:^|/)node_modules/(?:${browserPackages.map(escaped).join('|')})/.*(?:server|ssr-|plugin/)`;

export function dependencyRules(features: readonly string[], domains: readonly string[] = []) {
  const result = [];

  for (const role of roles) {
    if (role.id === 'composition') continue;
    const owners = featureRoles.includes(role.id) ? features : role.id === 'domain' ? domains : [''];

    for (const owner of owners) {
      const path = owner ? `(?=^src/${role.id === 'domain' ? 'domain' : 'features'}/${escaped(owner)}/)${role.path}` : role.path;
      result.push({ name: `ownership-${role.id}${owner ? `-${owner}` : ''}`, severity: 'error', from: { path, pathNot: unownedModule }, to: { pathNot: allowedTargets(role.id, owner) } });
    }
  }

  const client = roles.flatMap(role => clientRoles.some(id => id === role.id) ? [role.path] : []).join('|');
  result.push({ name: 'package', severity: 'error', from: { path: client, pathNot: unownedModule }, to: { path: '(?:^|/)node_modules/', pathNot: packages([...browserPackages, 'zod']) } });
  result.push({ name: 'package', severity: 'error', from: { path: client, pathNot: unownedModule }, to: { path: serverEntry } });
  result.push({ name: 'test-import', severity: 'error', from: { path: '^src/', pathNot: unownedModule }, to: { path: `${testModule}|^tests/` } });
  result.push({ name: 'composition-root', severity: 'error', from: { path: '^src/platform/', pathNot: unownedModule }, to: { path: '^src/features/' } });
  result.push({ name: 'feature-cycle', severity: 'error', from: { path: '^src/features/', pathNot: unownedModule }, to: { circular: true, path: '^src/features/' } });
  result.push({ name: 'unresolved-import', severity: 'error', from: { path: '^src/', pathNot: unownedModule }, to: { couldNotResolve: true, pathNot: '^cloudflare:' } });

  return result;
}

export const fixtureExpectations = {
  "file-role": [
    "file-role-feature-helper",
    "file-role-top-level",
    "file-role-domain-top-level"
  ],
  "pure-module": [
    "pure-fetch",
    "pure-clock",
    "pure-random",
    "pure-runtime",
    "pure-import",
    "pure-clock-alias",
    "pure-clock-element",
    "pure-clock-function",
    "pure-clock-call",
    "pure-clock-construct-alias",
    "pure-random-destructure",
    "pure-random-alias",
    "pure-agent-run",
    "pure-agent-runner",
    "pure-agent-namespace",
    "pure-agent-dynamic"
  ],
  "client-data-path": [
    "client-fetch",
    "client-mutation",
    "client-query",
    "client-mutation-alias",
    "client-mutation-namespace",
    "client-mutation-destructure",
    "client-query-shorthand",
    "client-query-computed",
    "client-fetch-alias",
    "client-fetch-global-this",
    "client-fetch-passed",
    "client-transport-alias",
    "role-components-queries",
    "client-event-source",
    "client-send-beacon",
    "client-mutation-observer"
  ],
  "server-function": [
    "server-function-ui",
    "server-function-route"
  ],
  "model-adapter": [
    "adapter-import",
    "adapter-alias",
    "adapter-dynamic-import",
    "adapter-require",
    "adapter-default-client",
    "adapter-default-client-namespace",
    "adapter-namespace"
  ],
  "env-access": [
    "environment-read",
    "environment-destructure",
    "environment-workflow",
    "environment-renamed",
    "environment-element",
    "environment-destructure-parameter",
    "environment-alias",
    "environment-cast",
    "environment-type-alias",
    "environment-handler",
    "environment-import-alias",
    "environment-spread",
    "environment-entries"
  ],
  "test-sign-in": [
    "signin-password",
    "signin-admin",
    "signin-element",
    "signin-admin-alias",
    "signin-admin-destructure"
  ],
  "brand-cast": [
    "brand-caller",
    "brand-cast-alias",
    "brand-cast-helper",
    "brand-cast-imported-helper",
    "brand-cast-derived"
  ],
  "no-reexport": [
    "export-module",
    "export-imported",
    "export-namespace",
    "export-default-imported",
    "export-const-imported",
    "export-local-alias"
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
    "styling-template-tail",
    "styling-concat",
    "styling-concat-palette",
    "styling-concat-constant",
    "styling-concat-conditional",
    "styling-template-constant",
    "styling-join"
  ],
  "comment-marker": [
    "comment-narration",
    "comment-todo",
    "comment-jsdoc",
    "comment-block",
    "comment-jsx",
    "comment-trailing",
    "comment-marker-later",
    "comment-ts-expect-error-bare",
    "comment-oxlint-disable-bare"
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
  "ci-gates": [
    "repo-ci-gates"
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
    "edge-cross-feature",
    "edge-domain-top-level"
  ],
  "test-import": [
    "edge-test-import",
    "edge-test-import-model"
  ],
  "package": [
    "edge-server-package",
    "edge-server-subpath",
    "edge-server-subpath-route"
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
    "bundle-runtime-module",
    "bundle-closure-barrier",
    "bundle-undeclared-dependency",
    "bundle-public-graph"
  ]
} as const;
