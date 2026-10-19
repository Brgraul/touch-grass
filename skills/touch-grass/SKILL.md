---
name: touch-grass
description: Initialize an empty repository for batteries-on agentic coding, verify it on this machine, and deploy it to a working staging environment. 
---

Initialize an empty repository from the bundled template, verify it on this machine, and deploy it to a working staging environment.

Before step 1:

- Make a task list with Bootstrap, Verify and Deploy, and update it as each step starts and ends.
- Show the person live progress. Run `scripts/tg watch` from the repository root in a terminal tab they can see. Inside tmux, use `tmux split-window -h '<path to scripts>/tg watch'`. Otherwise, give them that command to run in a second terminal. Skip this in a cloud session, where the person has no terminal on this machine.
- Tell the person what each step needs from them:
  - Bootstrap takes about a minute and needs nothing from them.
  - Verify runs on its own and is the longest step. It installs dependencies, builds, and runs the full test suite against a local Supabase in Docker. Docker must be running.
  - Deploy needs them throughout. They approve the Cloudflare and Supabase logins, sign in to Google Cloud, paste an LLM key (and Langfuse keys if they want tracing), approve the deploy, and pick their Google account in the acceptance journey. The build and deploy then run on their own for a few minutes.

1. **Bootstrap.** From the repository root, run `scripts/tg run --json` and act on what it reports: install named missing tools, fix named failures, or follow a waiting step's instructions. Rerun it until it exits 0 with `"provisioning": "complete"`.
2. **Verify.** Run `scripts/tg verify --json`. It prints only the `pnpm verify` summary and names the log that holds the full output. If it errors, read the end of that log, fix the cause, and rerun until it exits 0 with `"verification": "complete"`.
3. **Deploy.** Read [staging.md](references/staging.md) and follow it.

When a step needs the human driver's intervention, such as signing in or starting Docker Desktop, open the terminal tab or page yourself and name that exact gate. Never ask for credentials in chat.

Report the `origin` URL, the four check results from the `pnpm verify` summary with the tested commit, and the staging report that staging.md describes. Claim setup complete only when all four checks passed and the staging verifier and acceptance journey passed.
