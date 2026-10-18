# Touch Grass: MVP Specification

**Tagline:** Bootstrap your project. Let cloud agents build it.

**Goal:** In a single command, your coding agent sets up a batteries-included project scaffold that makes development with coding agent tools a breeze. This includes GitHub repository creation, template installation, Codex Cloud provisioning, and setup verification.

## Status

| Part | State |
|---|---|
| Template (`assets/template/`) | Implemented. [ARCHITECTURE.md](ARCHITECTURE.md) is its specification. |
| Repository-local `$touch-grass` verification skill | Implemented, at `assets/template/.agents/skills/touch-grass/SKILL.md`. |
| Bundled third-party agent skills | Implemented and pinned. See `assets/template/.agents/skills/UPSTREAM.md`. |
| Global `$touch-grass` skill (`touch-grass/SKILL.md`) | Not built. |
| Provisioning scripts | Not built. |
| Codex Cloud setup and handoff | Not built. |

The remaining work is the global skill and everything it orchestrates. The template is its input and is not changed by this work, except to fix defects that provisioning or cloud verification exposes.

## User Experience

1. User invokes `$touch-grass` in local Codex.
2. Agent creates a private GitHub repository and installs the bundled template.
3. Agent provisions and configures a Codex Cloud environment.
4. Agent verifies the cloud development environment. If runtime isolation prevents verification, instruct the user to invoke `$touch-grass` from the new cloud environment to complete it.

**Zero configuration, no wizard, no questions except unavoidable authorization.**

## Architecture & Decisions

- **Interface:** Globally installed Codex Skill (`touch-grass/SKILL.md`).
- **Stack:** Hardcoded and opinionated. No alternatives. TanStack Start with React and TypeScript, on Cloudflare Workers and Workflows, with Supabase for PostgreSQL and Auth, Google sign-in, and the OpenAI Agents SDK against any OpenAI-compatible provider. [ARCHITECTURE.md](ARCHITECTURE.md) lists the full stack.
- **Scaffolding:** The working template in `assets/template/`. It holds application code, two reference features (Account and Agent Chat), database migrations and SQL tests, unit, Workers, and E2E tests, boundary enforcement, a CI workflow, a Workers Builds deploy command (`pnpm cf:deploy`), `AGENTS.md`, and bundled agent skills. No external templates or dynamic code generation.
- **Provisioning:** Deterministic scripts copy the template, initialize Git, create a private GitHub repository, and push the initial commit.
  - Copy only the template's Git-tracked files. The working directory also holds build and test output (`node_modules/`, `dist/`, `test-results/`, `.wrangler/`, `.tanstack/`, `.dev.vars`), which the template's `.gitignore` excludes and which must never reach the new repository.
  - Keep `pnpm-lock.yaml`. Every check installs with `--frozen-lockfile`.
- **Agent Skills:** The template vendors pstack, `grill-me` and `grilling` (Matt Pocock), `show-me` (HumanLayer), and `vercel-react-best-practices` in `.agents/skills/`. The [skills CLI](https://github.com/vercel-labs/skills) installs them at pinned commits and records each in `skills-lock.json`, and `pnpm check:repo` fails when a copy differs from its recorded hash. The template also holds two repository-local skills: `touch-grass` (verification) and `evals`, a provider-neutral adaptation of Anthropic's eval guides. `AGENTS.md` carries pstack's routing rules, because a skills-only install has no session hook.
- **Cloud setup:** Provision and configure Codex Cloud through supported interfaces. If programmatic provisioning is unavailable, guide the user through the native setup. The environment needs Node.js 22.23.0 or later, pnpm 11.25.0 through Corepack (pinned by `packageManager` in `package.json`), and `pnpm install --frozen-lockfile` as its setup script.
- **Verification:** Run the repository-local `$touch-grass` skill. It runs four checks in order, stops at the first failure, and reports each as `passed`, `failed`, or `not run`:
  1. Repository access: `git ls-remote --exit-code origin HEAD`.
  2. Install: `pnpm install --frozen-lockfile`.
  3. Build: `pnpm build`.
  4. Check: `pnpm check`. It covers lint, boundaries, type checking, unit, Workers, SQL, and E2E tests, and the client-bundle inspection.

  The skill never provisions anything, so it is safe to repeat.
- **Execution boundary:** Local Codex handles initialization and orchestration. Codex Cloud handles verification when required and all subsequent development.

## Scope

The MVP provisions the GitHub repository and the Codex Cloud environment. It does not provision the template's hosted environments.

- **Hosted environments are manual.** Deploying the app needs two Supabase projects, a Cloudflare account, a Google OAuth client, an LLM provider key, and a connection from each Worker to the repository in Cloudflare Workers Builds. The template's `README.md` documents that setup. Touch Grass creates none of these resources and asks for none of these credentials.
- **Nothing deploys until the person connects Workers Builds.** The template has no deploy workflow in GitHub. Cloudflare Workers Builds builds and deploys each Worker, so the initial push triggers no deploy run. A deploy that Workers Builds starts early stops at the template's `pnpm cf:deploy` checks until `wrangler.jsonc` holds real values. Report this as "deployment not configured", not as a verification failure.
- **CI runs on pull requests only.** The initial push to `main` triggers no `ci.yml` run, so a green CI badge is not evidence of verification.

## Dependencies & Authentication

- **Local:** Codex, Git, authenticated GitHub CLI (`gh`). GitHub MCP optional.
- **GitHub:** Permissions to create private repositories and push code.
- **Codex Cloud:** Cloud access enabled and GitHub integration authorized for the new repository.
- **Template runtime:** Node.js 22.23.0 or later, pnpm 11.25.0, Docker for the local Supabase stack, and Google Chrome for Playwright. `pnpm check` needs all four. Google OAuth values may be placeholders, because no test contacts Google.
- **Preflight:** Check dependencies and authentication before provisioning. Request authorization only when necessary; never ask users to share credentials in chat.

## Acceptance Criteria

One `$touch-grass` invocation creates a private GitHub repository with the template's tracked files, bundled Agent Skills, and a configured Codex Cloud environment.

**Success requires passing cloud verification:** all four checks of the repository-local `$touch-grass` skill report `passed` in Codex Cloud. If runtime isolation prevents direct verification, provide an explicit `$touch-grass` handoff to the new cloud environment. Report provisioning, verification, and deployment status separately; never claim unverified setup is complete. A `pnpm check` that exits with code 2 (`INCOMPLETE`) is a failure to verify, not a pass.

## Open Questions

- **Docker in Codex Cloud.** `pnpm check` resets a local Supabase stack, which needs Docker. If the Codex Cloud runtime cannot run Docker, check 4 reports `not run` and cloud verification can never pass as written. Confirm Docker support before building the cloud setup. If it is unavailable, choose between running the database steps elsewhere (for example, CI on a pull request opened by the skill) and narrowing the cloud gate, and record the decision here.
- **Chrome in Codex Cloud.** Playwright drives Google Chrome. Confirm the runtime has it or that the setup script can install it.
- **Programmatic Codex Cloud provisioning.** Confirm which supported interface, if any, creates an environment and sets its setup script. Otherwise, specify the guided native setup.
