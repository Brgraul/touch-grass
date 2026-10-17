# Gaps in the template architecture

A review of [README-TEMPLATE-ARCHITECTURE.md](README-TEMPLATE-ARCHITECTURE.md) made by walking its two reference features end to end. Each gap names the step where the walk stopped, why the document cannot answer it, and a proposed contract.

**Status:** resolved in the architecture document. G1 to G10 follow the proposals below. G4 differs in one way: the in-application spend and token ledger was removed, and the AI gateway now owns budgets. That also removed request permits, so the permit-release rule proposed in G4 is moot. G11 is resolved by that same removal. A later adversarial review reshaped G3, G4, and G9 further. Steps now hold one model call plus pure tools only, and effect classes for non-pure tools moved to a deferred extension. The architecture document is the current contract. This file records why it changed.

**Method.** Trace one agent turn and one async agent task from the browser to PostgreSQL and back. At every hop, ask which module owns the step, which type crosses the boundary, and what happens on a retry or crash. A gap is a hop where the document gives no owner, no type, or two conflicting answers. The earlier [ARCHITECTURE.md](ARCHITECTURE.md) is used only to recover requirements the new document dropped.

**Summary.** The task ledger, dispatch recovery, and cancellation race are carefully specified. The agent itself is not. The document never says what an agent turn is, what a logical step contains, or how tool calls map to effects. Agent Turns gets one paragraph, so the two features share no model. Under the only provider the reference ships (an LLM without idempotent replay), the effect rules fail the task on any crash and hold its request permit forever.

| # | Gap | Feature | Severity |
|---|---|---|---|
| G1 | An agent turn has no definition, owner contract, or relation to tasks | Turn | P1 |
| G2 | Whether a turn calls an LLM is undecided, and either answer breaks a stated promise | Turn | P1 |
| G3 | The agent loop (step, tool call, effect) has no domain model | Task | P1 |
| G4 | LLM effects end every crash as `external_outcome_unknown` and leak permits | Task | P1 |
| G5 | Operator resolution has no actor, operation, or surface | Task | P1 |
| G6 | `Cursor` contradicts the rejected checkpoint-cursor design, and Workflow step retries are unspecified | Task | P2 |
| G7 | The four public operations cannot list tasks or page history | Task | P2 |
| G8 | The post-commit dispatch nudge has no import path | Task | P2 |
| G9 | Tool adapters have no registry or effect classification | Task | P2 |
| G10 | Stored content blocks have no evolution rule | Both | P2 |
| G11 | Accounting scope exceeds what a teaching template needs | Task | P2 |

## Walk 1. Agent turn

```text
Turn UI → turn command → createTurn RPC → [?] → turns repository → PostgreSQL
Turn page → turn query → readTurn RPC → repository → parse ContentBlock[] → exhaustive render
```

The document's whole contract for this feature is one paragraph in Usage and one E2E line in Verification. The walk stops at the first hop.

### G1. An agent turn has no definition, owner contract, or relation to tasks

**Where the walk stops.** The RPC handler receives a create request. There is no `Turn` type, no `createTurn` input schema, no table under `supabase/schemas/agent-turns/`, and no statement of who a turn belongs to. `ContentBlock` is defined only inside the task section, as an argument to `buildPrompt(input, history)`. Nothing says which feature owns `ContentBlock` or where `history` comes from.

**What was dropped.** The earlier document required tasks to "operate independently of conversations, with optional turn associations". The new document drops that requirement silently. It also says nothing about how `TaskResult` relates to content blocks, so the async UI may need a second renderer for the same tool-call and text shapes.

**Why it matters.** If tasks read turn history and turns display task results, the two features import each other. The policy rejects feature cycles, so the first implementer will either duplicate `ContentBlock` or invent a shared domain. Either choice is the hand-synced shape the review set out to remove.

**Proposed contract.**

- `agent-turns` owns `ContentBlock`, `Turn`, and their schemas. It is the transcript capability.
- A turn is an ordered, owned list of content blocks with a role (`user` or `agent`), an optional `taskId`, and a creation request key.
- `agent-tasks` depends on the public `agent-turns` API in one direction. A committed step appends its agent turn through that API. `TaskResult` references the final turn ID.
- `agent-turns` never imports `agent-tasks`. Rendering a task's transcript reuses the turn renderer with no task knowledge.

This gives `buildPrompt` its history source and gives both journeys one renderer.

### G2. Whether a turn calls an LLM is undecided

**Where the walk stops.** Between the RPC handler and the repository. The feature is named "agent turns" and its blocks include tool calls and tool results, which implies a model produced them. The document says only that the feature "creates, reads, and renders persisted turns".

**Both answers break something.**

- If the synchronous turn calls the LLM inside the request, it is a paid external effect outside the effect journal and quota ledger. The document's own rule says "if credentials are shared, all their consumers must use the same authoritative quota ledger". A turn that bypasses it voids the per-credential limit claim. It also runs a multi-second provider call inside a Worker request with no stated timeout, retry, or duplicate-submit protection.
- If it does not call the LLM, the user creates tool-call blocks by hand. The E2E journey then proves storage and rendering, not anything an agent did. That is a fine reference slice, but the name and the README should say so.

**Proposed contract.** Make turns a pure persistence and rendering slice with no provider call. Any model invocation goes through `agent-tasks`. A "chat" feature built later submits a task per user turn and renders the resulting agent turn. One path then pays for model calls, and it is the one with budgets.

### Smaller turn gaps

- **Duplicate create.** Turn creation has no request key. A double click or transport retry stores two turns. Reuse the task pattern (owner-scoped request key, unique constraint, return the existing row).
- **Mutation transport.** The document claims "one mutation transport" via `task_api` routines and the service credential. It does not say whether turns write through that transport or directly under the user's JWT and RLS. Either is defensible, but the policy file needs one answer per feature, and the "two ways to do one task" row in the red-flag table is currently unverified.
- **Tool-call pairing.** A `tool_result` block must reference an existing `tool_call` in the same or an earlier turn. Encode that in the schema rather than in renderers.

## Walk 2. Async agent task

```text
submitTask RPC → tasks.submit → commit receipt, task, attempt, reservations, dispatch intent
  → [nudge?] → Workflow create
cron → reconciler → claim dispatch intent → Workflow create → acknowledge
Workflow → step.do(advance) → runner → decide → prepare/authorize effect → LLM → observe → commit step
  → [tool calls?] → next step … → terminal outcome
UI → poll tasks.read → TaskView
```

Submission, dispatch recovery, cancellation ordering, and stale-attempt fencing all hold up under the walk. Each hop has an owner and a crash rule. The gaps sit inside the runner box and at the edges of the public API.

### G3. The agent loop has no domain model

**Where the walk stops.** Inside `runner.advance`. The document defines a step as "committed logical task progress with immutable inputs" and an effect as "one specific external invocation authorized by a step". It never says what one agent step contains. These types are referenced but undefined: `Cursor`, `ExecutionRef`, `RunSnapshot`, `Observation`, `Decision`, `Progress`, `TaskResult`, `EffectOutcome`, `UnknownEvidence`.

Questions an implementer must answer and cannot:

- Is one step one model call, or one model call plus the tool calls it requested?
- When the model requests three tool calls, are they three effects of one step, or three steps?
- Which data is the step's frozen input? The full prompt, or the turn history it was built from?
- What does `decide` return? Continue with a model call, run tools, complete with a result, or fail with a limit? How does that `Decision` become an `Advance`?
- When does a task move from `queued` to `running`?

**Why it matters.** This loop is the thing the template teaches. Everything else in the document protects it, yet it is the least specified part. Without a state machine here, the runner becomes the branch-heavy code the ownership rules were meant to prevent.

**Proposed contract.** One logical step is one model call plus the tool executions it requested. Effects within a step are ordered: ordinal 0 is the model call, ordinals 1..n are tool calls. Define the decision union explicitly.

```ts
type Decision =
  | { kind: 'call_model'; prompt: Prompt }             // prepares effect 0 of a new step
  | { kind: 'run_tools'; calls: readonly ToolCall[] }  // prepares effects 1..n of the current step
  | { kind: 'commit_step'; turn: AgentTurnDraft }      // appends the agent turn, advances the cursor
  | { kind: 'complete'; result: TaskResult }
  | { kind: 'fail'; failure: TaskFailure };
```

The task leaves `queued` when the first step's model effect is authorized. That is the first moment work can have happened.

### G4. LLM effects end every crash as `external_outcome_unknown` and leak permits

**Where the walk stops.** Recovery after a crash between authorize and observe on the model call. Mainstream LLM APIs offer neither idempotent replay nor a lookup by client operation ID. So the recovery table lands on its last row: "stop automatic work, fail with `external_outcome_unknown`". Two consequences follow.

1. **Liveness of the task.** Any Worker eviction, step timeout, or network drop during the slowest call the system makes fails the task. That is the common failure, not an edge case. The reference journey will look broken in exactly the case it claims to handle.
2. **Liveness of the system.** The request permit is released "only on conclusive completion or enforceable expiry". LLM providers supply neither. Each such crash permanently reduces outstanding-request capacity, so admission eventually refuses everything.

**What the document conflates.** It treats every unconfirmed effect as possibly irreversible. A repeated model call has a bounded cost but no external consequence. A repeated tool call that sends an email does. These need different recovery rules.

**Proposed contract.** Classify each effect kind in its adapter.

| Effect class | Example | Recovery when outcome is unknown |
|---|---|---|
| `pure` | Local calculator tool | Re-run freely, no journal entry required |
| `repeatable_charged` | LLM completion | Keep the old allocation held, allocate a new ceiling, resend under a new send ID |
| `idempotent` | Provider with documented idempotency keys | Replay with the same key within the documented window |
| `irreversible` | Send email, create external resource | Stop and fail with `external_outcome_unknown` |

For permits of a `repeatable_charged` effect, use a bound the platform enforces. A Workflow step has a maximum wall-clock duration, and a fetch cannot outlive the invocation that issued it. Release the permit once the step's platform limit has passed since authorization **and** the attempt that owns it is fenced. Document this as an assumption about Cloudflare's runtime and gate it on the feasibility experiment, since a terminated invocation may not cancel provider-side work. The cost allocation for the lost call still stays held until the conservative ceiling is charged, which keeps the budget sound.

### G5. Operator resolution has no actor, operation, or surface

**Where the walk stops.** After a task fails with `external_outcome_unknown`. The document says an "explicit operator resolution, supported by provider evidence or a separately accepted duplication risk, is recorded as a new decision". The template has no operator role, no RPC for resolution, no grant in the access matrix, and no UI. Unsafe user retry is refused until resolution. So the user's only path forward is a fresh submission, and the held reservation never clears.

**Proposed contract.** Either add a fifth operation `resolve(operator, effectId, resolution)` with an `operator` actor kind, a grant, and a minimal admin view, or state that resolution happens through a documented SQL routine run by the repository owner. The second is cheaper and honest for a template. G4's classification makes this path rare, since only `irreversible` effects reach it.

### G6. `Cursor` contradicts the rejected design, and Workflow retries are unspecified

**Where the walk stops.** At `step.do(checkpointName(cursor), () => runner.advance(execution, cursor))`. The synthesis rejects "Workflow-paced execution with a checkpoint cursor" because "reconstructing a distinct cursor from DB facts adds another progress representation". The selected design still passes a `Cursor` through the Workflow and returns one from `advance`. The document does not say what it contains or which side is authoritative when they disagree.

`step.do` also retries a throwing callback by default. If `advance` throws after authorizing an effect, Cloudflare re-enters it, and the runner must recognize its own authorized-but-unobserved effect. Nothing states whether retries are disabled, bounded, or relied on.

**Proposed contract.** `Cursor` is `{ stepOrdinal: number }`, used only to make step names deterministic. The runner always loads progress from PostgreSQL and treats a mismatched cursor as a replay. Configure `step.do` with no automatic retries, and let the runner own all retry policy through the effect classes in G4. State the step-count ceiling per task so it fits the Workflow step limit.

### G7. The public API cannot list tasks or page history

**Where the walk stops.** The task UI renders "my tasks". `Tasks` has `submit`, `read`, `cancel`, and `retry`. There is no `list`. `TaskView.history` returns the whole event log although the persistence table promises cursor pagination. `read_task(task_id)` is the only authenticated read routine.

**Proposed contract.** Add `list(actor, page)` returning `PublicTask` summaries, and give `read` a history page parameter. Both go through the same JWT-scoped definer routine pattern.

### G8. The post-commit dispatch nudge has no import path

**Where the walk stops.** After `tasks.submit` commits. Usage says a post-commit nudge improves latency. The nudge must create a Workflow instance, but the module map lets only `src/server.ts` and the Workflow adapter touch runtime code, and `platform/` has no generic Workflow interface any more. Without the nudge, the first step waits up to the one-minute cron interval, which the user sees as a stuck "queued" state.

**Proposed contract.** `src/server.ts` injects a `dispatch(attemptId)` function into the task API at composition time. The API calls it after commit and ignores failures. The reconciler remains the correctness path.

### G9. Tool adapters have no registry or effect classification

**Where the walk stops.** The model returns a tool call. The flowchart shows "LLM and tool adapters", but no tool is named, no registry maps a tool name to its input schema and adapter, and nothing says how a tool's output becomes a `tool_result` block. The model's tool-call arguments are external input and need parsing at that boundary.

**Proposed contract.** A feature-local `tools` registry keyed by tool name. Each entry has an input schema, an output schema, an effect class from G4, and an adapter. Ship one `pure` tool in the reference so the loop exercises tool calls without a paid or irreversible side effect.

### G10. Stored content blocks have no evolution rule

Both features persist `ContentBlock` JSON and render it exhaustively. Add a block kind, and older readers fail to parse new rows. Remove one, and new readers fail on old rows. The repository is the parse boundary, so it needs a rule: version each stored block, migrate old rows in SQL, and parse an unknown kind into an explicit `unsupported` block that renders a fallback rather than throwing.

### G11. Accounting scope exceeds what a teaching template needs

The conservation equations, overage freeze, period rollover, per-send allocations, and shared-credential ledger are correct, but each is a table, a routine, and several race tests. The template's stated goal is patterns that agents "can safely extend". An agent extending this will copy machinery it cannot reason about, or route around it.

The smallest design that keeps the promises is a per-task token ceiling, a per-user concurrent-attempt limit, and the effect classes from G4. Per-period spending and credential-wide quotas can be a documented extension with the equations already written. That cuts implementation unit 3 roughly in half and removes the period-rollover and overage rows from the required proofs. The cut is a product call, so this review recommends it without assuming it.

## What held up

- Submission idempotency, the receipt states, and refusal stability under the same key.
- One transaction for task, attempt, reservations, and dispatch intent, with the cron reconciler as the correctness path.
- Distinct identities for task, attempt, step, and effect, and the retry-kind table.
- First committed terminal transition wins, and fencing stale attempts before granting successors.
- Separating attempt ownership from request permits and cost holds.
- Policy-driven boundary checks with positive and negative fixtures.

## Suggested order

1. Decide G2 (turns make no model call) and write G1's ownership direction. Every later answer depends on it.
2. Write the agent-loop types from G3 and the effect classes from G4 into the Domain contracts section.
3. Fold G6, G8, and G9 into the Workflow and module-map sections.
4. Add G7's operations and G10's evolution rule.
5. Decide G5 and G11 as product calls.
