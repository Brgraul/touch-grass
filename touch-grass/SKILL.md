---
name: touch-grass
description: Initialize an empty repository for batteries-on agentic coding, verify it on this machine, and deploy it to a working staging environment. 
---

Initialize an empty repository from the bundled template, verify it on this machine, and deploy it to a working staging environment.

1. **Bootstrap.** From the repository root, run `scripts/tg run --json` and act on what it reports: install named missing tools, fix named failures, or follow a waiting step's instructions. Rerun it until it exits 0 with `"provisioning": "complete"`.
2. **Verify.** Run `scripts/tg verify --json`. If it errors, fix the cause, and rerun until it exits 0 with `"verification": "complete"`.
3. **Deploy.** Read [staging.md](references/staging.md) and follow it.

When a step needs the human driver's intervention, such as signing in or starting Docker Desktop, open the terminal tab or page yourself and name that exact gate. Never ask for credentials in chat.

Report the `origin` URL, the four check results from the `pnpm verify` summary with the tested commit, and the staging report that staging.md describes. Claim setup complete only when all four checks passed and the staging verifier and acceptance journey passed.
