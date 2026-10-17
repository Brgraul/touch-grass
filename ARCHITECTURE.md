# Codebase Architecture

**Stack:** TanStack Start, React, TypeScript, TanStack Query, async workers, Tailwind v4 + shadcn/ui

**Principle:** Organize by feature, enforce runtime boundaries, and optimize for code locality, reuse, and agent navigability.

## 1. Repository structure

Bootstrap two working, permanent reference features: `agent-turns` for standard application development and `agent-tasks` for asynchronous agent execution.

```text
src/
├── routes/                          # Thin TanStack routes
│
├── features/
│   ├── agent-turns/                 # Standard vertical slice
│   │   ├── ui/
│   │   │   ├── agent-turn.tsx       # Message + tool activity
│   │   │   └── turn-page.tsx
│   │   ├── agent-turns.queries.ts
│   │   ├── agent-turns.functions.ts
│   │   ├── agent-turns.schema.ts
│   │   └── agent-turns.repo.server.ts
│   │
│   └── agent-tasks/                 # Async vertical slice
│       ├── ui/
│       │   ├── task-form.tsx
│       │   └── task-status.tsx
│       ├── agent-tasks.queries.ts
│       ├── agent-tasks.functions.ts
│       ├── agent-tasks.schema.ts
│       ├── agent-tasks.service.server.ts
│       ├── agent-tasks.repo.server.ts
│       └── agent-tasks.worker.server.ts
│
├── components/
│   ├── ui/                          # Design system primitives
│   └── patterns/                    # Reusable UI compositions
├── layouts/                         # Application shells
├── domain/                          # Shared business capabilities
└── platform/                        # Auth, DB, queue, LLM, logging

worker/
└── main.ts                          # Worker bootstrap
```

For new features, follow the same naming conventions and ownership model.

**Files are optional.** Create only what a feature needs. Keep tests next to the code they verify. Use `.server.ts` for server-only implementations.

### Reference feature A: Agent Turns

A reusable interface for displaying persisted agent turns, including messages, tool calls, tool results and structured outputs.

- Demonstrates React composition, typed content blocks, TanStack Query, server functions and persistence.
- Keeps rendering independent of the agent execution engine.
- Supports incremental updates without requiring a full chat application.
- Serves as the canonical example for synchronous, UI-driven features.

### Reference feature B: Async Agent Tasks

A functional agent task that accepts a user instruction, executes asynchronously using a configurable LLM, and persists its progress and results.

- Demonstrates form submission, server functions, queueing, worker execution and persistence.
- Supports `queued`, `running`, `completed`, `failed` and `canceled` states.
- Exposes progress events, results, cancellation, retries and idempotent execution.
- Runs independently of conversations. A turn may reference a task, but no conversation is required.
- Serves as the canonical example for long-running, agentic features.

Both examples must be functional, tested and suitable for retention in production. No mock workflows or artificial delays.

## 2. Ownership rules

- **Routes:** URL mapping, search parameters, loaders and page registration. Delegate feature behavior.
- **UI:** Render state and handle interactions. Keep ephemeral UI state local.
- **Queries:** TanStack Query keys, hooks, caching and invalidation. Reuse definitions across loaders and components.
- **Server functions:** Validate input, authenticate/authorize and delegate. No substantial business logic.
- **Services:** Own business rules and workflows. One authoritative implementation shared by server functions and workers.
- **Repositories:** Own database access and persistence. No business workflows.
- **Schemas:** Shared types, validation and job payload contracts. No runtime-specific dependencies.
- **Worker handlers:** Feature-local (`*.worker.server.ts`). Execute queued jobs through services, with retry safety, cancellation handling and idempotency.
- **Worker bootstrap:** `worker/main.ts` registers handlers and starts queue consumers. No business logic.
- **Platform:** Generic infrastructure, including queue producers/consumers, database connections and external integrations.

## 3. Dependency and runtime rules

- UI may call server functions but must never import server implementations, repositories, workers or secrets.
- Server functions and workers call services; services may call repositories and platform infrastructure.
- Simple operations may omit the service layer when no substantial business logic exists.
- Long-running tasks execute in workers, not request handlers. Enqueue through `platform/queue.server.ts`.
- Workers run in a separate process but reuse the same business logic as the web server.
- Worker state, events and outputs must be persisted independently of the initiating request.
- Shared schemas must be runtime-independent.
- Enforce import boundaries through linting and CI, not instructions alone.

## 4. Reuse and abstraction

- Keep feature-specific code inside its owning feature.
- Shared UI primitives belong in `components/ui/`; generic UI compositions in `components/patterns/`.
- Shared business capabilities belong in `domain/`; generic infrastructure in `platform/`.
- Never duplicate business logic between entrypoints.
- Agent Turns own turn representation; Agent Tasks own execution lifecycle. Neither feature should duplicate the other's responsibility.
- Prefer existing components, schemas, queries and services before creating new ones.
- Extract shared code when it has a clear common owner, not merely because implementations look similar.
- Avoid unnecessary layers, wrappers and premature abstractions.

## 5. Agent workflow

1. Locate the owning feature. Inspect `agent-turns` for synchronous features or `agent-tasks` for asynchronous features.
2. Reuse established patterns and shared functionality.
3. Modify only the responsible files, adding layers only when needed.
4. Add or update relevant tests, including worker failure, cancellation and retry cases where applicable.
5. Run type checks, linting, dependency-boundary checks and relevant tests.
6. Never introduce a new architectural pattern when an existing one suffices.

**Enforcement strategy:** Working reference implementations teach patterns; linting and CI enforce architectural boundaries; a minimal `AGENTS.md` directs agents to the examples and captures rules requiring judgment.
