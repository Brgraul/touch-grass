<p align="center">
  <img src=".github/assets/logo.png" alt="Touch Grass — a fresh patch of grass" width="240">
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
  <a href="docs/SPEC.md">MVP specification</a> · <a href="docs/TEMPLATE-SPEC.md">Template specification</a>
</p>

One command turns a fresh clone of your empty private repo into a working TanStack Start app, verified on your machine and deployed to staging: hosted Supabase, Google sign-in, a real LLM and a Cloudflare Worker. Then go outside.

Everything runs on your computer. The agent opens the terminal tabs and browser pages. You only approve logins and consent screens.

## Install

Install the skill with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add Brgraul/touch-grass
```

The `skills/touch-grass/` folder is self-contained. It ships the app template as one file, `skills/touch-grass/assets/template.bundle`, so no installer can drop or alter template files.

To work on the skill itself, clone this repository and link it instead:

```sh
git clone https://github.com/Brgraul/touch-grass.git
cd touch-grass
ln -s "$PWD/skills/touch-grass" ~/.claude/skills/touch-grass
```

For Codex, link into `${CODEX_HOME:-~/.codex}/skills` instead. A `git pull` then updates the skill. Restart or refresh your agent's skill discovery after linking.

Run the skill's regression checks without provisioning live resources, and type-check its scripts once `template/` has its dependencies installed:

```sh
npm test
npm run typecheck
```

The editable template lives in `template/`. After changing it, stage the changes and rebuild the bundle, then commit both together. A test fails when the bundle is stale.

```sh
git add template
npm run bundle
```

## One command

Create an empty private repository on your Git host, clone it, and invoke the skill from the clone's root:

```text
$touch-grass
```

The agent takes it to a working staging environment in three stages:

1. **Bootstrap.** Checks dependencies, commits the bundled starter and pushes it to `origin`.
2. **Verify.** Runs the repository's `pnpm verify` on your machine: repository access, frozen install, build and the full test suite.
3. **Deploy.** Follows the [staging guide](skills/touch-grass/references/staging.md) with the `tg staging` helper.

If a run stops, invoke `$touch-grass` again in the generated repository. It picks up where it stopped.

## Staging

Once `pnpm verify` passes, the agent deploys the app's `dev` environment from your machine:

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
| **Resumable setup** | Rerun `$touch-grass` in the generated repo to verify it again and finish staging, without bootstrapping it again. |

## What you need

- **An empty private repository** you created, cloned locally, and Git credentials that can push to it.
- **Locally:** a coding agent that loads skills (Codex or Claude Code), Node.js >=22.23 and Git. Local verification also needs Docker and Google Chrome.
- **Accounts:** Cloudflare, Supabase and Google Cloud accounts, and an LLM API key with billing. The Free plans of Cloudflare and Supabase work. Google sign-in stays in Testing mode for listed test users; publishing it needs your homepage and privacy policy.
