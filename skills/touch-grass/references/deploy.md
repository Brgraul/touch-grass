# Guided deploy

The template has one hosted environment, `production`: one Worker, one Supabase project (`[remotes.production]` in `supabase/config.toml`), one Google OAuth client and one LLM key. `tg deploy` reads the environments from `wrangler.jsonc`. If the repository defines more than one, ask the person which to deploy and pass `--env <name>` to every command.

You drive every step; the person acts only at the gates named below. Run login and secret-entry commands in a terminal tab the person can see. Open vendor consoles in your own browser and fill their forms yourself.

Secrets live only in `.env.deploy.<env>`, which `tg deploy` writes. Never put a secret in chat, a typed command line, a report or a screenshot caption.

## Setup

Work from the generated repository root on a branch, after `pnpm install --frozen-lockfile`. `scripts/tg deploy --help` lists the commands. Every command is safe to rerun, and `status` shows what is stored without values. When a command fails, its error names the fix.

Commands report their own progress to `tg watch`. Steps 4, 6 and 9 run in your browser, so report those yourself: run `scripts/tg deploy mark <google|langfuse|acceptance> running` as you start one, then `done` when it finishes, or `skipped` if the person declines Langfuse.

## Steps

1. **Logins.** Run `scripts/tg deploy login-cloudflare` and `scripts/tg deploy login-supabase`, each in its own visible tab. The person approves in the browser and types the Supabase code into its tab. Continue when both report success.
2. **Supabase project.** Run `scripts/tg deploy supabase --region <code>`, with `--org <slug>` if the account has several organizations. Use the region of the person's existing projects, or ask. On a paid organization, pass `--confirm-cost` only after the person agrees to the added cost.
3. **Configuration.** Run `scripts/tg deploy configure`, with `--account <id>` if the login sees several accounts.
4. **Google OAuth client.** In your browser. The console layout shifts in a narrow pane, so find buttons by accessibility reference and confirm each save by reading the page.
   1. At `https://console.cloud.google.com/projectcreate`, name the project after the Worker and keep the suggested project ID. Google sign-in is the person's gate.
   2. At `https://console.cloud.google.com/auth/overview?project=<id>`, choose Get started: app name, the person's email as support and contact email, External audience. Ask before you tick the User Data Policy checkbox, then choose Create.
   3. At `https://console.cloud.google.com/auth/clients/create?project=<id>`, create a Web application named after the Worker with redirect URI `https://<ref>.supabase.co/auth/v1/callback`.
   4. Ask before you choose Download JSON, then run `scripts/tg deploy google <path to client_secret_*.json>`. Leave the download in place unless the person asks you to delete it.
   5. At `https://console.cloud.google.com/auth/audience?project=<id>`, add the person's Google email as a test user and save. Testing mode is enough to finish setup; publishing is the person's call.
5. **LLM key.** If the person names a private file holding a key, pipe it into `scripts/tg deploy set LLM_API_KEY` without printing it. Otherwise open the provider's key page (OpenAI: `https://platform.openai.com/api-keys`) and run `set LLM_API_KEY` in a visible tab for the person to paste into. Then run `scripts/tg deploy llm-check`. If the model is unavailable, set the environment's `LLM_MODEL` in `wrangler.jsonc` to one the key lists.
6. **Langfuse, optional.** Ask whether the person wants agent runs traced in Langfuse. Skip this step if the person declines; tracing stays off without the keys. Langfuse Cloud has no API that creates projects or keys below the Enterprise plan, so this step runs in your browser.
   1. Open `https://cloud.langfuse.com`. Sign-in is the person's gate, but your browser keeps sessions, so check whether the person is already signed in first. The sign-in page shows the data region. Outside the EU region, set `LANGFUSE_BASE_URL` (US: `https://us.cloud.langfuse.com`) in the environment's `vars` in `wrangler.jsonc`.
   2. At `https://cloud.langfuse.com/setup`, create an organization named after the repository. Turn off **Enable AI powered features** before you choose Create, unless the person wants them; they are on by default and send project data to AWS Bedrock. Then create a project named after the Worker.
   3. On the project's Tracing page, choose **Create new API key**. The page now shows the secret key, the public key and a `.env` block. From here on, never screenshot the page or read its text, DOM or accessibility tree; any of these puts the secret in your context. Find buttons with `find` only.
   4. The page's copy buttons do not reach the system clipboard, so the person pastes. Run `scripts/tg deploy set LANGFUSE_PUBLIC_KEY`, then `scripts/tg deploy set LANGFUSE_SECRET_KEY`, each in a visible tab, and ask the person to paste each value from the page. `push` installs both keys as Worker secrets.
7. **Deploy.** With the person's deploy approval for this environment, run `scripts/tg deploy push`.
8. **Verify.** Run `scripts/tg deploy verify`. It must print `VERIFIED`.
9. **Acceptance journey.** In your browser, at the environment's `APP_URL`:
   1. Signed out, `/` redirects to `/login`.
   2. Choose Continue with Google. Google's account chooser and consent are the person's gate.
   3. On `/chat`, send `Use the calculator: what is (1234.5 * 8) - 97 / 4?`. Expect a `calculate` tool call, the result `9851.75` in the answer, and `Completed`.
   4. Reload. The message, tool call and answer remain.
   5. `/account` loads for the Google user.
   6. Sign out from the header. `/chat` then redirects to `/login`.
   7. With the stored secret key, confirm via the Auth admin API that the user exists with provider `google`. Print only email, providers and timestamps.
   8. If Langfuse keys are stored, run `scripts/tg deploy trace-check`. It runs the template's Langfuse e2e against the deployed `APP_URL`, using the environment's vars and the stored secrets. It creates and deletes a password test user and sends one chat message to the real model. Then it polls Langfuse until the run's trace holds a `run` agent span and one `model-<n>` generation per saved step. Every observation must carry the trace name `agent-chat`, the user's ID and the conversation ID as its session.

## Failures you may encounter

| Symptom | Fix |
|---|---|
| Verifier says the Google provider is disabled | The Auth config push did not run. Rerun `push`. |
| Google says `redirect_uri_mismatch` | Fix the client's redirect URI in the console to match the project ref. |
| Google blocks the account | Add it as a test user on the Audience page. |
| The Langfuse test polls until it times out, or Langfuse answers `429` | Read traces with `GET /api/public/v2/observations` only. The v1 `GET /api/public/traces` lags by minutes, allowed only five reads per rate-limit window on the Hobby plan, and Langfuse removes it on 2026-11-16. Spans appear on v2 within seconds only because the exporter sends `x-langfuse-ingestion-version: 4`. |
| Langfuse answers `401` | The key pair belongs to another project or region. Create a new pair on the project's API Keys settings page and store both values again. |

## Report

Report the Supabase project ref, region and organization; the Google project and client ID; the Worker name, account, URL and deployed version; whether Langfuse tracing is on; the verifier result; each acceptance step; and what you did not cover. Leave the config changes uncommitted on the branch for review. Keep `.env.deploy.<env>`: it holds the only copy of the database password.
