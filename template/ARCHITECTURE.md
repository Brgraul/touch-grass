# Application architecture

Generated from `tools/boundary-enforcement/policy.ts`. Run `pnpm gen:architecture` after changing that policy.

## File roles and ownership

| Role | Owns | Never owns |
|---|---|---|
| route | URLs, params, loaders, redirects, composing feature UI | Direct transport, domain decisions, persistence |
| server-route | Server route handlers | Feature rules or persistence |
| ui | Rendering, interaction, ephemeral state | Fetching, persistence, transport |
| queries | Query keys, options, polling, mutations and invalidation | Domain decisions |
| functions | Parse input, resolve actor, delegate | Ownership checks or domain decisions |
| schema | Client-safe runtime contracts and inferred types | Runtime implementations or SQL |
| service | Server use cases and background processes | UI, transport or Workflow steps |
| model | Pure domain decisions, limits and outcome classification | I/O or transactional rules |
| tools | Pure deterministic tools | I/O |
| agent | SDK agent definition, instructions and tools | I/O |
| repo | Database routine calls and row parsing | Domain decisions |
| workflow | Durability, step names, retries and payload parsing | Domain decisions |
| components | Generic UI primitives and patterns | Feature knowledge or transport |
| layouts | Application shell and navigation | Persistence or transport |
| domain | Shared business capabilities used by multiple features, one directory per capability | Feature imports or modules directly under src/domain |
| platform-client | Shared identities and client mutation mechanism | Feature knowledge |
| platform | Environment, Supabase, auth, model adapter, tracing and logging | Feature knowledge |
| bootstrap | Framework bootstrap and one QueryClient per request | Feature knowledge |
| composition | Runtime wiring and entrypoint exports | Domain rules |

## Dependency allowlist

All roles may import `platform/ids.ts` and `zod`. Framework bootstrap modules are explicit owners of generated routing and hydration wiring.

| Source | May import only |
|---|---|
| route | Feature UI, queries and schemas; layouts; components; browser packages |
| server-route | platform/auth.server.ts; browser packages |
| ui | Components; own UI, queries and schemas; browser packages |
| queries | Own functions and schemas; platform/mutations.ts; @tanstack/react-query |
| functions | Own schema, service or repository; platform/auth.server.ts; @tanstack/react-start |
| schema | Other schemas |
| service | Own schema, model, agent and repository; other schemas; domain; platform; SDK |
| model | Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types |
| tools | Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types |
| agent | Own schema, model, tools and agent; other schemas; pure domain; SDK definitions and types |
| repo | Own schema; platform/supabase.server.ts; platform/database.types.ts |
| workflow | Own service, model, agent and schema; SDK; cloudflare:workers |
| components | Other components; browser packages |
| layouts | Components; feature UI and queries; browser packages |
| domain | Same domain; SDK definitions and types |
| platform-client | Other client-safe platform modules; browser packages |
| platform | Platform; server and browser packages |
| bootstrap | Generated route tree; browser packages |
| composition | Everything it wires |

Browser packages: `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-start`, `@tanstack/react-query`, `@tanstack/react-router-ssr-query`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `radix-ui`, `@radix-ui/react-slot`, `@radix-ui/react-label`, `@radix-ui/react-separator`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`.

Known server packages: `@supabase/supabase-js`, `@supabase/ssr`, `@openai/agents`, `openai`, `cloudflare:workers`. Every package outside the browser allowlist is server-only.

Emitted browser chunks may also contain the dependency closure of the browser packages that `package.json` declares, read from `pnpm-lock.yaml`. The closure excludes the TanStack server, plugin and router-utils packages and the build tools Vite, Rolldown and esbuild, which stay server-only even though a browser package depends on them.

## Rule checks

| Rule | Check | Requirement |
|---|---|---|
| ownership | dependency-cruiser | Import only the modules and packages allowed for the source role. Cross-feature imports reach only schemas. |
| test-import | dependency-cruiser | Application modules never import test or spec files or anything under tests/. |
| package | dependency-cruiser | Client roles import only browser packages, and never their server, SSR or plugin entry points. |
| feature-cycle | dependency-cruiser | Feature dependencies have no cycles. |
| composition-root | dependency-cruiser | Only src/server.ts wires feature Workflows into runtime entrypoints. Platform has no feature knowledge. |
| client-reachability | check-client-bundle | Every emitted browser chunk excludes server modules, server packages, private environment names and the planted secret sentinel. |
| file-role | lint | Every module under src matches exactly one role. Only tests, declaration files and the generated route tree have none. |
| pure-module | lint | Schemas, models, tools, agents and pure domain modules perform no I/O and read no clocks, randomness or runtime. They import only agent definitions, SDK error classes and types. |
| client-data-path | lint | Client views never fetch. Query functions belong to queries modules. Only platform/mutations.ts calls useMutation. |
| server-function | lint | Only functions modules create server functions or server middleware. |
| model-adapter | lint | Only platform/model.server.ts imports openai or constructs the model provider. |
| env-access | lint | Only platform/env.server.ts reads environment fields or copies the environment. The composition root reads only the Workflow binding. |
| test-sign-in | lint | Only tests/fixtures/test-users.ts calls password sign-in or auth.admin. |
| brand-cast | lint | Brands come from parsers. Brand assertions occur only in platform, schemas or repositories. |
| no-reexport | lint | Application modules contain no re-export statements or barrel files. |
| styling | lint | Components use Tailwind utilities and theme tokens. No raw palette colors, white or black, arbitrary color values, hex literals or literal inline styles. |
| comment-marker | lint | Comments in src/ start with SAFETY: on a cast, WHY: for a constraint from an SDK, PostgreSQL or an external API, or a tool directive. Other comments are deleted or encoded as a type, test or lint rule. |
| banned-package | check-repo | No ESLint, second global state manager or dependency injection container. |
| version-pin | check-repo | Every direct dependency and the package manager are pinned to exact versions. CLI tools are local dependencies. |
| forbidden-file | check-repo | No Tailwind, PostCSS or ESLint config and no stylesheet except src/styles/app.css. |
| migration-ledger | check-repo | Applied migrations never change or disappear. New migrations sort after the base branch ledger. |
| auth-urls | check-repo | Each wrangler.jsonc environment APP_URL matches the site_url and callback URL in its [remotes.<environment>.auth] block of supabase/config.toml. |
| ci-gates | check-repo | The pull request workflow runs `pnpm check:fast`, `pnpm typecheck`, `pnpm test`, `pnpm check:bundle`. |
| generated-architecture | check-repo | ARCHITECTURE.md exactly matches the policy renderer. |
| vendored-skill | check-repo | Each skill in skills-lock.json is pinned to a commit and matches its recorded upstream hash. |
| database-types | pnpm check | Database types are regenerated after the isolated reset and fail on a diff. |
| exhaustive-blocks | tsc | Turn rendering uses an exhaustive never check for all stored block kinds. |
| ownership-sql | two-user SQL and E2E proofs | Verified sessions supply owner IDs. RLS owns reads and each mutation routine owns write authorization. |
| turn-writer | SQL grants proof | Only commit_step writes turns. The committer owns exactly one routine and service_role cannot insert turns. |
| deterministic-replay | Workflow replay and deploy proofs | Outside steps execution is deterministic. Saved step names never change. Saved model calls are not resent. |
| timing | constants test | Model step timeout exceeds model call timeout plus trace export timeout. Dispatch delay is below duration. Step and history limits fit Workflows. |
| auth-config | deploy | Auth settings live in supabase/config.toml and each deploy applies them. |
| review | review | No forwarding services or placeholders. Functions delegate ownership. Block changes include data migrations. Secrets never enter source or logs. Production databases are never reset. |
