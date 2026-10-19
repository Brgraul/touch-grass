# Touch Grass app

This is a TanStack Start application for AI-agent products. It runs on Cloudflare Workers and Supabase, and it is built to be extended by coding agents.

It ships two working reference features.

- **Account** is plain CRUD. Each user has one profile row with a display name.
- **Agent Chat** is the agent reference. Each message starts a durable run of the OpenAI Agents SDK loop on Cloudflare Workflows. A run survives crashes and redeploys, you can stop it, and the page shows each step as it is saved.

Sign-in uses Google only. The app sends no email.

`ARCHITECTURE.md` lists every file role, import rule, and rule check. `AGENTS.md` holds the short rules for coding agents.

[`SETUP.md`](SETUP.md) is a checklist of every account, credential, and setting a person must provide before the app runs and deploys.

## Requirements

- Node.js 22.23.0 or later. `.node-version` pins 22.23.2, which CI and Workers Builds use.
- pnpm 11.25.0, the version pinned in `package.json`.
- Docker, to run the local Supabase stack.
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
| `pnpm check` | Every step above against a freshly reset local database, then `db:types` with a failure on any diff. |
| `pnpm verify` | Repository access, `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm check`. See [Verify a checkout](#verify-a-checkout). |
| `pnpm cf:deploy` | Applies migrations and Auth configuration, then deploys the Worker. Workers Builds runs it. See [Deploy and verify](#deploy-and-verify). |
| `pnpm verify:deployed --env <name>` | Live checks against a deployed environment, or `local` |
| `pnpm db:reset`, `pnpm db:diff <name>`, `pnpm db:types` | Reset the local database, generate a migration, regenerate database types |
| `pnpm gen:architecture` | Renders `ARCHITECTURE.md` from `tools/boundary-enforcement/policy.ts` |

### Run `pnpm check`

`pnpm check` runs the cheap static steps first, then resets the database and runs the rest. It stops at the first failure and prints the step name. Its summary lists each step as `passed`, `failed`, or `not run`.

If any step did not run, `pnpm check` exits with code 2 and prints `INCOMPLETE`. Treat that as a failure to verify, not as a pass. Pass `--skip <step,step>` or `--only <step,step>` to choose steps, and `--list` to print their names.

`pnpm check` starts the provider double itself when nothing listens on port 4010. It writes a temporary `.dev.vars` when none exists and removes it afterward.

### Verify a checkout

`pnpm verify` proves a clean checkout works. It runs four checks in order: repository access (`package.json`, `wrangler.jsonc` and `git ls-remote --exit-code origin HEAD`), `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check`. It stops at the first failure and prints each check as `passed`, `failed`, or `not run`, with the tested commit.

A missing `origin`, a stopped Docker, or an incomplete `pnpm check` reports `not run`, and `pnpm verify` exits with code 2. Treat that as a failure to verify. It runs on plain Node, so it works before the first install. It never provisions or deploys anything.

### Run the E2E journeys

`pnpm test:e2e` builds the app and serves the build with `pnpm preview`, which runs the Worker in workerd, the runtime Cloudflare deploys, with local Workflows and cron. It needs port 3000 free, so stop `pnpm dev` first. To run the journeys against `pnpm dev` while you iterate, run `EXTERNAL_APP=1 pnpm test:e2e`.

The journeys mock no application code. The local Supabase stack is real. The provider double stands in for the LLM API, and `signInAs` stands in for Google. `pnpm verify:deployed` covers both services after a deploy.

## Set up the hosted environments

The template has two hosted environments, `dev` and `production`. Each has its own Supabase project and Worker. Cloudflare Workers Builds, Cloudflare's Git integration, builds and deploys each Worker from this repository. GitHub runs only the pull request check. Nothing in the template creates cloud resources. You create them once, in this order. [`SETUP.md`](SETUP.md) lists the same steps as a checklist.

### 1. Create the Google OAuth client

1. In Google Cloud, create one OAuth client of type "Web application". It serves every environment.
2. Set the consent screen audience to External and the publishing status to "In production". In "Testing", only listed test users can sign in.
3. Add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` for each hosted Supabase project, once you have the references from the next step.
4. Keep the default scopes `openid`, `email`, and `profile`. Any other scope requires Google app verification.

The consent screen names `<project-ref>.supabase.co`, not your app.

### 2. Create the Supabase projects

1. Create two projects, one for `dev` and one for `production`. Choose a database password for each and save it. Prefer letters and digits, so step 6 needs no percent-encoding.
2. Copy each project's 20-letter reference from its URL.
3. In `supabase/config.toml`, set `project_id` in `[remotes.dev]` and `[remotes.production]` to those references. The shipped values are placeholders. `pnpm cf:deploy` stops if the value does not match the project in `SUPABASE_URL`, because `supabase config push` would otherwise apply the local `localhost` Auth URLs to the hosted project.
4. In `wrangler.jsonc`, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in each environment's `vars`. The publishable key is on the project's API keys page and is safe to commit. `SUPABASE_URL` must be `https://<project-ref>.supabase.co`. The deploy derives the project reference from it.
5. Create a Supabase access token for the CLI. All Auth settings live in `supabase/config.toml`, so never change them in the dashboard.
6. For each project, copy the session-mode pooler connection string from the project's Connect dialog. It uses port 5432 and the user `postgres.<project-ref>`. Put your database password in it, percent-encoded. This is `SUPABASE_DB_URL`. Use the pooler string, not the direct `db.<project-ref>.supabase.co` host. The direct host is IPv6 only on the Free plan, and the build container is not known to have IPv6.

### 3. Set up Cloudflare

1. Choose your account's workers.dev subdomain.
2. In `wrangler.jsonc`, replace `example` in each environment's `APP_URL` with that subdomain. For example, `https://touch-grass-dev.<subdomain>.workers.dev`.
3. Make the same replacement in `site_url` and `additional_redirect_urls` under `[remotes.dev.auth]` and `[remotes.production.auth]` in `supabase/config.toml`. The two files must agree, or sign-in redirects to the wrong host. `pnpm check:repo` fails when they differ.

You do not create a Cloudflare API token or copy an account ID. Workers Builds deploys with its own credentials.

### 4. Choose the LLM provider

Any provider with an OpenAI-compatible chat-completions API works. Set `LLM_BASE_URL` and `LLM_MODEL` in each environment's `vars` in `wrangler.jsonc`. The key is a secret, described below. Use a separate key for each environment and set a monthly spend limit at the provider.

### 5. Connect each Worker to Workers Builds

1. Create the release branch with `git push origin main:production`. Later releases fast-forward it.
2. In the Cloudflare dashboard, open Workers & Pages, choose Create, then Import a repository. Select the repository and name the Worker `touch-grass-dev`. This creates the Worker and installs the Cloudflare GitHub App on the repository. Repeat for `touch-grass-production`. Each Worker name must equal the `name` of its environment in `wrangler.jsonc`.
3. Give each Worker these build settings.

| Setting | `touch-grass-dev` | `touch-grass-production` |
|---|---|---|
| Production branch | `main` | `production` |
| Builds for non-production branches | Off | Off |
| Build command | `pnpm build` | `pnpm build` |
| Deploy command | `pnpm cf:deploy` | `pnpm cf:deploy` |
| Build variable `CLOUDFLARE_ENV` | `dev` | `production` |
| Build variable `PNPM_VERSION` | `11.25.0` | `11.25.0` |
| Build secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, with this environment's values | The same names, with this environment's values |

`CLOUDFLARE_ENV` makes the Vite plugin write the environment's name, bindings, and vars into `dist/server/wrangler.json`. `wrangler deploy` reads that file, so never pass `--env` to it. `PNPM_VERSION` is needed because the build image defaults to pnpm 10.11.1. Node comes from `.node-version`. Preview builds stay off because a preview version would run against a database whose migrations have not run.

4. Set the two runtime secrets once per Worker, after you run `pnpm exec wrangler login`. Each command prompts for the value.

```sh
pnpm exec wrangler secret put SUPABASE_SECRET_KEY --name touch-grass-dev
pnpm exec wrangler secret put LLM_API_KEY --name touch-grass-dev
```

Repeat with `--name touch-grass-production`. You can also set them in the dashboard. They persist across deploys, and the deploy never uploads them.

If the first build starts before you save the build secrets, or while `wrangler.jsonc` still holds placeholders, it stops at `pnpm cf:deploy` before it changes anything. Save the settings, merge your edits to `main`, and retry the build from the dashboard.

## Settings and secrets

Non-secret settings live in `wrangler.jsonc`. Secrets live only in the places below. Never write a secret into code, logs, or commits.

| Kind | Names | Where it is set | Used by |
|---|---|---|---|
| Wrangler `vars` | `ENVIRONMENT_ID`, a UUID you choose once per environment | `vars` in `wrangler.jsonc` | The Worker |
| Wrangler `vars` | `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | `vars` in `wrangler.jsonc` | The Worker, `cf:deploy`, and `verify:deployed` |
| Worker secrets | `SUPABASE_SECRET_KEY`, `LLM_API_KEY` | `wrangler secret put <NAME> --name touch-grass-<env>`, or the dashboard. Set once per Worker. | The Worker |
| Workers Builds build secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | The Worker's build settings in the dashboard | `pnpm cf:deploy` |
| Workers Builds build variables | `CLOUDFLARE_ENV`, `PNPM_VERSION` | The Worker's build settings in the dashboard | `pnpm build` and `pnpm cf:deploy` |
| Local files | `SUPABASE_SECRET_KEY`, `LLM_API_KEY` in `.dev.vars`. The two Google values in `supabase/.env`. | Your machine, never committed | The local app and the local Supabase stack |
| Your shell | `SUPABASE_SECRET_KEY` | Exported when you run `verify:deployed` | `verify:deployed` |

`SUPABASE_DB_URL` is the project's session-mode pooler string described in step 2. The project reference is not a secret. `cf:deploy` derives it from `SUPABASE_URL`.

Workers Builds exposes build secrets to every build command, including `pnpm install` and `pnpm build`. Keep dependencies pinned and reviewed.

## Deploy and verify

CI runs `pnpm check:fast` on every pull request, and the pull request shows the result as a check. It needs no secrets and no Docker, and it is the only GitHub workflow. Nothing deploys from GitHub.

Workers Builds deploys. A push to `main` builds and deploys `touch-grass-dev`. A push to `production` builds and deploys `touch-grass-production`. Each build runs `pnpm build` with `CLOUDFLARE_ENV` set, then `pnpm cf:deploy`. The deploy command stops at the first failure and does the following.

1. Requires `CLOUDFLARE_ENV` to name an environment in `wrangler.jsonc`.
2. Stops if `wrangler.jsonc` still holds a placeholder for that environment.
3. Derives the project reference from `SUPABASE_URL`, and requires `supabase/config.toml` to have a `[remotes.<environment>]` block with that `project_id`.
4. Requires the four build secrets. It lists missing names and never prints a value.
5. Applies the migration ledger with `supabase db push --db-url`. Migrations go first because the Auth configuration enables a hook that calls a migrated function. The database URL is a command-line argument, so other users of a shared machine can see it in the process list.
6. Applies `supabase/config.toml` with `supabase config push`.
7. Deploys the Worker with `wrangler deploy`.

To release production, check that `dev` verifies, then run `git push origin main:production`. The push fast-forwards `production` to `main`. Push only commits that are already on `main`.

Workers Builds does not run `verify:deployed`. After each deploy, run it yourself.

```sh
SUPABASE_SECRET_KEY=... pnpm verify:deployed --env dev
```

A deployment is unverified until that command passes. If a step loses its response, inspect the migration history or the deployed Worker version before you retry.

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
| Workers Builds on Free | 3,000 build minutes per month, 1 concurrent build per account, 20-minute build timeout |

Two projects use both Supabase Free slots. Restore a paused project from the Supabase dashboard. The sweep runs on a cron trigger every minute, which uses one of the five Cron Triggers for each environment. Both Workers share the account's single concurrent build, so a push to `main` and a push to `production` build one after the other.

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

`.agents/skills/` holds unchanged copies of pstack, `grill-me` and `grilling`, `show-me`, and `vercel-react-best-practices`, each pinned to a commit in `skills-lock.json`. `pnpm check:repo` fails when a copy differs from the hash recorded there. One skill is maintained in this repository: `evals`, adapted from Anthropic's eval guides, builds, audits, and improves against evals of its LLM features. `.agents/skills/UPSTREAM.md` lists each source and how to restore, add, or update a skill.
