<p align="center">
  <img src="logo.png" alt="Touch Grass — a fresh patch of grass" width="240">
</p>

<h1 align="center">Touch Grass</h1>

<p align="center">
  <strong>Bootstrap your project. Let cloud agents build it.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Codex-Skill-18181B?style=flat-square" alt="Codex Skill">
  <img src="https://img.shields.io/badge/TanStack-Start-65A30D?style=flat-square" alt="TanStack Start">
  <img src="https://img.shields.io/badge/React-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript">
</p>

<p align="center">
  <a href="SPEC.md">MVP specification</a> · <a href="ARCHITECTURE.md">Architecture</a>
</p>

One command to go from an empty directory to a private GitHub repo, a working TanStack Start app, and a verified Codex Cloud environment. Then go outside.

**Opinionated by design:** local Codex handles setup; your coding agents continue development in Codex Cloud. Built around the OpenAI ecosystem.

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

| Included | What you get |
| --- | --- |
| **TanStack Start** | React, TypeScript, and TanStack Query for the application. |
| **Tailwind CSS v4 + shadcn/ui** | Styling and accessible UI components you own. |
| **Cloudflare Workers + Workflows** | App hosting and durable background tasks. |
| **Supabase** | PostgreSQL, authentication, and file storage. |
| **Tests, CI, and `AGENTS.md`** | A starter built for coding agents. |
| **Pinned agent skills** | Systematic debugging, verification before completion, and React best practices. |
| **Repeatable verification** | Rerun `$touch-grass` in the generated repo without provisioning it again. |

Setup is complete only after cloud verification passes. If verification requires the cloud runtime, the agent hands you off to run `$touch-grass` there.

## What you need

- **OpenAI account** with Codex Cloud access and the GitHub integration authorized.
- **GitHub account** with permission to create private repositories and push code.
- **Cloudflare and Supabase accounts** to provision and deploy the generated app.
- **Google Cloud account** to create the OAuth client for "Continue with Google". It's free and needs no custom domain.

Locally: Codex, Git, and an authenticated GitHub CLI (`gh`).

The app's AI features need separate LLM API credentials and usage budget; the provider is configurable.
