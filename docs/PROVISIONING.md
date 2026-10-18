# Provisioning surfaces

This page maps each human step in [`assets/template/SETUP.md`](../assets/template/SETUP.md) to the best way an agent can do it. It is the input for the provisioning work that [SPEC.md](SPEC.md) lists as not built.

The surfaces, best first:

1. **MCP or Codex plugin.** A tool the agent calls directly. The official Codex marketplace ([openai/plugins](https://github.com/openai/plugins)) has plugins for GitHub, Cloudflare, Supabase, and OpenAI Developers. None exists for Google Cloud.
2. **Official CLI or API.** A command the agent runs. A one-time browser approval for `gh auth login`, `wrangler login`, or `supabase login` still counts as CLI.
3. **Vendor UI.** A person must use the vendor's website.

Findings are as of 2026-10-18 and come from vendor docs, the plugin manifests in `openai/plugins`, and the local CLIs (`gh` 2.100.0, `wrangler` 4.151.1, `codex-cli` 0.162.1). Vendors change these surfaces often. Recheck a "UI only" row before you build around it.

## What stays in the vendor UI

These steps have no MCP, plugin, CLI, or API path. The provisioning skill must hand them to the person.

| Vendor | Step | Why |
|---|---|---|
| All | Sign up for GitHub, Cloudflare, Supabase, Google, and OpenAI. Verify the Cloudflare email address. | No vendor offers sign-up through an API. |
| All | Approve each OAuth connection once: `gh auth login`, `wrangler login` or the Cloudflare plugin, `supabase login` or the Supabase plugin, the OpenAI Platform connector, and the Codex GitHub connector. | OAuth consent is a browser step by design. |
| OpenAI | Add a payment method or prepaid credits. | Billing has no API. |
| Google | Configure the Google Auth Platform branding, set the audience to External, and publish the app to "In production". | No API or `gcloud` command. |
| Google | Create the OAuth client of type "Web application" and add the redirect URIs. Copy the client secret when Google shows it. | The IAP OAuth Admin API, the only API that made OAuth clients, [shut down on 2026-03-19](https://cloud.google.com/iap/docs/programmatic-oauth-clients). `gcloud iam oauth-clients` makes Workforce Identity Federation clients, not web sign-in clients. |
| Supabase | Create the personal access token that Workers Builds uses as the build secret `SUPABASE_ACCESS_TOKEN`. | The Management API has no endpoint that creates tokens. [The CLI docs](https://supabase.com/docs/reference/cli/supabase-login) point to the dashboard tokens page. |
| Cloudflare | Connect the repository to each Worker in Workers Builds, which also installs the Cloudflare GitHub App. | Installing a GitHub App is a browser step. The Builds API (`POST /accounts/{id}/builds/triggers`) needs a user token with the Workers CI permission. Cloudflare requires that ["you need to generate an initial token via the Cloudflare dashboard"](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/), so the dashboard is the simplest path. |
| Cloudflare | Set each Worker's build command, deploy command, branch control, build variables, and build secrets. | Part of the same dashboard flow. The Builds API could set them after the connection exists, but it needs the same dashboard-made token. |
| Codex | Create the Codex Cloud environment, choose the repository, and set the setup script. | `codex cloud` only submits and browses tasks. The request for environment commands, [openai/codex#24777](https://github.com/openai/codex/issues/24777), was still open on 2026-10-14. |
| Codex | Install the ChatGPT GitHub connector on the new repository. | GitHub App installation is a browser step. |
| Google | Sign in with Google once on each deployed environment. | The account password is the person's. An agent must not type it. |

Two more steps can be done from the CLI, but the person should own them: releasing production with `git push origin main:production`, and choosing spend limits at the LLM provider.

## Step-by-step map

### GitHub

| Step | Best surface | How |
|---|---|---|
| Authenticate | CLI | `gh auth login`, a browser device-code flow. The GitHub plugin uses its own OAuth. |
| Create the private repository and push the template | Plugin or CLI | GitHub plugin (`create_repository`, `push_files`), or `gh repo create <name> --private --source . --push`. |
| Create the `production` branch | CLI | `git push origin main:production`. Do it before you connect the production Worker. |
| Merge and watch CI | Plugin or CLI | `gh pr merge`, `gh run watch`. The merge makes Workers Builds deploy `dev`. |
| Release production | CLI | `git push origin main:production`, a fast-forward. Keep this with the person. |
| Verify a deploy | CLI | `SUPABASE_SECRET_KEY=... pnpm verify:deployed --env <name>`. Workers Builds does not run it. A deploy is unverified until it passes. |

### Codex

| Step | Best surface | How |
|---|---|---|
| Install the plugins | Codex CLI | `/plugins` inside `codex`. Install `github`, `cloudflare`, `supabase`, and `openai-developers`. Each one asks for OAuth on install or first use. |
| Authorize the GitHub integration for the repository | UI | Codex settings in ChatGPT. |
| Create the cloud environment | UI | Set Node.js 22.23.0 or later, and `pnpm install --frozen-lockfile` as the setup script. Docker and Chrome support in the cloud runtime are still open questions in [SPEC.md](SPEC.md). |
| Run cloud verification | CLI | `codex cloud exec --env <ENV_ID> '$touch-grass'`. Get the environment ID from the `codex cloud` browser. |

### Supabase

The Supabase plugin bundles the hosted MCP server (`https://mcp.supabase.com/mcp`), which signs in with OAuth. The CLI is a template dependency, so run it as `pnpm exec supabase`.

| Step | Best surface | How |
|---|---|---|
| Authenticate | Plugin or CLI | Supabase plugin OAuth, or `supabase login`, a browser flow. |
| Check that both Free project slots are open | Plugin | MCP `list_projects`, `list_organizations`. |
| Create the `dev` and `production` projects | Plugin or CLI | MCP `get_cost`, `confirm_cost`, then `create_project`. Or `supabase projects create <name> --org-id <id> --db-password <pw> --region <region>`. The agent generates a database password of letters and digits and keeps it out of chat and logs. |
| Get the project reference and URL | Plugin or CLI | MCP `list_projects`, `get_project_url`, or `supabase projects list`. |
| Get the publishable key | Plugin or CLI | MCP `get_publishable_keys`, or `supabase projects api-keys --project-ref <ref>`. |
| Get the secret key | API | Management API `GET /v1/projects/<ref>/api-keys?reveal=true`. If the project has none, `POST /v1/projects/<ref>/api-keys` creates one. Both need a token with secret-key permission. The MCP server returns only publishable keys. Pipe the value into `wrangler secret put SUPABASE_SECRET_KEY --name touch-grass-<env>`. |
| Build the pooler connection string | API | Management API `GET /v1/projects/<ref>/config/database/pooler`. Copy the session-mode host and port 5432 from the response, because the docs say not to build the host from the region. The user is `postgres.<ref>`. Percent-encode the database password. The result is the build secret `SUPABASE_DB_URL`. Use it instead of a database password and `supabase link`. The direct `db.<ref>.supabase.co` host is IPv6 only on Free. The person pastes the string into Workers Builds. |
| Create the access token for Workers Builds | UI | Dashboard, account tokens page. `supabase login` also stores a token, but the build should not reuse a person's CLI login. |
| Enable Google sign-in and set redirect URLs | Already automated | `pnpm cf:deploy` runs `supabase config push` with the Google build secrets. Never set these in the dashboard. |
| Restore a paused project | Plugin or API | MCP `restore_project`, or the Management API restore endpoint. |

### Cloudflare

The Cloudflare plugin bundles the Cloudflare API MCP server (`https://mcp.cloudflare.com/mcp`). Its `search` and `execute` tools reach about 2,500 API endpoints, within the permissions granted at OAuth consent.

| Step | Best surface | How |
|---|---|---|
| Authenticate | Plugin or CLI | Cloudflare plugin OAuth, or `wrangler login`, a browser flow. |
| Get the account ID | Plugin or CLI | `wrangler whoami`, or the MCP. Only direct API calls need it. The template needs no account ID. |
| Register the workers.dev subdomain | Plugin or API | MCP `execute` calling `PUT /accounts/<id>/workers/subdomain` with `{"subdomain": "<name>"}`. Or call the same endpoint with the token from `wrangler auth token`. The `workers_scripts:write` scope covers subdomains. |
| Connect the repository and set the build settings | UI | See [What stays in the vendor UI](#what-stays-in-the-vendor-ui). In the dashboard choose Workers & Pages, Create, Import a repository, once for `touch-grass-dev` and once for `touch-grass-production`. Then set production branch, non-production builds off, build command `pnpm build`, deploy command `pnpm cf:deploy`, build variables `CLOUDFLARE_ENV` and `PNPM_VERSION`, and the four build secrets. [SETUP.md](../assets/template/SETUP.md) has the table. |
| Set the runtime Worker secrets | CLI | `wrangler secret put SUPABASE_SECRET_KEY --name touch-grass-<env>` and the same for `LLM_API_KEY`. The command reads the value from standard input, so it never appears in a command line. The secrets persist across deploys. |
| Create the Workers, Workflows, and cron triggers | Already automated | `wrangler deploy` in `pnpm cf:deploy`, run by Workers Builds. |

### Google

No Google Cloud plugin is in the Codex marketplace, and Google's own MCP servers do not manage OAuth clients.

| Step | Best surface | How |
|---|---|---|
| Create a Google Cloud project | CLI | `gcloud projects create <id>`, or reuse an existing project. A new account may need to accept the terms of service in the console first. |
| Configure branding, audience, and publishing status | UI | Google Auth Platform pages in the console. |
| Create the web OAuth client and its redirect URIs | UI | Add `https://<ref>.supabase.co/auth/v1/callback` for each project, and optionally `http://127.0.0.1:54321/auth/v1/callback` for local sign-in. This means the person returns to the console after the Supabase projects exist. To avoid a second visit, create the projects first. |
| Move the client ID and secret to Workers Builds | UI | The person pastes both values as build secrets `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` on each Worker. The value never passes through chat or a file. |

### OpenAI (or another LLM provider)

The `openai-developers` plugin includes the `openai-platform-api-key` skill. It creates an API key through the OpenAI Platform connector, lets the person pick the organization and project in a picker, and writes the key to a local env file without printing it.

| Step | Best surface | How |
|---|---|---|
| Create the `dev` and `production` API keys | Plugin | `openai-developers` plugin. Set the env var name to `LLM_API_KEY` and the target to a gitignored file. Then run `wrangler secret bulk <file> --name touch-grass-<env>`, which reads the `KEY=VALUE` file, and delete the file. |
| Create one project per environment | UI or API | Platform UI. With an admin key: `openai admin:organization:projects create --name ...` ([OpenAI CLI](https://developers.openai.com/api/docs/libraries/openai-cli), `brew install openai/tools/openai`). The `openai` on this machine is a pyenv shim for the old Python package, not this CLI. |
| Set a spend limit per project | UI or API | Platform UI. With an admin key: the Admin API project Spend Limit and Spend Alerts endpoints. |
| Create an admin key | UI | Only needed for the two API rows above. Without one, keys come from the plugin and the rest is a few UI clicks. |

Another OpenAI-compatible provider has its own key and limit surfaces. This table covers only the template default.

### Repository files

The agent edits these with no vendor involved, after the steps above give it the values.

- `wrangler.jsonc`: `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, and an `ENVIRONMENT_ID` from `uuidgen` for each environment.
- `supabase/config.toml`: `project_id`, `site_url`, and `additional_redirect_urls` under `[remotes.dev]` and `[remotes.production]`.
- `supabase/.env` with placeholder Google values for local runs, then `pnpm dev:vars`.
- `pnpm check:repo` and `pnpm exec tsx tools/placeholders.ts dev production` confirm the edits.

### Local tools

| Tool | Best surface | How |
|---|---|---|
| Node.js, pnpm | CLI | `brew install node`, then `corepack enable`. |
| Google Chrome | CLI | `brew install --cask google-chrome`. |
| Docker | CLI or UI | `brew install colima docker` and `colima start` stay in the terminal. Docker Desktop asks the person to accept its license on first launch. |
