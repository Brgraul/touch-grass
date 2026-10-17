# Architecture review against pstack principles

Reviewed on 2026-10-17 against all 24 available `principle-*` skills from pstack 0.9.90.

**Verdict:** The architecture has a sound ownership model, but does not fully satisfy the principles as written. Two policy contradictions and several missing execution contracts should be resolved before using it as the authoritative scaffold specification.

This is a review of the current working-tree document, including its existing uncommitted edits. The repository contains specifications and assets, with no application implementation or runnable quality commands. “Aligned” below means aligned design intent, not verified implementation. An unspecified mechanism is a design gap, not evidence that an implementation is broken. Provider compatibility, current pricing, and free-tier feasibility were not independently researched for this principle review.

<!-- architecture-sha256: f4ab4f2b923344ae3b42da4c11ecde36e4b6e660221187f441c2416e161d9334 -->
<!-- principles-sha256: e1838a46f5514975a430ffdec1c9c8c62e898fc04854510d7d70181fb7f5baaf -->

## Findings

P1 findings affect correctness or the meaning of completion. P2 findings affect boundary clarity, maintainability, testing, or recovery during setup.

### F1 · P1 · Completion has conflicting verification requirements

**Contradiction.** The trigger table, lifecycle rules, and sample `AGENTS.md` require only `pnpm check:fast` before completion. That command runs lint and dependency checks, excluding type checking and runtime tests. The development workflow separately requires deeper checks and verification of the affected user journey. An agent following the supplied minimal instructions can meet its completion gate while leaving a type error or broken behavior undetected until CI.

**Evidence:** [command definitions](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:512), [completion trigger](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:531), [lifecycle rule](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:542), [sample instructions](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:629), [deeper verification](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:640).

**Principles:** `prove-it-works`; `encode-lessons-in-structure`.

**Resolve:** Define one completion contract: fast checks plus affected type/runtime checks and direct verification of changed behavior. Keep full CI mandatory, and require full static/runtime verification at the end of planned migrations. Keep checks proportional to the change; this does not require running the entire suite after each edit. Point the sample instructions at that contract.

### F2 · P1 · Partial task submission has no owned recovery mechanism

**Gap.** The submission path persists a queued task and then starts a Workflow. The document correctly requires reconciliation and idempotent submission, but assigns neither a durable dispatch record nor a recovery actor, trigger, or completion rule. If execution stops between those two operations, nothing specified guarantees that the queued task will ever start. If the start succeeds but its response is lost, a retry has no specified way to identify the existing execution.

**Evidence:** [submission lifecycle](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:232), [partial-failure requirement](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:286).

**Principles:** `make-operations-idempotent`; `foundational-thinking`; `prove-it-works`.

**Resolve:** Specify durable submission intent, a stable task-to-execution identity, and the owner and trigger for reconciling pending dispatches. This can use an outbox or another recoverable design; the required property is convergence after every interruption. Scope submission keys to the caller and define what happens when a key is reused with different input.

**Proof required:** Interrupt after persistence, after execution creation, and before acknowledgement. Resubmission/reconciliation must produce one logical task execution, with no stranded queued task.

### F3 · P1 · Task states do not define attempts, retries, or cancellation races

**Gap with an unresolved tension.** The document lists five states and supports retries, while prohibiting retries from overwriting terminal states. These requirements can coexist, but only after distinguishing a logical task from an execution attempt. It does not say whether a retry occurs before `failed`, creates a new attempt, or creates a new task. Nor does it define which result wins when completion races with cancellation.

**Evidence:** [states and retries](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:250), [transition ownership](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:270), [terminal-state rule](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:285).

**Principles:** `model-the-domain`; `type-system-discipline`; `foundational-thinking`.

**Resolve:** Define the task/attempt relationship, legal transition table, terminal outcomes, and cancellation precedence before implementation. Use a discriminated model that ties results and failures to the appropriate states, with exhaustive transition handling. Keep transition policy pure and enforce expected-state/version conditions atomically in persistence. Preserve prior attempt history when retrying.

**Proof required:** A stale attempt cannot publish into a newer attempt; retry cannot erase an accepted terminal result; completion/cancellation races have a specified, reproducible outcome.

### F4 · P1 · Per-task atomic writes do not specify shared admission and budget control

**Gap.** The architecture bounds concurrency and spending and calls for atomic task transitions. It does not define the scope or mechanism for limits across tasks. Two submissions can each pass a read-then-check concurrency or cost test and jointly exceed the limit. Cancellation and execution recovery also need a rule for releasing or recovering reservations without allowing a stale worker to keep writing.

**Evidence:** [execution limits](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:253), [budget ownership](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:269), [atomic persistence](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:273).

**Principles:** `separate-before-serializing-shared-state`; `foundational-thinking`; `make-operations-idempotent`.

**Resolve:** Isolate state by task and attempt first. Identify the resources that actually require shared accounting, define each limit's scope, and reserve/release capacity atomically. Specify stale reservation recovery and fencing of obsolete attempts. Define stable identities and recorded outcomes for retryable external effects; when an external system cannot provide idempotency, state the reconciliation or uncertainty policy instead of implying exactly-once effects. Include retries in budget accounting.

**Proof required:** Concurrent submissions against one available slot admit at most one task. A crash recovers capacity without admitting an obsolete writer. Replaying a completed effect does not repeat it where the provider contract supports that guarantee.

### F5 · P2 · Runtime contracts stop short of all external boundaries

**Gap.** RPC validation and generated database types are specified well. The document does not require parsing environment configuration, provider outputs, Workflow payloads, or stored JSON into domain types at their respective boundaries. It also does not define semantic ID types or prevent storage/provider representations from becoming service/public API contracts. Generated database types alone do not provide runtime parsing of untrusted values.

The service owns both decisions and effectful orchestration. That is reasonable, but the pure decision-making part is not identified: transition rules, prompt construction, and budget calculations can otherwise become tied to the execution framework.

**Evidence:** [runtime contracts](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:163), [service responsibilities](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:267), [schema distinctions](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:375).

**Principles:** `boundary-discipline`; `type-system-discipline`; `minimize-reader-load`.

**Resolve:** Assign parsing and error translation to each external adapter, returning domain types internally. Distinguish semantic identifiers such as user, task, attempt, and execution IDs. Derive shapes from authoritative schemas and exhaust variants. Keep business decisions pure and effect orchestration thin; avoid revalidating already parsed internal values. This need not add another mandatory file layer.

### F6 · P2 · The mocked-call testing guidance is overbroad

**Policy tension.** “Avoid tests that merely verify … mocked calls” can exclude valid behavior tests. For example, asserting the request sent to an external tool, or that cancellation prevents a second charge, can directly test the observable contract. Pstack explicitly distinguishes these external effects from calls to private helpers. The E2E preference itself is consistent with the principle.

**Evidence:** [testing exclusion](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:484), [permitted deterministic adapters](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:497).

**Principle:** `test-behavior-not-implementation`.

**Resolve:** Discourage assertions on private collaborators and internal call order. Explicitly permit assertions on externally observable requests and effects through deterministic adapters. Judge a test by whether it catches broken behavior and survives an internal refactor.

### F7 · P2 · Transitive boundary rules need a compilation-aware contract

**Gap in enforcement semantics.** Browser imports of server-function wrappers are allowed, and those functions can import repositories/services in server handlers. The source dependency graph therefore contains legitimate UI → function → server implementation paths. A blanket forbidden-transitive-dependency rule would reject these paths; exempting the entire function module could miss a client-reachable leak.

The document acknowledges TanStack's compilation model, but does not specify how the checker distinguishes those cases. This is an unresolved tooling contract, not a claim that TanStack cannot provide the boundary.

**Evidence:** [allowed compiled boundary](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:419), [bundle verification](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:432), [negative transitive fixture](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:443).

**Principles:** `boundary-discipline`; `prove-it-works`; `encode-lessons-in-structure`.

**Resolve:** Separate source ownership checks from checks of client-reachable compiled code. Add a positive fixture for the canonical RPC path alongside negative fixtures for server imports in client-executed code. Require the intended diagnostic for negative fixtures, so a parser/configuration failure cannot count as successful enforcement.

### F8 · P2 · Platform bootstrap imports are both forbidden and permitted

**Contradiction.** The Workflow rules prohibit platform imports of feature-specific Workflow implementations and put registration in `src/server.ts`. The dependency table later permits platform imports of feature internals for “explicit bootstrap registration.” These yield different dependency rules and leave the exception's scope unclear.

**Evidence:** [prohibition and entrypoint owner](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:281), [platform exception](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:417).

**Principles:** `encode-lessons-in-structure`; `boundary-discipline`; `laziness-protocol`.

**Resolve:** Keep bootstrap registration in the composition root and remove the platform exception, or explicitly designate one bootstrap module and amend both rules. Enforce the selected boundary by path rather than relying on an informal exception.

### F9 · P2 · Repeated policy copies lack an authoritative source

**Gap with observed drift.** Ownership, dependency, validation, and workflow rules recur in tables, prose, examples, and acceptance criteria. F1 and F8 show that these copies already disagree. The sample `AGENTS.md` also lacks a pointer telling agents when to consult the detailed architecture. Its brevity is good, but essential caveats can be missed when agents imitate only the reference feature or summary.

**Evidence:** [ownership table](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:135), [dependency table](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:407), [minimal instructions](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:615).

**Principles:** `encode-lessons-in-structure`; `guard-the-context-window`; `laziness-protocol`.

**Resolve:** Give each policy one authoritative definition; use concise references or generated summaries elsewhere. Add conditional navigation from `AGENTS.md` to relevant architecture sections for boundary changes, durable execution, schema changes, and completion checks. Split reference material only if those branches benefit; document length alone is not a reason to split it.

### F10 · P2 · Bootstrap convergence and environment ownership are unspecified

**Gap.** The autonomous bootstrap workflow provisions resources, applies migrations, configures secrets, and deploys, but defines no stable resource identity or resume behavior. The idempotency requirement currently applies to agent tasks, while bootstrap is another crash-prone sequence of state mutations. “Use isolated test environments” also leaves resource ownership and concurrent-run isolation as conventions.

**Evidence:** [isolated tests](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:553), [bootstrap steps](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:573), [environment strategy](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:589), [fresh-repository acceptance](/Users/pc/Documents/repos/touch-grass/ARCHITECTURE.md:670).

**Principles:** `make-operations-idempotent`; `separate-before-serializing-shared-state`; `build-the-lever`.

**Resolve:** Provide a rerunnable bootstrap command with discover/select/create behavior, stable environment/resource identity, and explicit ownership of resumable state. Isolate independent development and CI runs; serialize only genuinely shared operations such as applying migrations to one database. Provide a supported fallback when isolated resources are unavailable under the selected plan. Keep required authentication/irreversible approvals explicit.

**Proof required:** A second bootstrap and a bootstrap resumed after interruption converge on the intended resources without duplicates. Concurrent independent runs cannot reset or mutate each other's data.

## Coverage of all 24 principles

`Aligned` means the specification supports the principle. `Gap` references an actionable omission or conflict. `Conditional` means the triggering work has not occurred in the reviewed artifact; absence of a process paragraph is not automatically an architecture defect. `Unproven` means the principle calls for evidence not supplied here.

All skill identifiers below refer to their `SKILL.md` under `/Users/pc/.codex/plugins/cache/pstack-claude/pstack/0.9.90/skills/`.

| Principle skill | Assessment | Evidence or qualification |
|---|---|---|
| `principle-attack-the-premise` | Conditional | No repeated failed fixes are supplied. If feasibility probes repeatedly fail, test their common premise before changing more implementation. |
| `principle-boundary-discipline` | Gap | Thin RPC handlers and runtime-independent schemas align; complete adapter parsing, pure decisions, and enforcement semantics in F5, F7, F8. |
| `principle-build-the-lever` | Aligned | Ordinary quality commands, generated DB types, dependency checks, and negative fixtures are planned (§§5–8). Bootstrap needs the same treatment (F10). This audit includes a rerunnable coverage check. |
| `principle-encode-lessons-in-structure` | Gap | Negative fixtures and reference-first correction are strong (§§6, 10), but contradictory policy copies undermine the encoded rules (F1, F7–F9). |
| `principle-exhaust-the-design-space` | Unproven | No competing prototypes or comparison evidence accompanies the novel architecture decisions. Established patterns need no ritual alternatives; novel choices should have 2–3 focused comparisons before commitment. |
| `principle-experience-first` | Aligned | Working foundations, responsive shell, feedback states, and a small reference scope support consumers (§§1, 4). Actual usability and polish require implementation evidence. |
| `principle-explain-the-number` | Conditional | No measured performance/eval result is reported. Future free-tier feasibility measurements need workloads, run counts, spread, observed limits, and evidence that real work ran (§9). |
| `principle-fix-root-causes` | Aligned | Request/task correlation, persistent events, diagnostics, and structural corrections support diagnosis (§§4, 10). No bug investigation is supplied to validate the method itself. |
| `principle-foundational-thinking` | Gap | Quality infrastructure and contracts are planned, but the foundational task/attempt and shared-admission models remain unspecified (F2–F4). An implementation plan should establish them before orchestration. |
| `principle-guard-the-context-window` | Gap | Minimal agent instructions and feature-local work align. Conditional pointers and removal of drifting policy copies are missing (F9). No arbitrary file-size limit is needed. |
| `principle-laziness-protocol` | Aligned | Optional layers, direct repository calls for simple CRUD, and no speculative shared APIs reduce ceremony (§§1–3). Consolidate duplicated policy decisions (F8–F9). |
| `principle-make-operations-idempotent` | Gap | Correct intent is explicit for tasks, but crash recovery and bootstrap convergence lack concrete contracts (F2, F4, F10). |
| `principle-migrate-callers-then-delete-legacy-apis` | Conditional | No existing API migration is being designed. For coordinated internal changes, migrate callers/tests and remove the old API in the same wave. External compatibility requires separate judgment. |
| `principle-minimize-reader-load` | Aligned | Predictable owners, optional services, and no forwarding-only CRUD service compress navigation (§§1–3). Do not turn the illustrative directory tree into mandatory pass-through files. |
| `principle-model-the-domain` | Gap | Discriminated turn blocks align, but task lifecycle/attempt/cancellation invariants are not yet encoded in a domain model (F3). |
| `principle-never-block-on-the-human` | Aligned | Autonomous repairs, optional hooks, and provider tools support asynchronous supervision (§§8–10). Appropriate production approvals do not contradict this principle. |
| `principle-outcome-oriented-execution` | Conditional | No planned rewrite or migration phases are supplied. If introduced, declare scoped temporary breakage and require full end-state verification; resolve completion ambiguity first (F1). |
| `principle-prove-it-works` | Gap | Real journeys, negative fixtures, and deployed verification are good. Completion can still stop at static checks, and boundary fixtures need more precise proof (F1, F7). |
| `principle-redesign-from-first-principles` | Conditional | No new requirement or before/after redesign is supplied. Future changes must propagate through types, examples, rationale, and policy summaries; F9 identifies current drift risks. |
| `principle-separate-before-serializing-shared-state` | Gap | Feature ownership and atomic writes help, but shared admission and environment isolation need structural guarantees (F4, F10). A global migration ledger is not itself a violation: one database requires ordered history. |
| `principle-sequence-verifiable-units` | Conditional | A static target architecture is not a delivery plan. Bootstrap and future multi-unit implementation should use checked phases; there is no execution history here to establish a violation. |
| `principle-subtract-before-you-add` | Aligned | No placeholders, no speculative domains, optional layers, and architecture improvement over accumulating instructions align (§§1, 2, 10). Actual removal-before-construction is conditional on future changes. |
| `principle-test-behavior-not-implementation` | Gap | Behavior-driven E2E journeys and consequential-invariant tests align. Narrow the mocked-call exclusion so external effects remain testable (F6). |
| `principle-type-system-discipline` | Gap | Discriminated blocks and generated DB types align. Define semantic IDs, task-state invariants, and parsing at all external boundaries (F3, F5). |

## Suggested resolution order

1. Unify completion and platform-import policy (F1, F8); remove contradictory summaries (F9).
2. Define task, attempt, dispatch, effect, and admission contracts together (F2–F4), then specify crash/race tests for those contracts.
3. Complete boundary parsing and compilation-aware enforcement (F5, F7); narrow testing guidance (F6).
4. Define resumable bootstrap and environment ownership (F10), then gather runtime/provider feasibility evidence.

The last two process principles, outcome-oriented execution and verifiable units, can coexist: allow planned reversible breakage inside a declared unit, and require the unit's verification gate before building the next unit on it.

## Template architecture synthesis and revisions

This section records how [the template architecture](README-TEMPLATE-ARCHITECTURE.md) was chosen and revised, and how it answers F1 to F10. The contract itself stays free of process history.

### Synthesis decision

Three model-diverse packages were produced with the architect/arena workflow, each comparing structurally different execution authorities. All recommended database authorization. An independent cross-judge agreed with the parent review that candidate A provided the strongest base. Its decisive distinction was separating attempt ownership from the evidence of external effects; a terminal task alone cannot prove an in-flight request stopped.

| Whole architecture | Interface depth and decision |
|---|---|
| Database-authorized execution, selected | Five caller operations hide admission, arbitration, recovery, and dispatch. SQL facts suffice after Workflow history expires. |
| Workflow-owned state machine with command inbox/projection | Hides sequencing in a Workflow but exposes command acknowledgement, projection freshness, and generation takeover. Shared admission still requires database arbitration. Rejected. |
| Workflow-paced execution with a checkpoint cursor | Convenient happy-path orchestration, but reconstructing a distinct cursor from DB facts adds another progress representation. The selected design keeps only a sequence number for unique step names; PostgreSQL stays authoritative. |

Two narrow grafts came from candidate B. Limits follow the actual shared provider/credential resource, which the gateway now enforces per key and per user. Selected live resources have an explicit Auth/DB-RLS/Storage/Worker/Workflow/gateway proof matrix. Candidate C contributed no unique retained contract. Retrying by reopening a terminal task and overlapping policy authorities were rejected.

### Revisions

1. **Gap review.** [The gap review](TEMPLATE-ARCHITECTURE-GAPS.md) traced both reference features and found that the agent loop, turn ownership, and tool calls had no model. It also found an in-application money and token ledger that was never a product requirement. The user decided that spend and token budgets belong to an AI gateway (LiteLLM or equivalent) and tracing to Langfuse.
2. **First adversarial review** (three-model panel). It found crash-path faults in the revised loop. Step names collided, turn writes bypassed the fence, completion duplicated the final turn, lost sends could not be expressed, and transient failures burned attempts. The fixes were decision tables, a fenced `commit_step` routine, nested deadlines, and an outcome classification. The user also cut non-pure tools, effect classes, operator resolution, pruning, the event log, separate fence and dispatch records, and environment reconciliation into deferred extensions.
3. **Second adversarial review** (same panel). It found narrower SQL and timing gaps:
   - A grant model that could not restrict `insert_agent_turn` to `commit_step`.
   - An ambiguous send acceptance rule.
   - No fence between concurrent `advance` calls of one attempt.
   - Backoff that could not be computed from the snapshot.
   - Deterministic failures that consumed every attempt.
   - Unenforced duration and tool-call limits.
   - Leases that could expire before dispatch.
   - An unpersisted model response.
   - Quadratic prompt storage.
   - Unbounded per-user rows.
   - An inconsistent lock order.

   The contract now uses a role-based grant boundary, an attempt token, a SQL acceptance predicate with one response per step, timing constants whose nesting the database enforces, and per-user rate windows. The panel's view was that remaining detail is better settled by unit 2's real PostgreSQL race and grant tests than by further prose review.

### Architect red flags

| Architect red flag | Selected design response |
|---|---|
| Shallow module | Task and turn operations complete meaningful use cases; no extra forwarding service/barrel. |
| Information leakage | Parse into domain values; execution and storage details stay private. |
| Temporal decomposition | Task knowledge stays in one feature across request, recovery, and execution. |
| Pass-through method | RPC adds security, repository adds atomicity, Workflow adds durability; omit any layer without a distinct job. |
| Split ownership | PostgreSQL arbitrates facts; the gateway arbitrates spend; checkpoints, query caches, and Langfuse are subordinate replicas. |
| Two ways to do one task | One task capability, one transcript capability, one mutation transport, one read transport, one model path, and one recovery path. |
| Importable internals | Source rules and SQL grants reject access except through named public entrypoints and the composition root. |
| Hand-synced list | Policy-driven checks/profiles/navigation; schema-generated DB types; no duplicated policy tables in agent instructions. |

### Finding coverage

| Finding | Design contract | Decisive proof before implementation acceptance |
|---|---|---|
| F1 | [Verification](README-TEMPLATE-ARCHITECTURE.md#verification): one policy-driven completion profile, full CI/end-state gates. | A type or behavior failure prevents completion even when fast checks pass. |
| F2 | [Persistence and dispatch recovery](README-TEMPLATE-ARCHITECTURE.md#persistence-and-dispatch-recovery): transactional receipt and attempt, one lease-based recovery path, owned scheduled reconciliation. | Interrupt every dispatch boundary and recover without stranded tasks, consumed attempts, or concurrent sends. |
| F3 | [The agent loop](README-TEMPLATE-ARCHITECTURE.md#the-agent-loop) and [Lifecycle and cancellation](README-TEMPLATE-ARCHITECTURE.md#lifecycle-and-cancellation): immutable terminals, active-attempt and token fencing on every runner write. | All terminal race orders, concurrent advances, fenced commits, and explicit retry preserve terminal history. |
| F4 | [Admission and limits](README-TEMPLATE-ARCHITECTURE.md#admission-and-limits), [Timing](README-TEMPLATE-ARCHITECTURE.md#timing), and [Model calls](README-TEMPLATE-ARCHITECTURE.md#model-calls-and-gateway-outcomes): atomic slot admission, database-enforced lease nesting, per-user gateway budgets and rate windows. | Last-slot contention, stale senders, every gateway outcome, and budget refusal converge. |
| F5 | [Runtime parsing and authorization](README-TEMPLATE-ARCHITECTURE.md#runtime-parsing-and-authorization): every external adapter parses, including tool arguments, model outcomes, and stored blocks; domain decisions stay pure. | Malformed and oversized inputs fail at every boundary; branded IDs and exhaustive variants reject misuse. |
| F6 | [Verification](README-TEMPLATE-ARCHITECTURE.md#verification): gateway requests are behavioral evidence. | A private refactor preserves tests; a wrong or duplicated model request fails them. |
| F7 | [Policy and compiled boundaries](README-TEMPLATE-ARCHITECTURE.md#policy-and-compiled-boundaries): source ownership plus transformed client reachability. | The canonical RPC passes; each negative fixture fails with its designated diagnostic. |
| F8 | [Module map](README-TEMPLATE-ARCHITECTURE.md#module-map): only `src/server.ts` composes feature runtime code; platform has no exception. | A platform-to-feature registration import fails enforcement. |
| F9 | [Policy and compiled boundaries](README-TEMPLATE-ARCHITECTURE.md#policy-and-compiled-boundaries): one source per policy, derived consumers, conditional agent pointers. | Changing a rule requires regenerating/checking its consumers; contradictory older template summaries are removed on adoption. |
| F10 | [Template environments and deployment](README-TEMPLATE-ARCHITECTURE.md#template-environments-and-deployment): explicit manifest, inspect-before-retry deployment, isolated identities. Reconciliation is deferred. | A lost deployment response is resolved by inspection; dev and CI never share credentials. Surrounding provisioning and reconciliation are deferred. |

## Rerun the coverage check

```sh
python3 tools/check_architecture_review.py
```

Use `--skills-root PATH` when the installed pstack path differs. The check verifies all available principle skills have exactly one assessment row and that the architecture/skill contents still match this review's fingerprints. It cannot verify the semantic judgments or runtime behavior. If a fingerprint changes, review the change and update the findings before refreshing the fingerprint.
