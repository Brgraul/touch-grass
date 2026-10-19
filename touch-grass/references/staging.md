# Guided staging environment

Staging is the template's `dev` environment: one Worker, one Supabase project (`[remotes.dev]` in `supabase/config.toml`), one Google OAuth client and one LLM key.

You drive every step; the person acts only at the gates named below. Run login and secret-entry commands in a terminal tab the person can see. Open vendor consoles in your own browser and fill their forms yourself.

Secrets live only in `.env.deploy.<env>`, which `tg staging` writes. Never put a secret in chat, a typed command line, a report or a screenshot caption.

## Setup

Work from the generated repository root on a branch, after `pnpm install --frozen-lockfile`. `scripts/tg staging --help` lists the commands. Every command is safe to rerun, and `status` shows what is stored without values. When a command fails, its error names the fix.

## Steps

1. **Logins.** Run `scripts/tg staging login-cloudflare` and `scripts/tg staging login-supabase`, each in its own visible tab. The person approves in the browser and types the Supabase code into its tab. Continue when both report success.
2. **Supabase project.** Run `scripts/tg staging supabase --region <code>`, with `--org <slug>` if the account has several organizations. Use the region of the person's existing projects, or ask. On a paid organization, pass `--confirm-cost` only after the person agrees to the added cost.
3. **Configuration.** Run `scripts/tg staging configure`, with `--account <id>` if the login sees several accounts.
4. **Google OAuth client.** In your browser. The console layout shifts in a narrow pane, so find buttons by accessibility reference and confirm each save by reading the page.
   1. At `https://console.cloud.google.com/projectcreate`, name the project `<repo>-staging` and keep the suggested project ID. Google sign-in is the person's gate.
   2. At `https://console.cloud.google.com/auth/overview?project=<id>`, choose Get started: app name, the person's email as support and contact email, External audience. Ask before you tick the User Data Policy checkbox, then choose Create.
   3. At `https://console.cloud.google.com/auth/clients/create?project=<id>`, create a Web application named after the Worker with redirect URI `https://<ref>.supabase.co/auth/v1/callback`.
   4. Ask before you choose Download JSON, then run `scripts/tg staging google <path to client_secret_*.json>`. Leave the download in place unless the person asks you to delete it.
   5. At `https://console.cloud.google.com/auth/audience?project=<id>`, add the person's Google email as a test user and save. Testing mode is enough for staging; publishing is the person's call.
5. **LLM key.** If the person names a private file holding a key, pipe it into `scripts/tg staging set LLM_API_KEY` without printing it. Otherwise open the provider's key page (OpenAI: `https://platform.openai.com/api-keys`) and run `set LLM_API_KEY` in a visible tab for the person to paste into. Then run `scripts/tg staging llm-check`. If the model is unavailable, set the environment's `LLM_MODEL` in `wrangler.jsonc` to one the key lists.
6. **Deploy.** With the person's deploy approval for this environment, run `scripts/tg staging deploy`.
7. **Verify.** Run `scripts/tg staging verify`. It must print `VERIFIED`.
8. **Acceptance journey.** In your browser, at the environment's `APP_URL`:
   1. Signed out, `/` redirects to `/login`.
   2. Choose Continue with Google. Google's account chooser and consent are the person's gate.
   3. On `/chat`, send `Use the calculator: what is (1234.5 * 8) - 97 / 4?`. Expect a `calculate` tool call, the result `9851.75` in the answer, and `Completed`.
   4. Reload. The message, tool call and answer remain.
   5. `/account` loads for the Google user.
   6. Sign out from the header. `/chat` then redirects to `/login`.
   7. With the stored secret key, confirm via the Auth admin API that the user exists with provider `google`. Print only email, providers and timestamps.

## Failures the helpers cannot name

| Symptom | Fix |
|---|---|
| Verifier says the Google provider is disabled | The Auth config push did not run. Rerun `deploy`. |
| Google says `redirect_uri_mismatch` | Fix the client's redirect URI in the console to match the project ref. |
| Google blocks the account | Add it as a test user on the Audience page. |

## Report

Report the Supabase project ref, region and organization; the Google project and client ID; the Worker name, account, URL and deployed version; the verifier result; each acceptance step; and what you did not cover. Leave the config changes uncommitted on the branch for review. Keep `.env.deploy.<env>`: it holds the only copy of the database password.
