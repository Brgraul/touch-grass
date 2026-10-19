# Touch Grass: MVP Specification

**Tagline:** Bootstrap your project. Ship it. Go outside.

**Goal:** In a single command, your coding agent sets up a batteries-included project scaffold that makes development with coding agent tools a breeze. The person creates an empty private repository and clones it; the agent installs the template there, pushes it, verifies it on the local machine, and guides the person through a hosted environment deployed from that machine.

## Status

| Part | State |
|---|---|
| Template (`template/`, shipped as `skills/touch-grass/assets/template.bundle`) | Implemented. [TEMPLATE-SPEC.md](TEMPLATE-SPEC.md) is its specification. |
| Repository verifier, `pnpm verify` | Implemented, at `template/tools/verify.ts`. |
| Bundled third-party agent skills | Implemented and pinned. See `template/.agents/skills/UPSTREAM.md`. |
| Global `$touch-grass` skill (`skills/touch-grass/SKILL.md`) | Implemented. One run: bootstrap of an empty clone, local verification, then a guided deploy. |
| Provisioning scripts | Implemented. Pinned committed snapshot, private recovery journal, and an initial push that never overwrites an existing remote branch. Offline fixture verification only; no live resources created for implementation tests. |
| Guided deploy (`tg deploy`, `skills/touch-grass/references/deploy.md`) | Implemented. On 19 October 2026 the flow ran against a real Supabase project, Google OAuth client, OpenAI key and Cloudflare Worker, including real Google sign-in and a tool-using model reply. The helper's project-creation path is covered by offline tests only. |

The global skill orchestrates safe local steps, the initial push, local verification, and the guided deploy. The template is its input and is not changed by this work, except to fix defects that provisioning or verification exposes.

## User Experience

1. User creates an empty private repository, clones it, and invokes `$touch-grass` from the clone's root in a local coding agent.
2. Agent commits the bundled template and pushes it to `origin`.
3. `tg verify` runs the repository's `pnpm verify` on the local machine.
4. Agent deploys the hosted environment. It opens the terminal tabs and browser pages itself. The person only approves logins, consent, policies, downloads and cost choices.

**Zero configuration, no wizard, no questions except unavoidable authorization.**

## Architecture & Decisions

- **Interface:** Globally installed agent skill (`skills/touch-grass/SKILL.md`), for Codex or Claude Code.
- **Stack:** Hardcoded and opinionated. No alternatives. TanStack Start with React and TypeScript, on Cloudflare Workers and Workflows, with Supabase for PostgreSQL and Auth, Google sign-in, and the OpenAI Agents SDK against any OpenAI-compatible provider. [TEMPLATE-SPEC.md](TEMPLATE-SPEC.md) lists the full stack.
- **Scaffolding:** The working template in `template/`. It holds application code, two reference features (Account and Agent Chat), database migrations and SQL tests, unit, Workers, and E2E tests, boundary enforcement, a CI workflow, a Workers Builds deploy command (`pnpm cf:deploy`), `AGENTS.md`, and bundled agent skills. No external templates or dynamic code generation.
- **Provisioning:** Deterministic scripts fetch the template from the skill's Git bundle into the person's empty clone, commit it, and push the initial commit to `origin`. Touch Grass never creates repositories.
  - Ship only the template's staged Git tree. `npm run bundle` packs it into `skills/touch-grass/assets/template.bundle`, and a test fails when the bundle differs from the staged `template/`. Build and test output in the working directory (`node_modules/`, `dist/`, `test-results/`, `.wrangler/`, `.tanstack/`, `.dev.vars`) never reaches the bundle. One file also survives installers that skip files, such as the skills CLI dropping `metadata.json`.
  - Keep `pnpm-lock.yaml`. Every check installs with `--frozen-lockfile`.
- **Agent Skills:** The template vendors pstack, `grill-me` and `grilling` (Matt Pocock), `show-me` (HumanLayer), and `vercel-react-best-practices` in `.agents/skills/`. The [skills CLI](https://github.com/vercel-labs/skills) installs them at pinned commits and records each in `skills-lock.json`, and `pnpm check:repo` fails when a copy differs from its recorded hash. The template also holds one repository-local skill: `evals`, a provider-neutral adaptation of Anthropic's eval guides. `AGENTS.md` carries pstack's routing rules, because a skills-only install has no session hook.
- **Verification:** Run `pnpm verify`. It runs on plain Node before the first install, runs four checks in order, stops at the first failure, and reports each as `passed`, `failed`, or `not run`:
  1. Repository access: `git ls-remote --exit-code origin HEAD`.
  2. Install: `pnpm install --frozen-lockfile`.
  3. Build: `pnpm build`.
  4. Check: `pnpm check`. It covers lint, boundaries, type checking, unit, Workers, SQL, and E2E tests, and the client-bundle inspection.

  It never provisions anything, so it is safe to repeat. A missing `origin`, a stopped Docker, or an incomplete `pnpm check` reports `not run`, and it exits with code 2. `tg verify` runs it as the `local-verification` step and records a pass only for the clean HEAD it tested.
- **Progress:** `tg run`, `tg verify` and `tg deploy` append step status and command output to `.git/touch-grass-progress/events.jsonl`. They give the agent only summaries, and the full output of each step goes to a log in `logs/` beside it. `tg watch` follows the event log in a terminal the person can see. It shows the three steps, the current step's sub-steps, a remaining-time estimate and the last lines of output. Estimates start as per-step guesses and switch to this machine's own timings once a step has run. Steps where the person must act are named in advance. A session with no terminal for the person falls back to the agent's task list.
- **Execution boundary:** Everything runs on the local machine: initialization, verification, and deploys. The `tg deploy` helper creates the Supabase project, fills the environment config, stores secrets in a mode-0600 `.env.deploy.<env>` file, deploys with the template's `pnpm cf:deploy`, installs Worker secrets, and runs `pnpm verify:deployed`.

## Scope

Every run ends with a working hosted environment. The template ships one, `production`.

- **One environment, named by the project.** `tg deploy` reads the environments from `wrangler.jsonc` and needs `--env` only when there are several. A project adds environments such as `staging` by adding a `wrangler.jsonc` environment and its `[remotes.<name>]` block, as the template's README describes. No tool hardcodes a name.
- **Deploy is the last stage.** It starts only after all four local checks pass. It needs one Supabase project, a Cloudflare account, a Google OAuth client and an LLM provider key. The global skill's deploy reference deploys it from the local machine. Git-triggered deploys through Cloudflare Workers Builds remain documented in the template's `SETUP.md`.
- **Only the deploy stage deploys.** The template has no deploy workflow in GitHub, so the initial push triggers no deploy. `pnpm cf:deploy` refuses to run while `wrangler.jsonc` holds placeholders, which `tg deploy configure` fills.
- **CI runs on pull requests only.** The initial push triggers no `ci.yml` run, so a green CI badge is not evidence of verification.

## Dependencies & Authentication

- **Local:** a skill-loading coding agent, Git with credentials that can push to the repository, Docker and Google Chrome.
- **Repository:** An empty private repository the person created, cloned locally.
- **Deploy:** Cloudflare, Supabase and Google Cloud accounts, and an LLM key with billing.
- **Template runtime:** Node.js 22.23.0 or later, pnpm 11.25.0, Docker for the local Supabase stack, and Google Chrome for Playwright. `pnpm check` needs all four. Google OAuth values may be placeholders, because no test contacts Google.
- **Preflight:** Check dependencies and authentication before provisioning. Request authorization only when necessary; never ask users to share credentials in chat.

## Acceptance Criteria

One `$touch-grass` invocation in an empty clone commits and pushes the template's tracked files and bundled Agent Skills, verifies them locally, and deploys the hosted environment. Setup is complete only when both criteria below hold.

**Local verification passes:** all four checks of `pnpm verify` report `passed` on the local machine at the reported commit. The deploy starts only after this passes. Report provisioning, verification, and deployment status separately; never claim unverified setup is complete. A `pnpm check` that exits with code 2 (`INCOMPLETE`) is a failure to verify, not a pass.

**The deploy succeeds** when `pnpm verify:deployed` prints `VERIFIED` and the acceptance journey passes: real Google sign-in, a model reply that uses the `calculate` tool, persistence across reload, and sign-out.

## Open Questions

- **Public launch.** Setup leaves the Google client in Testing mode, so only listed test users can sign in. Publishing it needs the person's homepage, privacy policy and possibly verification. Later deploys can stay local with `tg deploy push`, or move to Cloudflare Workers Builds as the template's `SETUP.md` describes.
