# Guided staging environment

Read this only when the person asks for a hosted, staging, or deployed app. Staging is the template's `dev` environment: one Worker, `[remotes.dev]` in `supabase/config.toml`, one Supabase project, one Google OAuth client and one LLM key. The first `configure` names the Worker `<repo>-dev`, so generated repos never deploy over each other. Use `--env production` with the same steps only when the person asks for production.

## Who does what

You drive every step. The person acts only at a gate:

| Gate | What the person does |
|---|---|
| Vendor login | Approves Cloudflare and Supabase in the browser, then types Supabase's verification code into the terminal tab. |
| Google account | Signs in to Google in your browser once, and later picks their account on the app's consent screen. |
| Policy or terms | Says yes before you tick a vendor agreement, such as Google's API Services User Data Policy. |
| Cost or organization | Chooses a Supabase organization or region when you cannot infer one, frees a Free-plan slot if needed, and agrees before you create a project in a paid organization. |
| Secret entry | Pastes an LLM key into a hidden terminal prompt, if no private key file exists. |
| Download | Says yes before you click a download, such as the OAuth client JSON. |

Before each gate, open the exact terminal tab or browser page yourself. Check that the person can see it: the browser pane is displayed, or the terminal tab exists. Say in one line what to click, then wait. Run login and secret-entry commands in a terminal tab the person can see, because they need a TTY and the person's input. Open vendor consoles in your own browser. Do everything else yourself, including console forms.

Secrets stay in `.env.deploy.<env>` (mode 0600, ignored by the template's `.env*` rule). Only `tg staging` writes it. Never put a secret in chat, a command line you type, a report or a screenshot caption. The deploy commands redact stored values from their output. The template's `cf:deploy` passes the database URL to `supabase db push` as an argument, which other users of a shared machine could see in the process list.

## Setup

Set `T="$SKILL/scripts/tg"`. Work from the generated repository root on a branch, after `pnpm install --frozen-lockfile`. Run `"$T" staging --help` for every command. Every command is safe to rerun. `"$T" staging status` shows what is stored without printing values.

## Steps

1. **Logins.** Open one visible terminal tab with `"$T" staging login-cloudflare` and another with `"$T" staging login-supabase`. Wrangler opens the Cloudflare approval page. The Supabase helper presses the CLI's Enter prompt and opens the browser. The person approves, then types the 8-character code into that tab. Continue when both tabs report success.
2. **Supabase project.** Run `"$T" staging supabase --region <code>`. Add `--org <slug>` when the account has several organizations. Pick the region of the person's existing projects, or ask. The helper creates `<repo>-<env>` with a generated database password, waits until it is healthy, and stores the ref, secret key and session-pooler URL. On a Free organization with 2 active projects it stops; ask the person to pause one. On a paid organization it stops until you rerun with `--confirm-cost`, which you pass only after the person agrees to the added compute cost. It never adopts a same-name project it did not record creating.
3. **Configuration.** Run `"$T" staging configure`. It reads the workers.dev subdomain, names the Worker and Workflow after the repository on first run, fills the environment's vars in `wrangler.jsonc` and `[remotes.<env>]` in `supabase/config.toml`, and stores the Cloudflare account. Then it runs `pnpm check:repo` and the placeholder check. Pass `--account <id>` when the login sees several accounts. If the account has no subdomain, open the Cloudflare dashboard so the person can choose one.
4. **Google OAuth client.** Use your browser.
   1. Open `https://console.cloud.google.com/projectcreate`. If Google asks for sign-in, that is the person's gate. Name the project `<repo>-staging` and keep the project ID the console suggests, because IDs are global and the plain name is often taken. Use that ID below.
   2. Open `https://console.cloud.google.com/auth/overview?project=<id>` and choose Get started. Enter the app name and the person's email as support email. Choose the External audience. Enter the person's email as contact. Stop at the User Data Policy checkbox and ask. After the yes, tick it and choose Create.
   3. Open `https://console.cloud.google.com/auth/clients/create?project=<id>`. Choose Web application, name it after the Worker, and add the redirect URI `https://<ref>.supabase.co/auth/v1/callback`. Choose Create.
   4. The dialog shows the secret once. Ask before you choose Download JSON. Then run `"$T" staging google <path to client_secret_*.json>`. It refuses a client without the callback URI. Leave the download in place unless the person asks you to delete it.
   5. Open `https://console.cloud.google.com/auth/audience?project=<id>`, choose Add users, type the person's Google email, press Enter to make a chip, and choose Save. Confirm the email appears under Test users. Testing mode with test users is enough for staging. Publishing needs branding, a homepage and a privacy policy, which are the person's to provide.

   The console layout shifts in a narrow pane. Find buttons by accessibility reference rather than screen coordinates, and confirm each save by reading the page.
5. **LLM key.** If the person names a private file that already holds a key, pipe the value from it into `"$T" staging set LLM_API_KEY` without printing it. Otherwise open the provider's key page (for OpenAI, `https://platform.openai.com/api-keys`). Run `"$T" staging set LLM_API_KEY` in a visible terminal tab, and the person pastes the key into the hidden prompt. Then run `"$T" staging llm-check`. If the model is unavailable, set `LLM_MODEL` for the environment in `wrangler.jsonc` to one the key lists. The person owns billing and spend limits.
6. **Deploy.** Get the person's deploy approval for this environment unless they already gave it. Run `"$T" staging deploy`. It first checks that the stored project, `wrangler.jsonc` and the database URL name the same Supabase project, and that any existing Worker with this name belongs to this environment. It then builds with `CLOUDFLARE_ENV`, runs `pnpm cf:deploy` (migrations, Auth config, then the Worker and its cron), and installs `SUPABASE_SECRET_KEY` and `LLM_API_KEY` as Worker secrets.
7. **Deployed verifier.** Run `"$T" staging verify`. It must print `VERIFIED`.
8. **Acceptance journey.** In your browser, at the environment's `APP_URL`:
   1. Signed out, `/` redirects to `/login`.
   2. Choose Continue with Google. Google's account chooser and consent are the person's gate.
   3. On `/chat`, send `Use the calculator: what is (1234.5 * 8) - 97 / 4?`. Expect a `calculate` tool call, the tool result `9851.75`, an answer with that number, and `Completed`.
   4. Reload the conversation URL. The message, tool call and answer remain.
   5. Open `/account`. It loads for the Google user.
   6. Sign out from the header. `/chat` then redirects to `/login`.
   7. Confirm server-side that Supabase Auth has the person's user with provider `google`. Use the admin API with the stored secret key, from a script that prints only email, providers and timestamps.

## Failures

| Symptom | Cause and fix |
|---|---|
| `has no record of creating it` | A project with the same name exists that this helper did not create. Do not adopt it. Choose another organization with the person, or rename the repository directory. |
| `already exists on account ... for another environment` | Another repository owns a Worker with this name. Rename this environment's Worker and Workflow in `wrangler.jsonc`, then rerun `configure` and `deploy`. |
| `Project refs disagree` | The stored project and the config point at different projects. Rerun `supabase` and `configure`. |
| Verifier says the Google provider is disabled | The Auth config push did not run. Rerun `"$T" staging deploy`. |
| Google says `redirect_uri_mismatch` | The client's redirect URI does not match the project ref. Fix it in the console. |
| Google says access is blocked for this account | The account is not a test user. Add it on the Audience page. |
| `wrangler whoami` fails in a helper | The Cloudflare login expired. Rerun `"$T" staging login-cloudflare`. |

## Report

Report the resource identities: the Supabase project ref, region and organization; the Google project and client ID; and the Worker name, account, URL and deployed version. Then report the verifier result, each acceptance step, and what you did not cover. Leave the public config changes uncommitted on the branch for the person to review. Keep `.env.deploy.<env>`. It is the only copy of the generated database password.
