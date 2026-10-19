# Setup checklist

This page lists every step a person must take before the app runs locally and deploys. The template creates no accounts, cloud resources, or credentials. `README.md` explains each step in more detail.

Cloudflare Workers Builds, Cloudflare's Git integration, builds and deploys each Worker. GitHub runs only the pull request check, which needs no secrets.

Do the sections in order. Later steps need values from earlier ones. The Google client needs the Supabase project references, and `supabase/config.toml` needs the Cloudflare subdomain.

## Accounts

- [ ] GitHub. A private repository on the Free plan works, because nothing deploys from GitHub.
- [ ] Cloudflare, on the Workers Free plan or higher.
- [ ] Supabase. The Free plan allows 2 active projects, and the template uses both. Pause or delete other Free projects first.
- [ ] Google Cloud, for the OAuth client.
- [ ] An LLM provider with an OpenAI-compatible chat-completions API. The shipped settings use OpenAI with `gpt-5-mini`.

## Local tools

- [ ] Node.js 22.23.0 or later. `.node-version` pins 22.23.2.
- [ ] pnpm 11.25.0. Run `corepack enable` to use the version pinned in `package.json`.
- [ ] Docker, running. The local Supabase stack needs it.
- [ ] Google Chrome. Playwright and `pnpm verify:deployed` drive it.
- [ ] Git.

## 1. Create the repository

- [ ] Create a GitHub repository and push the template's files at the repository root. `.github/workflows/` must be at the root, or CI never runs.
- [ ] Push only files that `.gitignore` allows. It keeps `.dev.vars`, `.env*`, and `supabase/.env` out of the repository.

## 2. Run the app locally

- [ ] Create `supabase/.env` with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. Placeholder values are enough for the tests.
- [ ] Run `pnpm install`, then `pnpm exec supabase start`, then `pnpm dev:vars`.
- [ ] Run `pnpm dev:provider` in one terminal and `pnpm dev` in another. Open `http://127.0.0.1:3000`, not `localhost`.
- [ ] Optional: to sign in with Google on your machine, put the real client ID and secret from section 3 in `supabase/.env`, add `http://127.0.0.1:54321/auth/v1/callback` to the client's redirect URIs, and restart the stack.

Local runs need no Cloudflare account and no LLM key. The provider double stands in for the LLM API.

## 3. Create the Google OAuth client

One client serves every environment.

- [ ] Create an OAuth client of type "Web application".
- [ ] Set the consent screen audience to External and the publishing status to "In production". In "Testing", only listed test users can sign in.
- [ ] Keep only the scopes `openid`, `email`, and `profile`. Any other scope requires Google app verification.
- [ ] Save the client ID and client secret for section 7.
- [ ] After section 4, add `https://<project-ref>.supabase.co/auth/v1/callback` to the authorized redirect URIs, once for each Supabase project.

## 4. Create the Supabase projects

Do these steps for `dev`, then for `production`.

- [ ] Create the project. Choose a database password and save it. Prefer letters and digits, so the connection string needs no percent-encoding.
- [ ] Copy the 20-letter project reference from the project URL.
- [ ] In `supabase/config.toml`, set `project_id` under `[remotes.dev]` or `[remotes.production]` to the reference.
- [ ] In `wrangler.jsonc`, set the environment's `SUPABASE_URL` to `https://<project-ref>.supabase.co`.
- [ ] From the project's API keys page, copy the publishable key into the environment's `SUPABASE_PUBLISHABLE_KEY` in `wrangler.jsonc`. It is safe to commit.
- [ ] From the same page, copy the secret key for section 7. Never commit it.
- [ ] From the project's Connect dialog, copy the session-mode pooler connection string. It uses port 5432 and the user `postgres.<project-ref>`. Put the database password in it, percent-encoded, and keep the result for section 7. This is `SUPABASE_DB_URL`. Do not use the direct `db.<project-ref>.supabase.co` host. It is IPv6 only on the Free plan, and the build container is not known to have IPv6.

Then, once for your account:

- [ ] Create a Supabase access token for the CLI.

Never change Auth settings in the Supabase dashboard. `pnpm cf:deploy` applies them from `supabase/config.toml` on every deploy.

## 5. Set up Cloudflare

- [ ] Choose your account's workers.dev subdomain.
- [ ] In `wrangler.jsonc`, replace `example` in each environment's `APP_URL` with the subdomain.
- [ ] In `supabase/config.toml`, make the same replacement in `site_url` and `additional_redirect_urls` under `[remotes.dev.auth]` and `[remotes.production.auth]`. `pnpm check:repo` fails when the two files disagree.
- [ ] Replace each environment's `ENVIRONMENT_ID` in `wrangler.jsonc` with a UUID you generate, for example with `uuidgen`. The placeholder check does not catch the shipped values.

## 6. Set up the LLM provider

- [ ] Create one API key for `dev` and one for `production`.
- [ ] Set a monthly spend limit at the provider.
- [ ] If you do not use OpenAI or `gpt-5-mini`, set `LLM_BASE_URL` and `LLM_MODEL` in each environment's `vars` in `wrangler.jsonc`.

## 7. Connect each Worker to Workers Builds

Do these steps for `touch-grass-dev`, then for `touch-grass-production`. You need no Cloudflare API token or account ID.

- [ ] Create the release branch with `git push origin main:production`. Do this before you connect the production Worker. Later releases fast-forward it.
- [ ] In the Cloudflare dashboard, open Workers & Pages, choose Create, then Import a repository. Select the repository. This creates the Worker and installs the Cloudflare GitHub App on the repository.
- [ ] Name the Worker exactly as in `wrangler.jsonc`: `touch-grass-dev` or `touch-grass-production`.
- [ ] Set the build settings in this table.

| Setting | `touch-grass-dev` | `touch-grass-production` |
|---|---|---|
| Production branch | `main` | `production` |
| Builds for non-production branches | Off | Off |
| Build command | `pnpm build` | `pnpm build` |
| Deploy command | `pnpm cf:deploy` | `pnpm cf:deploy` |
| Build variable `CLOUDFLARE_ENV` | `dev` | `production` |
| Build variable `PNPM_VERSION` | `11.25.0` | `11.25.0` |
| Build secret `SUPABASE_ACCESS_TOKEN` | The Supabase access token | The same token |
| Build secret `SUPABASE_DB_URL` | The dev pooler string | The production pooler string |
| Build secret `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | The Google client ID | The same client ID |
| Build secret `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | The Google client secret | The same client secret |

Preview builds stay off. A preview version would run against a database whose migrations have not run.

If the first build starts before you save these settings, or while `wrangler.jsonc` still holds placeholders, it stops at `pnpm cf:deploy` before it changes anything. Save the settings, then retry the build from the dashboard.

Then set the runtime secrets once per Worker. They persist across deploys.

- [ ] Run `pnpm exec wrangler login`.
- [ ] Run `pnpm exec wrangler secret put SUPABASE_SECRET_KEY --name touch-grass-dev` and enter the dev project's secret key. You can use the dashboard instead.
- [ ] Run `pnpm exec wrangler secret put LLM_API_KEY --name touch-grass-dev` and enter the dev LLM key.
- [ ] Repeat both commands with `--name touch-grass-production` and the production values.
- [ ] Optional. To trace agent runs, create a Langfuse project per environment and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` on each Worker the same way. Outside Langfuse Cloud EU, also set `LANGFUSE_BASE_URL` in the environment's `vars`.

## 8. Deploy, verify, and release

- [ ] Run `pnpm check:repo` and `pnpm exec tsx tools/placeholders.ts dev production`. Both must pass.
- [ ] Open a pull request and merge it to `main` after CI passes. The push to `main` makes Workers Builds build and deploy `touch-grass-dev`.
- [ ] Check that the `touch-grass-dev` build succeeded in the dashboard. If it failed, read the build log. `pnpm cf:deploy` names the check that stopped it.
- [ ] Export the dev project's secret key and run `SUPABASE_SECRET_KEY=... pnpm verify:deployed --env dev`. Workers Builds does not run it. A deploy is unverified until it passes.
- [ ] Release production with `git push origin main:production`. The push fast-forwards `production` to `main`. Push only commits that are already on `main`.
- [ ] Check the `touch-grass-production` build, then run `SUPABASE_SECRET_KEY=... pnpm verify:deployed --env production` with the production key.
- [ ] Sign in with Google by hand once on each environment. `pnpm verify:deployed` confirms that the Google provider is on, but it signs in with a password test user.

## After setup

- A Supabase Free project pauses after 1 week of inactivity. Restore it from the Supabase dashboard.
- LLM usage is the only external cost. Watch the provider's usage page. Each verification sends one short message.
- Workers Builds on the Free plan allows 3,000 build minutes per month and 1 concurrent build per account.
