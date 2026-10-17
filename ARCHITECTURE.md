# Codebase Architecture & Scaffolding

**Stack:** TanStack Start, React, TypeScript, TanStack Query, Supabase (PostgreSQL, Auth, Storage), Cloudflare Workers and Workflows.

**Quality tooling:** Oxlint, vendored [anti-slop](https://github.com/dmmulroy/anti-slop), dependency-cruiser, TypeScript, Vitest, Playwright.

**Goal:** A production-oriented, batteries-included scaffold for AI-agent applications, deployable on Cloudflare Free + Supabase Free, optimized for autonomous development by coding agents.

**Architectural principle:** Organize by feature, give every responsibility one predictable owner, enforce runtime boundaries mechanically, and make correct architectural patterns easy for agents to imitate.

## 1. Repository structure

Bootstrap two permanent reference features:

- **Agent Turns:** Canonical synchronous vertical slice.
- **Async Agent Tasks:** Canonical durable background-execution vertical slice.

Ship authentication, account management, shared UI, observability, and deployment infrastructure as working foundations.

```text
src/
├── routes/                             # Thin TanStack routes
│   ├── __root.tsx
│   ├── login.tsx
│   ├── signup.tsx
│   ├── reset-password.tsx
│   └── _authenticated.tsx              # Protected layout
│
├── features/
│   ├── auth/
│   │   ├── ui/
│   │   ├── auth.commands.ts
│   │   ├── auth.functions.ts
│   │   ├── auth.schema.ts
│   │   └── auth.e2e.spec.ts
│   │
│   ├── account/
│   │   ├── ui/
│   │   ├── account.queries.ts
│   │   ├── account.commands.ts
│   │   ├── account.functions.ts
│   │   ├── account.schema.ts
│   │   ├── account.repo.server.ts
│   │   └── account.e2e.spec.ts
│   │
│   ├── agent-turns/                    # Sync reference
│   │   ├── ui/
│   │   │   ├── turn-page.tsx
│   │   │   ├── agent-turn.tsx
│   │   │   └── turn-blocks/
│   │   │       ├── text-block.tsx
│   │   │       └── tool-call-block.tsx
│   │   ├── agent-turns.queries.ts
│   │   ├── agent-turns.commands.ts
│   │   ├── agent-turns.functions.ts
│   │   ├── agent-turns.schema.ts
│   │   ├── agent-turns.repo.server.ts
│   │   └── agent-turns.e2e.spec.ts
│   │
│   └── agent-tasks/                    # Async reference
│       ├── ui/
│       │   ├── task-form.tsx
│       │   └── task-status.tsx
│       ├── agent-tasks.queries.ts
│       ├── agent-tasks.commands.ts
│       ├── agent-tasks.functions.ts
│       ├── agent-tasks.schema.ts
│       ├── agent-tasks.service.server.ts
│       ├── agent-tasks.repo.server.ts
│       ├── agent-tasks.workflow.server.ts
│       └── agent-tasks.e2e.spec.ts
│
├── components/
│   ├── ui/                             # Design system primitives
│   └── patterns/                       # Generic UI compositions
├── layouts/                            # Application shell
├── domain/                             # Shared business capabilities
├── platform/
│   ├── auth.server.ts
│   ├── auth-middleware.server.ts
│   ├── supabase.server.ts
│   ├── database.types.ts
│   ├── workflows.server.ts
│   ├── llm.server.ts
│   ├── logger.server.ts
│   └── env.server.ts
└── server.ts                           # Cloudflare entrypoint

supabase/
├── config.toml
├── schemas/                            # Declarative DB definitions
│   ├── account/
│   │   ├── tables.sql
│   │   └── policies.sql
│   ├── agent-turns/
│   │   ├── tables.sql
│   │   └── policies.sql
│   └── agent-tasks/
│       ├── tables.sql
│       ├── policies.sql
│       └── indexes.sql
├── migrations/                         # Ordered migration ledger
└── tests/                              # Database-wide security tests

tests/
├── fixtures/                           # Shared test infrastructure
└── architecture/                       # Boundary regression tests

tools/
├── oxlint/anti-slop/                  # Vendored lint rules
└── hooks/                             # Optional agent hooks

.github/workflows/                     # CI/CD
oxlint.config.ts
dependency-cruiser.config.cjs
playwright.config.ts
wrangler.jsonc
AGENTS.md
```

**Rules:**
- Files and layers are optional. Create only what a feature needs.
- Feature-specific implementation and tests, including E2E, stay inside their owning feature directory.
- Shared business capabilities belong in `domain/`, created only when justified.
- Declarative database definitions live centrally under `supabase/schemas/`, grouped by owning feature or domain.
- Database migrations remain in one globally ordered ledger.
- Shared test infrastructure and global architecture tests live under `tests/`.
- Use `.server.ts` for server-only implementations.
- Avoid placeholder files, unnecessary wrappers, and speculative abstractions.

## 2. Ownership and responsibility boundaries

Every kind of logic must have one predictable owner.

| Component | Owns | Must not own |
|---|---|---|
| `routes/` | URLs, parameters, loaders, navigation | Business logic, persistence |
| `ui/` | Rendering, interactions, ephemeral state | Persistence, transport orchestration |
| `*.queries.ts` | Reads, query keys, caching, subscriptions | Mutations, domain rules |
| `*.commands.ts` | Mutations, optimistic updates, reconciliation | Authoritative business behavior |
| `*.functions.ts` | Typed server RPC, validation, authentication, authorization | Substantial domain logic |
| `*.schema.ts` | Application contracts, types, validation | Database DDL, runtime implementations |
| `*.service.server.ts` | Business rules, agent behavior, orchestration | React, transport, database implementation |
| `*.repo.server.ts` | Database access and atomic persistence | Business workflows |
| `*.workflow.server.ts` | Durable execution, checkpoints, retries | Duplicated domain logic |
| `*.api.server.ts` | Optional cross-feature public interface | Duplicated implementation |
| `supabase/schemas/` | Tables, constraints, indexes, RLS | Application behavior |
| `platform/` | Generic infrastructure | Feature-specific business logic |
| `domain/` | Shared business capabilities | Generic infrastructure |

### Client state and commands

TanStack Query provides the client-side replica of authoritative server state.

- `*.queries.ts` owns query keys, fetching, caching, and subscriptions.
- `*.commands.ts` owns client mutations, optimistic updates, rollbacks, and cache invalidation.
- UI components consume queries and invoke commands, rather than orchestrating persistence directly.
- Ephemeral UI state remains local to React.
- The server remains authoritative for persistent data.

Do not introduce another global state-management layer without demonstrated need.

### Typed runtime contracts

- `*.schema.ts` defines client-safe request/response validation and serializable types.
- `*.functions.ts` exposes typed TanStack server functions.
- Server functions validate input, enforce authorization, and delegate.
- Browser code may import server-function wrappers, never server-only implementations.
- Shared schemas must not depend on React, database clients, or Cloudflare runtime APIs.
- Do not introduce a redundant custom RPC framework.

### Cross-feature APIs

Each feature owns its internal behavior.

- Features must not import another feature's private services or repositories.
- Introduce an optional `*.api.server.ts` when another feature needs server-side behavior.
- Public APIs delegate to existing services or repositories.
- Independently shared business capabilities belong in `domain/<capability>/`.
- Do not create public APIs or shared domains speculatively.

## 3. Canonical vertical slices

### A. Agent Turns: Synchronous reference

A reusable interface for creating, persisting, and displaying agent turns, including text, tool calls, tool results, and structured outputs.

**Request lifecycle:**

```text
Route
  ↓
Feature UI
  ↓
Queries (reads) / Commands (mutations)
  ↓
Typed Server Function
  ↓
Service (only when needed)
  ↓
Repository
  ↓
Supabase PostgreSQL

Result → Query cache → React render
```

Requirements:

- Real create/read operations with persistence.
- Typed discriminated content blocks with exhaustive rendering.
- Separate presentation components for text and tool calls.
- Incremental updates through client-side cache reconciliation.
- Rendering independent of the agent execution engine.
- One colocated E2E test verifying creation, persistence, reload, and rendering.

Simple CRUD may call repositories directly from server-function handlers. Do not create a service merely to forward a method call.

### B. Async Agent Tasks: Asynchronous reference

A working feature where users submit instructions for an agent to execute asynchronously and inspect its progress and results.

**Request lifecycle:**

```text
Task UI
  ↓
Client Command
  ↓
Typed Server Function
  ↓
Task Service
  ├── Repository → Persist queued task
  └── Platform → Start Workflow
                    ↓
             Workflow Adapter
                    ↓
               Task Service
                    ↓
                Repository
                    ↓
                  Supabase

Task Queries → Status UI / Results
```

Requirements:

- Execute a real configurable LLM task.
- Support `queued`, `running`, `completed`, `failed`, and `canceled` states.
- Persist progress events, execution history, results, and failures.
- Support retries, cooperative cancellation, and idempotency.
- Bound agent steps, duration, tokens, estimated cost, and concurrency.
- Use TanStack Query polling initially. Real-time subscriptions are optional.
- Operate independently of conversations, with optional turn associations.
- Include one colocated E2E test covering submission, execution, progress, and persisted output.

### Workflow responsibility boundaries

Separate execution machinery from business behavior.

**Workflow adapter:**
- Cloudflare durable steps, retries, waits, and checkpointing.
- Execution recovery and cancellation coordination.
- Splitting long-running execution into appropriately sized durable steps.

**Task service:**
- Agent behavior, model/tool invocation, and domain decisions.
- Execution budgets and business rules.
- Valid task transitions and application-level idempotency.

**Repository:**
- Atomic state transitions and conditional writes.
- Execution events, results, and idempotency records.

**Rules:**

- Services must not import Cloudflare Workflow APIs or feature Workflow adapters.
- Workflow adapters invoke shared services, never the reverse.
- Services may start workflows through `platform/workflows.server.ts`, which exposes a generic execution interface.
- `platform/` must not import feature-specific Workflow implementations.
- `src/server.ts` registers/exports Workflow classes and the TanStack handler, without business logic.
- Never execute a multistep agent run inside a single uncheckpointed operation.
- Retryable external side effects require idempotency protection.
- Cancellation and retries must not overwrite terminal task states.
- Task creation and Workflow initiation must tolerate partial failures through reconciliation and idempotent submission.

Supabase owns durable application state. Cloudflare Workflow checkpoints provide execution recovery.

## 4. Authentication and application foundations

Ship working implementations rather than placeholder integrations.

### Authentication and authorization

- Supabase Auth: Sign-up, login, logout, password recovery, persistent sessions.
- Cookie-based SSR authentication.
- Protected application routes.
- Reusable server-side authentication middleware.
- Authorization for every private server operation.
- User-owned data protected by PostgreSQL RLS.
- Basic account settings and profile management.
- Configurable SMTP for public email authentication.

`features/auth/` owns user-facing flows. `features/account/` owns profiles. `platform/` owns authentication infrastructure.

Route protection does not replace server-side authorization.

Privileged Workflow/database operations must explicitly enforce ownership and must not assume a browser session exists.

### Shared UI

Provide a minimal responsive application shell, navigation, account menu, and consistent loading, empty, error, and success states.

- Feature-specific UI stays feature-local.
- Generic primitives belong in `components/ui/`.
- Domain-agnostic compositions belong in `components/patterns/`.
- Use existing components and design tokens.
- Avoid premature UI abstractions.

### Observability

- Structured request/error logging in `platform/`.
- Persistent agent execution events in `agent-tasks`.
- Correlation via request IDs and task IDs.
- Model identifiers, token usage, timings, estimated costs, and errors where available.
- Cloudflare runtime and Workflow diagnostics.

Never log credentials or sensitive payloads unnecessarily.

## 5. Database architecture

**Principle: Centralized database definitions, organized by business ownership, with one globally ordered migration ledger.**

```text
supabase/
├── config.toml
├── schemas/
│   ├── account/
│   │   ├── tables.sql
│   │   └── policies.sql
│   ├── agent-turns/
│   │   ├── tables.sql
│   │   └── policies.sql
│   ├── agent-tasks/
│   │   ├── tables.sql
│   │   ├── policies.sql
│   │   └── indexes.sql
│   └── documents/                    # Example shared domain
│       ├── tables.sql
│       └── policies.sql
├── migrations/
└── tests/
```

The `documents/` directory is illustrative, not a mandatory scaffold feature.

### Database ownership

Every table, view, and database policy has one authoritative owner.

- **Feature-owned objects:** `supabase/schemas/<feature>/`.
- **Shared business objects:** `supabase/schemas/<domain>/`, corresponding to `src/domain/<domain>/`.
- **Provider-managed objects:** Remain provider-owned. Application customizations have an explicit owner.
- **Migration history:** `supabase/migrations/`, globally ordered.
- **Application contracts:** `src/features/<feature>/*.schema.ts`.
- **Generated DB types:** `src/platform/database.types.ts`.

Database ownership is logical; separate PostgreSQL namespaces are not required.

A table used by multiple features doesn't automatically become a shared domain. Keep it with its original owner unless it represents an independently reusable business capability.

Other features consume the owning domain's public API for business operations. Foreign keys and explicitly owned cross-domain read queries are permitted where appropriate.

### Application schemas versus database schemas

These are different, complementary contracts:

- **TypeScript/Zod schemas:** Validate application requests, responses, and events.
- **SQL schemas:** Define tables, constraints, indexes, relations, and RLS.
- **Generated database types:** Represent the actual database structure in TypeScript.

Do not duplicate authoritative SQL definitions or manually recreate generated database types.

### Schema change workflow

1. Identify the feature/domain owning the database object.
2. Edit its declarative SQL under `supabase/schemas/<owner>/`.
3. Generate a migration using the Supabase CLI and `pg-delta`.
4. Review the migration, especially destructive operations, renames, and data transformations.
5. Apply and verify it in an isolated environment.
6. Regenerate database types.
7. Run the owning feature's E2E/integration tests and relevant RLS checks.

Use a pinned compatible Supabase CLI. The default declarative source is `supabase/schemas/`; no custom SQL collection script is required.

The `pg-delta` engine resolves SQL statement dependencies independently of directory naming. For unsupported transformations, use reviewed hand-authored migrations while keeping declarative definitions synchronized.

Do not use production databases for unreviewed schema experiments.

## 6. Dependency and runtime enforcement

Architectural rules must be machine-enforceable, not merely documented.

### Dependency policy

| Source | Allowed | Forbidden |
|---|---|---|
| Routes | Feature views, queries, schemas, server functions | Repositories, services, Workflow adapters |
| UI | Components, queries, commands, schemas | Repositories, services, Workflows |
| Queries / Commands | Server functions, schemas, client utilities | Repositories, services, Workflows |
| Server functions | Schemas, auth, server services/repositories | UI, client hooks |
| Services | Schemas, repositories, platform, public feature APIs | Routes, UI, commands, Workflow adapters |
| Repositories | Schemas, database infrastructure | UI, commands, services, Workflows |
| Workflow adapters | Schemas, services, platform | UI, routes, queries |
| Shared schemas | Pure types, validation, constants | Runtime-specific implementations |
| Platform | Generic infrastructure | Feature internals, except explicit bootstrap registration |

Account for TanStack Start's compilation model: browser code may import `*.functions.ts`, whose server handlers may import server-only implementations.

### Static analysis

Use **Oxlint + vendored [anti-slop](https://github.com/dmmulroy/anti-slop)**. Do not install ESLint.

- Enable relevant Oxlint correctness, TypeScript, React, and import rules.
- Vendor anti-slop and enable its generic rules.
- Adapt opinionated rules when justified; do not introduce artificial workarounds.
- Pin compatible Oxlint and plugin versions.
- Use Oxlint for forbidden direct imports.
- Use dependency-cruiser for transitive boundaries, feature isolation, and cycles.
- Support TypeScript path aliases and relative imports.
- Verify server-only code and secrets cannot enter browser bundles.

### Architectural regression tests

Maintain a small set of negative fixtures proving checks reject:

- UI importing repositories.
- Routes importing services directly.
- Services importing UI or Workflow adapters.
- Cross-feature imports into private implementations.
- Shared schemas importing runtime-specific code.
- Circular and forbidden transitive dependencies.
- Server-only implementations leaking into client bundles.

A rule is only considered enforced when a representative violation demonstrably fails.

Prefer actionable diagnostics explaining the correct destination.

Avoid arbitrary file-length limits and mandatory abstraction layers.

## 7. Testing philosophy

**Prefer one meaningful E2E test per feature over dozens of low-value unit tests.**

Tests should validate useful behavior and consequential invariants, not maximize test count or code coverage.

### Test ownership

All feature-specific tests, including E2E, belong inside their owning feature.

```text
src/features/agent-tasks/
├── agent-tasks.e2e.spec.ts
├── agent-tasks.service.test.ts       # Only when useful
└── ...

tests/
├── fixtures/                         # Shared testing utilities
└── architecture/                     # Global structural checks

supabase/tests/                      # Database-wide security tests
```

Playwright discovers colocated E2E tests through its configuration.

### Testing priorities

1. **E2E:** Prefer one representative journey covering the complete feature.
2. **Integration:** Add targeted tests for authorization, persistence, retries, and consequential failure modes.
3. **Unit:** Test nontrivial algorithms, state transitions, or isolated logic when valuable.
4. **Architecture:** Test prohibited dependencies mechanically.

Avoid tests that merely verify component rendering, mocked calls, trivial forwarding, or implementation details.

Do not introduce coverage-percentage targets for their own sake.

### Canonical E2E journeys

| Feature | E2E behavior |
|---|---|
| Authentication | Log in, access protected page, log out, verify access revoked |
| Account | Update profile, reload, verify persistence |
| Agent Turns | Create turn, persist, reload, verify typed rendering |
| Agent Tasks | Submit task, execute Workflow, observe status, inspect persisted result |

Use realistic infrastructure when practical. Deterministic LLM adapters are acceptable for reliable CI, but real provider integrations must be verified separately after deployment.

Test critical invariants separately when necessary, especially cross-user access, RLS, idempotency, cancellation, and retries.

**Success is measured by confidence in behavior, not test volume.**

## 8. Validation lifecycle and CI/CD

**Principle:** Catch architectural errors early without interrupting every edit or unnecessarily slowing agent iteration.

All validation must be implemented as ordinary repository commands, independent of agent-specific hooks.

### Quality commands

```text
pnpm lint              # Oxlint + anti-slop
pnpm check:boundaries  # Architectural dependency checks
pnpm check:fast        # Lint + boundaries
pnpm typecheck         # TypeScript
pnpm test              # Focused automated tests
pnpm test:e2e          # Feature-local Playwright journeys
pnpm check             # Full quality gate
```

`pnpm check` runs static checks, type checking, relevant tests, and deterministic E2E journeys in the configured test environment.

Real hosted integration verification is separate from routine local checks.

### Validation triggers

| Trigger | Checks | Policy |
|---|---|---|
| Individual file edit | None by default | No interruption |
| Optional `PostToolUse` hook | Targeted fast checks | Feedback during implementation |
| Before agent completion | `pnpm check:fast` | Agent repairs failures autonomously |
| Pre-commit | Optional staged-file lint | Disabled by default |
| PR / CI | `pnpm check` | Mandatory and blocking |
| Deployment | Real provider verification | Required when configured |

### Agent lifecycle hooks

- Prefer optional `PostToolUse` hooks for early, targeted feedback where supported and trusted.
- Hooks must not be required for correctness or autonomous operation.
- Do not require Stop hooks.
- Do not run expensive full-project checks after every edit.
- Before task completion, agents run `pnpm check:fast` through their normal tool workflow and fix failures.
- Hooks should provide concise diagnostics identifying the broken rule and expected fix.
- Use bounded repair attempts; avoid infinite validation loops.
- If validation cannot run, report that explicitly rather than claiming success.

### CI enforcement

CI is the final authority.

- Run full checks on pull requests.
- Reject lint, type, dependency, migration, and test failures.
- Use isolated test environments.
- Protect production deployment through reviewed code and appropriate approvals.
- Never rely on local hooks or agent behavior for final correctness.

## 9. Infrastructure and autonomous deployment

### Default infrastructure

| Responsibility | Provider |
|---|---|
| Hosting, SSR, server functions | Cloudflare Workers |
| Durable asynchronous execution | Cloudflare Workflows |
| Database, Auth, Storage | Supabase |
| Database migrations | Supabase CLI |
| Hosting configuration | Wrangler |
| CI/CD | GitHub Actions + Cloudflare |
| LLM inference | Configurable provider |

### Bootstrap workflow

An authenticated coding agent should be able to:

1. Create a GitHub repository from the scaffold.
2. Provision or select a Supabase project.
3. Apply migrations, configure RLS, and generate database types.
4. Configure authentication and required integrations.
5. Provision Cloudflare Workers and Workflow bindings.
6. Configure secrets and environment variables securely.
7. Configure CI/CD and deploy the application.
8. Run architectural checks, feature-local E2E tests, and deployed verification.
9. Report unresolved configuration, failed checks, and required user approvals.

Use authenticated provider MCP tools or CLIs where appropriate.

### Environment strategy

- Support local development and Codex Cloud.
- Avoid requiring local containers for ordinary feature development.
- Use isolated development databases or Supabase branches when available.
- Run container-dependent migration operations in suitable CI/dev environments when necessary.
- Separate development and production resources.
- Pin dependencies and commit lockfiles.
- Never expose secrets in code, logs, commits, or agent output.

### Free-tier constraints

- Target Cloudflare Free and Supabase Free by default.
- Avoid always-on compute.
- Keep Workflow steps small and I/O-heavy.
- Validate actual agent execution against free-tier CPU and usage limits.
- Bound execution and external API spending.
- Provide SMTP configuration for production email.
- Treat LLM credentials and inference costs as external requirements.
- Account for Supabase Free inactivity pauses and provider quotas.
- General-purpose subprocesses and heavyweight code-execution agents are outside the initial Cloudflare target.

Never silently require paid upgrades.

## 10. Minimal AGENTS.md and agent workflow

Working reference implementations teach patterns. Static checks enforce invariants. `AGENTS.md` provides only essential navigation and judgment.

### Minimal AGENTS.md

```markdown
## Architecture

- Organize by feature. Follow existing reference implementations.
- Use `agent-turns` for synchronous features.
- Use `agent-tasks` for asynchronous features.
- UI reads via queries and mutates via commands.
- Cross-feature calls use public APIs, never private internals.
- Database definitions live in `supabase/schemas/<owner>/`.
- Keep all feature tests, including E2E, feature-local.
- Reuse existing components and services. Avoid unnecessary layers.
- Prefer meaningful E2E tests over trivial unit tests.
- Run `pnpm check:fast` before completion and fix failures.
```

### Agent development workflow

1. Locate the owning feature and inspect the closest working implementation.
2. Identify the responsible files, database definitions, and tests.
3. Reuse established contracts, components, services, and infrastructure.
4. Implement changes within existing dependency boundaries.
5. Add or update meaningful E2E and focused tests when justified.
6. Run fast validation and resolve architectural violations.
7. Run relevant deeper checks and verify the affected user journey.
8. Report any unresolved failures rather than claiming completion.

### Continuous architectural improvement

When agents repeatedly make the same mistake:

1. Improve the canonical reference implementation.
2. Add a mechanical check when appropriate.
3. Update `AGENTS.md` only if neither approach is suitable.

Prefer improving the architecture over accumulating written instructions.

## 11. Scaffold acceptance criteria

The scaffold is complete when:

- Authentication and account management work end-to-end.
- Protected routes, server authorization, and RLS are verified.
- Agent Turns support real creation, persistence, and typed rendering.
- Async Agent Tasks execute through Cloudflare Workflows and persist results.
- Retries, cancellation, idempotency, and execution limits are tested.
- Client commands, server functions, services, repositories, and Workflow adapters follow ownership rules.
- Declarative SQL is grouped by owning feature/domain under `supabase/schemas/`.
- Migrations are reproducible from Git through the central ledger.
- Cross-feature and runtime dependencies are mechanically enforced.
- Negative architecture tests prove illegal dependencies are rejected.
- Every reference feature has a meaningful colocated E2E journey.
- Oxlint, anti-slop, TypeScript, and CI pass.
- Optional `PostToolUse` validation works where supported, without being required for correctness.
- A coding agent can provision, deploy, and verify the application from a fresh repository without manual source-code modifications, subject to provider authentication and environment capabilities.
- Free-tier limits and external provider costs are documented.

**Final design objective:** A coding agent should immediately know where to implement a change, which reference pattern to copy, which dependencies are legal, and how to verify the result.

Most feature work should remain inside one directory. Database definitions should be immediately discoverable by feature name under `supabase/schemas/`. Global architectural invariants should be protected mechanically, without unnecessarily interrupting the agent's development loop.
