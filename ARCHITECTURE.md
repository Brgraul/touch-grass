# Template architecture

This document is the complete specification for the application template that Touch Grass installs into a new repository. An agent builds the template from this document alone. Where this document says **must** or **never**, the rule is mandatory and enforced by a check named in [Static enforcement](#static-enforcement) or a proof named in [Testing](#testing). Where it gives a default value, use that value unless a feasibility check in [Open feasibility checks](#open-feasibility-checks) proves it cannot work.

The template is a production-oriented, batteries-included TanStack Start application for AI-agent products. It runs on Cloudflare Free and Supabase Free and is built to be extended by coding agents. It ships two working reference features that agents copy:

- **Agent Turns** is the synchronous reference. It persists and renders typed content blocks.
- **Agent Tasks** is the asynchronous reference. It runs a durable LLM agent loop with tool calls, cancellation, and crash recovery.

It also ships working authentication, account management, shared UI, observability, CI, and deployment.

**Design rule.** Organize by feature. Give every responsibility one predictable owner. Enforce boundaries mechanically. Ship only the machinery the reference features use, and list everything else as a [deferred extension](#deferred-extensions) with its trigger.

## Contents

1. [Scope and stack](#scope-and-stack)
2. [Repository layout](#repository-layout)
3. [File roles and ownership](#file-roles-and-ownership)
4. [Dependency rules](#dependency-rules)
5. [Shared identities and conventions](#shared-identities-and-conventions)
6. [Authentication and account](#authentication-and-account)
7. [Agent Turns](#agent-turns)
8. [Agent Tasks](#agent-tasks)
9. [Database](#database)
10. [Runtime composition](#runtime-composition)
11. [Client state and UI](#client-state-and-ui)
12. [Observability](#observability)
13. [Static enforcement](#static-enforcement)
14. [Testing](#testing)
15. [Commands, validation, and CI](#commands-validation-and-ci)
16. [Environments and deployment](#environments-and-deployment)
17. [Agent guidance files](#agent-guidance-files)
18. [Deferred extensions](#deferred-extensions)
19. [Build order](#build-order)
20. [Acceptance criteria](#acceptance-criteria)
21. [Open feasibility checks](#open-feasibility-checks)

## Scope and stack

### What the template contains

The template contains application code, database definitions, tests, CI, deployment commands, agent guidance, and bundled agent skills. Repository creation, cloud-environment provisioning, provider account creation, and AI gateway or Langfuse deployment happen outside the template.

### Stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start, React, TypeScript (strict) |
| Client server-state | TanStack Query |
| Database, Auth, Storage | Supabase (PostgreSQL, Supabase Auth, Supabase Storage) |
| Hosting, SSR, server functions | Cloudflare Workers |
| Durable execution | Cloudflare Workflows |
| Scheduled recovery | Cloudflare Cron Trigger on the same Worker |
| Model calls | An OpenAI-compatible AI gateway (LiteLLM or equivalent) |
| Model tracing | Langfuse, fed by the gateway |
| Lint | Oxlint with vendored anti-slop rules. Never install ESLint. |
| Boundaries | dependency-cruiser plus a client-bundle inspection script |
| Tests | Vitest, Playwright, SQL tests run through the Supabase CLI |
| Package manager | pnpm with a committed lockfile |
| CI | GitHub Actions |
| Migrations | Supabase CLI with declarative schemas |
| Worker configuration | Wrangler |

Pin every dependency to an exact version. Pin the Supabase CLI and Wrangler versions in `package.json` and run them through `pnpm exec`.

### External requirements

These are prerequisites the template consumes and never creates:

- An LLM provider account reached through the AI gateway.
- An AI gateway that enforces spend, token, and provider rate limits **per environment key and per end user**, and forwards traces to Langfuse. A gateway without per-user budgets does not meet this requirement, because one user could exhaust every user's budget.
- A Langfuse project connected to the gateway.
- Production SMTP for Supabase Auth email.

The template keeps no money or token ledger of its own. The gateway owns spend.

## Repository layout

Create only the files a feature needs. Never create placeholder files.

```text
.agents/skills/                          Bundled, version-pinned agent skills
.github/workflows/
	ci.yml                               Full check on every pull request
	deploy.yml                           Migrate, deploy, verify on main
architecture/
	policy.ts                            Single source of ownership and verification rules
src/
	routes/
		__root.tsx                       Document shell, QueryClient provider
		login.tsx
		signup.tsx
		reset-password.tsx
		update-password.tsx              Target of the recovery email link
		_authenticated.tsx               Protected layout; redirects to /login
		_authenticated/
			index.tsx                    Redirects to /tasks
			account.tsx
			turns.tsx
			tasks.index.tsx
			tasks.$taskId.tsx
	features/
		auth/
			ui/
			auth.commands.ts
			auth.functions.ts
			auth.schema.ts
			auth.e2e.spec.ts
		account/
			ui/
			account.queries.ts
			account.commands.ts
			account.functions.ts
			account.schema.ts
			account.repo.server.ts
			account.e2e.spec.ts
		agent-turns/
			ui/
				turn-page.tsx
				turn-composer.tsx
				turn-view.tsx
				blocks/
					text-block.tsx
					tool-call-block.tsx
					tool-result-block.tsx
					structured-output-block.tsx
					unsupported-block.tsx
			agent-turns.queries.ts
			agent-turns.commands.ts
			agent-turns.functions.ts
			agent-turns.schema.ts
			agent-turns.api.server.ts
			agent-turns.repo.server.ts
			agent-turns.e2e.spec.ts
		agent-tasks/
			ui/
				task-form.tsx
				task-list.tsx
				task-detail.tsx
			agent-tasks.queries.ts
			agent-tasks.commands.ts
			agent-tasks.functions.ts
			agent-tasks.schema.ts
			agent-tasks.api.server.ts
			agent-tasks.model.ts
			agent-tasks.model.test.ts
			agent-tasks.tools.ts
			agent-tasks.runtime.server.ts
			agent-tasks.repo.server.ts
			agent-tasks.workflow.server.ts
			agent-tasks.integration.test.ts
			agent-tasks.e2e.spec.ts
	components/
		ui/                              Design-system primitives
		patterns/                        Domain-agnostic compositions
	layouts/
		app-shell.tsx                    Responsive shell, navigation, account menu
	domain/                              Absent until a shared business capability exists
	platform/
		ids.ts
		env.server.ts
		supabase.server.ts
		auth.server.ts
		model.server.ts
		logger.server.ts
		database.types.ts                Generated; never edited by hand
	server.ts                            Sole runtime composition root
supabase/
	config.toml
	schemas/
		account/
		agent-turns/
		agent-tasks/
	migrations/                          One globally ordered ledger
	tests/                               Database-wide security tests
tests/
	fixtures/                            Shared test utilities, gateway double
	architecture/                        Positive and negative boundary fixtures
tools/
	oxlint/anti-slop/                    Vendored lint rules
	check-client-bundle.ts
	verify.ts                            Implements pnpm verify and verify:deployed
	hooks/                               Optional agent hooks
environments/                            Nonsecret per-environment manifests
ARCHITECTURE.md                          This specification
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
- Shared test infrastructure and architecture fixtures live under `tests/`.
- Database definitions live under `supabase/schemas/<owner>/`, where `<owner>` is the feature or domain directory name.

## File roles and ownership

Every kind of logic has one owner. The file suffix names the role.

| File | Owns | Never owns |
|---|---|---|
| `routes/*.tsx` | URLs, params, loaders, redirects, composing feature UI | Business logic, persistence |
| `ui/*.tsx` | Rendering, interaction, ephemeral state | Fetching, persistence, transport |
| `*.queries.ts` | Query keys, query options, polling | Mutations, domain rules |
| `*.commands.ts` | Mutations, optimistic updates, cache invalidation | Authoritative behavior |
| `*.functions.ts` | TanStack server functions: parse input, resolve the actor, authorize, delegate | Domain logic beyond authorization |
| `*.schema.ts` | Client-safe runtime schemas and the types inferred from them | Runtime implementations, SQL |
| `*.api.server.ts` | The feature's server-side use cases; the only server module other features may import | UI, transport details |
| `*.model.ts` | Pure domain decisions, constants, policies, and outcome classification | I/O of any kind |
| `*.tools.ts` | Pure tools an agent may call | I/O of any kind |
| `*.runtime.server.ts` | Execution runner and reconciler | Cloudflare step objects |
| `*.repo.server.ts` | Calls to the feature's database routines and row parsing | Business decisions |
| `*.workflow.server.ts` | The Cloudflare Workflow class: steps, sleeps, payload parsing | Domain decisions |
| `supabase/schemas/<owner>/` | Schemas, roles, tables, constraints, indexes, RLS, routines, grants | Application behavior outside SQL routines |
| `platform/` | Generic mechanisms: env, Supabase clients, auth, model adapter, logging | Feature knowledge |
| `src/server.ts` | Wiring runtime dependencies and exporting entrypoints | Any rule |

A feature with simple CRUD needs no `*.api.server.ts`. Its server functions call its repository directly. Create `*.api.server.ts` when another feature needs the behavior, or when use cases hold logic beyond authorization. Never add a forwarding service, barrel file, or DI container.

## Dependency rules

`architecture/policy.ts` encodes this table, and dependency-cruiser enforces it.

| Source | May import | Must not import |
|---|---|---|
| Routes | Feature `ui/`, `*.queries.ts`, `*.commands.ts`, `*.schema.ts`, `*.functions.ts`, layouts, components | Repositories, `*.api.server.ts`, runtime, workflow |
| `ui/` | Components, own feature's queries, commands, and schema | Any `.server.ts`, any `*.functions.ts` |
| Queries and commands | Own feature's `*.functions.ts` and `*.schema.ts`, `@tanstack/react-query` | Any `.server.ts` |
| `*.functions.ts` | Own schema, own `*.api.server.ts` or repository, `platform/auth.server.ts` | UI, queries, commands |
| `*.api.server.ts` | Own schema, model, tools, repository; other features' `*.schema.ts` and `*.api.server.ts`; `platform/` | UI, routes, workflow |
| `*.model.ts`, `*.tools.ts` | Own schema, other pure modules, `platform/ids.ts` | Any `.server.ts`, runtime globals |
| `*.runtime.server.ts` | Own model, tools, repository, schema; `platform/` | UI, routes, `*.workflow.server.ts` |
| `*.repo.server.ts` | Own schema, `platform/supabase.server.ts`, `platform/database.types.ts`, `platform/ids.ts` | UI, model, runtime |
| `*.workflow.server.ts` | Own runtime and schema, `cloudflare:workers` | UI, routes, repository |
| `*.schema.ts` | `zod`, `platform/ids.ts`, other features' `*.schema.ts` | React, Supabase, Cloudflare APIs, any `.server.ts` |
| `platform/` | Third-party libraries, other `platform/` modules | Anything under `src/features/` or `src/domain/` |
| `src/server.ts` | Everything it wires | Nothing is forbidden; it holds no rules |

Additional rules:

- Feature dependencies point one way. `agent-tasks` may import `agent-turns` public modules. `agent-turns` never imports `agent-tasks`. Cycles between features fail the check.
- A feature never imports another feature's `ui/`, model, tools, runtime, repository, or workflow.
- Only `platform/model.server.ts` sends model calls. No provider SDK appears anywhere else.
- `platform/model.server.ts` knows nothing about tasks. It takes platform-level request types and returns a raw `GatewayResult`. The task feature builds the request and classifies the result.
- Browser code may import `*.functions.ts`. TanStack Start compiles each server function into a client RPC stub. Importing `*.functions.ts` never makes the rest of that module safe for the browser, and the client-bundle inspection decides what actually ships.

## Shared identities and conventions

`platform/ids.ts` holds brands for identities that more than one feature names.

```ts
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type UserId = Brand<string, 'UserId'>;
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type RequestKey = Brand<string, 'RequestKey'>;
export type Instant = Brand<string, 'IsoInstant'>;
export type PageCursor = Brand<string, 'PageCursor'>;
export type Page<T> = { items: readonly T[]; next?: PageCursor };
export type Actor = { userId: UserId; environmentId: EnvironmentId };
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type NotFound = { kind: 'not_found' };
```

Conventions every feature follows:

- **Parse once at the boundary.** Every value from outside the process (request payload, environment, Workflow payload, database row, gateway response, model tool arguments) is parsed by a zod schema at its owning adapter. Code inside the boundary trusts the types and never revalidates.
- **Brands come from parsers.** Never cast a string to a brand in caller code.
- **Owner IDs come from the verified session.** Never read an owner ID from a request body, a URL, or user-editable metadata.
- **Request keys.** The browser generates one `RequestKey` (a UUID) per deliberate create action and reuses it for transport retries of that action. A user who submits again gets a new key.
- **Receipts.** Every create returns a discriminated receipt: the stored result, `key_conflict` when the same key arrives with different input, or a refusal.
- **Pagination.** Lists use keyset pagination. A `PageCursor` is an opaque base64url encoding of the last item's sort key. The page size is 25 and the maximum is 50.
- **Times.** PostgreSQL time decides every deadline, lease, and window. Worker clocks only measure relative durations.
- **Errors.** Server functions return safe, typed errors. A safe error carries a stable code and a correlation ID, never a stack trace, SQL text, or provider body.

## Authentication and account

### Authentication

`features/auth/` owns the sign-up, login, logout, password recovery, and update-password flows. `platform/auth.server.ts` owns the infrastructure.

- Supabase Auth with email and password. Sessions persist in HTTP-only cookies through `@supabase/ssr`.
- `platform/auth.server.ts` exports `createRequestClient(request)`, which builds a Supabase client bound to the request's cookies, and `requireActor(request)`, which verifies the session with `auth.getUser()` and returns an `Actor` or throws an unauthenticated error.
- The `_authenticated` layout route redirects unauthenticated visitors to `/login`. Route protection is navigation only. Every private server function calls `requireActor` itself.
- Logout signs out through Supabase, clears the cookies, and calls `queryClient.clear()`.
- Password recovery sends the Supabase recovery email. Its link targets `/update-password`.
- SMTP settings come from `supabase/config.toml` locally and from the Supabase project settings in hosted environments.

### Account

`features/account/` owns the profile. A profile is a display name of 1 to 80 characters.

- `getProfile` returns the stored profile or a default with an empty display name.
- `updateProfile` upserts the profile for the actor.
- The account page shows the email (read from the session) and an editable display name.

Account is simple CRUD. Its server functions call `account.repo.server.ts` directly, and it uses the same database pattern as every feature (see [Database](#database)).

## Agent Turns

Agent Turns is the synchronous reference and the transcript capability. It stores and renders turns. It makes no model or tool call. A feature that needs a model response submits an agent task and renders the agent turn that task writes, so every model call goes through one path with limits.

### Turn contracts

`agent-turns.schema.ts` is public. Other features may import it.

```ts
export type ToolCallId = Brand<string, 'ToolCallId'>;

// The write type. Callers can only create these kinds.
export type ContentBlock =
	| { kind: 'text'; text: string }
	| { kind: 'tool_call'; callId: ToolCallId; tool: string; input: JsonValue | { unparsed: string } }
	| { kind: 'tool_result'; callId: ToolCallId; output: JsonValue; isError: boolean }
	| { kind: 'structured_output'; schema: string; value: JsonValue };

// The read type. Parsing an unknown stored kind or version produces `unsupported`.
export type StoredBlock =
	| ContentBlock
	| { kind: 'unsupported'; storedKind: string; storedVersion: number };

export type Turn = {
	id: TurnId;
	owner: UserId;
	role: 'user' | 'agent';
	blocks: readonly StoredBlock[];
	taskId?: TaskId;
	createdAt: Instant;
};

export type TurnReceipt =
	| { kind: 'stored'; turn: Turn }
	| { kind: 'key_conflict' }
	| { kind: 'rate_limited'; retryAfter: Instant };

export const BLOCK_SCHEMA_VERSION = 1;
```

`agent-turns.api.server.ts` is public to other server modules.

```ts
export interface Turns {
	create(actor: Actor, input: { requestKey: RequestKey; blocks: readonly ContentBlock[] }): Promise<TurnReceipt>;
	list(actor: Actor, query: { taskId?: TaskId; after?: PageCursor }): Promise<Page<Turn>>;
}
```

Write rules, enforced by the write schema:

- Every `tool_result` references a `tool_call` with the same `callId` in the same turn.
- `unsupported` is not a write kind.
- A text block holds at most 32 KB. A JSON value holds at most 16 KB serialized. A turn holds at most 64 blocks and 256 KB in total.

### Turn behavior

- `create` checks the actor's turn-creation window (60 creates per user per hour). A rate-limited create writes nothing and returns `rate_limited`.
- `create` then inserts with `on conflict do nothing` on `(owner_id, request_key)` and compares the canonical input hash with the stored row. The same input returns `stored`. Different input returns `key_conflict`. Concurrent identical calls take the same path.
- `list` without `taskId` returns the actor's user turns, newest first, sorted by `(created_at, id)`. `list` with `taskId` returns that task's agent turns in step order.
- The repository parses stored blocks by `block_schema_version` and kind. An unknown kind or version becomes `unsupported`. Removing or reshaping a block kind requires a SQL data migration in the same change.
- Only the Agent Tasks `commit_step` database routine writes agent turns. No TypeScript function writes them.

### Turn UI

- The turns page lists the actor's user turns and has a composer that creates a text turn.
- `turn-view.tsx` renders a turn by switching exhaustively over `block.kind`, one component per kind. The TypeScript `never` check fails the build when a kind lacks a component.
- The task detail page reuses `turn-view.tsx` for its transcript.

## Agent Tasks

A user submits instructions. An agent runs asynchronously, calls pure tools, and writes one agent turn per step. The user watches progress, can cancel, and sees the final turn.

### Task contracts

`agent-tasks.schema.ts` is public.

```ts
export type TaskFailure =
	| { kind: 'execution'; code: SafeFailureCode }
	| { kind: 'limit'; limit: 'attempts' | 'steps' | 'tool_calls' | 'sends' | 'context' | 'duration' }
	| { kind: 'gateway_refused'; reason: 'budget' | 'policy' | 'configuration' }
	| { kind: 'model_output_invalid'; reason: 'truncated' | 'oversized' };

export type PublicTask = { id: TaskId; instructions: string; retryOf?: TaskId; version: number; createdAt: Instant } & (
	| { state: 'queued' }
	| { state: 'running'; committedSteps: number }
	| { state: 'completed'; finalTurn: TurnId; endedAt: Instant }
	| { state: 'failed'; failure: TaskFailure; endedAt: Instant }
	| { state: 'canceled'; endedAt: Instant }
);

export type PublicActivity = {
	at: Instant;
	kind: 'attempt_started' | 'send_started' | 'send_retryable' | 'send_lost' | 'step_committed' | 'attempt_replaced';
	step?: number;
};

export type TaskView = { task: PublicTask; transcript: Page<Turn>; activity: readonly PublicActivity[] };

export type SubmissionRefusal = 'capacity' | 'rate_limited' | 'source_not_retryable';

export type SubmissionReceipt =
	| { kind: 'accepted'; task: PublicTask }
	| { kind: 'refused'; reason: SubmissionRefusal }
	| { kind: 'key_conflict' };
```

`instructions` is plain text of at most 8 KB. `SafeFailureCode` is a closed string union declared in the same file: `'internal'` and `'unclassified_gateway_response'`.

`agent-tasks.api.server.ts` implements the five use cases.

```ts
export interface Tasks {
	submit(actor: Actor, input: { requestKey: RequestKey; instructions: string }): Promise<SubmissionReceipt>;
	list(actor: Actor, page: { after?: PageCursor }): Promise<Page<PublicTask>>;
	read(actor: Actor, id: TaskId, page: { transcript?: PageCursor }): Promise<TaskView | NotFound>;
	cancel(actor: Actor, id: TaskId): Promise<TaskView | NotFound>;
	retry(actor: Actor, id: TaskId, requestKey: RequestKey): Promise<SubmissionReceipt | NotFound>;
}
```

- `list` sorts by `(created_at, id)`, newest first.
- `read` composes the `read_task` routine with `turns.list(actor, { taskId })`. The task feature never reads turn tables directly.
- `cancel` returns the durable winner, including an already completed or failed task.
- `retry` accepts only a `failed` or `canceled` task. It creates a new task with the same instructions and `retryOf` set. The original task never changes. Any other source state refuses with `source_not_retryable`.

### Private execution contracts

These types live in `agent-tasks.model.ts` and never leave the feature.

```ts
export type AttemptId = Brand<string, 'AttemptId'>;
export type ExecutionId = Brand<string, 'ExecutionId'>;
export type Cursor = { seq: number };

export type Prompt = {
	messages: readonly ChatMessage[];   // From platform/model.server.ts
	tools: readonly ToolSpec[];         // From platform/model.server.ts
	digest: string;          // SHA-256 of the canonical JSON of messages and tools
	builderVersion: string;  // Bumped whenever buildPrompt's output format changes
};

export type ModelResponse = {
	blocks: readonly ContentBlock[];   // text and tool_call blocks only
	usage: { inputTokens: number; outputTokens: number };
};

export type ModelOutcome =
	| { kind: 'response'; response: ModelResponse }
	| { kind: 'retryable'; retryAfter?: Instant }
	| { kind: 'terminal'; failure: TaskFailure };

export type Send = { ordinal: number; attempt: AttemptId; promptDigest: string; deadline: Instant } & (
	| { state: 'in_flight' }
	| { state: 'observed'; observedAt: Instant; outcome: ModelOutcome }
);

export type RunSnapshot = {
	now: Instant;
	deadline: Instant;
	attempt: { id: AttemptId; token: number };
	instructions: string;
	history: readonly Turn[];        // This task's committed agent turns, in step order
	committedSteps: number;
	openStep?: { ordinal: number; sends: readonly Send[] };
};

export type Decision =
	| { kind: 'send'; step: number; prompt: Prompt }
	| { kind: 'wait'; until: Instant }
	| { kind: 'commit_step'; step: number; response: ModelResponse; final: boolean }
	| { kind: 'fail'; failure: TaskFailure };

export type Advance =
	| { kind: 'checkpoint'; cursor: Cursor }
	| { kind: 'wait'; until: Instant; cursor: Cursor }
	| { kind: 'stop' };

export function decide(snapshot: RunSnapshot, tools: ToolCatalog): Decision;
export function buildPrompt(instructions: string, history: readonly Turn[], tools: ToolCatalog): Prompt;
export function backoff(sendOrdinal: number): number; // milliseconds
export function classify(result: GatewayResult): ModelOutcome | 'lost';
```

A send is **lost** when it is `in_flight` and `now` is at or past its deadline. Lost is derived. No row stores it.

### Vocabulary

- A **task** is one submission. Its outcome is terminal once set.
- An **attempt** is one bounded period during which one Workflow execution owns the task. It has an ID, an ordinal, a unique execution ID, a token, a lease, and an ended outcome. The task row names its active attempt.
- The **token** is a counter on the attempt. Every fenced write requires the token the runner read and increments it. Two concurrent `advance` calls in one attempt therefore cannot both commit.
- A **step** is one model response plus the pure tool calls it requested, committed as one agent turn.
- A **send** is one transmission of a step's prompt to the gateway. A step has one or more sends. At most one send per step is accepted as the step's response.

### Policy and timing defaults

`agent-tasks.model.ts` exports these constants. A unit test asserts every inequality listed under [Timing](#timing).

| Constant | Default |
|---|---|
| `MAX_STEPS` | 8 |
| `MAX_TOOL_CALLS_PER_STEP` | 4 |
| `MAX_SENDS_PER_STEP` | 3 |
| `MAX_ATTEMPTS` | 3 |
| `TASK_DURATION` | 15 minutes |
| `MAX_PROMPT_TOKENS` | 32,000, estimated as UTF-8 bytes divided by 4 |
| `MAX_OUTPUT_TOKENS` | 1,024 |
| `SLOTS_PER_USER` | 2 active attempts |
| `SLOTS_PER_ENVIRONMENT` | 10 active attempts |
| `SUBMISSIONS_PER_USER_PER_HOUR` | 20 |
| `SEND_TIMEOUT` (D) | 120 seconds |
| `STEP_TIMEOUT` (T) | 180 seconds |
| `STEP_RETRIES` | 2, with exponential backoff starting at 5 seconds |
| `STEP_RETRY_WINDOW` (W) | `(STEP_RETRIES + 1) × T` plus total retry backoff (555 seconds by default) |
| `SCHEDULING_ALLOWANCE` (A) | 60 seconds |
| `CLOCK_SKEW_MARGIN` | 5 seconds |
| `backoff(n)` | `min(2^n × 2 s, 60 s)`, or the gateway's `retryAfter` when that is later |
| `REENTRY_ALLOWANCE` | 10 Workflow steps |
| `WORKFLOW_STEP_LIMIT` | The current Cloudflare per-instance step limit, copied from Cloudflare's limits page |

The task row stores the policy values in force at admission, so a later deploy never changes a running task's limits. Timing constants are not stored per task. The lease rule in SQL keeps them safe across deploys.

### Tools

`agent-tasks.tools.ts` exports the tool catalog. A tool is a pure, deterministic, synchronous function.

```ts
export type PureTool<I, O> = { name: string; description: string; input: z.ZodType<I>; output: z.ZodType<O>; run(input: I): O };
export type ToolCatalog = readonly PureTool<never, unknown>[];
export const TOOLS: ToolCatalog = [calculate];
```

The reference ships one tool. `calculate` takes `{ expression: string }`, evaluates arithmetic with `+`, `-`, `*`, `/`, parentheses, and decimal numbers through a hand-written parser, and returns `{ value: number }`. It never calls `eval` or `Function`.

Tool rules:

- The tools module imports only `zod`, its own feature schema, and other pure modules. A lint rule bans `fetch`, `caches`, `crypto`, `Date`, `Math.random`, `process`, and Worker bindings inside it.
- Tools are not journaled. Re-running a tool on recovery is free and gives the same result.
- The runner parses model-supplied arguments with the tool's input schema before `run`. An unknown tool name, unparsed or invalid arguments, a thrown error, or an output over 16 KB becomes `{ kind: 'tool_result', isError: true }` with a short message the model can read.
- A tool with network, storage, or any other side effect needs the non-pure tool extension in [Deferred extensions](#deferred-extensions). The tool-purity lint rule rejects such a tool until that extension exists.

### Prompt construction

`buildPrompt` is pure.

- It reads only the task's `instructions` and its committed agent turns. User turns never reach a prompt, so a user cannot forge a tool result into a model call.
- The first message is a fixed system message from `agent-tasks.model.ts`. The second is the instructions as the user message.
- Each agent turn becomes one assistant message holding its `text` and `tool_call` blocks, followed by one tool message per `tool_result`.
- A `tool_call` whose input is `{ unparsed }` is sent back as its raw string.
- An `unsupported` block becomes the text `[unsupported block]`.
- `tools` lists the catalog with each tool's name, description, and JSON schema.
- No prompt is stored. Each send records the prompt's digest and builder version. A resend rebuilds the prompt from the same immutable turns.

### The agent loop

The runner loads a `RunSnapshot` in one read, including PostgreSQL's `now`, calls `decide`, and applies exactly one decision per `advance`. `decide` checks these rows in order and returns the first match.

| Snapshot | Decision |
|---|---|
| `now` at or past `deadline` | `fail` with `limit: 'duration'` |
| No open step and `committedSteps` equals `MAX_STEPS` | `fail` with `limit: 'steps'` |
| No open step, and the built prompt exceeds `MAX_PROMPT_TOKENS` | `fail` with `limit: 'context'` |
| No open step | `send` for step `committedSteps + 1` |
| Open step, a send observed as `response` | `commit_step`, with `final` true when the response holds no `tool_call` |
| Open step, latest send `in_flight` and before its deadline, from any attempt | `wait` until that deadline |
| Open step, latest send `terminal` | `fail` with that send's failure |
| Open step, latest send `retryable`, and `now` before the later of `observedAt + backoff(ordinal)` and `retryAfter` | `wait` until that time |
| Open step, latest send lost or `retryable`, and sends equal `MAX_SENDS_PER_STEP` | `fail` with `limit: 'sends'` |
| Open step, latest send lost or `retryable` | `send` for the same step |

`commit_step` runs every requested tool before it writes the turn. A committed turn therefore never holds an unresolved tool call, and "no open step" always means the next action is a model call.

The runner maps each decision to transactions and an `Advance` result.

| Decision | Work inside one `advance` | Result |
|---|---|---|
| `send` | **Transaction 1** (`begin_send`, fenced): open the step if absent, insert an `in_flight` send with deadline `now + D` and the prompt digest, extend the lease, and mark the task `running` if it was `queued`. It returns the time remaining until the deadline. **Gateway call**: the model adapter aborts the call after that remaining time minus `CLOCK_SKEW_MARGIN`. **Transaction 2** (`record_observation`): store the classified outcome. The runner retries Transaction 2 in-process up to 3 times on transient database errors. | `checkpoint` |
| `wait` | `extend_lease` (fenced) sets the lease to cover the wake time. | `wait` |
| `commit_step` | Run the tools. Then `commit_step` (fenced) writes the agent turn, closes the step, and, when `final`, completes the task with `finalTurn`, ends the attempt, and releases the slot. | `checkpoint`, or `stop` when final |
| `fail` | `fail_task` (fenced) sets the failure, ends the attempt, and releases the slot. | `stop` |

Each `advance` returns `cursor.seq + 1` in its result, so every Workflow step name is unique and deterministic.

### Fencing and rejections

A fenced routine takes `(attempt_id, token)` and commits only when all of these hold:

- the attempt is the task's active attempt,
- the task is not terminal,
- the attempt's token equals the given token.

It increments the token in the same transaction. Each rejection maps to one result.

| Rejection | `advance` result |
|---|---|
| Attempt not active, or task terminal | `stop`, with no further writes |
| Stale token, or a unique-key conflict on step, send, or turn | `checkpoint`, so the next `advance` reads a fresh snapshot |
| Task deadline passed | Call `fail_task` with `limit: 'duration'`, then `stop` |

`record_observation` is not token-fenced, so a concurrent `wait` in the same attempt cannot discard a response that already arrived. It stores the outcome only when all of these hold, and otherwise logs the IDs and discards the response:

- the send is the latest send of its step,
- the send is still `in_flight`,
- PostgreSQL `now` is before the send's deadline,
- the send's attempt is still the task's active attempt.

A partial unique index allows at most one `response` outcome per step. If Transaction 2 still fails after its retries, the response is lost and the step sends again later. The send limit bounds that duplicate charge.

### Runner error handling

The runner classifies every error that escapes a decision:

- **Transient** errors (database connection failure, Supabase timeout, HTTP 5xx from Supabase) are rethrown. The Workflow step retries and re-enters `advance`, which is safe because the snapshot decides.
- **Every other error** is a defect. The runner calls `fail_task` with `{ kind: 'execution', code: 'internal' }`, logs the cause with its correlation IDs, and returns `stop`. A deterministic bug fails the task once instead of consuming every attempt.

### Model adapter and gateway outcomes

`platform/model.server.ts` exports `ChatMessage`, `ToolSpec`, and `GatewayResult`, and one function that sends one chat-completion request to `AI_GATEWAY_URL`. `GatewayResult` is `{ kind: 'http'; status; headers; body: unknown }`, `{ kind: 'aborted' }`, or `{ kind: 'network_error' }`. The request carries:

- `model` from `AI_MODEL`,
- the prompt's messages and tools,
- `max_tokens` from `MAX_OUTPUT_TOKENS`,
- `user` set to the task owner's user ID, which the gateway uses for per-user budgets,
- metadata naming the task (as the trace ID), the step, and the send, in the field names the chosen gateway forwards to Langfuse,
- an `AbortSignal` that fires after the duration the runner passes in.

`classify` in `agent-tasks.model.ts` is a pure function from `GatewayResult` to a `ModelOutcome`, or `'lost'` for an abort or network error. It parses the body with zod and checks the turn caps and the tool-call limit. `agent-tasks.model.test.ts` runs it against recorded fixtures of the chosen gateway's responses.

| Gateway outcome | `ModelOutcome` | Loop behavior |
|---|---|---|
| Complete response within the turn caps | `response` | `commit_step` |
| Response blocks exceed the turn write caps | `terminal`, `model_output_invalid: 'oversized'` | `fail` |
| More tool calls than `MAX_TOOL_CALLS_PER_STEP` | `terminal`, `limit: 'tool_calls'` | `fail` |
| Finish reason is the output token limit | `terminal`, `model_output_invalid: 'truncated'` | `fail` |
| Tool-call arguments that are not valid JSON | `response`, with the argument kept as `{ unparsed }` | `commit_step`; the tool returns an error result |
| Rate limit from the gateway or upstream, 5xx, provider overloaded | `retryable`, with `retryAfter` from the `Retry-After` header when present | `wait`, then a new send |
| Context length exceeded | `terminal`, `limit: 'context'` | `fail` |
| Budget exceeded, per user or per key | `terminal`, `gateway_refused: 'budget'` | `fail` |
| Content policy refusal | `terminal`, `gateway_refused: 'policy'` | `fail` |
| 401, 403, or unknown model | `terminal`, `gateway_refused: 'configuration'` | `fail` |
| Abort at the timeout, network loss, crash before Transaction 2 | No outcome; the send becomes lost | A new send |
| Anything the classifier does not recognize | `terminal`, `execution` with `unclassified_gateway_response` | `fail` |

A repeated model call can be charged twice. The template accepts that cost. The send limit and the gateway's per-user budget bound it, and Langfuse shows it.

### Lifecycle and cancellation

| Current state | Allowed next states |
|---|---|
| `queued` | `running`, `failed`, `canceled` |
| `running` | `completed`, `failed`, `canceled`. A successor attempt may take over without a state change. |
| `completed`, `failed`, `canceled` | None |

- A task becomes `running` in the `begin_send` transaction of its first send.
- Cancellation, completion, and failure lock the same task row. The first committed terminal transition wins. Repeated cancellation returns that winner.
- A winning cancellation ends the active attempt and releases its slot in the same transaction. No new send and no new turn can follow, because both need the active attempt. A gateway call already in flight is aborted by its deadline, and its result is discarded.
- Releasing the slot at cancel means a user who submits and cancels repeatedly can briefly have more aborted calls running at the provider than their slot count. The gateway's per-user rate limit bounds that.
- A completed task's `finalTurn` is written by its final `commit_step` in the same transaction that completes the task. A final answer is never visible on a running task.
- `version` increases on every change to the task row. Clients use it for cache reconciliation. Runner writes are fenced by the attempt token, not by `version`.

### Submission

`submit` runs one database routine, `submit_task`, in one transaction:

1. Check the actor's submission window. A rate-limited submission returns `refused: rate_limited` and writes no row, so the same key is evaluated again later.
2. Insert the receipt with `on conflict do nothing` on `(owner_id, request_key)`. If the key exists, compare the canonical input hash and return the stored receipt or `key_conflict`. The canonical input is the operation (`submit` or `retry`), the instructions, and the source task ID for a retry.
3. Upsert the user and environment slot rows, lock them in the fixed order, and check both limits. A capacity refusal records a `refused: capacity` receipt and creates no task.
4. On acceptance, create the task with its policy snapshot and deadline, its first attempt with a new execution ID and no lease, and the slot claims.

After the transaction commits, `submit` calls the injected `startExecution(executionId)` and ignores its failure. The nudge removes the cron delay from the common path. The reconciler is the correctness path.

### Dispatch and recovery

The scheduled handler runs the reconciler every minute. Each run processes at most 25 attempts per query, oldest first. The two queries never select the same attempt.

- **Unacknowledged attempts.** Active attempts with no dispatch acknowledgement. Call `startExecution(executionId)`. A duplicate-ID error means the instance exists and counts as success. The first fenced write in `advance` acknowledges the attempt and sets its first lease. An unacknowledged attempt holds no lease, so a dispatch outage consumes no attempts. Its age is logged as oldest-pending age.
- **Expired leases.** Acknowledged active attempts whose lease has passed. In one transaction, end the attempt, and if the task is nonterminal and attempts remain, create a successor attempt with a new execution ID and transfer the slot to it. When attempts are exhausted, fail the task with `limit: 'attempts'` and release the slot.

A lost execution has one recovery path. Its lease expires, and a successor replaces it. An execution ID is never reused. The Workflow payload is `{ executionId }` and nothing else. The runner resolves the attempt from its unique execution ID and returns `stop` if that attempt has ended. PostgreSQL, not Cloudflare's instance retention, deduplicates executions.

### Timing

These inequalities hold, and the timing unit test asserts them:

- `T ≥ D + 60 s`. The extra 60 seconds cover the step's database transactions and tool runs.
- `W = (STEP_RETRIES + 1) × T + total retry backoff`.
- Every fenced write sets the lease to `max(current lease, now + W + A)`. Before a `wait`, `extend_lease` sets it to at least `until + W + A`.
- Every routine that sets a lease also raises it to at least the latest deadline of the attempt's `in_flight` sends plus `CLOCK_SKEW_MARGIN`. This rule lives in SQL and reads stored deadlines, so it holds when a deploy changes the constants mid-task.
- Leases never extend past the task deadline plus `W`.
- `MAX_STEPS × (2 × MAX_SENDS_PER_STEP + 1) + REENTRY_ALLOWANCE ≤ WORKFLOW_STEP_LIMIT`. Each send uses at most two Workflow steps (the send and one wait), and each logical step adds one commit.

**Safety guarantee.** A successor attempt exists only after the lease expires, and the lease outlasts every send the old attempt may still have running. At most one send per task is live at the adapter. A provider may keep processing a request the adapter aborted. The gateway's per-user budget bounds that cost.

**Liveness.** A healthy attempt renews its lease long before it expires. A Workflow wake later than `A` can still lose the lease. That is safe, because the fence stops the old runner, and it costs one attempt.

### Workflow adapter

`agent-tasks.workflow.server.ts` exports `AgentTasksWorkflow`, a Cloudflare `WorkflowEntrypoint`.

```ts
export class AgentTasksWorkflow extends WorkflowEntrypoint<Env, unknown> {
	async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
		const { executionId } = parseExecutionPayload(event.payload);
		const runner = createRunner(this.env);
		let cursor: Cursor = { seq: 0 };
		for (;;) {
			const next = await step.do(`advance-${cursor.seq}`, STEP_CONFIG, () => runner.advance(executionId, cursor));
			if (next.kind === 'stop') return;
			if (next.kind === 'wait') await step.sleepUntil(`wait-${cursor.seq}`, new Date(next.until));
			cursor = next.cursor;
		}
	}
}
```

`STEP_CONFIG` sets `timeout` to `T` and `retries` to `{ limit: STEP_RETRIES, delay: '5 seconds', backoff: 'exponential' }`. The adapter holds no domain logic. Workflows earn their place over a database-only loop because they continue to the next step immediately and sleep durably. The reconciler is only the recovery path.

### Limits summary

| Limit | Enforced by |
|---|---|
| Active attempts per user and per environment | `submit_task` and the reconciler, in PostgreSQL |
| Submissions and turn creates per user per hour | Window counters in PostgreSQL, checked before any row is written |
| Steps, sends per step, attempts, duration | `decide` and the reconciler, from the task's policy snapshot |
| Tool calls per step, response size | The model outcome classifier |
| Prompt size | `decide`, before each new step |
| Output tokens per call | The `max_tokens` request parameter |
| Instruction, block, and turn size | Write schemas at the RPC boundary |
| Spend, token budgets, provider rate limits | The AI gateway, per environment key and per end user |

## Database

### Schemas and roles

Each feature with tables owns two PostgreSQL schemas and the roles its routines need.

| Feature | Private schema (tables, internal routines) | Exposed schema (routines callable through PostgREST) | Roles |
|---|---|---|---|
| account | `account` | `account_api` | `account_reader` |
| agent-turns | `agent_turns` | `agent_turns_api` | `agent_turns_reader`, `agent_turns_writer` |
| agent-tasks | `agent_tasks` | `agent_tasks_api` | `agent_tasks_reader`, `agent_tasks_committer` |

`supabase/config.toml` lists only the `*_api` schemas (plus Supabase's defaults) under `[api] schemas`. Private schemas are never exposed.

Each feature directory under `supabase/schemas/` holds `schema.sql` (schemas and roles), `tables.sql`, `policies.sql`, `routines.sql`, and `grants.sql`. Add `indexes.sql` when a feature needs indexes beyond its constraints.

### Access pattern

Every feature uses the same pattern. Agents copy it for new features.

**Reads.** A read routine is `security definer`, owned by the feature's reader role, with `set search_path = ''` and schema-qualified names. The reader role is `nologin`, owns no tables, has no `bypassrls`, and holds only `select` on the tables it reads. The routine raises `42501` when `auth.uid()` is null and filters by `auth.uid()`. Every RLS policy on the table targets both `authenticated` and the reader role, so the policy enforces ownership a second time. Execution is granted to `authenticated` only. The server calls read routines through the request client, so the caller's JWT reaches PostgreSQL.

**Writes.** A mutation routine is `security invoker` and runs as `service_role`. The server calls it through the service client in `platform/supabase.server.ts`, which uses the server-only secret key. Each routine takes the actor's user ID as a parameter that the server function took from `requireActor`, and checks every ownership relationship itself, because `service_role` bypasses RLS. Execution is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`.

**Tables.** Tables live in the private schema with RLS enabled. Revoke all table privileges from `anon` and `authenticated`. Grant `service_role` exactly the privileges its invoker routines need.

**Migration roles.** `grants.sql` grants each feature role to `postgres` so the migration can transfer function ownership to it.

### Agent-turn grant boundary

PostgreSQL grants go to roles, not to calling routines. Only `agent_tasks_api.commit_step` may write an agent turn, and the boundary is built from roles:

- `agent_turns.insert_agent_turn` lives in the private schema, so PostgREST cannot reach it. It is `security definer` and owned by `agent_turns_writer`, which holds `insert` on `agent_turns.turns`, has an RLS insert policy that only admits `role = 'agent'`, and owns nothing else.
- Execution of `insert_agent_turn` is revoked from `public`, `anon`, `authenticated`, and `service_role`, and granted only to `agent_tasks_committer`.
- `agent_tasks_api.commit_step` is `security definer` and owned by `agent_tasks_committer`. That role owns exactly this one routine and holds the task-table privileges `commit_step` needs. `service_role` may execute `commit_step`, never `insert_agent_turn`.
- `supabase/tests/` asserts the grant list on `insert_agent_turn`, that `agent_tasks_committer` owns one routine, and that a direct call as `service_role` fails.

### Reference SQL for Agent Turns

The SQL below is the pattern to copy. Routine bodies follow the behavior in [Turn behavior](#turn-behavior).

```sql
-- supabase/schemas/agent-turns/schema.sql
create schema agent_turns;
create schema agent_turns_api;
create role agent_turns_reader nologin;
create role agent_turns_writer nologin;

-- supabase/schemas/agent-turns/tables.sql
create table agent_turns.turns (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null references auth.users (id) on delete cascade,
	role text not null check (role in ('user', 'agent')),
	blocks jsonb not null,
	block_schema_version int not null,
	request_key text,
	input_hash text,
	task_id uuid,
	step_ordinal int,
	created_at timestamptz not null default now(),
	check ((role = 'user') = (request_key is not null and input_hash is not null and task_id is null)),
	check ((role = 'agent') = (task_id is not null and step_ordinal is not null)),
	unique (owner_id, request_key),
	unique (task_id, step_ordinal)
);
create table agent_turns.creation_windows (
	owner_id uuid not null,
	window_start timestamptz not null,
	count int not null,
	primary key (owner_id, window_start)
);

-- supabase/schemas/agent-turns/policies.sql
alter table agent_turns.turns enable row level security;
alter table agent_turns.creation_windows enable row level security;
create policy turns_owner_read on agent_turns.turns
	for select to authenticated, agent_turns_reader
	using (owner_id = (select auth.uid()));
create policy turns_agent_insert on agent_turns.turns
	for insert to agent_turns_writer
	with check (role = 'agent');

-- supabase/schemas/agent-turns/routines.sql
create function agent_turns_api.list_turns(p_after jsonb, p_limit int)
returns table (id uuid, role text, blocks jsonb, block_schema_version int, task_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
	if auth.uid() is null then
		raise exception 'not authenticated' using errcode = '42501';
	end if;
	return query
		select t.id, t.role, t.blocks, t.block_schema_version, t.task_id, t.created_at
		from agent_turns.turns t
		where t.owner_id = auth.uid()
			and t.task_id is null
			and (p_after is null or (t.created_at, t.id) < ((p_after->>'created_at')::timestamptz, (p_after->>'id')::uuid))
		order by t.created_at desc, t.id desc
		limit least(p_limit, 50);
end;
$$;
-- list_task_turns(p_task_id uuid, p_after_step int, p_limit int) follows the same shape,
-- filters task_id = p_task_id, and orders by step_ordinal ascending.

create function agent_turns_api.create_turn(
	p_owner_id uuid, p_request_key text, p_input_hash text, p_blocks jsonb, p_block_schema_version int)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
-- 1. Increment the owner's current-hour window; return {"kind":"rate_limited","retryAfter":...} above the limit.
-- 2. Insert with on conflict (owner_id, request_key) do nothing.
-- 3. Read the stored row; return {"kind":"stored",...} on a matching input_hash, else {"kind":"key_conflict"}.
$$;

create function agent_turns.insert_agent_turn(
	p_owner_id uuid, p_task_id uuid, p_step_ordinal int, p_blocks jsonb, p_block_schema_version int)
returns uuid
language sql security definer set search_path = '' as $$
	insert into agent_turns.turns (owner_id, role, blocks, block_schema_version, task_id, step_ordinal)
	values (p_owner_id, 'agent', p_blocks, p_block_schema_version, p_task_id, p_step_ordinal)
	returning id;
$$;

-- supabase/schemas/agent-turns/grants.sql
grant agent_turns_reader, agent_turns_writer to postgres;
revoke all on all tables in schema agent_turns from anon, authenticated;
grant usage on schema agent_turns to agent_turns_reader, agent_turns_writer, service_role;
grant usage on schema agent_turns_api to authenticated, service_role;
grant usage on schema auth to agent_turns_reader;
grant execute on function auth.uid() to agent_turns_reader;
grant select on agent_turns.turns to agent_turns_reader;
grant insert on agent_turns.turns to agent_turns_writer;
grant select, insert on agent_turns.turns to service_role;
grant select, insert, update on agent_turns.creation_windows to service_role;

alter function agent_turns_api.list_turns(jsonb, int) owner to agent_turns_reader;
revoke execute on function agent_turns_api.list_turns(jsonb, int) from public, anon;
grant execute on function agent_turns_api.list_turns(jsonb, int) to authenticated;

revoke execute on function agent_turns_api.create_turn(uuid, text, text, jsonb, int) from public, anon, authenticated;
grant execute on function agent_turns_api.create_turn(uuid, text, text, jsonb, int) to service_role;

alter function agent_turns.insert_agent_turn(uuid, uuid, int, jsonb, int) owner to agent_turns_writer;
revoke execute on function agent_turns.insert_agent_turn(uuid, uuid, int, jsonb, int) from public, anon, authenticated, service_role;
grant execute on function agent_turns.insert_agent_turn(uuid, uuid, int, jsonb, int) to agent_tasks_committer;
grant usage on schema agent_turns to agent_tasks_committer;
```

### Agent Tasks storage

| Table | Columns and constraints |
|---|---|
| `agent_tasks.receipts` | `owner_id`, `request_key`, `input_hash`, `result jsonb`, `created_at`. Primary key `(owner_id, request_key)`. |
| `agent_tasks.tasks` | `id`, `owner_id`, `environment_id`, `instructions` (at most 8 KB), `retry_of_task_id`, `policy jsonb`, `deadline`, `version`, `state`, `failure jsonb`, `active_attempt_id`, `committed_steps`, `final_turn_id`, `created_at`, `ended_at`. Check: `state` is one of the five states. Check: terminal states have `ended_at` and no `active_attempt_id`. |
| `agent_tasks.attempts` | `id`, `task_id`, `ordinal`, `execution_id` (unique), `token`, `lease_expires_at` (null until acknowledged), `acknowledged_at`, `ended_at`, `ended_reason`, `created_at`. Unique `(task_id, ordinal)`. |
| `agent_tasks.steps` | `task_id`, `ordinal`, `opened_at`, `turn_id`, `committed_at`. Primary key `(task_id, ordinal)`. |
| `agent_tasks.sends` | `task_id`, `step_ordinal`, `ordinal`, `attempt_id`, `prompt_digest`, `builder_version`, `deadline`, `observed_at`, `outcome_kind`, `outcome jsonb` (holds the response blocks, already within the turn caps), `input_tokens`, `output_tokens`. Primary key `(task_id, step_ordinal, ordinal)`. Partial unique index on `(task_id, step_ordinal)` where `outcome_kind = 'response'`. |
| `agent_tasks.slots` | `scope` (`user` or `environment`), `scope_id`, `active`. Primary key `(scope, scope_id)`. Check: `active >= 0`. |
| `agent_tasks.submission_windows` | `owner_id`, `window_start`, `count`. Primary key `(owner_id, window_start)`. |

Indexes: `attempts (acknowledged_at) where ended_at is null`, `attempts (lease_expires_at) where ended_at is null and acknowledged_at is not null`, and `tasks (owner_id, created_at desc, id desc)`.

Routines in `agent_tasks_api`:

| Routine | Security | Called by |
|---|---|---|
| `submit_task`, `cancel_task` | Invoker, `service_role` | Server functions through `tasks` |
| `load_snapshot`, `begin_send`, `record_observation`, `extend_lease`, `fail_task`, `acknowledge` | Invoker, `service_role` | The runner |
| `commit_step` | Definer, owner `agent_tasks_committer` | The runner |
| `claim_unacknowledged`, `expire_leases` | Invoker, `service_role` | The reconciler |
| `list_tasks`, `read_task` | Definer, owner `agent_tasks_reader` | Server functions, with the caller's JWT |

Lock order in every routine: slot rows (user, then environment), then the task, then the attempt, then the step, then sends. A routine that starts from a task ID first reads the task's owner and environment without a lock, which is safe because neither ever changes. It then takes the locks in order. No routine holds a lock while a provider call runs, because every provider call happens between transactions.

### Account storage

`account.profiles` holds `user_id` (primary key, references `auth.users` on delete cascade), `display_name` (1 to 80 characters), and `updated_at`. `account_api.get_profile()` is a definer read routine owned by `account_reader`. `account_api.upsert_profile(p_user_id, p_display_name)` is an invoker mutation routine.

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

`src/server.ts` is the Worker entry. It is the only module that imports feature runtime or workflow code.

- It exports the TanStack Start request handler as `fetch`.
- It exports `scheduled`, which builds the reconciler and runs one pass.
- It exports the `AgentTasksWorkflow` class.
- It builds `startExecution(executionId)` from the `AGENT_TASKS_WORKFLOW` binding as `env.AGENT_TASKS_WORKFLOW.create({ id: executionId, params: { executionId } })`, and injects it into the task API and the reconciler.

It contains no rules. The exact TanStack Start server-entry API follows the pinned TanStack Start version.

### `wrangler.jsonc`

- `main` is `src/server.ts`, with the `nodejs_compat` compatibility flag.
- `workflows`: one entry named `agent-tasks`, binding `AGENT_TASKS_WORKFLOW`, class `AgentTasksWorkflow`.
- `triggers.crons`: `["* * * * *"]`.
- `vars`: `ENVIRONMENT_ID`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AI_GATEWAY_URL`, `AI_MODEL`.
- Secrets, set with `wrangler secret put`: `SUPABASE_SECRET_KEY` and `AI_GATEWAY_KEY`.

### Environment parsing

`platform/env.server.ts` parses the Worker `env` with one zod schema the first time a request, scheduled event, or Workflow step needs it. A missing or malformed variable fails with an error naming the variable. Code outside `platform/env.server.ts` never reads `env` fields directly, except `src/server.ts` reading the Workflow binding.

## Client state and UI

### Server state

TanStack Query is the client replica of server state. Never add another global state manager.

- `*.queries.ts` owns query keys and options. Keys start with the feature name and include the user ID for private data.
- The task detail query polls every 2 seconds while the task is `queued` or `running` and stops at a terminal state. The task list polls every 10 seconds while any listed task is nonterminal.
- `*.commands.ts` owns mutations. Each command creates the request key once, retries transport errors with the same key, and invalidates the affected queries on success.
- SSR creates one QueryClient per request.
- Ephemeral UI state stays in React components.

### Routes and shell

| Route | Content |
|---|---|
| `/login`, `/signup`, `/reset-password`, `/update-password` | Auth forms |
| `/` (authenticated) | Redirects to `/tasks` |
| `/tasks` | Task form and task list |
| `/tasks/$taskId` | Task status, activity, transcript, cancel and retry buttons, failure explanation |
| `/turns` | Turn composer and turn list |
| `/account` | Profile form |

`layouts/app-shell.tsx` provides responsive navigation (Tasks, Turns, Account) and an account menu with logout. Every data view renders consistent loading, empty, error, and success states from `components/patterns/`. Feature-specific UI stays in its feature. Generic primitives live in `components/ui/`. Domain-agnostic compositions live in `components/patterns/`.

## Observability

`platform/logger.server.ts` writes structured JSON logs to the Workers runtime log.

- Every request gets a correlation ID. Safe errors return it to the client.
- Task logs include task, attempt, execution, step, and send IDs, the classified outcome, and timings.
- The reconciler logs oldest-pending age, expired leases handled, and failures.
- Track lost-send count, retryable-failure count, stale-write rejections, discarded late responses, execution-defect failures, and gateway refusals as log fields that the Workers dashboard can filter.
- Never log credentials, cookies, prompts, or completions. Prompts and completions are visible in Langfuse under its own access control.

## Static enforcement

`architecture/policy.ts` is the single machine-readable source for ownership roles, public entrypoints, the dependency table, the composition root, tool purity, verification profiles, and fixture expectations. Tools derive their configuration from it:

- `dependency-cruiser.config.cjs` imports the policy and enforces [Dependency rules](#dependency-rules), feature direction, and cycles.
- `oxlint.config.ts` enables Oxlint correctness, TypeScript, React, and import rules, the vendored anti-slop rules, the provider-SDK ban outside `platform/model.server.ts`, and the I/O-global ban inside `*.tools.ts`. Adapt an anti-slop rule only with a one-line reason in the config.
- `tools/verify.ts` reads the verification profiles.
- A check script compares the navigation block in `AGENTS.md` with the policy keys. CI rejects drift.

`tools/check-client-bundle.ts` builds the pinned TanStack application and inspects every emitted browser chunk, including lazy chunks. It fails on server-only module paths, private environment names, database or provider clients, and a planted secret sentinel string.

Architecture fixtures under `tests/architecture/` prove each rule. Every negative fixture declares the diagnostic and path it expects. A checker crash, missing dependency, or syntax error fails the test run and never counts as a rejection. Each boundary has a positive fixture beside its negative ones, so an always-failing checker cannot pass.

| Fixture | Expected result |
|---|---|
| UI → command → server function → repository | Passes. The bundle check finds no server code or sentinel. |
| UI imports a repository | Ownership diagnostic naming the edge |
| UI reaches server code through a helper or re-export | Client-reachability diagnostic naming the path |
| A `*.functions.ts` module exports a client-run helper that uses server code | Client-reachability diagnostic |
| `platform/` imports a feature Workflow class | Composition-root diagnostic |
| `agent-turns` imports `agent-tasks` | Dependency-direction diagnostic |
| A feature imports a provider SDK | Model-adapter diagnostic |
| A tool imports a server module or calls `fetch` | Tool-purity diagnostic |
| Cross-feature private import, feature cycle, or runtime import in a schema | The matching ownership, cycle, or purity diagnostic |

## Testing

### Principles

- Prefer one meaningful E2E journey per feature over many low-value unit tests.
- Test behavior a caller can observe. Never assert private helper choices, internal call order, or rendering of static markup.
- Recorded requests to the gateway double, including the absence of a second request, are observable behavior.
- No coverage percentage or test-count target.
- Tests fail when behavior breaks and survive refactors that keep the contract.

### Test locations

| Kind | Location | Runner |
|---|---|---|
| E2E journey | `src/features/<feature>/<feature>.e2e.spec.ts` | Playwright against the local stack |
| Feature integration | `src/features/<feature>/<feature>.integration.test.ts` | Vitest against the local Supabase database |
| Pure logic | `src/features/<feature>/<feature>.model.test.ts` | Vitest |
| Database security | `supabase/tests/` | SQL tests through the Supabase CLI |
| Architecture | `tests/architecture/` | Vitest driving the checkers |

`tests/fixtures/` holds the deterministic gateway double. It serves the OpenAI-compatible endpoint, returns scripted responses for every row of the classification table, can delay a response past its deadline, and records every request. Database failpoints are test-only hooks in the integration harness that inject a transient error or pause a transaction.

### E2E journeys

| Feature | Journey |
|---|---|
| Auth | Sign up, log in, open a protected page, log out, confirm the page redirects |
| Account | Update the display name, reload, confirm it persisted |
| Agent Turns | Create a text turn in the composer, reload, confirm it persisted. Seed one turn holding every block kind through `createTurn` and one row with an unknown kind through SQL, then confirm each renders, including the unsupported fallback. |
| Agent Tasks | Submit a task that calls `calculate`, watch it reach `completed`, reload, and confirm the transcript shows the tool call, the tool result, and the final turn. Submit a second task and cancel it. |

CI runs the journeys with the gateway double. A separate live smoke test, run by `pnpm verify:deployed`, submits a real task through the gateway, confirms its trace reached Langfuse, and confirms a per-user budget refusal is classified as `gateway_refused: 'budget'`.

### Required proofs

Each row is at least one integration or database test.

| Scenario | Observable assertion |
|---|---|
| Same submission or turn retried; changed input under the same key | One task or turn, or `key_conflict` |
| Two identical submissions or turn creates race on one key | One row; both callers get the same receipt |
| A user exceeds the submission or turn-creation window | Refusal with no row written |
| Two submissions contend for the last execution slot | At most one admitted; slot counts match active attempts |
| Dispatch nudge fails, and Workflow creation fails for several reconciler runs | Submission still accepted; no attempt consumed; execution starts once creation succeeds |
| Workflow instance errors or disappears, including after retention | Lease expires; a successor with a new execution ID continues from committed steps |
| Transient database error inside `advance` | The step retry re-enters and the task proceeds without a new attempt |
| Transaction 2 fails after a response arrives, past its retries | The step sends once more; the send count shows it |
| Crash after a response is recorded, before `commit_step` | The successor commits the stored response with no new send |
| Two `advance` calls of one attempt run concurrently | One fenced write commits; the other re-reads; at most one send in flight |
| Successor finds its predecessor's send in flight | It waits until that deadline, then sends |
| A response arrives after its deadline, or after a newer send exists | Discarded; at most one response accepted per step |
| A deploy shortens the timing constants mid-send | The lease still outlasts the in-flight send |
| Retryable outcome, then wake after backoff | Sends again after the backoff and not before |
| Each row of the gateway classification table | The loop takes the specified behavior; sends stop at the send limit |
| A runner defect throws on every attempt | Task fails once with `execution`; no other attempts consumed |
| Completion, failure, and cancellation in every commit order | The first terminal outcome persists; the slot is released once |
| Fenced or canceled runner reaches `commit_step` | No turn written; no orphan turn in the transcript |
| Final step commits | Task completes with `finalTurn` in the same transaction; no extra turn |
| Task deadline passes during a backoff or an in-flight send | Task fails with `limit: 'duration'` |
| Steps, tool calls, sends, attempts, and prompt size each exhausted | Each converges to its specified failure |
| Unknown tool, unparsable or invalid arguments, throwing tool, oversized tool output | Each becomes an `isError` tool result |
| Malformed request, environment, Workflow payload, row, or gateway body; oversized input | Rejected at the adapter with a classified diagnostic |
| Stored block of an unknown kind or version | Renders the fallback and becomes a placeholder in prompts |
| `unsupported` or unpaired `tool_result` submitted for writing | The write schema rejects it |
| Two users list, read, and mutate each other's data | Denied by authorization and RLS |
| `service_role` calls `insert_agent_turn` directly | The database rejects it; the catalog grant test passes |
| Timing constants | The timing unit test asserts every inequality |

## Commands, validation, and CI

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app locally against the local Supabase stack and the gateway double |
| `pnpm lint` | Oxlint with anti-slop and the policy-derived rules |
| `pnpm check:boundaries` | dependency-cruiser and the `AGENTS.md` drift check |
| `pnpm check:fast` | `lint` and `check:boundaries` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit, integration, and architecture tests |
| `pnpm test:db` | SQL tests in `supabase/tests/` |
| `pnpm test:e2e` | Playwright journeys |
| `pnpm check:bundle` | Production build and client-bundle inspection |
| `pnpm check` | Everything above against a freshly reset local database. CI runs this. |
| `pnpm verify --base <commit>` | The completion profile for the changed files, staged and untracked included, plus their dependents |
| `pnpm verify:deployed --env <id>` | Live checks against a selected deployed environment |
| `pnpm db:reset`, `pnpm db:diff <name>`, `pnpm db:types` | Local database reset, migration generation, type generation |

`pnpm verify` selects checks from the verification profiles in `architecture/policy.ts`. Unknown impact selects the full `pnpm check`. A persistence change adds migration replay, type drift, and `test:db`. A documentation-only change runs link checks. A missing prerequisite or an empty test selection for changed behavior reports `incomplete`, never `pass`.

### When checks run

| Trigger | Checks | Policy |
|---|---|---|
| Each file edit | None | No interruption |
| Optional `PostToolUse` hook in `tools/hooks/` | Targeted fast checks on the edited file | Feedback only. Never required for correctness. |
| Before an agent reports completion | `pnpm verify --base <branch base>` | The agent fixes failures, with bounded repair attempts |
| Pull request | `pnpm check` in CI | Mandatory, blocking |
| Merge to `main` | `deploy.yml` | Migrate, deploy, `verify:deployed` |

If a check cannot run, report it as not run. Never claim success without it.

### CI

- `ci.yml` installs the pinned pnpm and dependencies, starts the local Supabase stack, and runs `pnpm check`. It runs on every pull request and blocks merging on failure.
- `deploy.yml` runs on `main` behind a GitHub environment with required approval for production. It applies migrations with `supabase db push`, deploys with `wrangler deploy`, and runs `pnpm verify:deployed`. A deployment with unrun or failing verification is reported as `unverified`.

## Environments and deployment

### Environment manifest

Each environment has a nonsecret manifest committed as `environments/<id>.json`, parsed by `tools/verify.ts`. It holds the environment ID, Supabase project reference, Worker name, AI gateway URL, model name, and the names of the secrets the environment needs. Identity is explicit and survives a repository rename. The manifest never creates resources.

### Deployment

1. Apply migrations from the ledger with the pinned Supabase CLI.
2. Deploy the Worker with the pinned Wrangler.
3. Run `pnpm verify:deployed --env <id>`.

After a lost response at any step, inspect the migration history or the deployed version before retrying. Supply secrets through Wrangler and Supabase secret management. Never write a secret into code, logs, commits, manifests, or agent output.

### Isolation

- Development, CI, and production use separate Supabase projects or branches, separate Worker names, and separate gateway keys.
- A test run owns its Auth users, Storage prefixes, Workflow instance IDs, and data.
- Ordinary development needs no local containers. Container-backed local Supabase runs in CI and where Docker exists.
- Never reset a production database or another developer's database. If no safe target exists, the check reports the missing capability and stops.

### Free-tier constraints

- Target Cloudflare Free and Supabase Free. Never require a paid plan silently.
- Avoid always-on compute. Keep Workflow steps small and I/O-bound.
- Supabase Free projects pause after inactivity. `verify:deployed` reports a paused project as a failed prerequisite.
- LLM spend and production SMTP are external costs. The README of the generated app lists them.
- General-purpose subprocesses and code-execution agents are outside the Cloudflare target.

## Agent guidance files

### `AGENTS.md`

`AGENTS.md` stays short. Working reference features teach patterns, and checks enforce rules. Its navigation block is checked against `architecture/policy.ts`.

```markdown
## Architecture

- ARCHITECTURE.md is the specification. Follow it.
- Organize by feature. Copy the closest reference: `agent-turns` for synchronous work, `agent-tasks` for asynchronous work.
- UI reads through queries and writes through commands.
- Other features are reached only through their `*.schema.ts` and `*.api.server.ts`.
- Database definitions live in `supabase/schemas/<owner>/`. Copy the agent-turns access pattern.
- Keep feature tests, including E2E, in the feature directory.
- Prefer meaningful E2E and integration tests over trivial unit tests.
- Run `pnpm verify --base <branch base>` before reporting completion and fix every failure.
```

### Agent workflow

1. Find the owning feature and read its closest working implementation.
2. Find the responsible files, database definitions, and tests.
3. Reuse existing contracts, components, and platform modules.
4. Change code within the dependency rules.
5. Add or update a meaningful test for the changed behavior.
6. Run `pnpm verify` and fix every failure.
7. Exercise the affected user journey.
8. Report anything unresolved instead of claiming completion.

When agents repeat a mistake, first improve the reference implementation, then add a mechanical check, and only then add a line to `AGENTS.md`.

### Bundled skills

`.agents/skills/` holds version-pinned copies of `systematic-debugging` and `verification-before-completion` (from Superpowers) and `react-best-practices` (from Vercel). It also holds a repository-local `touch-grass` verification skill. That skill checks repository access, runs `pnpm install --frozen-lockfile`, the build, and `pnpm check`, and reports each result separately. It is idempotent and never provisions anything.

## Deferred extensions

Each extension below was designed and kept out of the MVP. When its trigger appears, build it as described instead of working around the MVP's limits.

| Extension | Trigger | What it adds |
|---|---|---|
| Non-pure tools | A tool needs network, storage, or any external side effect | A journaled effect per tool call with a declared class: `idempotent` (with the provider's replay window and a key derived from the effect ID) or `irreversible`. Single-sender authorization per effect. An `external_outcome_unknown` failure that blocks unsafe retry. An operator resolution routine. |
| Pruning and tombstones | Task data pressures storage | A scheduled routine that deletes send outcomes and steps after a documented lifetime and keeps receipts as tombstones, so replays still return their original answer |
| Environment reconciliation | More than one person or runner deploys to shared environments | `env:reconcile` with an operation journal keyed by environment, operation, and desired digest; database-scoped migration locks; exclusive leases on shared nonproduction targets with quiescence checks |
| Waiting queue | Users should wait for capacity instead of being refused | A separately bounded queue with explicit admission semantics |
| In-application accounting | The product must bill or meter inside the app | A ledger that reads gateway usage. The gateway stays the enforcement point. |
| Real-time updates | Polling latency or cost becomes a problem | Supabase Realtime subscriptions in `*.queries.ts`, replacing polling for task detail |

## Build order

Build in these units. Each unit's checks pass before the next unit depends on it.

1. **Foundations.** Project setup, pinned tooling, `architecture/policy.ts`, Oxlint and anti-slop, dependency-cruiser, the bundle check, the positive and negative architecture fixtures, and an empty app that builds. Gate: every fixture yields its expected result.
2. **Auth, account, and database pattern.** Supabase config, auth flows, the account feature with its schemas, roles, routines, and grants. Gate: auth and account E2E, and the two-user access tests.
3. **Agent Turns.** Turn schemas and SQL, block parsing, size caps, rate window, UI, and the `insert_agent_turn` grant boundary. Gate: turns E2E, same-key race, and the catalog grant test.
4. **Agent Tasks persistence and model.** Task tables and routines, fencing, lock order, slots, submission, `decide`, `buildPrompt`, the timing test, the classifier with gateway fixtures, and the `calculate` tool. Gate: every required proof that does not need a Workflow.
5. **Durable execution.** The Workflow adapter, the runner, the reconciler, `src/server.ts` wiring, and `wrangler.jsonc`. Gate: dispatch and recovery proofs and the tasks E2E.
6. **Shell, CI, and deployment.** App shell polish, `ci.yml`, `deploy.yml`, manifests, `verify:deployed`, `AGENTS.md`, and bundled skills. Gate: a deployed environment passes `verify:deployed`, including the live gateway smoke test.

## Acceptance criteria

The template is complete when all of these hold:

- Authentication and account management work end to end.
- Protected routes, server authorization, and RLS are verified, including two-user denial tests.
- Agent Turns create, persist, and exhaustively render every block kind, including the unsupported fallback.
- Agent Tasks run through Cloudflare Workflows, call a tool, persist a transcript, and complete, cancel, and fail as specified.
- Every row in [Required proofs](#required-proofs) has a passing test.
- Every architecture fixture yields its expected result, and the bundle check finds no server code in client chunks.
- Declarative SQL is grouped by owner under `supabase/schemas/`, and migrations replay from Git into an empty database.
- `pnpm check` passes in CI.
- A deployed environment passes `pnpm verify:deployed`.
- Optional hooks work where supported and nothing depends on them.
- The generated app's README lists free-tier limits and external costs.

## Open feasibility checks

These questions need evidence from the pinned versions before their unit's gate. If a check fails, change the implementation and record the change in this document. Never weaken acceptance, cancellation, fencing, or ownership rules to fit a limit.

- Does the pinned TanStack Start build expose a client chunk graph the bundle check can trust, and what is its Cloudflare server-entry API?
- Does the chosen gateway enforce per-key and per-user budgets, return error bodies that separate budget, rate-limit, and policy refusals, and forward traces with task, step, and send metadata to Langfuse? Record its fixtures for `agent-tasks.model.test.ts`.
- Where does the gateway run, given that LiteLLM does not run on Workers, and does that host fit the MVP's cost target?
- Do Cloudflare's step `timeout` and `retries` settings accept the defaults for `T` and `STEP_RETRIES`? What is the current `WORKFLOW_STEP_LIMIT`? How late do Workflow wakes run in practice compared with `A`?
- Does the Workers Free CPU limit hold for parsing a 256 KB response and running `buildPrompt` on a full history?
- Does the hosted Supabase `postgres` role allow creating the `nologin` feature roles, granting them to `postgres`, and transferring function ownership as written?
- Do the free plans handle the CPU, cron schedule, storage, step counts, and CI workload for the reference journeys? Record run counts, spread, and the limiting resource for every measurement.
