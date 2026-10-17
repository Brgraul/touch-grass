# Touch Grass

**Bootstrap your project. Let cloud agents build it.**

One command to go from an empty directory to a private GitHub repo, a working TanStack Start app, and a verified Codex Cloud environment. Then go outside.

> **Status:** MVP specification. Implementation and installation instructions are coming.

## One command

Invoke the skill in local Codex:

```text
$touch-grass
```

The agent handles the setup:

1. Checks dependencies and authentication.
2. Creates a private GitHub repository and pushes the bundled starter.
3. Sets up Codex Cloud, guiding you through native setup if needed.
4. Verifies repository access, dependencies, build, tests, and cloud readiness.

Zero configuration. No wizard. Authorization only when required.

## Batteries included

- **TanStack Start** — one opinionated stack, ready to build on.
- **Tests, CI, and `AGENTS.md`** — bundled with the app.
- **Pinned agent skills** — systematic debugging, verification before completion, and React best practices.
- **Repeatable verification** — rerun `$touch-grass` in the generated repo without provisioning it again.

Setup is complete only after cloud verification passes. If verification requires the cloud runtime, the agent hands you off to run `$touch-grass` there.

## Prerequisites

Local Codex, Git, an authenticated GitHub CLI (`gh`), and Codex Cloud access with GitHub integration authorized for the new repository.

See the [MVP specification](SPEC.md) for scope and acceptance criteria.
