<p align="center">
  <img src="logo.png" alt="Touch Grass — a fresh patch of grass" width="240">
</p>

<h1 align="center">Touch Grass</h1>

<p align="center">
  <strong>Bootstrap your project. Ship it to staging. Go outside.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Agent-Skill-18181B?style=flat-square" alt="Agent Skill">
  <img src="https://img.shields.io/badge/TanStack-Start-65A30D?style=flat-square" alt="TanStack Start">
  <img src="https://img.shields.io/badge/React-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript">
</p>

<p align="center">
  <a href="docs/SPEC.md">MVP specification</a> · <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

One command takes an empty directory to a private GitHub repo with a working TanStack Start app, verified on your machine. Ask for staging and the same agent deploys it: hosted Supabase, Google sign-in, a real LLM and a Cloudflare Worker. Then go outside.

Everything runs on your computer. The agent opens the terminal tabs and browser pages. You only approve logins and consent screens.

## Install

Clone this repository and install the skill. Keep the checkout in place because the skill uses its sibling template.

```sh
git clone https://github.com/Brgraul/touch-grass.git
cd touch-grass
node touch-grass/scripts/install.mjs
```

The installer links into `${CODEX_HOME:-~/.codex}/skills` by default. For Claude Code, pass `--skills-dir ~/.claude/skills`. It is rerunnable and preserves unrelated installations. Restart or refresh your agent's skill discovery after installation.

Run the skill's regression checks without provisioning live resources:

```sh
node --test touch-grass/scripts/test/*.test.mjs
```

## One command

Invoke the skill in an empty directory:

```text
$touch-grass
```

The agent handles the setup:

1. Checks dependencies and GitHub authentication.
2. Creates a private GitHub repository and pushes the bundled starter.
3. Runs the repository's four checks on your machine: repository access, frozen install, build and the full test suite.

## Staging

In the generated repository, ask for a staging environment. The agent follows the [staging guide](touch-grass/references/staging.md) with the `tg staging` helper:

1. Opens terminal tabs for the Cloudflare and Supabase logins. You approve them.
2. Creates the Supabase project and fills in the app's configuration.
3. Drives the Google Cloud console to create the OAuth client. You sign in, accept Google's policy and add yourself as a test user.
4. Stores your LLM key from a hidden prompt, then deploys migrations, Auth config and the Worker from your machine.
5. Runs the deployed verifier, then walks the real journey with you: Google sign-in, a model reply that uses a tool, a reload, and sign-out.

Secrets stay in a private, gitignored `.env.deploy.<env>` file and in Worker secrets. They never appear in chat.

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

## What you need

- **GitHub account** with permission to create private repositories and push code.
- **Locally:** a coding agent that loads skills (Codex or Claude Code), Node.js >=22.23, Git, and an authenticated GitHub CLI (`gh`). Local verification also needs Docker and Google Chrome.
- **For staging:** Cloudflare, Supabase and Google Cloud accounts, and an LLM API key with billing. The Free plans of Cloudflare and Supabase work. Google sign-in stays in Testing mode for listed test users; publishing it needs your homepage and privacy policy.
