# Touch Grass app

This is a TanStack Start application for AI-agent products. It runs on Cloudflare Workers and Supabase, and it is built to be extended by coding agents.

It ships two working reference features.

- **Account** is plain CRUD. Each user has one profile row with a display name.
- **Agent Chat** is the agent reference. Each message starts a durable run of the OpenAI Agents SDK loop on Cloudflare Workflows. A run survives crashes and redeploys, you can stop it, and the page shows each step as it is saved.

Sign-in uses Google only. The app sends no email.

`ARCHITECTURE.md` lists every file role, import rule, and rule check. `AGENTS.md` holds the short rules for coding agents.

## Requirements

- Node.js 22.23.0 or later.
- pnpm 11.25.0, the version pinned in `package.json`.
- Docker, to run the local Supabase stack. CI uses the same stack on GitHub runners.
- Google Chrome, which the Playwright tests and `pnpm verify:deployed` drive.

## Run the app locally

1. Install dependencies with `pnpm install`.
2. Create `supabase/.env` with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. Placeholder values are enough for the tests. Real values are needed only to sign in with Google by hand.
3. Run `pnpm exec supabase start` to start the local stack.
4. Run `pnpm dev:vars`. It writes `.dev.vars` with the local Supabase keys and a placeholder LLM key. It refuses to overwrite an existing file unless you pass `--force`.
5. In one terminal, run `pnpm dev:provider`. It starts the provider double, a local stand-in for the LLM API on port 4010.
6. In another terminal, run `pnpm dev`, then open `http://127.0.0.1:3000`. Use `127.0.0.1`, not `localhost`. The sign-in cookie belongs to the host that started the flow, and the Auth redirect URLs name `127.0.0.1`.

Automated tests never use Google. They create a confirmed user through the admin API and sign in with a password, using `tests/fixtures/test-users.ts`.

To sign in with Google on your machine, add `http://127.0.0.1:54321/auth/v1/callback` to the authorized redirect URIs of your Google OAuth client.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app against the local Supabase stack |
| `pnpm dev:vars` | Writes `.dev.vars` from the running local stack |
| `pnpm dev:provider` | Runs the provider double on port 4010 |
| `pnpm lint` | Oxlint with the anti-slop and policy-derived rules |
| `pnpm check:boundaries` | dependency-cruiser import rules |
| `pnpm check:repo` | Package pins, forbidden files, migration ledger, generated `ARCHITECTURE.md` |
| `pnpm check:fast` | `lint`, `check:boundaries`, and `check:repo` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit and architecture tests |
| `pnpm test:workers` | Integration tests in the Workers runtime, against the local database and the provider double |
| `pnpm test:db` | SQL tests in `supabase/tests/` |
| `pnpm test:e2e` | Builds the app and runs the Playwright journeys against it in workerd |
| `pnpm check:bundle` | Production build and client-bundle inspection |
| `pnpm check` | Every step above against a freshly reset local database, then `db:types` with a failure on any diff. CI runs this. |
| `pnpm verify:deployed --env <name>` | Live checks against a deployed environment, or `local` |
| `pnpm db:reset`, `pnpm db:diff <name>`, `pnpm db:types` | Reset the local database, generate a migration, regenerate database types |
| `pnpm gen:architecture` | Renders `ARCHITECTURE.md` from `tools/boundary-enforcement/policy.ts` |

### Run `pnpm check`

`pnpm check` runs the cheap static steps first, then resets the database and runs the rest. It stops at the first failure and prints the step name. Its summary lists each step as `passed`, `failed`, or `not run`.

If any step did not run, `pnpm check` exits with code 2 and prints `INCOMPLETE`. Treat that as a failure to verify, not as a pass. Pass `--skip <step,step>` or `--only <step,step>` to choose steps, and `--list` to print their names.

`pnpm check` starts the provider double itself when nothing listens on port 4010. It writes a temporary `.dev.vars` when none exists and removes it afterward.

### Run the E2E journeys

`pnpm test:e2e` builds the app and serves the build with `pnpm preview`, which runs the Worker in workerd, the runtime Cloudflare deploys, with local Workflows and cron. It needs port 3000 free, so stop `pnpm dev` first. To run the journeys against `pnpm dev` while you iterate, run `EXTERNAL_APP=1 pnpm test:e2e`.

The journeys mock no application code. The local Supabase stack is real. The provider double stands in for the LLM API, and `signInAs` stands in for Google. `pnpm verify:deployed` covers both services after a deploy.

## Set up the hosted environments

The template has two hosted environments, `dev` and `production`. Each has its own Supabase project, Worker, and GitHub environment. Nothing in the template creates cloud resources. You create them once, in this order.

### 1. Create the Google OAuth client

1. In Google Cloud, create one OAuth client of type "Web application". It serves every environment.
2. Set the consent screen audience to External and the publishing status to "In production". In "Testing", only listed test users can sign in.
3. Add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` for each hosted Supabase project, once you have the references from the next step.
4. Keep the default scopes `openid`, `email`, and `profile`. Any other scope requires Google app verification.

The consent screen names `<project-ref>.supabase.co`, not your app.

### 2. Create the Supabase projects

1. Create two projects, one for `dev` and one for `production`. Choose a database password for each and save it.
2. Copy each project's 20-letter reference from its URL.
3. In `supabase/config.toml`, set `project_id` in `[remotes.dev]` and `[remotes.production]` to those references. The shipped values are placeholders. `deploy.yml` stops if the value does not match the `SUPABASE_PROJECT_REF` secret, because `supabase config push` would otherwise apply the local `localhost` Auth URLs to the hosted project.
4. In `wrangler.jsonc`, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in each environment's `vars`. The publishable key is on the project's API keys page and is safe to commit.
5. Create a Supabase access token for the CLI. All Auth settings live in `supabase/config.toml`, so never change them in the dashboard.

### 3. Set up Cloudflare

1. Choose your account's workers.dev subdomain.
2. In `wrangler.jsonc`, replace `example` in each environment's `APP_URL` with that subdomain. For example, `https://touch-grass-dev.<subdomain>.workers.dev`.
3. Make the same replacement in `site_url` and `additional_redirect_urls` under `[remotes.dev.auth]` and `[remotes.production.auth]` in `supabase/config.toml`. The two files must agree, or sign-in redirects to the wrong host. `pnpm check:repo` fails when they differ.
4. Copy your Cloudflare account ID. Create an API token from the "Edit Cloudflare Workers" template.

### 4. Choose the LLM provider

Any provider with an OpenAI-compatible chat-completions API works. Set `LLM_BASE_URL` and `LLM_MODEL` in each environment's `vars` in `wrangler.jsonc`. The key is a secret, described below. Use a separate key for each environment and set a monthly spend limit at the provider.

### 5. Configure GitHub

1. Create the GitHub environments `dev` and `production`. Add required reviewers to `production`.
2. Add the secrets in the next section to each environment.
3. Require the `check` job of `ci.yml` before merging to `main`.

## Settings and secrets

Non-secret settings live in `wrangler.jsonc`. Secrets live only in the places below. Never write a secret into code, logs, or commits.

| Name | Where it is set | Used by |
|---|---|---|
| `ENVIRONMENT_ID` | `vars` in `wrangler.jsonc`. A UUID you choose once per environment. | The Worker |
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | `vars` in `wrangler.jsonc` | The Worker and `verify:deployed` |
| `SUPABASE_SECRET_KEY` | `.dev.vars` locally. GitHub environment secret for deploys. | The Worker, uploaded by `deploy.yml`. `verify:deployed`. |
| `LLM_API_KEY` | `.dev.vars` locally. GitHub environment secret for deploys. | The Worker, uploaded by `deploy.yml` |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | `supabase/.env` locally. GitHub environment secrets. | `supabase config push` and the local stack |
| `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` | GitHub environment secrets | `deploy.yml` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub environment secrets | `deploy.yml` |

## Deploy and verify

CI runs `pnpm check` on every pull request. It starts the local Supabase stack with the pinned CLI and sets the Google variables to placeholders.

A merge to `main` runs `deploy.yml`. It deploys only from `main`, including a manual run. For `dev`, then `production` after approval, it does the following.

1. Stops if `wrangler.jsonc` still holds a placeholder for the environment, before anything is installed or built.
2. Applies the migration ledger with `supabase db push`. Migrations go first because the Auth configuration enables a hook that calls a migrated function.
3. Applies `supabase/config.toml` with `supabase config push`.
4. Builds and deploys the Worker with `wrangler deploy`, uploading the two Worker secrets.
5. Runs `pnpm verify:deployed --env <name>`.

Each secret reaches only the steps that use it. `pnpm install` and `pnpm build` see none of them.

A deployment whose verification fails or does not run is unverified. If a step loses its response, inspect the migration history or the deployed Worker version before you retry.

`pnpm verify:deployed --env dev` reads the environment's settings from `wrangler.jsonc` and needs `SUPABASE_SECRET_KEY` in your shell. It runs these checks in order and stops at the first failure.

1. The `vars` hold no placeholder values.
2. The Supabase project answers. A paused Free project fails here as a failed prerequisite.
3. `<SUPABASE_URL>/auth/v1/settings` shows the Google provider enabled.
4. The app redirects a signed-out visitor from `/chat` to `/login`.
5. A test user is created, signs in, and sees `/chat` and `/account`.
6. One real message is sent to the configured LLM provider, and its run completes.
7. The test user is deleted, whether or not earlier checks passed.

`--env local` runs the same journey against the local stack and also confirms the provider double recorded the request.

## Free-tier limits

The template targets Cloudflare Workers Free and Supabase Free. These limits come from each provider's documentation on 2026-10-17. Check the provider pages before you rely on them.

| Service | Limit |
|---|---|
| Workers Free | 100,000 requests per day, 10 ms of CPU per request, 50 subrequests per request, 5 Cron Triggers per account |
| Workflows on Workers Free | 1,024 steps per instance, 100 concurrent instances per account, 10 ms of CPU per step, 3 days of retention for finished instances |
| Supabase Free | 2 active projects, 500 MB of database per project, 50,000 monthly active users, 5 GB of egress, and a pause after 1 week of inactivity |

Two projects use both Supabase Free slots. Restore a paused project from the Supabase dashboard. The sweep runs on a cron trigger every minute, which uses one of the five Cron Triggers for each environment.

The template stays inside these limits by default. At most 10 runs are active per environment, below the 100-instance Workflows limit. A run takes at most 8 steps.

## Costs

LLM spend is the only external cost. Cloudflare, Supabase, and Google sign-in cost nothing on the plans above.

The template keeps no spend ledger. These limits bound the spend.

- One message starts at most one run. A run takes at most `MAX_STEPS` (8) steps, and each step retries a failed model call up to `MODEL_CALL_RETRIES` (2) times. A run therefore sends at most `MAX_STEPS × (MODEL_CALL_RETRIES + 1)` requests to the provider, which is 24 with the defaults. A step whose result fails to save runs again and adds its requests to that count.
- Each model call produces at most 1,024 output tokens.
- Each call sends at most the last 20 runs of the conversation, capped at 512 KiB.
- Each user can send 60 messages per hour. At most 2 of a user's runs are active at once.

`pnpm verify:deployed` sends one short message to the real provider each time it runs.

## Optional agent hook

`tools/hooks/post-edit-check.ts` runs Oxlint and the dependency rules on one edited file and prints any findings. It gives feedback only. Nothing depends on it. For Claude Code, register it in `.claude/settings.json`.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "pnpm exec tsx tools/hooks/post-edit-check.ts" }]
      }
    ]
  }
}
```

## Bundled agent skills

`.agents/skills/` holds version-pinned copies of `systematic-debugging` and `verification-before-completion` from Superpowers and `react-best-practices` from Vercel, plus a `touch-grass` skill that verifies this repository. `.agents/skills/UPSTREAM.md` lists each source, its pinned commit, and how to verify the copies.
