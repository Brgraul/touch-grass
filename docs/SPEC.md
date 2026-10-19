# Touch Grass: MVP Specification

**Tagline:** Bootstrap your project. Ship it to staging. Go outside.

**Goal:** In a single command, your coding agent sets up a batteries-included project scaffold that makes development with coding agent tools a breeze. This includes GitHub repository creation, template installation, and verification on the local machine. On request, the same agent guides the person through a hosted staging environment deployed from that machine.

## Status

| Part | State |
|---|---|
| Template (`template/`, shipped as `touch-grass/assets/template.bundle`) | Implemented. [ARCHITECTURE.md](ARCHITECTURE.md) is its specification. |
| Repository-local `$touch-grass` verification skill | Implemented, at `template/.agents/skills/touch-grass/SKILL.md`. |
| Bundled third-party agent skills | Implemented and pinned. See `template/.agents/skills/UPSTREAM.md`. |
| Global `$touch-grass` skill (`touch-grass/SKILL.md`) | Implemented. Default GitHub bootstrap with local verification, and a separate guided staging reference. |
| Provisioning scripts | Implemented. Pinned committed snapshot, private recovery journal and conservative GitHub identity checks. Offline fixture verification only; no live resources created for implementation tests. |
| Guided staging (`tg staging`, `touch-grass/references/staging.md`) | Implemented. On 19 October 2026 the flow ran against a real Supabase project, Google OAuth client, OpenAI key and Cloudflare Worker, including real Google sign-in and a tool-using model reply. The helper's project-creation path is covered by offline tests only. |

The global skill orchestrates safe local and GitHub steps, local verification, and the guided staging flow. The template is its input and is not changed by this work, except to fix defects that provisioning or verification exposes.

## User Experience

1. User invokes `$touch-grass` in a local coding agent.
2. Agent creates a private GitHub repository and installs the bundled template.
3. Agent runs the repository's four checks on the local machine.
4. On request, agent sets up a staging environment. It opens the terminal tabs and browser pages itself. The person only approves logins, consent, policies, downloads and cost choices.

**Zero configuration, no wizard, no questions except unavoidable authorization.**

## Architecture & Decisions

- **Interface:** Globally installed agent skill (`touch-grass/SKILL.md`), for Codex or Claude Code.
- **Stack:** Hardcoded and opinionated. No alternatives. TanStack Start with React and TypeScript, on Cloudflare Workers and Workflows, with Supabase for PostgreSQL and Auth, Google sign-in, and the OpenAI Agents SDK against any OpenAI-compatible provider. [ARCHITECTURE.md](ARCHITECTURE.md) lists the full stack.
- **Scaffolding:** The working template in `template/`. It holds application code, two reference features (Account and Agent Chat), database migrations and SQL tests, unit, Workers, and E2E tests, boundary enforcement, a CI workflow, a Workers Builds deploy command (`pnpm cf:deploy`), `AGENTS.md`, and bundled agent skills. No external templates or dynamic code generation.
- **Provisioning:** Deterministic scripts fetch the template from the skill's Git bundle, initialize Git, create a private GitHub repository, and push the initial commit.
  - Ship only the template's staged Git tree. `node tools/build-template-bundle.ts` packs it into `touch-grass/assets/template.bundle`, and a test fails when the bundle differs from the staged `template/`. Build and test output in the working directory (`node_modules/`, `dist/`, `test-results/`, `.wrangler/`, `.tanstack/`, `.dev.vars`) never reaches the bundle. One file also survives installers that skip files, such as the skills CLI dropping `metadata.json`.
  - Keep `pnpm-lock.yaml`. Every check installs with `--frozen-lockfile`.
- **Agent Skills:** The template vendors pstack, `grill-me` and `grilling` (Matt Pocock), `show-me` (HumanLayer), and `vercel-react-best-practices` in `.agents/skills/`. The [skills CLI](https://github.com/vercel-labs/skills) installs them at pinned commits and records each in `skills-lock.json`, and `pnpm check:repo` fails when a copy differs from its recorded hash. The template also holds two repository-local skills: `touch-grass` (verification) and `evals`, a provider-neutral adaptation of Anthropic's eval guides. `AGENTS.md` carries pstack's routing rules, because a skills-only install has no session hook.
- **Verification:** Run the repository-local `$touch-grass` skill. It runs four checks in order, stops at the first failure, and reports each as `passed`, `failed`, or `not run`:
  1. Repository access: `git ls-remote --exit-code origin HEAD`.
  2. Install: `pnpm install --frozen-lockfile`.
  3. Build: `pnpm build`.
  4. Check: `pnpm check`. It covers lint, boundaries, type checking, unit, Workers, SQL, and E2E tests, and the client-bundle inspection.

  The skill never provisions anything, so it is safe to repeat.
- **Execution boundary:** Everything runs on the local machine: initialization, verification, and staging deploys. The `tg staging` helper creates the Supabase project, fills the environment config, stores secrets in a mode-0600 `.env.deploy.<env>` file, deploys with the template's `pnpm cf:deploy`, installs Worker secrets, and runs `pnpm verify:deployed`.

## Scope

The MVP provisions the GitHub repository and verifies it locally. Hosted environments are created only on request.

- **Staging is optional.** A staging environment needs one Supabase project, a Cloudflare account, a Google OAuth client and an LLM provider key. The global skill's staging reference deploys it from the local machine. The default workflow creates none of these resources and asks for none of these credentials. Production and Git-triggered deploys through Cloudflare Workers Builds remain documented in the template's `SETUP.md`.
- **Nothing deploys during default setup.** The template has no deploy workflow in GitHub, so the initial push triggers no deploy. `pnpm cf:deploy` refuses to run while `wrangler.jsonc` holds placeholders. Report this as "deployment not configured", not as a verification failure.
- **CI runs on pull requests only.** The initial push to `main` triggers no `ci.yml` run, so a green CI badge is not evidence of verification.

## Dependencies & Authentication

- **Local:** a skill-loading coding agent, Git, authenticated GitHub CLI (`gh`), Docker and Google Chrome.
- **GitHub:** Permissions to create private repositories and push code.
- **Staging:** Cloudflare, Supabase and Google Cloud accounts, and an LLM key with billing.
- **Template runtime:** Node.js 22.23.0 or later, pnpm 11.25.0, Docker for the local Supabase stack, and Google Chrome for Playwright. `pnpm check` needs all four. Google OAuth values may be placeholders, because no test contacts Google.
- **Preflight:** Check dependencies and authentication before provisioning. Request authorization only when necessary; never ask users to share credentials in chat.

## Acceptance Criteria

One `$touch-grass` invocation creates a private GitHub repository with the template's tracked files and bundled Agent Skills.

**Success requires passing local verification:** all four checks of the repository-local `$touch-grass` skill report `passed` on the local machine at the reported commit. Report provisioning, verification, and deployment status separately; never claim unverified setup is complete. A `pnpm check` that exits with code 2 (`INCOMPLETE`) is a failure to verify, not a pass.

**Staging succeeds** when `pnpm verify:deployed` prints `VERIFIED` and the acceptance journey passes: real Google sign-in, a model reply that uses the `calculate` tool, persistence across reload, and sign-out.

## Open Questions

- **Production release.** Staging proves the deploy path from a local machine. Production can reuse it with `--env production`, or move to Cloudflare Workers Builds as the template's `SETUP.md` describes. Publishing the Google client needs the person's homepage, privacy policy and possibly verification.
