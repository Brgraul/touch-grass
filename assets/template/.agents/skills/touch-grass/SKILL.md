---
name: touch-grass
description: Verify that this repository installs, builds, and passes its full check, and report each result separately. Use when asked to verify the repository, confirm a clean checkout works, or check readiness before a release. Never provisions anything.
---

# Verify the repository

Run the four checks below in order from the repository root. Stop at the first failure and report the rest as not run. Report each check on its own line as `passed`, `failed`, or `not run`, with one sentence of evidence or the reason.

This skill is safe to repeat. It reads the repository and writes only the local `node_modules/`, `dist/`, and test output directories. It never creates cloud resources, links a Supabase project, pushes migrations, deploys, or writes secrets.

1. **Repository access.** Confirm the current directory holds `package.json` and `wrangler.jsonc`. Run `git ls-remote --exit-code origin HEAD`. If the repository has no `origin`, report this check as `not run` and continue.
2. **Install.** Run `pnpm install --frozen-lockfile`. A lockfile mismatch is a failure. Do not fix it by running `pnpm install` without the flag.
3. **Build.** Run `pnpm build`.
4. **Check.** Run `pnpm check`. It resets the local database, so it needs a running local Supabase stack. If `supabase status` fails because Docker is missing, report this check as `not run` and name the steps that could not run. Never report `passed` for a partial run. `pnpm check` exits with code 2 and prints `INCOMPLETE` when any step did not run.

When a check fails, quote the failing step name and the first error line from its output. Do not retry a failure to make it pass.
