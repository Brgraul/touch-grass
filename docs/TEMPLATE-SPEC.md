# Template architecture

This document is the complete specification for the application template that Touch Grass installs into a new repository. An agent builds the template from this document alone. This document does not ship in the template. The generated app gets an `ARCHITECTURE.md` rendered from its policy file instead (see [Generated `ARCHITECTURE.md`](#generated-architecturemd)). Where this document says **must** or **never**, the rule is mandatory. [Rule checks](#rule-checks) names the check or proof behind each rule. A rule marked `review` there has no mechanical check yet, and it is the first candidate for one when agents break it. Where it gives a default value, use that value unless a feasibility check in [Open feasibility checks](#open-feasibility-checks) proves it cannot work.

The template is a production-oriented, batteries-included TanStack Start application for AI-agent products. It runs on Cloudflare Free and Supabase Free and is built to be extended by coding agents. It ships two working reference features that agents copy:

- **Account** is the plain CRUD reference. It reads and writes one row per user through the standard database access pattern.
- **Agent Chat** is the agent reference. Every chat message starts a durable run that executes the OpenAI Agents SDK loop with tools on Cloudflare Workflows, survives crashes, and can be stopped. The page shows each step as it is saved.

It also ships working authentication, account management, shared UI, CI, and deployment.

**Design rule.** Organize by feature. Give every responsibility one predictable owner. Enforce boundaries mechanically. Ship only the machinery the reference features use, and list everything else as a [deferred extension](#deferred-extensions) with its trigger.

## Contents

1. [Scope and stack](#scope-and-stack)
2. [Repository layout](#repository-layout)
3. [File roles and ownership](#file-roles-and-ownership)
4. [Dependency rules](#dependency-rules)
5. [Shared identities and conventions](#shared-identities-and-conventions)
6. [Authentication and account](#authentication-and-account)
7. [Agent Chat](#agent-chat)
8. [Database](#database)
9. [Runtime composition](#runtime-composition)
10. [Client state and UI](#client-state-and-ui)
11. [Static enforcement](#static-enforcement)
12. [Testing](#testing)
13. [Commands, validation, and CI](#commands-validation-and-ci)
14. [Environments and deployment](#environments-and-deployment)
15. [Agent guidance files](#agent-guidance-files)
16. [Deferred extensions](#deferred-extensions)
17. [Build order](#build-order)
18. [Acceptance criteria](#acceptance-criteria)
19. [Open feasibility checks](#open-feasibility-checks)

## Scope and stack

### What the template contains

The template contains application code, database definitions, tests, CI, deployment commands, agent guidance, and bundled agent skills. Repository creation, hosted-environment provisioning, and provider account creation happen outside the template.

### Stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start, React, TypeScript (strict) |
| Client server-state | TanStack Query |
| Styling | Tailwind CSS v4 through `@tailwindcss/vite` |
| UI primitives | shadcn/ui, with lucide-react icons |
| Database, Auth, Storage | Supabase (PostgreSQL, Supabase Auth, Supabase Storage) |
| Hosting, SSR, server functions | Cloudflare Workers |
| Durable execution | Cloudflare Workflows |
| Agent loop | OpenAI Agents SDK for TypeScript (`@openai/agents`), over the Chat Completions API |
| Stuck-run sweep | Cloudflare Cron Trigger on the same Worker |
| Lint | Oxlint with vendored anti-slop rules. Never install ESLint. |
| Boundaries | dependency-cruiser plus a client-bundle inspection script |
| Tests | Vitest, Playwright, SQL tests run through the Supabase CLI |
| Package manager | pnpm with a committed lockfile |
| CI | GitHub Actions, for the pull request check only |
| Deployment | Cloudflare Workers Builds, which builds and deploys each Worker from the repository |
| Migrations | Supabase CLI with declarative schemas |
| Worker configuration | Wrangler |

Pin every dependency to an exact version. Pin the Supabase CLI, Wrangler, and shadcn CLI versions in `package.json` and run them through `pnpm exec`.

### External requirements

These are prerequisites the template consumes and never creates:

- An LLM provider account with an OpenAI-compatible chat-completions API.
- A Google Cloud OAuth client for sign-in (see [Google OAuth client](#google-oauth-client)). It needs no custom domain.

The template keeps no money or token ledger. The limits in [Limits summary](#limits-summary) bound how many model calls and tokens one run can use.

## Repository layout

Create only the files a feature needs. Never create placeholder files.

```text
.agents/skills/                          Bundled, version-pinned agent skills
.github/workflows/
	ci.yml                               check:fast, typecheck, test and check:bundle on every pull request
src/
	routes/
		__root.tsx                       Document shell, QueryClient provider
		login.tsx                        "Continue with Google" button
		auth.callback.ts                 Server route; exchanges the OAuth code for a session
		_authenticated.tsx               Protected layout; redirects to /login
		_authenticated/
			index.tsx                    Redirects to /chat
			account.tsx
			chat.index.tsx
			chat.$conversationId.tsx
	features/
		auth/
			ui/
			auth.queries.ts
			auth.functions.ts
			auth.schema.ts
			auth.e2e.spec.ts
		account/
			ui/
			account.queries.ts
			account.functions.ts
			account.schema.ts
			account.repo.server.ts
			account.e2e.spec.ts
		agent-chat/
			ui/
				chat-page.tsx
				conversation-list.tsx
				composer.tsx
				exchange-view.tsx
				turn-view.tsx            Exhaustive block switch
			agent-chat.queries.ts
			agent-chat.functions.ts
			agent-chat.schema.ts
			agent-chat.service.server.ts
			agent-chat.agent.ts
			agent-chat.tools.ts
			agent-chat.model.ts
			agent-chat.model.test.ts
			agent-chat.repo.server.ts
			agent-chat.workflow.server.ts
			agent-chat.integration.test.ts
			agent-chat.e2e.spec.ts
	components/
		ui/                              shadcn/ui components and `cn.ts`
		patterns/                        Domain-agnostic compositions
	layouts/
		app-shell.tsx                    Responsive shell, navigation, account menu
	domain/                              Absent until a shared business capability exists
	platform/
		ids.ts
		mutations.ts                     Client-safe; request keys, transport retries, invalidation
		env.server.ts
		supabase.server.ts
		auth.server.ts
		model.server.ts
		model.server.test.ts
		logger.server.ts
		database.types.ts                Generated; never edited by hand
	styles/
		app.css                          The only stylesheet: Tailwind import and theme tokens
	server.ts                            Sole runtime composition root
supabase/
	config.toml
	schemas/
		auth/                            The before_user_created hook
		account/
		agent-chat/
	migrations/                          One globally ordered ledger
	tests/                               Database-wide security tests
tests/
	fixtures/                            Shared test utilities, provider double
		test-users.ts                    The only password sign-in path
tools/
	boundary-enforcement/                The policy, every repo-owned check, and the fixtures that prove them
		policy.ts                        Single source of roles, imports, packages, and rule checks
		lint-rules/                      Oxlint JS plugin rules derived from the policy
		check-client-bundle.ts
		check-repo.ts                    Packages, pins, forbidden files, migrations, generated files
		generate-architecture.ts         Renders ARCHITECTURE.md from the policy
		fixtures/                        Positive and negative fixtures for every check
		boundary-enforcement.test.ts     Runs every checker against the fixtures
	oxlint/anti-slop/                    Vendored lint rules
	deploy.ts                            Implements pnpm cf:deploy, the Workers Builds deploy command
	verify.ts                            Implements pnpm verify, the four local checks
	verify-deployed.ts                   Implements pnpm verify:deployed
	hooks/                               Optional agent hooks
ARCHITECTURE.md                          Generated from policy.ts; never edited by hand
.node-version                            Node version for CI and Workers Builds
components.json                          shadcn/ui configuration
AGENTS.md
oxlint.config.ts
dependency-cruiser.config.cjs
playwright.config.ts
vitest.config.ts
wrangler.jsonc
package.json
pnpm-lock.yaml
```

Rules:

- Feature implementation and feature tests, including E2E specs, stay in the owning feature directory.
- Server-only modules end in `.server.ts`.
- `src/domain/<capability>/` exists only for a business capability that two or more features share and that belongs to neither. A table that two features read does not make a domain.
- Shared test infrastructure lives under `tests/`.
- Enforcement lives in one place, `tools/boundary-enforcement/`: the policy, every repo-owned check that reads it, and the fixtures that prove them. Root config files (`oxlint.config.ts`, `dependency-cruiser.config.cjs`) stay at the root because their tools expect them there, and import the policy from `tools/boundary-enforcement/policy.ts`.
- Database definitions live under `supabase/schemas/<owner>/`, where `<owner>` is the feature or domain directory name.

## File roles and ownership

Every kind of logic has one owner. The file suffix names the role.

| File | Owns | Never owns |
|---|---|---|
| `routes/*.tsx` | URLs, params, loaders, redirects, composing feature UI | Data access except through `*.queries.ts`, domain decisions, persistence |
| `ui/*.tsx` | Rendering, interaction, ephemeral state | Fetching, persistence, transport |
| `*.queries.ts` | Query keys, query options, polling, and mutations with their request keys and cache invalidation | Domain decisions |
| `*.functions.ts` | TanStack server functions: parse input, resolve the actor, delegate | Ownership checks, domain decisions |
| `*.schema.ts` | The feature's client-safe contracts: runtime schemas and the types inferred from them | Runtime implementations, SQL |
| `*.service.server.ts` | The feature's server-side use cases and the background processes that serve them | UI, transport details, Cloudflare step objects |
| `*.model.ts` | Pure domain decisions over loaded data, constants and limits, feature-private types, and outcome classification | I/O of any kind, rules that must hold atomically with a write |
| `*.tools.ts` | Pure tools an agent may call | I/O of any kind |
| `*.repo.server.ts` | Calls to the feature's database routines, and the server-only row schemas that parse their results | Domain decisions |
| `*.agent.ts` | The OpenAI Agents SDK `Agent` definition: instructions, tools, and model settings | I/O of any kind |
| `*.workflow.server.ts` | The Cloudflare Workflow class and the model wrapper that turns each model call into a step: steps, retries, and the payload schema | Domain decisions |
| `supabase/schemas/<owner>/` | Schemas, roles, tables, constraints, indexes, RLS, grants, and routines, including ownership checks and every rule that must hold atomically with a write | Constants and limits, domain decisions that need no lock or transaction |
| `platform/` | Generic mechanisms: env, Supabase clients, auth, model adapter, logging | Feature knowledge |
| `src/server.ts` | Wiring runtime dependencies and exporting entrypoints | Any rule |

Domain rules split between `*.model.ts` and SQL routines by one test. A rule that must hold atomically with a write lives in a routine: admission, request-key idempotency, capacity, terminal transitions, step commits, and ownership. Every other domain decision lives in `*.model.ts`. Routines receive limits as parameters from `*.model.ts` constants and never hardcode them.

Ownership is checked only in SQL. A server function calls `requireActor` and passes the actor's user ID down. It never checks whether the actor owns a row. RLS enforces ownership on reads, and each mutation routine checks it on writes (see [Access pattern](#access-pattern)).

A feature with simple CRUD needs no `*.service.server.ts`. Its server functions call its repository directly. Create a service only when a use case does more than call one repository routine. Never add a forwarding service, barrel file, or DI container.

## Dependency rules

`tools/boundary-enforcement/policy.ts` encodes this table, and dependency-cruiser enforces it. The table is an allowlist. A module under `src/` may import only what its row lists, and every other edge fails the check. Every module may also import `platform/ids.ts` and `zod`.

The policy names two package lists:

- **Browser packages** are React, TanStack Router, Start, and Query, `lucide-react`, `clsx`, `tailwind-merge`, and the dependencies of installed shadcn/ui components.
- **Server packages** are every other dependency, including `@supabase/*`, `@openai/agents`, and `openai`.

| Source | May import only |
|---|---|
| Routes (`routes/*.tsx`) | Any feature's `ui/`, `*.queries.ts`, and `*.schema.ts`; layouts; components; browser packages |
| Server routes (route files that export only server `handlers`, such as `auth.callback.ts`) | `platform/auth.server.ts`; browser packages |
| `ui/` | Components; own feature's `*.queries.ts` and `*.schema.ts`; browser packages |
| `components/` | Other components; browser packages |
| `layouts/` | Components; any feature's `ui/` and `*.queries.ts`; browser packages |
| `*.queries.ts` | Own feature's `*.functions.ts` and `*.schema.ts`; `platform/mutations.ts`; `@tanstack/react-query` |
| `*.functions.ts` | Own schema; own service or repository; `platform/auth.server.ts`; `@tanstack/react-start` |
| `*.service.server.ts` | Own schema, model, agent, and repository; other features' `*.schema.ts`; `src/domain/`; `platform/`; `@openai/agents` |
| `*.model.ts`, `*.tools.ts`, `*.agent.ts` | Own schema; one another within the same feature; other features' `*.schema.ts`; pure modules in `src/domain/`; `@openai/agents` definitions and types |
| `src/domain/<capability>/` | Modules in the same domain; `@openai/agents` definitions and types |
| `*.repo.server.ts` | Own schema; `platform/supabase.server.ts`; `platform/database.types.ts` |
| `*.workflow.server.ts` | Own service, model, agent, and schema; `@openai/agents`; `cloudflare:workers` |
| `*.schema.ts` | Other features' `*.schema.ts` |
| Client-safe `platform/` modules (`ids.ts`, `mutations.ts`) | Each other; browser packages |
| Other `platform/` modules | Any `platform/` module; server and browser packages |
| `src/server.ts` | Everything it wires. It holds no rules. |

Additional rules:

- Feature dependencies point one way. Cycles between features fail the check.
- A feature may import any module of a domain. A domain never imports a feature.
- A feature imports only another feature's `*.schema.ts`. When a page needs data from two features, its route composes both features' UI and queries.
- Route loaders read data with `queryClient.ensureQueryData` and the query options from `*.queries.ts`. A route never calls a server function directly, so every read goes through one cache.
- Only `platform/model.server.ts` builds a model provider or an `openai` client. The `openai` package appears nowhere else. Features import `@openai/agents` only for `Agent`, `Runner`, `tool`, the `Model` interface, and SDK types.
- `platform/model.server.ts` knows nothing about chat. Agent Chat wraps its model calls in Workflow steps and classifies their errors.
- `*.queries.ts` is the only client-reachable module that imports `*.functions.ts`. TanStack Start compiles each server function into a client RPC stub. Importing `*.functions.ts` never makes the rest of that module safe for the browser, and the client-bundle inspection decides what actually ships.

## Shared identities and conventions

`platform/ids.ts` holds brands for identities that more than one feature names.

```ts
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type UserId = Brand<string, 'UserId'>;
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type RunId = Brand<string, 'RunId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type RequestKey = Brand<string, 'RequestKey'>;
export type Instant = Brand<string, 'IsoInstant'>;
export type PageCursor = Brand<string, 'PageCursor'>;
export type Page<T> = { items: readonly T[]; next?: PageCursor };
export type Actor = { userId: UserId; environmentId: EnvironmentId };
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type NotFound = { kind: 'not_found' };
```

Conventions every feature follows:

- **Parse once at the boundary.** Every value from outside the process (request payload, environment, Workflow payload, database row, provider response, model tool arguments) is parsed by a zod schema at its owning adapter. Code inside the boundary trusts the types and never revalidates.
- **Brands come from parsers.** Never cast a string to a brand in caller code.
- **Owner IDs come from the verified session.** Never read an owner ID from a request body, a URL, or user-editable metadata.
- **Request keys.** `platform/mutations.ts` generates one `RequestKey` (a UUID) per deliberate create action and reuses it for transport retries of that action. A user who submits again gets a new key. Features never create request keys.
- **Receipts.** Every create returns a discriminated receipt: the stored result, `key_conflict` when the same key arrives with different input, or a refusal.
- **Pagination.** Lists use keyset pagination. A `PageCursor` is an opaque base64url encoding of the last item's sort key. The page size is 25 and the maximum is 50.
- **Times.** PostgreSQL time decides every deadline and window. Worker clocks only measure relative durations.
- **Errors.** Server functions return safe, typed errors. A safe error carries a stable code and a correlation ID, never a stack trace, SQL text, or provider body. Invalid input returns the code `invalid_input`. A server function therefore parses its input with `parseInput` from `platform/auth.server.ts` inside its `safeResult` callback, behind a typed identity `.validator()`. A schema passed to `.validator()` throws before the handler runs, and the client would retry that throw as a transport failure.

## Authentication and account

### Authentication

Google is the only sign-in method. The template sends no email. `features/auth/` owns sign-in, the OAuth callback, and logout. `platform/auth.server.ts` owns the infrastructure.

- Supabase Auth with the Google provider. Sessions persist in HTTP-only cookies through `@supabase/ssr`, which uses the PKCE flow.
- `/login` shows one "Continue with Google" button. The button calls the `startGoogleSignIn` server function through a mutation in `auth.queries.ts`. The server function calls `auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL + '/auth/callback', skipBrowserRedirect: true } })` through the request client and returns the provider URL. The page navigates to that URL.
- `/auth/callback` is a server route. It calls `auth.exchangeCodeForSession(code)` through the request client and redirects to `/`. A missing code or a failed exchange redirects to `/login?error=sign_in_failed`, where the page shows one generic failure message.
- Sign-in requests only the `openid`, `email`, and `profile` scopes. Any other scope requires Google app verification.
- The first sign-in creates the Supabase user. There is no separate sign-up flow.
- `platform/auth.server.ts` exports `createRequestClient(request)`, which builds a Supabase client bound to the request's cookies, and `requireActor(request)`, which verifies the session with `auth.getUser()` and returns an `Actor` or throws an unauthenticated error.
- The `_authenticated` layout route reads the session through the session query in `auth.queries.ts` and redirects unauthenticated visitors to `/login`. Route protection is navigation only. Every private server function calls `requireActor` itself.
- Logout signs out through Supabase with `scope: 'local'`, so it revokes only the current session. It clears the cookies and calls `queryClient.clear()`. A failed logout shows an alert and keeps the user signed in.

### Auth configuration

`supabase/config.toml` holds every Auth setting. Never change Auth settings in the Supabase dashboard. Local URLs use `127.0.0.1`, the host the dev server binds, so the OAuth callback lands on the origin that holds the PKCE verifier cookie.

```toml
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]
enable_signup = true

[auth.email]
enable_signup = true

[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/auth_hooks/before_user_created"

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
skip_nonce_check = false
```

- Each hosted environment has a `[remotes.<environment>]` block with its `project_id`. Its `[remotes.<environment>.auth]` block sets `site_url` to the environment's `APP_URL` and `additional_redirect_urls` to `["<APP_URL>/auth/callback"]`.
- `pnpm cf:deploy` applies the file with `supabase config push` (see [Deployment](#deployment)).
- The Supabase CLI maps `[auth.email] enable_signup` to the whole email provider. Turning it off also turns off password sign-in, so it stays on.
- The `before_user_created` hook blocks email sign-up instead. Supabase Auth calls `auth_hooks.before_user_created` before it creates a user through sign-up, a magic link, an anonymous sign-in, or an OAuth provider. The hook allows only `google` and rejects every other provider with HTTP 403. Users created through the admin API skip the hook, so email and password sign-in works only for users that [test sign-in](#test-sign-in) creates with the secret key.
- `supabase/schemas/auth/` owns the hook. Its schema is `auth_hooks`, because Supabase owns `auth`. Execution is granted only to `supabase_auth_admin`.
- Locally, the Supabase CLI reads the two Google variables from `supabase/.env`, which is gitignored. No test contacts Google.

### Google OAuth client

The developer creates one Google Cloud OAuth client of type "Web application". It serves every environment.

- The consent screen audience is External, and its publishing status is "In production". In "Testing", only listed test users can sign in.
- The authorized redirect URIs are `https://<project-ref>.supabase.co/auth/v1/callback` for each hosted Supabase project and `http://127.0.0.1:54321/auth/v1/callback` for the local stack.
- The client ID and secret are the Workers Builds build secrets `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, and the same names in `supabase/.env`.
- The consent screen names `<project-ref>.supabase.co`, not the app. Changing that is the branded consent [deferred extension](#deferred-extensions).

### Test sign-in

Automated tests never use Google. `tests/fixtures/test-users.ts` exports `createTestUser()`, `signInAs(page, user)`, and `deleteTestUser(user)`.

- `createTestUser` creates a confirmed user through `auth.admin.createUser` with a unique `@example.test` email and a random password.
- `signInAs` signs in with `auth.signInWithPassword` through an `@supabase/ssr` client and writes the resulting session cookies into the Playwright browser context.
- E2E journeys, the two-user denial tests, and `verify:deployed` use these helpers. `verify:deployed` deletes its user when it finishes.
- Only `tests/fixtures/test-users.ts` calls `signInWithPassword` or `auth.admin.createUser`.

### Account

`features/account/` owns the profile. A profile is a display name of 1 to 80 characters.

- `getProfile` returns the stored profile or a default with an empty display name.
- `updateProfile` upserts the profile for the actor.
- The account page shows the Google account email (read from the session) and an editable display name.

Account is simple CRUD. Its server functions call `account.repo.server.ts` directly, and it uses the same database pattern as every feature (see [Database](#database)).

## Agent Chat

A user sends a message in a conversation. Every message starts a durable run on Cloudflare Workflows. The run executes the OpenAI Agents SDK loop with tools and commits one agent turn per step. A five-second answer and a five-hour answer take the same path. The browser only views runs. Closing the tab never stops a run, and reopening the conversation shows where it stands.

Three parts share the work, and each owns one thing:

| Part | Owns |
|---|---|
| PostgreSQL | The record: conversations, runs, agent turns, admission, and terminal outcomes |
| OpenAI Agents SDK (`@openai/agents`) | The agent loop: building the conversation, calling the model, running tools, and deciding when the answer is final |
| `AgentChatWorkflow` (Cloudflare Workflows) | Durability: each model call and each commit is a Workflow step, so a crashed run resumes from its last saved step |

Progress reaches the browser one step at a time. Each committed step is an agent turn in PostgreSQL, and the page polls while a run is active. The template does not stream tokens. The live updates extension in [Deferred extensions](#deferred-extensions) adds them when a product needs them.

The template has one durability mechanism. It never adds attempts, leases, or fencing tokens on top of Workflows. A one-minute sweep covers the two gaps Workflows cannot see: a run that never started, and a run that died without failing.

### Vocabulary

- A **conversation** is one chat thread. It belongs to one user.
- A **message** is the text a user sends. Each message starts exactly one run and is stored on that run.
- A **run** is the durable execution that answers one message. Its Workflow instance ID is the run ID, so a run never has two instances.
- A **step** is one model response plus the pure tool calls it requested, committed as one agent turn.
- A **model call** is one request to the LLM provider. A step makes one model call and up to `MODEL_CALL_RETRIES` retries.

### Chat contracts

`agent-chat.schema.ts` holds the feature's public contracts.

```ts
export type ToolCallId = Brand<string, 'ToolCallId'>;

// Agent turns hold these kinds.
export type ContentBlock =
	| { kind: 'text'; text: string }
	| { kind: 'tool_call'; callId: ToolCallId; tool: string; input: JsonValue | { unparsed: string } }
	| { kind: 'tool_result'; callId: ToolCallId; output: JsonValue; isError: boolean }
	| { kind: 'structured_output'; schema: string; value: JsonValue };

// The read type. Parsing an unknown stored kind or version produces `unsupported`.
export type StoredBlock =
	| ContentBlock
	| { kind: 'unsupported'; storedKind: string; storedVersion: number };

export type RunFailure =
	| { kind: 'execution'; code: 'internal' | 'unclassified_provider_response' }
	| { kind: 'limit'; limit: 'steps' | 'tool_calls' | 'model_retries' | 'context' | 'duration' }
	| { kind: 'provider_refused'; reason: 'quota' | 'policy' | 'configuration' }
	| { kind: 'model_output_invalid'; reason: 'truncated' | 'oversized' };

export type Run = { id: RunId; conversationId: ConversationId; message: string; version: number; createdAt: Instant } & (
	| { state: 'queued' }
	| { state: 'running'; committedSteps: number }
	| { state: 'completed'; finalTurn: TurnId; endedAt: Instant }
	| { state: 'failed'; failure: RunFailure; endedAt: Instant }
	| { state: 'canceled'; endedAt: Instant }
);

export type AgentTurn = { id: TurnId; runId: RunId; step: number; blocks: readonly StoredBlock[]; createdAt: Instant };
export type Exchange = { run: Run; turns: readonly AgentTurn[] };
export type Conversation = { id: ConversationId; title: string; updatedAt: Instant };

export type SendRefusal = 'rate_limited' | 'capacity' | 'busy';
export type SendReceipt =
	| { kind: 'accepted'; run: Run }
	| { kind: 'refused'; reason: SendRefusal }
	| { kind: 'key_conflict' };

// Parses OpenAI Agents SDK run items (messages, function calls, function call results) into blocks.
export const blocksFromAgentItems: z.ZodType<ContentBlock[], z.ZodTypeDef, unknown>;

export const BLOCK_SCHEMA_VERSION = 1;
```

A message is plain text of at most 32 KB, with no NUL character and no unpaired UTF-16 surrogate, because PostgreSQL and JSON cannot store them. `blocksFromAgentItems` replaces those characters with U+FFFD in model output, so they never fail a run and a replay stores the same blocks. In an agent turn, every `tool_result` references a `tool_call` with the same `callId` in the same turn, and `unsupported` is never written. A text block holds at most 32 KB. A JSON value holds at most 16 KB serialized. A turn holds at most 64 blocks and 256 KB in total.

`agent-chat.service.server.ts` implements the use cases, the runner that the Workflow steps call, and the sweep.

```ts
export interface Chat {
	send(actor: Actor, input: { requestKey: RequestKey; conversationId?: ConversationId; text: string }): Promise<SendReceipt | NotFound>;
	listConversations(actor: Actor, page: { after?: PageCursor }): Promise<Page<Conversation>>;
	readConversation(actor: Actor, id: ConversationId, page: { after?: PageCursor }): Promise<{ conversation: Conversation; exchanges: Page<Exchange> } | NotFound>;
	cancel(actor: Actor, runId: RunId): Promise<Run | NotFound>;
}

// Built in src/server.ts from the AGENT_CHAT_WORKFLOW binding and injected into the service.
export type WorkflowRuns = {
	start(runId: RunId): Promise<void>; // Creates the instance with ID runId. An existing instance counts as success.
	terminate(runId: RunId): Promise<void>;
};
```

`agent-chat.functions.ts` exposes `sendMessage`, `listConversations`, `readConversation`, and `stopRun`. Each resolves the actor and calls the service.

- `send` without a `conversationId` starts a new conversation. Its title is the first 80 characters of the message.
- `listConversations` sorts by `(updated_at, id)`, newest first.
- `readConversation` returns the conversation's exchanges, newest first. Each exchange holds a run and its committed agent turns in step order.
- `cancel` returns the durable winner, including an already completed or failed run.
- A failed or canceled run has no retry. The page offers to send the same text again as a new message.

### Sending a message

`send` runs the `submit_message` routine in one transaction:

1. Take the environment's advisory lock. It serializes admission for the environment.
2. Look up the run for `(owner_id, request_key)`. If one exists, compare the canonical input hash and return the stored run or `key_conflict`. The canonical input is the conversation ID, or none, and the message text.
3. If a conversation ID is given, return `not_found` unless the actor owns it.
4. Count the user's runs created within the last hour. At `MESSAGES_PER_USER_PER_HOUR`, return `refused: rate_limited`.
5. If the conversation has a `queued` or `running` run, return `refused: busy`. One run per conversation runs at a time.
6. Count the user's and the environment's `queued` and `running` runs. At either limit, return `refused: capacity`.
7. Create the conversation if none was given. Create the run with its policy snapshot and deadline, and set the conversation's `updated_at`.

A refusal writes no row, so the same request key is evaluated again on a later attempt. `submit_message` receives every limit as a parameter from the `agent-chat.model.ts` constants. Active-run counts come from run state, so no slot table exists and no code releases a slot.

After the transaction commits, the service calls `workflowRuns.start(runId)` for a newly created run and ignores a failure. The sweep starts the run instead.

### The sweep

The Worker's scheduled handler runs `sweepRuns` every minute. It reads at most 25 runs per rule with the `sweep_candidates` routine, oldest first, and applies two rules:

| Runs | Action |
|---|---|
| `queued`, created before PostgreSQL `now - DISPATCH_CHECK_DELAY` | `workflowRuns.start(runId)` |
| Nonterminal, with PostgreSQL `now` at or past `deadline + END_CHECK_GRACE` | `workflowRuns.terminate(runId)`, best effort, then `fail_run` with `limit: 'duration'` |

Both rules are idempotent. Starting an existing instance changes nothing, and `fail_run` changes nothing on a terminal run. The sweep holds no state between passes.

### Stopping a run

The page's stop button calls `cancel`, which calls `cancel_run`, then `workflowRuns.terminate(runId)`.

- `cancel_run` locks the run row. If the run is nonterminal, it becomes `canceled`. The routine returns the durable winner.
- Termination is best effort. If it fails, the run's next commit finds a terminal run and the loop ends. No turn follows a cancellation.
- Committed steps stay in the conversation. The model call in flight is discarded, and that call may still be charged.

### Lifecycle

| Current state | Allowed next states |
|---|---|
| `queued` | `running`, `failed`, `canceled` |
| `running` | `completed`, `failed`, `canceled` |
| `completed`, `failed`, `canceled` | None |

- A run becomes `running` in `start_run`, the first step of its Workflow instance.
- Cancellation, completion, and failure lock the same run row. The first committed terminal transition wins. Every later transition returns that winner.
- A completed run's `finalTurn` is written by its final commit in the same transaction that completes the run. A final answer is never visible on a running run.
- `version` increases on every change to the run row. Clients use it for cache reconciliation.

### The agent definition

`agent-chat.agent.ts` exports `CHAT_AGENT`, an OpenAI Agents SDK `Agent`. It has no I/O.

```ts
export const CHAT_AGENT = new Agent({
	name: 'chat',
	instructions: SYSTEM_PROMPT,     // From agent-chat.model.ts
	tools: TOOLS,                    // From agent-chat.tools.ts
	// The pinned SDK sends maxTokens as max_tokens, which reasoning models reject.
	modelSettings: { providerData: { max_completion_tokens: MAX_OUTPUT_TOKENS } },
});

// The pinned SDK reads these from the run configuration, not from the Agent.
export const CHAT_RUN_CONFIG = {
	tracingDisabled: true,
	toolNotFoundBehavior: 'return_error_to_model',
	toolErrorFormatter: () => TOOL_ERROR_OUTPUT,
} satisfies Partial<RunConfig>;
```

`toAgentInput(history, message)` in `agent-chat.model.ts` builds the run's input:

- The history is the conversation's earlier `completed` runs, oldest first, at most `MAX_HISTORY_RUNS` runs and `MAX_HISTORY_BYTES` in total. The oldest runs drop first.
- Each history run becomes its message as a user message, then its agent turns' blocks as SDK items in order. Text becomes assistant messages, `tool_call` blocks become function calls, and `tool_result` blocks become function call results.
- The new message comes last as a user message.
- Failed and canceled runs never reach the model. An `unsupported` block becomes the text `[unsupported block]`.
- Messages are plain text, and only `commit_step` writes agent turns. A user therefore cannot forge a tool call or tool result into a model call.

`start_run` loads the history in SQL, and the `start` step saves it as its result. A replay therefore builds the same input. No prompt is stored.

### Tools

`agent-chat.tools.ts` exports the tool catalog. A tool is a pure, deterministic, synchronous function wrapped by the SDK's `tool` helper.

```ts
export const calculate = pureTool({
	name: 'calculate',
	description: 'Evaluate an arithmetic expression.',
	parameters: z.object({ expression: z.string() }),
	run: ({ expression }) => ({ value: evaluate(expression) }),
});
export const TOOLS = [calculate];
```

`pureTool` builds an SDK `tool`. Its `execute` runs `run`, rejects an output over 16 KB, and returns the output as JSON. `calculate` evaluates arithmetic with `+`, `-`, `*`, `/`, parentheses, and decimal numbers through a hand-written parser. It never calls `eval` or `Function`.

Tool rules:

- The tools module is a pure role. The `pure-module` lint rule rejects any I/O, clock, randomness, or runtime access inside it (see [Purity](#purity)).
- Tools run inside the Workflow's `run`, outside any step, so a replay runs them again. A pure tool gives the same result every time.
- An unknown tool name, invalid arguments, a thrown error, or an oversized output becomes a tool error the model can read, and the run continues.
- A tool with network, storage, or any other side effect needs the non-pure tool extension in [Deferred extensions](#deferred-extensions). The `pure-module` lint rule rejects such a tool until that extension exists.

### Private execution contracts

These types live in `agent-chat.model.ts` and never leave the feature.

```ts
export type RunPolicy = { maxSteps: number; maxToolCallsPerStep: number };

export type RunInput = {
	runId: RunId;
	ownerId: UserId;
	conversationId: ConversationId;
	message: string;
	history: readonly Exchange[];
	policy: RunPolicy;
	deadline: Instant;
};

// A model response in a form Workflows can save as a step result.
export type SavedModelResponse = {
	output: readonly AgentOutputItem[];   // From @openai/agents
	usage: { inputTokens: number; outputTokens: number };
	finishReason?: string;
};

export type ModelOutcome =
	| { kind: 'response'; response: SavedModelResponse }
	| { kind: 'terminal'; failure: RunFailure };

export type Commit =
	| { kind: 'committed'; now: Instant }  // PostgreSQL time
	| { kind: 'completed' }               // This step's commit completed the run.
	| { kind: 'ended' };                   // The run is terminal. The loop stops.

export class RunFailed extends Error { constructor(readonly failure: RunFailure) { super(failure.kind); } }
export class RunEnded extends Error {}

export function toAgentInput(history: readonly Exchange[], message: string): AgentInputItem[];
export function checkBeforeCall(input: RunInput, step: number, now: Instant): RunFailure | undefined;
export function checkResponse(response: SavedModelResponse, policy: RunPolicy): RunFailure | undefined;
export function turnBlocks(response: SavedModelResponse, nextInput?: readonly AgentInputItem[]): ContentBlock[];
export function classifyModelError(kind: ProviderErrorKind): 'retry' | RunFailure;
export function failureFromRunError(error: unknown): RunFailure | undefined;
```

- `checkBeforeCall` fails with `limit: 'duration'` when `now` is at or past the deadline, and with `limit: 'steps'` when `step` exceeds `policy.maxSteps`.
- `checkResponse` fails with `limit: 'tool_calls'` above `policy.maxToolCallsPerStep`, with `model_output_invalid: 'oversized'` when the turn would exceed the turn write caps, and with `model_output_invalid: 'truncated'` when the finish reason is the output token limit.
- `turnBlocks` parses a response's items, plus each `function_call_result` item in the next request's input that answers one of its calls, with `blocksFromAgentItems`. Arguments that are not valid JSON become `{ unparsed }`. The SDK wraps a tool result as `{ type: 'text', text }`. `blocksFromAgentItems` stores the parsed JSON inside it, and stores a result that is not JSON, such as the SDK's argument-parse message, with `isError: true`.
- `failureFromRunError` maps an error that escapes the SDK run to a failure. It returns `undefined` for `RunEnded`, because the run is already terminal.

### Policy and timing defaults

`agent-chat.model.ts` exports these constants. A unit test asserts every inequality below the table.

| Constant | Default |
|---|---|
| `MAX_STEPS` | 8 |
| `MAX_TOOL_CALLS_PER_STEP` | 4 |
| `MAX_OUTPUT_TOKENS` | 1,024 per model call |
| `MESSAGES_PER_USER_PER_HOUR` | 60 |
| `ACTIVE_RUNS_PER_USER` | 2 |
| `ACTIVE_RUNS_PER_ENVIRONMENT` | 10 |
| `RUN_DURATION` | 15 minutes |
| `MODEL_CALL_TIMEOUT` | 120 seconds. The model call aborts after this time. |
| `MODEL_STEP_TIMEOUT` | 150 seconds. The Workflow step timeout for one model call attempt. |
| `MODEL_CALL_RETRIES` | 2, with exponential backoff starting at 5 seconds |
| `DISPATCH_CHECK_DELAY` | 60 seconds |
| `END_CHECK_GRACE` | 5 minutes |
| `MAX_HISTORY_RUNS` | 20 |
| `MAX_HISTORY_BYTES` | 512 KB |
| `WORKFLOW_STEP_LIMIT` | The current Cloudflare per-instance step limit, copied from Cloudflare's limits page |

- `MODEL_STEP_TIMEOUT > MODEL_CALL_TIMEOUT`, so the abort ends a call before Workflows times out the step.
- `DISPATCH_CHECK_DELAY < RUN_DURATION`.
- `2 × MAX_STEPS + 2 ≤ WORKFLOW_STEP_LIMIT`. A run uses one start step, a model step and a commit step per step, and at most one fail step.
- `MAX_HISTORY_BYTES` stays below the 1 MiB Workflow step result limit, because the `start` step saves the history.

The runtime itself has no upper bound on how long a run takes. `RUN_DURATION` and `MAX_STEPS` are the product's limits, and a product that needs hours raises them. The run row stores the `RunPolicy` in force at admission, so a later deploy never changes a running run's step or tool limits. Timing constants are not stored per run. A deploy that changes them affects only steps that start after the deploy.

### The Workflow

`agent-chat.workflow.server.ts` exports `AgentChatWorkflow`, a Cloudflare `WorkflowEntrypoint`, and the `DurableModel` it uses.

```ts
export class AgentChatWorkflow extends WorkflowEntrypoint<Env, unknown> {
	async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
		const { runId } = parseRunPayload(event.payload);
		const runner = createRunner(this.env);
		const start = await step.do('start', () => runner.start(runId));
		if (start.kind === 'ended') return;
		const model = new DurableModel(step, runner, start.input, start.now);
		try {
			const result = await new Runner({ model, ...CHAT_RUN_CONFIG }).run(
				CHAT_AGENT,
				toAgentInput(start.input.history, start.input.message),
				{ maxTurns: start.input.policy.maxSteps + 1 },
			);
			await model.commitFinal(result);
		} catch (error) {
			if (isEngineControl(error)) throw error;
			const failure = failureFromRunError(error);
			if (failure) await step.do('fail', () => runner.fail(runId, failure));
		}
	}
}
```

`DurableModel` implements the SDK's `Model` interface. Its `getResponse(request)` does this for model call `n`:

1. If `n > 1`, run step `commit-${n - 1}`. It calls `commit_step` with `turnBlocks(previous response, request.input)`. If the step returns anything but `committed`, throw `RunEnded`.
2. If `checkBeforeCall(input, n, now)` returns a failure, throw `RunFailed` with it.
3. Run step `model-${n}` with `MODEL_STEP_CONFIG`. Inside the step, `runner.callModel(request)` sends the request through the provider from `platform/model.server.ts`, aborts it after `MODEL_CALL_TIMEOUT`, and returns a `ModelOutcome`. It throws only when `classifyModelError` returns `'retry'`, so Workflows retries the step.
4. If the step throws after its retries, throw `RunFailed` with `limit: 'model_retries'`. If the outcome is `terminal`, or `checkResponse` returns a failure, throw `RunFailed` with it.
5. Remember the response and return it to the SDK.

`commitFinal` runs the last commit step with `final` set to true. `getStreamedResponse` throws, because runs never stream.

| Step | Work | Retries |
|---|---|---|
| `start` | `start_run`: return `ended` if the run is terminal. Otherwise mark it `running` and return its `RunInput`, including the history, and PostgreSQL `now`. | Workflows default |
| `model-N` | One model call, classified | `MODEL_STEP_CONFIG` |
| `commit-N` | `commit_step` for step `N` | Workflows default |
| `fail` | `fail_run` | Workflows default |

`MODEL_STEP_CONFIG` sets `retries` to `{ limit: MODEL_CALL_RETRIES, delay: '5 seconds', backoff: 'exponential' }` and `timeout` to `MODEL_STEP_TIMEOUT`.

Workflow rules:

- The payload is `{ runId }` and nothing else.
- Step names come only from the call count. Never rename a step. A deploy replays running instances against the new code, and Workflows matches saved results by step name.
- Code outside `step.do` is deterministic. SDK tracing is disabled, so no trace export runs on replay. Run tracing goes to Langfuse from inside the steps instead (see [Run tracing](#run-tracing)).
- `DurableModel` holds no domain logic. Every check is a function in `agent-chat.model.ts`.
- `maxTurns` is one above `policy.maxSteps`, so `checkBeforeCall` reports the step limit after the last step is committed. `MaxTurnsExceededError` is only a backstop.
- A pause, restart, or engine shutdown rejects the pending `step.do`. `isEngineControl` recognizes that rejection, and both `DurableModel` and `run` rethrow it. Without this, the catch-all would record `model_retries` or `internal` on a run that Workflows is about to resume.
- `runner.callModel` runs the model call inside `withTrace(new NoopTrace(), ...)`. A step runs outside the SDK run's trace context, and the Chat Completions model throws "No existing trace found" without one.
- `agent-chat.workflow.server.ts` also exports `workflowRuns(binding)`, which builds `WorkflowRuns`. `start` treats only an "already exists" error as success and rethrows every other error. `src/server.ts` and the integration tests use the same factory.

### Commit and failure routines

`commit_step(p_run_id, p_step_ordinal, p_blocks, p_final, p_usage)` runs in one transaction:

1. Lock the run row.
2. If a turn already exists for `(run_id, step_ordinal)`, the commit step is repeating. Return `completed` if that turn is the run's final turn, `ended` if the run is otherwise terminal, and otherwise `committed`.
3. If the run is terminal, return `ended` and write nothing.
4. If PostgreSQL `now` is at or past the deadline, fail the run with `limit: 'duration'` and return `ended`.
5. Insert the agent turn, increment `committed_steps`, add the token usage, increment `version`, and set the conversation's `updated_at`.
6. If `p_final` is true, complete the run with `final_turn_id` and `ended_at`.
7. Return `completed` for a final step, or `committed` with PostgreSQL `now`.

`fail_run(p_run_id, p_failure)` locks the run row. If the run is nonterminal, it records the failure. When PostgreSQL `now` is at or past the deadline, it records `limit: 'duration'` instead of the given failure, so a deadline that passes during a retry backoff ends as `duration`. It returns the durable winner either way.

### Why the loop is safe

- **One instance per run.** The Workflow instance ID is the run ID, and Workflows refuses a second instance with the same ID.
- **A saved model call is never sent again.** On replay, `step.do` returns the saved response.
- **A replay rebuilds the same conversation.** The input comes from the saved `start` step, the model responses come from saved steps, and pure tools give the same results.
- **A repeated commit changes nothing.** `commit_step` is keyed by `(run_id, step_ordinal)`. `start_run`, `fail_run`, and `cancel_run` change nothing on a terminal run.
- **A terminal run stays terminal.** Every routine checks the run state while it holds the row lock.
- **A lost run is noticed.** The sweep fails the run by `deadline + END_CHECK_GRACE`.

The template accepts one cost. A model call repeats when its step's result fails to save, or when the step times out while the provider is still working. Each repeat can be charged. `MODEL_CALL_RETRIES` bounds a step to `MODEL_CALL_RETRIES + 1` model calls.

### Run tracing

`platform/telemetry.server.ts` exports `createTracer(env)`, which sends one OTLP/JSON span per `record` call to Langfuse at `LANGFUSE_BASE_URL`. It knows nothing about chat. Without both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` it sends nothing, and `parseEnv` rejects one key without the other.

- The trace ID is the run ID without hyphens. Every span carries the trace name `agent-chat`, the run owner as the Langfuse user, and the conversation ID as the Langfuse session. `start_run` returns the conversation ID in `RunInput` for this. `Trace.sessionId` is optional, and a span without one carries no session.
- `runner.callModel` records one generation per provider request, named after its step (`model-<n>`), with the prompt, the output or failure, the token usage and the model. A retried attempt is an error generation.
- The final commit, when `commit_step` returns `completed`, and the `fail` step record one `run` span. Its span ID comes from the trace ID, so a repeated step resends the same span. The sweep and cancellation record nothing.
- Every export runs inside a step, so a replay that reuses a saved step sends nothing. An export waits at most `TRACE_EXPORT_TIMEOUT` (5 seconds), and `MODEL_STEP_TIMEOUT` exceeds `MODEL_CALL_TIMEOUT` plus that. A failed export logs `trace_export_failed` with the run ID and never fails the run.

### Model provider and errors

`platform/model.server.ts` exports `createModelProvider(env)` and `classifyProviderError(error)`. Neither function knows anything about chat.

- `createModelProvider` returns an SDK `OpenAIProvider` for the Chat Completions API at `LLM_BASE_URL`, with `LLM_API_KEY` and the default model `LLM_MODEL`. The client's own retries are off (`maxRetries: 0`), because Workflows retries model steps.
- `classifyProviderError` matches the pinned `openai` error classes with `instanceof`, because every class has `name === 'Error'`. It maps the error a model call throws to one `ProviderErrorKind`: `retryable`, `context_length`, `quota`, `policy`, `configuration`, or `unknown`. `src/platform/model.server.test.ts` runs it against recorded fixtures of the chosen provider's error responses.

| Provider outcome | Result | Run behavior |
|---|---|---|
| Complete response within the turn caps | `response` | The SDK runs the tools, and the next model call commits the step |
| Response blocks exceed the turn write caps | `model_output_invalid: 'oversized'` | The run fails |
| More tool calls than `MAX_TOOL_CALLS_PER_STEP` | `limit: 'tool_calls'` | The run fails |
| Finish reason is the output token limit | `model_output_invalid: 'truncated'` | The run fails |
| `retryable`: rate limit, 5xx, overloaded, abort at the timeout, network loss (including a body cut off after the headers, which the client's `fetch` in `platform/model.server.ts` reads whole and turns into a connection error) | `'retry'` | Workflows retries the model step after its backoff |
| `context_length` | `limit: 'context'` | The run fails |
| `quota`, `policy`, `configuration` | `provider_refused` with the same reason | The run fails |
| `unknown` | `execution` with `unclassified_provider_response` | The run fails |

Errors that escape the SDK run map to failures through `failureFromRunError`:

| Error | Failure |
|---|---|
| `RunFailed` | The failure it carries |
| `RunEnded` | None. The run is already terminal. |
| `MaxTurnsExceededError` | `limit: 'steps'` |
| Any other error, including `ModelBehaviorError` | `execution` with `internal` |

Workflows' retry backoff does not read the provider's `Retry-After` header. The backoff starts at 5 seconds and doubles.

### Progress in the browser

- `readConversation` returns each run with its committed agent turns. While a visible run is `queued` or `running`, the conversation query polls every 2 seconds and stops when the run ends. Each poll is one invoker read under the caller's JWT.
- The page shows a run's steps as they are saved: text, tool calls, and tool results. Between steps it shows that the run is working, with the number of committed steps.
- Nothing is pushed to the browser. A tab that was closed shows the current state when it opens.

### Limits summary

| Limit | Enforced by |
|---|---|
| Active runs per user and per environment | `submit_message`, counted from run state under the environment lock |
| One active run per conversation | `submit_message` |
| Messages per user per hour | `submit_message`, counted from runs created within the last hour, before any row is written |
| Steps, duration | `checkBeforeCall`, from the run's policy snapshot. `commit_step` also checks the deadline. |
| Model calls per step | `MODEL_STEP_CONFIG` retries |
| Tool calls per step, response size, truncation | `checkResponse` |
| History sent to the model | `toAgentInput`, by `MAX_HISTORY_RUNS` and `MAX_HISTORY_BYTES` |
| Prompt size | The provider's context-length error |
| Output tokens per call | `max_completion_tokens` in the agent's model settings `providerData` |
| Message, block, and turn size | Write schemas at the RPC boundary |
| A run that never ends | The sweep, at `deadline + END_CHECK_GRACE` |

### Chat UI

- `/chat` lists conversations and has a composer that starts a new one. `/chat/$conversationId` shows the exchanges, oldest at the top, with the composer at the bottom.
- Each exchange shows the message and the committed agent turns. While the run is active, it also shows a working indicator with the step count and a stop button.
- A failed or canceled run shows its reason and a button that sends the same text again with a new request key.
- `turn-view.tsx` renders an agent turn by switching exhaustively over `block.kind`, with a small component per kind in the same file. The TypeScript `never` check fails the build when a kind lacks a branch. Move a block component to its own file only when it grows.
- The repository parses stored blocks by `block_schema_version` and kind. An unknown kind or version becomes `unsupported`. Removing or reshaping a block kind requires a SQL data migration in the same change.

## Database

### Schemas and roles

Each feature with tables owns two PostgreSQL schemas. Only the agent-turn write boundary needs its own role.

| Feature | Private schema (tables, internal routines) | Exposed schema (routines callable through PostgREST) | Roles |
|---|---|---|---|
| account | `account` | `account_api` | None |
| agent-chat | `agent_chat` | `agent_chat_api` | `agent_chat_committer` |

`supabase/config.toml` lists only the `*_api` schemas (plus Supabase's defaults) under `[api] schemas`. Private schemas are never exposed.

Each feature directory under `supabase/schemas/` holds `schema.sql` (schemas and roles), `tables.sql`, `policies.sql`, `routines.sql`, and `grants.sql`. Add `indexes.sql` when a feature needs indexes beyond its constraints.

### Access pattern

Every feature uses the same pattern. Agents copy it for new features.

**Reads.** A read routine is `security invoker`, with `set search_path = ''` and schema-qualified names. The server calls it through the request client, so it runs as `authenticated` under the caller's JWT. `authenticated` holds `select` on the private tables it reads and nothing more. The private schema is not exposed, so the browser cannot query those tables directly. RLS policies `for select to authenticated using (owner_id = (select auth.uid()))` enforce ownership. Execution is granted to `authenticated` only.

**Writes.** A mutation routine is `security invoker` and runs as `service_role`. The server calls it through the service client in `platform/supabase.server.ts`, which uses the server-only secret key. Each routine takes the actor's user ID as a parameter that the server function took from `requireActor`, and checks every ownership relationship itself, because `service_role` bypasses RLS. Execution is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`.

**Tables.** Tables live in the private schema with RLS enabled. Revoke all table privileges from `anon` and `authenticated`, then grant `authenticated` only the `select` its read routines need. Grant `service_role` exactly the privileges its invoker routines need.

**Migration roles.** `grants.sql` grants the committer role to `postgres` so the migration can transfer function ownership to it.

### Reference SQL for Account

The SQL below is the pattern to copy for a feature's tables, reads, and writes.

```sql
-- supabase/schemas/account/schema.sql
create schema account;
create schema account_api;

-- supabase/schemas/account/tables.sql
create table account.profiles (
	user_id uuid primary key references auth.users (id) on delete cascade,
	display_name text not null check (char_length(display_name) between 1 and 80),
	updated_at timestamptz not null default now()
);

-- supabase/schemas/account/policies.sql
alter table account.profiles enable row level security;
create policy profiles_owner_read on account.profiles
	for select to authenticated
	using (user_id = (select auth.uid()));

-- supabase/schemas/account/routines.sql
create function account_api.get_profile()
returns table (display_name text, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
	-- RLS limits rows to the caller's own profile.
	select p.display_name, p.updated_at from account.profiles p;
$$;

create function account_api.upsert_profile(p_user_id uuid, p_display_name text)
returns void
language sql security invoker set search_path = '' as $$
	insert into account.profiles (user_id, display_name, updated_at)
	values (p_user_id, p_display_name, now())
	on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
$$;

-- supabase/schemas/account/grants.sql
revoke all on all tables in schema account from anon, authenticated;
grant usage on schema account to authenticated, service_role;
grant usage on schema account_api to authenticated, service_role;
grant select on account.profiles to authenticated;
grant select, insert, update on account.profiles to service_role;

revoke execute on function account_api.get_profile() from public, anon;
grant execute on function account_api.get_profile() to authenticated;

revoke execute on function account_api.upsert_profile(uuid, text) from public, anon, authenticated;
grant execute on function account_api.upsert_profile(uuid, text) to service_role;
```

`getProfile` returns the stored profile, or a default with an empty display name when the routine returns no row.

### Agent Chat storage

| Table | Columns and constraints |
|---|---|
| `agent_chat.conversations` | `id`, `owner_id`, `title` (1 to 80 characters), `created_at`, `updated_at` |
| `agent_chat.runs` | `id`, `conversation_id`, `owner_id`, `environment_id`, `message` (at most 32 KB), `request_key`, `input_hash`, `policy jsonb`, `deadline`, `version`, `state`, `failure jsonb`, `committed_steps`, `final_turn_id`, `input_tokens`, `output_tokens`, `created_at`, `ended_at`. Unique `(owner_id, request_key)`. Check: `state` is one of the five states. Check: `ended_at` is set exactly when the state is terminal. Check: `final_turn_id` is set exactly when the state is `completed`, and `failure` exactly when it is `failed`. |
| `agent_chat.turns` | `id`, `run_id`, `owner_id`, `step_ordinal`, `blocks jsonb`, `block_schema_version`, `created_at`. Unique `(run_id, step_ordinal)`. |

Every table has an owner-read RLS policy for `authenticated`.

Indexes: `conversations (owner_id, updated_at desc, id desc)`, `runs (conversation_id, created_at desc, id desc)`, `runs (owner_id, created_at)`, and `runs (environment_id) where state in ('queued', 'running')`.

Routines in `agent_chat_api`:

| Routine | Security | Called by |
|---|---|---|
| `submit_message`, `cancel_run` | Invoker, `service_role` | The chat service |
| `start_run`, `fail_run` | Invoker, `service_role` | The runner inside Workflow steps, and the sweep |
| `commit_step` | Definer, owner `agent_chat_committer` | The runner, inside commit steps |
| `sweep_candidates` | Invoker, `service_role` | The sweep |
| `list_conversations`, `read_conversation` | Invoker, `authenticated` | The service, with the caller's JWT |

Lock order: `submit_message` takes the environment's advisory lock before it touches any row. Every other routine locks the run row before it touches any other row. `commit_step` and `submit_message` also update the conversation row, and neither locks a run row after it, so no lock cycle exists. No routine holds a lock while a provider call runs, because every provider call runs in its own Workflow step, outside every transaction.

### Agent-turn write boundary

PostgreSQL grants go to roles, not to calling routines. Only `agent_chat_api.commit_step` may write an agent turn, and the boundary is built from a role:

- `agent_chat.turns` grants `insert` to `agent_chat_committer` only. `service_role` holds `select` on it and no write privilege, so no invoker routine can write a turn.
- `commit_step` is `security definer` and owned by `agent_chat_committer`. That role owns exactly this one routine and holds the run-table and conversation-table privileges `commit_step` needs. `service_role` may execute `commit_step`.
- `supabase/tests/` asserts the grants on `agent_chat.turns`, that `agent_chat_committer` owns one routine, and that an insert as `service_role` fails.

### Schema change workflow

1. Find the feature or domain that owns the object.
2. Edit its declarative SQL under `supabase/schemas/<owner>/`.
3. Run `pnpm db:diff <name>` to generate a migration with the pinned Supabase CLI and its declarative diff engine.
4. Review the migration for destructive changes, renames, and data transformations. Write a hand-authored migration for any change the diff engine cannot express, and keep the declarative SQL in sync with it.
5. Apply it to an isolated database with `pnpm db:reset` and run `pnpm test:db`.
6. Run `pnpm db:types` to regenerate `src/platform/database.types.ts`.
7. Run the owning feature's tests.

Migration history is append-only. Never edit an applied migration. Never run unreviewed schema changes against a production database.

## Runtime composition

### `src/server.ts`

`src/server.ts` is the Worker entry. It is the only module that registers Workflow classes and builds the sweep.

- It exports the TanStack Start request handler as `fetch`.
- It exports `scheduled`, which runs one `sweepRuns` pass.
- It exports the `AgentChatWorkflow` class.
- It builds `WorkflowRuns` from the `AGENT_CHAT_WORKFLOW` binding and injects it into the chat service. `start` calls `env.AGENT_CHAT_WORKFLOW.create({ id: runId, params: { runId } })` and treats an existing instance as success. `terminate` calls `terminate()` on the instance.

It contains no rules. The exact TanStack Start server-entry API follows the pinned TanStack Start version.

### `wrangler.jsonc`

- `main` is `src/server.ts`, with the `nodejs_compat` compatibility flag.
- `workflows`: one entry named `agent-chat`, binding `AGENT_CHAT_WORKFLOW`, class `AgentChatWorkflow`.
- `triggers.crons`: `["* * * * *"]`.
- `vars`: `ENVIRONMENT_ID`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_BASE_URL`, `LLM_MODEL`.
- Secrets, set once per Worker with `wrangler secret put <NAME> --name touch-grass-<environment>` or in the dashboard: `SUPABASE_SECRET_KEY` and `LLM_API_KEY`, and optionally `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. They persist across deploys, and the deploy never uploads them.

### Environment parsing

`platform/env.server.ts` parses the Worker `env` with one zod schema the first time a request, scheduled event, or Workflow step needs it. A missing or malformed variable fails with an error naming the variable. Code outside `platform/env.server.ts` never reads `env` fields directly, except `src/server.ts` reading the Workflow binding.

## Client state and UI

### Server state

TanStack Query is the client replica of server state. Never add another global state manager.

- `*.queries.ts` owns query keys, query options, and mutations. Keys start with the feature name and include the user ID for private data.
- While a visible run is `queued` or `running`, the conversation query polls every 2 seconds and stops at a terminal state. No other query polls.
- Every mutation goes through `platform/mutations.ts`. It owns request keys, transport retries, and invalidation, so a feature declares only what to send and what to invalidate.
- SSR creates one QueryClient per request.
- Ephemeral UI state stays in React components.

### Mutations

`platform/mutations.ts` is client-safe and knows no feature. It exports two hooks, and `*.queries.ts` builds every mutation from one of them.

```ts
type MutationSpec<Input, Result> = {
	mutationKey: QueryKey;
	invalidate: (result: Result, input: Input) => readonly QueryKey[];
};

// For a create. Each `submit` creates one RequestKey. Transport retries rerun the mutation
// with the same variables, so they reuse that key.
export function useKeyedMutation<Input, Receipt>(spec: MutationSpec<Input, Receipt> & {
	send: (input: Input & { requestKey: RequestKey }) => Promise<Receipt>;
}): MutationHandle<Input, Receipt>;

// For a mutation that is idempotent by its input, such as an upsert or a cancel.
export function useIdempotentMutation<Input, Result>(spec: MutationSpec<Input, Result> & {
	send: (input: Input) => Promise<Result>;
}): MutationHandle<Input, Result>;
```

- `MutationHandle` is TanStack Query's mutation result, with `submit(input)` in place of `mutate`. `submit` resolves to `undefined` after a transport failure instead of rejecting, and the failure renders from `isError`.
- Both hooks retry a thrown error up to 3 times with exponential backoff. A server function returns its safe errors and refusals as values, so only transport failures throw.
- On success, both hooks invalidate the keys `invalidate` returns.
- `sendMessage` uses `useKeyedMutation`. `updateProfile`, `stopRun`, and `startGoogleSignIn` use `useIdempotentMutation`.
- The `client-data-path` lint rule bans `useMutation` outside `platform/mutations.ts`, so a feature cannot write its own retry or key logic.

### Routes and shell

| Route | Content |
|---|---|
| `/login` | "Continue with Google" button and the sign-in failure message |
| `/auth/callback` | Server route; no UI |
| `/` (authenticated) | Redirects to `/chat` |
| `/chat` | Conversation list and a composer that starts a conversation |
| `/chat/$conversationId` | Exchanges with each saved step, the stop button, failure reasons, and the composer |
| `/account` | Profile form |

`layouts/app-shell.tsx` provides responsive navigation (Chat, Account) and an account menu with logout. Every data view renders consistent loading, empty, error, and success states from `components/patterns/`. Feature-specific UI stays in its feature. Generic primitives live in `components/ui/`. Domain-agnostic compositions live in `components/patterns/`.

### Styling

- Tailwind CSS v4 runs through the `@tailwindcss/vite` plugin. There is no `tailwind.config.*` and no PostCSS config. Configuration lives in CSS.
- `src/styles/app.css` is the only stylesheet. It holds `@import "tailwindcss";`, the shadcn/ui theme variables for light and dark under `:root` and `.dark`, and the `@theme inline` block that maps them to Tailwind tokens. `__root.tsx` links it in the document head.
- Components style with Tailwind utility classes only. There are no CSS modules, CSS-in-JS, or inline `style` attributes, except for values computed at runtime.
- Colors come only from theme tokens such as `bg-background` and `text-muted-foreground`. There are no raw palette classes such as `bg-zinc-900` and no hex values in components.
- `components.json` sets `style: "new-york"`, `baseColor: "neutral"`, `cssVariables: true`, `iconLibrary: "lucide"`, an empty `tailwind.config`, and the aliases `ui` and `components` to `@/components/ui` and `utils` to `@/components/ui/cn`.
- Add a shadcn/ui component only when a feature uses it, with the pinned CLI: `pnpm exec shadcn add <name>`. The generated file is owned source in `components/ui/`. Edit it in place. Rerunning `shadcn add` for an existing component overwrites local edits, so review the diff before keeping it.
- `components/ui/cn.ts` exports `cn()`, which combines `clsx` and `tailwind-merge`. Conditional class names go through `cn()`.

## Static enforcement

`tools/boundary-enforcement/policy.ts` is the single machine-readable source for file roles, the dependency allowlist, the package lists, the pure roles, the rules and their checks, the composition root, and fixture expectations. Every tool derives its configuration from it:

- `dependency-cruiser.config.cjs` imports the policy and enforces [Dependency rules](#dependency-rules), feature direction, and cycles.
- `oxlint.config.ts` enables Oxlint correctness, TypeScript, React, and import rules, the vendored anti-slop rules, and the repo-owned rules in `tools/boundary-enforcement/lint-rules/`. Adapt an anti-slop rule only with a one-line reason in the config.
- `tools/boundary-enforcement/check-client-bundle.ts` builds the pinned TanStack application and inspects every emitted browser chunk, including lazy chunks. It fails on server-only module paths, server packages, private environment names, database or provider clients, and a planted secret sentinel string.
- `tools/boundary-enforcement/check-repo.ts` checks what no import graph shows: banned packages, version pins, forbidden files, the migration ledger, and generated files.
- `tools/boundary-enforcement/generate-architecture.ts` renders the generated app's `ARCHITECTURE.md` from the policy.

Once the template is built, `policy.ts` is the source of truth for every table it encodes. Change a rule there, and the checks and the generated `ARCHITECTURE.md` follow.

### Purity

The pure roles are `*.schema.ts`, `*.model.ts`, `*.tools.ts`, `*.agent.ts`, and every module in `src/domain/` that does not end in `.server.ts`. Workflow replays rerun them, so the same input must always give the same output. The `pure-module` lint rule bans these inside them:

- I/O: `fetch`, `caches`, `XMLHttpRequest`, `WebSocket`, `navigator`, and browser storage
- Runtime access: `process`, `globalThis`, the Worker `env`, and imports from `cloudflare:*` or `node:*`
- Clocks and timers: `Date.now`, `new Date()` with no argument, `performance`, `setTimeout`, `setInterval`, and `queueMicrotask`
- Randomness: `Math.random` and `crypto`

Time enters a pure module only as an `Instant` argument, which comes from PostgreSQL.

### Rule checks

Every **must** and **never** rule in this document appears in one row. `policy.ts` holds the same table, and the generated `ARCHITECTURE.md` renders it.

| Check | Rules it enforces |
|---|---|
| dependency-cruiser | The import allowlist, package lists, one-way feature dependencies, and no feature cycles |
| `check-client-bundle.ts` | No server code, server packages, private environment names, or secrets in browser chunks |
| Lint `pure-module` | Pure roles do no I/O and read no clock, randomness, or runtime |
| Lint `client-data-path` | No `fetch`, `XMLHttpRequest`, or `WebSocket` in routes, `ui/`, layouts, or components. `queryFn` appears only in `*.queries.ts`. `useMutation` appears only in `platform/mutations.ts`. |
| Lint `model-adapter` | Only `platform/model.server.ts` imports `openai` or builds a model provider |
| Lint `env-access` | Only `platform/env.server.ts` reads Worker `env` fields. `src/server.ts` reads only the Workflow binding. A Workflow passes `this.env` on without reading it. |
| Lint `test-sign-in` | Only `tests/fixtures/test-users.ts` calls `signInWithPassword` or `auth.admin` |
| Lint `brand-cast` | Brands come from parsers. A type assertion to a brand appears only in `platform/`, `*.schema.ts`, and `*.repo.server.ts`. |
| Lint `no-reexport` | No barrel files. `src/` contains no re-export statements. |
| Lint `styling` | Tailwind utility classes only, theme-token colors only, no raw palette classes or hex values, and no `style` attribute with a literal value |
| `check-repo.ts` | No banned package (ESLint, a second global state manager such as Redux, Zustand, Jotai, MobX, Valtio, or Recoil, or a DI container such as InversifyJS or tsyringe). Every dependency is pinned to an exact version. No `tailwind.config.*`, `postcss.config.*`, ESLint config, or stylesheet besides `src/styles/app.css`. Applied migrations are never edited or deleted, and a new migration sorts after the base branch's newest. The committed `ARCHITECTURE.md` matches a fresh render of the policy. |
| `pnpm check` type regeneration | `src/platform/database.types.ts` is never edited by hand. `pnpm check` regenerates it after `db:reset` and fails on a diff. |
| `tsc` | `turn-view.tsx` handles every block kind, through the `never` check |
| Proof: two-user denial | Ownership is checked in SQL, by RLS on reads and by each mutation routine on writes |
| Proof: `service_role` insert into turns | Only `commit_step` writes an agent turn |
| Proofs: replay and deploy between steps | Code outside `step.do` is deterministic. Step names are never renamed. |
| Proof: timing constants | Every inequality under [Policy and timing defaults](#policy-and-timing-defaults) |
| Deploy | Auth settings live only in `supabase/config.toml`. Each deploy applies it with `supabase config push` and overwrites dashboard changes. |
| `review` | No forwarding service, and a service only when a use case does more than call one repository routine. A server function never checks ownership. No placeholder files. Removing or reshaping a block kind ships with its SQL data migration. Secrets never appear in code, logs, commits, or agent output, beyond what the bundle sentinel catches. Never reset a production database. |

### Fixtures

Fixtures under `tools/boundary-enforcement/fixtures/` prove each check, and `tools/boundary-enforcement/boundary-enforcement.test.ts` runs them. Every negative fixture declares the diagnostic and path it expects. A checker crash, missing dependency, or syntax error fails the test run and never counts as a rejection. Each check has a positive fixture beside its negative ones, so an always-failing checker cannot pass. The test also fails when a rule in `policy.ts` whose check is dependency-cruiser, a lint rule, or `check-repo.ts` has no negative fixture.

| Fixture | Expected result |
|---|---|
| UI → query → server function → repository | Passes. The bundle check finds no server code or sentinel. |
| UI imports a repository, a `*.functions.ts` module, or a `*.model.ts` module | Ownership diagnostic naming the edge |
| UI imports a server package | Package diagnostic naming the edge |
| A route imports a `*.functions.ts` module | Ownership diagnostic naming the edge |
| UI reaches server code through a helper | Client-reachability diagnostic naming the path |
| A `*.functions.ts` module exports a client-run helper that uses server code | Client-reachability diagnostic |
| `platform/` imports a feature Workflow class | Composition-root diagnostic |
| A feature imports `openai` or builds a model provider | Model-adapter diagnostic |
| A tool, model, or agent module imports a server module, calls `fetch`, reads `Date.now()`, or calls `Math.random` | Purity diagnostic |
| UI calls `fetch` or `useMutation`, or defines a `queryFn` | Client-data-path diagnostic |
| A feature module reads an `env` field | Env-access diagnostic |
| Caller code casts a string to `UserId` | Brand-cast diagnostic |
| A feature module re-exports another module | No-reexport diagnostic |
| A component uses `bg-zinc-900`, a hex color, or a literal `style` | Styling diagnostic |
| `package.json` adds ESLint, Zustand, or a version range; a commit edits an applied migration; `ARCHITECTURE.md` is stale | Repo diagnostic naming the rule |
| Cross-feature private import, feature cycle, or runtime import in a schema | The matching ownership, cycle, or purity diagnostic |

## Testing

### Principles

- Prefer one meaningful E2E journey per feature over many low-value unit tests.
- Test behavior a caller can observe. Never assert private helper choices, internal call order, or rendering of static markup.
- Recorded requests to the provider double, including the absence of a second request, are observable behavior.
- No coverage percentage or test-count target.
- Tests fail when behavior breaks and survive refactors that keep the contract.

### Test locations

| Kind | Location | Runner |
|---|---|---|
| E2E journey | `src/features/<feature>/<feature>.e2e.spec.ts` | Playwright against the production build in workerd (`vite preview`) and the local stack |
| Feature integration | `src/features/<feature>/<feature>.integration.test.ts` | Vitest in the Workers runtime (`@cloudflare/vitest-pool-workers`) against the local Supabase database |
| Pure logic | `src/features/<feature>/<feature>.model.test.ts` | Vitest |
| Provider error classification | `src/platform/model.server.test.ts` | Vitest against recorded provider fixtures |
| Database security | `supabase/tests/` | SQL tests through the Supabase CLI |
| Database concurrency | `tests/database/races.ts` | Node against the local database, with real concurrent connections |
| Boundary enforcement | `tools/boundary-enforcement/boundary-enforcement.test.ts` | Vitest driving the checkers |

`tests/fixtures/` holds the deterministic provider double. It serves the OpenAI-compatible endpoint, returns scripted responses for every row of the classification table, can delay a response past `MODEL_CALL_TIMEOUT`, and records every request. Database failpoints are test-only hooks in the integration harness that inject a transient error or pause a transaction.

### E2E journeys

| Feature | Journey |
|---|---|
| Auth | Open `/chat` signed out and confirm the redirect to `/login`. Click "Continue with Google", intercept the navigation to `accounts.google.com`, assert its `client_id` and `redirect_uri` parameters, and abort it. Open `/auth/callback?code=invalid` and confirm the redirect to `/login?error=sign_in_failed`. Sign in with `signInAs`, open `/chat`, log out, and confirm `/chat` redirects to `/login`. |
| Account | Update the display name, reload, confirm it persisted |
| Agent Chat | Send a message that makes the provider double call `calculate`. See the tool call and the tool result appear as their step is saved, reload while the run is active, and confirm the run continues and the transcript shows the tool call, the tool result, and the final turn. Send a second message whose reply the double delays, and stop it. Seed one agent turn holding every block kind and one row with an unknown kind through SQL, then confirm each renders, including the unsupported fallback. Seed a run whose dispatch was lost, fire the cron trigger through workerd's local `/cdn-cgi/local/scheduled` route, and confirm the sweep starts the run and it completes. |

The journeys use no module mocks or in-process stubs. The Worker runs from its production bundle in workerd, the open-source runtime Cloudflare deploys, with Miniflare's local Workflows engine and cron trigger route. Supabase runs from the CLI's containers. Only the two services outside the stack are replaced: the LLM provider by the provider double over HTTP, and Google sign-in by `signInAs` against the real Supabase Auth. Plan limits, edge placement, and the production cron scheduler cannot be reproduced locally.

`pnpm test:e2e` runs the journeys with the provider double. A separate live smoke test, run by `pnpm verify:deployed`, sends a real message to the configured LLM provider and confirms its run completes.

### Required proofs

Each row is at least one integration or database test. One case is a unit test instead: oversized tool output runs through the real SDK `Runner` with a test-only tool, because `calculate` cannot produce 16 KB.

| Scenario | Observable assertion |
|---|---|
| Same message retried; changed input under the same key | One run, or `key_conflict` |
| Two identical messages race on one key | One run; both callers get the same receipt |
| A user exceeds the message window | Refusal with no row written |
| Two messages contend for the last active-run place, per user and per environment | At most one admitted |
| A second message in a conversation with an active run | `busy`, with no row written |
| `workflowRuns.start` fails after `submit_message` commits | The sweep starts the run, and it completes |
| A run errors outside its loop, or never starts before the deadline | The sweep fails the run by `deadline + END_CHECK_GRACE` |
| A run crashes mid-loop and Workflows replays it | Saved model calls are not sent again; the provider double records no repeat; one turn per step |
| A commit step repeats after its transaction committed | One turn; the repeat changes nothing |
| A deploy lands between two steps of a running run | The run resumes from its saved steps and completes |
| A model call fails transiently, then succeeds | The run proceeds; the provider double records one extra request |
| Every model call for a step is retryable | Fails with `limit: 'model_retries'` after `MODEL_CALL_RETRIES + 1` requests |
| Each row of the provider classification table | The run takes the specified behavior |
| The SDK throws `ModelBehaviorError` or any unexpected error | Fails once with `execution: 'internal'` |
| Stop during a model call | The run is canceled; no turn is written after the cancellation; the instance ends |
| Completion, failure, and cancellation in every commit order | The first terminal outcome persists |
| Final step commits | The run completes with `finalTurn` in the same transaction; no extra turn |
| Run deadline passes during a model call or a retry backoff | The run fails with `limit: 'duration'` |
| Steps and tool calls each exhausted; the provider reports context length exceeded | Each converges to its specified failure |
| A conversation's history exceeds `MAX_HISTORY_RUNS` or `MAX_HISTORY_BYTES` | The oldest runs drop; failed and canceled runs never reach the model |
| Unknown tool, unparsable or invalid arguments, throwing tool, oversized tool output | Each becomes a tool error the model can read |
| Malformed request, environment, Workflow payload, row, or provider body; oversized input | Rejected at the adapter with a classified diagnostic |
| Stored block of an unknown kind or version | Renders the fallback and becomes a placeholder in model input |
| A message with anything but plain text, or an agent turn with `unsupported` or an unpaired `tool_result` | The write schema rejects it |
| Two users list, read, and mutate each other's data | Denied by RLS on reads and by the mutation routine's ownership check on writes |
| `service_role` inserts into `agent_chat.turns` directly | The database rejects it; the catalog grant test passes |
| Timing constants | The constants unit test asserts every inequality |

## Commands, validation, and CI

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app locally against the local Supabase stack and the provider double |
| `pnpm lint` | Oxlint with anti-slop and the policy-derived rules |
| `pnpm check:boundaries` | dependency-cruiser |
| `pnpm check:repo` | `check-repo.ts`. It compares migrations against the pull request's base branch in CI and against `origin/main` locally. |
| `pnpm check:fast` | `lint`, `check:boundaries`, and `check:repo` |
| `pnpm gen:architecture` | Renders `ARCHITECTURE.md` from `policy.ts` |
| `pnpm cf:types` | Regenerates the committed `worker-configuration.d.ts` with `wrangler types`, reading secret names from `.dev.vars.example`. It rewrites the two types Wrangler infers from `src/server.ts`, because importing the entry module into the global `Env` makes TypeScript lose the router's request context type. `--check` fails when the committed file is stale. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit and architecture tests. Fast and offline. |
| `pnpm test:workers` | Vitest integration tests in the Workers runtime, against the local database and the provider double |
| `pnpm test:db` | SQL tests in `supabase/tests/` |
| `pnpm test:db:races` | Concurrent admission, capacity, and terminal-order races in `tests/database/races.ts` |
| `pnpm test:e2e` | Builds the app and runs the Playwright journeys against `vite preview`. `EXTERNAL_APP=1` aims them at an already running server instead. |
| `pnpm check:bundle` | Production build and client-bundle inspection |
| `pnpm check` | Everything above against a freshly reset local database, then `db:types` with a failure on any diff. |
| `pnpm cf:deploy` | The Workers Builds deploy command. It applies migrations and Auth configuration, then deploys the Worker. |
| `pnpm verify:deployed --env <name>` | Live checks against a deployed Wrangler environment |
| `pnpm db:reset`, `pnpm db:diff <name>`, `pnpm db:types` | Local database reset, migration generation, type generation |

### When checks run

| Trigger | Checks | Policy |
|---|---|---|
| Each file edit | None | No interruption |
| Optional `PostToolUse` hook in `tools/hooks/` | Targeted fast checks on the edited file | Feedback only. Never required for correctness. |
| Before an agent reports completion | `pnpm check:fast`, `pnpm typecheck`, and the tests of every changed feature. Add `pnpm test:db` after a schema change. | The agent fixes failures, with bounded repair attempts |
| Pull request | `pnpm check:fast`, `pnpm typecheck`, `pnpm test` and `pnpm check:bundle` in CI | Shown as a check on the pull request |
| Push to `main` or `production` | Workers Builds runs `pnpm build` and `pnpm cf:deploy` for that branch's Worker | Migrate and deploy. No GitHub workflow runs. |
| After each deploy | `pnpm verify:deployed --env <name>`, run by a person or an agent | A deployment is unverified until it passes |

If a check cannot run, report it as not run. Never claim success without it.

### CI

- `ci.yml` installs the pinned pnpm and dependencies and runs `pnpm check:fast`, `pnpm typecheck`, `pnpm test` and `pnpm check:bundle` on every pull request. The pull request shows the result as a check. `check:repo` fails when the workflow drops one of these steps.
- `ci.yml` needs no secrets and no Docker. GitHub runs no deploy workflow.

## Environments and deployment

### Environments

Each deployed environment is a named environment in `wrangler.jsonc`. The template ships one, `production`. Its `vars` hold its nonsecret settings. Each environment has one Worker, `touch-grass-production` for the shipped one, connected to the repository in Workers Builds. No tool hardcodes an environment name, so a project adds more environments, such as `staging`, by adding a `wrangler.jsonc` environment and a matching `[remotes.<name>]` block.

| Setting | `production` |
|---|---|
| Production branch | `main` |
| Builds for non-production branches | Off |
| Build command | `pnpm build` |
| Deploy command | `pnpm cf:deploy` |
| Build variables | `CLOUDFLARE_ENV=production`, `PNPM_VERSION=11.25.0` |
| Build secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` |

- `CLOUDFLARE_ENV` makes the Vite plugin write the environment's name, bindings, and vars into `dist/server/wrangler.json`. `wrangler deploy` reads that redirected config, so the deploy never passes `--env`.
- `PNPM_VERSION` is set because the build image defaults to pnpm 10.11.1. Node comes from `.node-version`.
- Preview builds are off because a preview version would run against a database whose migrations have not run.
- `SUPABASE_DB_URL` is the project's Supavisor session-mode pooler string, with port 5432, the user `postgres.<project-ref>`, and a percent-encoded password. The direct `db.<project-ref>.supabase.co` host is IPv6 only on Free, and build containers are not known to have IPv6. The project reference is not a secret. `pnpm cf:deploy` derives it from the environment's `SUPABASE_URL`.
- The runtime secrets `SUPABASE_SECRET_KEY` and `LLM_API_KEY` are Worker secrets, not build secrets.

### Deployment

A push to `main` deploys `production`. Workers Builds then runs `pnpm cf:deploy` with `tools/deploy.ts`, which stops at the first failure.

1. Require `CLOUDFLARE_ENV` to name an environment in `wrangler.jsonc`.
2. Refuse placeholder settings for that environment.
3. Derive the project reference from `SUPABASE_URL`, and require a `[remotes.<environment>]` block in `supabase/config.toml` with that `project_id`. Without a match, `supabase config push` would push the local `localhost` Auth URLs.
4. Require the four build secrets, and name any that are missing.
5. Apply migrations from the ledger with `supabase db push --db-url`.
6. Apply `supabase/config.toml` with `supabase config push`. It runs after the migrations because it enables the `before_user_created` hook, which calls a migrated function.
7. Deploy the Worker with the pinned Wrangler.

Workers Builds does not run `pnpm verify:deployed --env <name>`. A person or an agent runs it after each deploy, with `SUPABASE_SECRET_KEY` in the shell. A deployment is unverified until it passes.

After a lost response at any step, inspect the migration history or the deployed version before retrying. Supply secrets through Wrangler and Supabase secret management. Never write a secret into code, logs, commits, or agent output. Build secrets reach every build command, so keep dependencies pinned.

### Isolation

- Each hosted environment uses its own Supabase project or branch, its own Worker name, and its own LLM API key. Local development uses the local stack.
- A test run owns its Auth users, Storage prefixes, Workflow instance IDs, and data.
- Ordinary development needs no local containers. Container-backed local Supabase runs where Docker exists.
- Never reset a production database or another developer's database. If no safe target exists, the check reports the missing capability and stops.

### Free-tier constraints

- Target Cloudflare Free and Supabase Free. Never require a paid plan silently.
- Avoid always-on compute. Keep Workflow steps small and I/O-bound.
- Workflows on Workers Free allow 1,024 steps per instance, 100 concurrent instances per account, 10 ms of CPU per step, and 3 days of retention, according to Cloudflare's limits page at the time of writing. `ACTIVE_RUNS_PER_ENVIRONMENT` stays below the concurrency limit.
- Workers Builds on Free allows 3,000 build minutes per month, 1 concurrent build per account, and a 20-minute build timeout, according to Cloudflare's limits page at the time of writing.
- Supabase Free projects pause after inactivity. `verify:deployed` reports a paused project as a failed prerequisite.
- `verify:deployed` reads `<SUPABASE_URL>/auth/v1/settings` and reports a disabled Google provider as a failed prerequisite.
- LLM spend is the only external cost. Google sign-in is free. The README of the generated app lists the cost.
- General-purpose subprocesses and code-execution agents are outside the Cloudflare target.

## Agent guidance files

### `AGENTS.md`

`AGENTS.md` stays short. Working reference features teach patterns, and checks enforce rules.

```markdown
## Architecture

- ARCHITECTURE.md lists every file role, import rule, and rule check. It is generated from `tools/boundary-enforcement/policy.ts`. To change a rule, change the policy and its check, then run `pnpm gen:architecture`.
- Organize by feature. Copy the closest reference: `account` for plain CRUD, `agent-chat` for agent work.
- UI reads and writes through the feature's `*.queries.ts`.
- A feature imports only another feature's `*.schema.ts`. Routes compose UI from several features.
- Database definitions live in `supabase/schemas/<owner>/`. Copy the account access pattern.
- Keep feature tests, including E2E, in the feature directory.
- Prefer meaningful E2E and integration tests over trivial unit tests.
- Before reporting completion, run `pnpm check:fast`, `pnpm typecheck`, and the changed features' tests, and fix every failure.
```

### Agent workflow

1. Find the owning feature and read its closest working implementation.
2. Find the responsible files, database definitions, and tests.
3. Reuse existing contracts, components, and platform modules.
4. Change code within the dependency rules.
5. Add or update a meaningful test for the changed behavior.
6. Run the completion checks and fix every failure.
7. Exercise the affected user journey.
8. Report anything unresolved instead of claiming completion.

When agents repeat a mistake, first improve the reference implementation. Then add the rule to `policy.ts` with a check and a negative fixture, or move an existing `review` rule to a mechanical check. Add a line to `AGENTS.md` only for a rule no check can express.

### Generated `ARCHITECTURE.md`

The generated app never ships this specification. Its `ARCHITECTURE.md` is rendered from `policy.ts` by `pnpm gen:architecture` and holds three tables: [File roles and ownership](#file-roles-and-ownership), the [dependency allowlist](#dependency-rules) with its package lists, and [Rule checks](#rule-checks). Each rule sits next to the check that enforces it. `check-repo.ts` fails when the committed file differs from a fresh render, so the document an agent reads always matches the checks it runs against. Feature design that no rule captures lives in the reference implementations and their tests.

### Bundled skills

`.agents/skills/` holds unchanged copies of pstack, `grill-me` and `grilling` (Matt Pocock), `show-me` (HumanLayer), and `vercel-react-best-practices`. The skills CLI installs each at a pinned commit and records it in `skills-lock.json`. The `vendored-skill` rule in `check-repo.ts` recomputes each recorded hash, so an in-place edit or a floating branch pin fails the check. `AGENTS.md` carries pstack's routing rules, because a skills-only install has no session hook. The directory also holds one repository-local skill: `evals`, a provider-neutral adaptation of Anthropic's eval guides.

`pnpm verify` (`tools/verify.ts`) checks repository access, runs `pnpm install --frozen-lockfile`, the build, and `pnpm check`, and reports each result separately. It imports only Node built-ins, so it runs before the first install. It is idempotent and never provisions anything.

## Deferred extensions

Each extension below was designed and kept out of the MVP. When its trigger appears, build it as described instead of working around the MVP's limits.

| Extension | Trigger | What it adds |
|---|---|---|
| Non-pure tools | A tool needs network, storage, or any external side effect | Each effect runs in its own Workflow step with a declared class: `idempotent` (with the provider's replay window and a key derived from the run, step, and call IDs) or `irreversible`. An `external_outcome_unknown` failure that blocks unsafe retry. An operator resolution routine. |
| Pruning | Run data pressures storage | A scheduled routine that deletes old conversations' runs and turns after a documented lifetime |
| Environment reconciliation | More than one person or runner deploys to shared environments | `env:reconcile` with an operation journal keyed by environment, operation, and desired digest; database-scoped migration locks; exclusive leases on shared nonproduction targets with quiescence checks |
| Waiting queue | Users should wait for capacity instead of being refused | A separately bounded queue with explicit admission semantics |
| Live updates | Users need to see an answer as it is written, or polling cost becomes a problem | The model step streams the provider response and sends the full text so far, plus a change notice after each commit, to the owner's private Supabase Realtime Broadcast channel. Nothing live is stored. A Realtime Authorization policy admits only the owner. Messages per model call stay below the Worker subrequest limit, or go over one outbound WebSocket per step. |
| Spend accounting | The product must cap, bill, or meter model spend per user | A per-user token and cost ledger fed by the usage that `commit_step` records, plus a record of model calls that retries repeated |
| Email sign-in | Users without a Google account must sign in, and the developer owns a domain | Resend SMTP on the verified domain in `[auth.email.smtp]`, `[auth.email] enable_signup = true`, and one email holding a magic link and a 6-digit code. An `/auth/confirm` route verifies the link. `/login` gains an email field and a code field. Supabase Auth rate limits rise to match the Resend plan. |
| Branded consent | The Google consent screen must name the app instead of `<project-ref>.supabase.co` | Google brand verification on a domain the developer owns, or a Supabase custom domain used as the client's Supabase URL |

## Build order

Build in these units. Each unit's checks pass before the next unit depends on it.

1. **Foundations.** Project setup, pinned tooling, `tools/boundary-enforcement/` with the policy and its rule checks, Oxlint with anti-slop and the repo-owned lint rules, dependency-cruiser, the bundle check, `check-repo.ts`, `generate-architecture.ts`, `platform/mutations.ts`, the positive and negative fixtures, and an empty app that builds. Gate: every fixture yields its expected result, and every mechanically checked rule has a negative fixture.
2. **Auth, account, and database pattern.** Auth configuration, Google sign-in, the callback route, test sign-in, the account feature with its schemas, roles, routines, and grants. Gate: auth and account E2E, and the two-user access tests.
3. **Agent Chat persistence and model.** Conversation, run, and turn tables and routines, admission, the agent-turn write boundary, block parsing and `blocksFromAgentItems`, the agent definition and `calculate`, `toAgentInput`, the checks, the model provider and error classification, and the constants test. Gate: every required proof that needs no Workflow.
4. **Durable execution.** The Workflow adapter and `DurableModel`, the runner, the sweep, the chat UI, `src/server.ts` wiring, and `wrangler.jsonc`. Gate: the dispatch, replay, recovery, and stop proofs, and the chat E2E.
5. **Shell, CI, and deployment.** App shell polish, `ci.yml`, `tools/deploy.ts`, Wrangler environments, `verify:deployed`, `AGENTS.md`, the generated `ARCHITECTURE.md`, and bundled skills. Gate: a deployed environment passes `verify:deployed`, including the live provider smoke test.

## Acceptance criteria

The template is complete when all of these hold:

- Authentication and account management work end to end.
- Protected routes, actor resolution, and SQL ownership checks are verified, including two-user denial tests.
- Agent Chat runs every message as a durable OpenAI Agents SDK run on Cloudflare Workflows, with every model call as a step. Runs call a tool, persist a transcript, show each step as it is saved, continue after the tab closes, and complete, stop, and fail as specified. Every block kind renders, including the unsupported fallback.
- Every row in [Required proofs](#required-proofs) has a passing test.
- Every architecture fixture yields its expected result, and the bundle check finds no server code in client chunks.
- Every rule in [Rule checks](#rule-checks) has its named check or proof, and every mechanically checked rule has a negative fixture.
- The committed `ARCHITECTURE.md` matches a fresh render of `policy.ts`, and the template does not ship this specification.
- Declarative SQL is grouped by owner under `supabase/schemas/`, and migrations replay from Git into an empty database.
- `pnpm check` passes locally, and the static checks pass in CI.
- A deployed environment passes `pnpm verify:deployed`.
- Optional hooks work where supported and nothing depends on them.
- The generated app's README lists free-tier limits and external costs.

## Open feasibility checks

These questions need evidence from the pinned versions before their unit's gate. If a check fails, change the implementation and record the change in this document. Never weaken acceptance, cancellation, idempotency, or ownership rules to fit a limit.

- Does the pinned TanStack Start build expose a client chunk graph the bundle check can trust, and what is its Cloudflare server-entry API? Does it strip a server route's `handlers`, including their `platform/auth.server.ts` import, from client chunks?
- Does the pinned Oxlint run repo-owned JS plugin rules that inspect `className` strings, type-assertion targets, and member access on `env`? If not, run those rules in a separate pass with the TypeScript compiler API and keep them in `tools/boundary-enforcement/lint-rules/`.
- Do the chosen provider's error bodies separate quota, rate-limit, and policy refusals? Record its fixtures for `src/platform/model.server.test.ts`.
- How long does a run take from `sendMessage` to its first saved step? Record the Workflow start time separately from the model call time.
- Does the pinned `@openai/agents` run in a Worker with `nodejs_compat` and against an OpenAI-compatible Chat Completions endpoint? Does `new Runner({ model, tracingDisabled: true })` accept a custom `Model` and turn off every trace export? Yes to both, measured locally in workerd. A model call inside a step needs a trace context (see [The Workflow](#the-workflow)). With `tracingDisabled: true`, a recording processor sees zero trace events, against 12 with tracing on.
- Is the SDK loop deterministic on replay? It must make the same model calls in the same order, given the same saved responses, with no random or time-based input that changes the order.
- Can a `ModelResponse` round-trip through JSON as a step result, including `usage`, and does the SDK expose the Chat Completions finish reason so `checkResponse` can detect truncation? Not as-is. `usage` is a `Usage` class instance, so the step saves `SavedModelResponse` and rebuilds `Usage`. The finish reason exists only in `providerData`. An empty truncated completion throws a `ModelBehaviorError` with a fixed message, which `isTruncatedModelError` matches.
- How does the pinned SDK count `maxTurns`, and how does it handle tool arguments that are not valid JSON? The spec assumes they become a tool error the model can read. One turn is one model call, and the SDK throws when the turn count passes `maxTurns` at the start of a turn. Unparsable arguments skip the tool and return a fixed parse-error message to the model, which the turn stores with `isError: true`.
- Does `create` with an existing instance ID fail with an error `WorkflowRuns.start` can recognize? Locally, yes: a `WorkflowError` whose message contains `instance.already_exists`. Not yet checked on hosted Workflows.
- After a step's retries run out, does `step.do` rethrow the last attempt's error? Does a step timeout surface as a retryable error? Locally, yes to both. Not yet checked on hosted Workflows.
- Does the Workers Free CPU limit for Workflow steps (10 ms per step at the time of writing) hold for replaying the SDK loop and parsing a 256 KB response?
- Can Vitest with `@cloudflare/vitest-pool-workers` run the Workflow and the provider double with crash and failure injection?
- Does the hosted Supabase `postgres` role allow creating the `nologin` committer role, granting it to `postgres`, and transferring function ownership as written?
- Does `supabase config push` apply the `[remotes.<environment>]` Auth overrides and resolve the Google `env()` values? If not, `tools/deploy.ts` sets the same values through the Supabase Management API auth config endpoint.
- Does `auth.signInWithPassword` succeed for an admin-created user while `[auth.email] enable_signup = false`? No. Supabase Auth v2.197.0 returns "Email logins are disabled". [Auth configuration](#auth-configuration) keeps the email provider on and blocks email sign-up with the `before_user_created` hook.
- Does `startGoogleSignIn` through `@supabase/ssr` on Workers store the PKCE verifier cookie that `/auth/callback` reads?
- Do the free plans handle the CPU, Workflow concurrency, cron schedule, storage, and step counts for the reference journeys? Record run counts, spread, and the limiting resource for every measurement.
