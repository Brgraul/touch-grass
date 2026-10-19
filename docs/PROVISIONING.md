# Provisioning surfaces

The [MVP](SPEC.md) initializes an empty repository the person created, verifies it on the local machine, and deploys it to staging. The [global skill](../skills/touch-grass/SKILL.md) owns the execution loop. Its [staging reference](../skills/touch-grass/references/staging.md) is the last stage, after local verification passes. The rows below run in order. Everything below runs on the local machine. On 19 October 2026 every row ran live against real services. The Supabase project in that run was created by an earlier ad hoc script; the helper's create path is covered by offline tests with a stubbed Management API, and its reuse path ran live.

The agent opens every terminal tab and browser page. The person acts only at the gates in the last column.

| Workflow | Automation | Person's gate |
|---|---|---|
| Bootstrap | `tg run` commits the pinned template in the empty clone and push it to `origin` with the person's Git credentials. An existing remote branch without the initial commit stops safely. | Create an empty private repository and clone it. Sign in to the Git host if the push needs it. |
| Local verification | `tg verify` runs the repository's `pnpm verify`: repository access, frozen install, build and `pnpm check`. It records a pass for the clean HEAD it tested. | Install or start Docker Desktop when it is missing. |
| Logins | `tg staging login-cloudflare` and `tg staging login-supabase` run in a visible terminal tab. The Supabase helper presses the CLI's Enter prompt. | Approve both in the browser, and type Supabase's verification code. |
| Supabase | `tg staging supabase` uses the CLI login's token with the Management API. It creates the project with a generated password, waits for health, and stores the secret key and session-pooler URL. | Choose an organization or region when ambiguous, free a Free-plan slot when two projects are active, and agree to cost before a project in a paid organization. |
| Configuration | `tg staging configure` reads the workers.dev subdomain, names the Worker after the repository, and fills `wrangler.jsonc` and `supabase/config.toml`. | None, unless the account has no subdomain yet. |
| Google OAuth | The agent drives the console: project, Auth Platform branding and audience, Web client with the Supabase callback, and test users. `tg staging google` imports the client JSON. | Sign in to Google, approve the User Data Policy, and approve the JSON download. |
| LLM key | `tg staging set LLM_API_KEY` reads a hidden prompt or a piped private file, and `tg staging llm-check` validates key and model. | Create the key and paste it into the hidden prompt. Own billing and spend limits. |
| Deploy | `tg staging deploy` runs `pnpm build` and `pnpm cf:deploy` (migrations, Auth config, Worker) with redacted output, then installs Worker secrets. | Approve deploying the environment. |
| Deployed verification | `tg staging verify` runs `pnpm verify:deployed`. The agent then walks the acceptance journey in its browser. | Pick the Google account on the app's consent screen. |

Staging creates one Supabase project, Google client and Worker, and stores one LLM key, all for the `dev` environment. Production is never touched. Keep provisioning, verification and deployment separate in reports. A successful deploy does not replace `tg staging verify` and the acceptance journey.

Vendor references: [Supabase Management API](https://api.supabase.com/api/v1-json), [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Google branding](https://support.google.com/cloud/answer/15549049), [Google verification](https://support.google.com/cloud/answer/13463073) and [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
