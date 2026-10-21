## Architecture

- ARCHITECTURE.md lists every file role, import rule, and rule check. It is generated from `tools/boundary-enforcement/policy.ts`. To change a rule, change the policy and its check, then run `pnpm gen:architecture`.
- Organize by feature. Copy the closest reference: `account` for plain CRUD, `agent-chat` for agent work.
- UI reads and writes through the feature's `*.queries.ts`.
- A feature imports only another feature's `*.schema.ts`. Routes compose UI from several features.
- Database definitions live in `supabase/schemas/<owner>/`. Copy the account access pattern.
- Keep feature tests, including E2E, in the feature directory.
- Prefer meaningful E2E and integration tests over trivial unit tests.
- A comment in `src/` starts with `SAFETY:` for a cast, `WHY:` for a constraint from an SDK, PostgreSQL, or an external API, or is a tool directive. Delete any other comment, or encode it as a type, test, or lint rule.
- Before reporting completion, run `pnpm check:fast`, `pnpm typecheck`, and the changed features' tests, and fix every failure.

## Skills

- Use the `poteto-mode` skill when a task touches more than one file or changes a signature other files call, involves a design or architecture choice, or is a bug with an unknown cause or a performance issue. Work smaller tasks directly and verify them on the real artifact.
- Use the `evals` skill to build, audit, or improve against an eval of an LLM feature.
