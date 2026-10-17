# Touch Grass: MVP Specification

**Tagline:** Bootstrap your project. Let cloud agents build it.

**Goal:** In a single command, your coding agent sets up a batteries-included project scaffold that makes development with coding agent tools a breeze. This includes GitHub repository creation, template installation, Codex Cloud provisioning, and setup verification.

## User Experience

1. User invokes `$touch-grass` in local Codex.
2. Agent creates a private GitHub repository and installs the bundled template.
3. Agent provisions and configures a Codex Cloud environment.
4. Agent verifies the cloud development environment. If runtime isolation prevents verification, instruct the user to invoke `$touch-grass` from the new cloud environment to complete it.

**Zero configuration, no wizard, no questions except unavoidable authorization.**

## Architecture & Decisions

- **Interface:** Globally installed Codex Skill (`touch-grass/SKILL.md`).
- **Stack:** Hardcoded, opinionated TanStack Start. No alternatives.
- **Scaffolding:** Working template bundled in `assets/template/`, containing application code, dependencies, tests, CI, and `AGENTS.md`. No external templates or dynamic code generation.
- **Provisioning:** Deterministic scripts copy the template, initialize Git, create a private GitHub repository, and push the initial commit.
- **Agent Skills:** Bundle version-pinned third-party skills in `.agents/skills/`: `systematic-debugging`, `verification-before-completion` (Superpowers), and `react-best-practices` (Vercel).
- **Cloud setup:** Provision and configure Codex Cloud through supported interfaces. If programmatic provisioning is unavailable, guide the user through the native setup.
- **Verification:** Check repository accessibility, dependency installation, build, tests, and cloud environment readiness. Bundle a repository-local `$touch-grass` skill supporting idempotent verification without repeating provisioning.
- **Execution boundary:** Local Codex handles initialization and orchestration. Codex Cloud handles verification when required and all subsequent development.

## Dependencies & Authentication

- **Local:** Codex, Git, authenticated GitHub CLI (`gh`). GitHub MCP optional.
- **GitHub:** Permissions to create private repositories and push code.
- **Codex Cloud:** Cloud access enabled and GitHub integration authorized for the new repository.
- **Preflight:** Check dependencies and authentication before provisioning. Request authorization only when necessary; never ask users to share credentials in chat.

## Acceptance Criteria

One `$touch-grass` invocation creates a private GitHub repository with a functional TanStack Start starter, bundled Agent Skills, and a configured Codex Cloud environment.

**Success requires passing cloud verification.** If runtime isolation prevents direct verification, provide an explicit `$touch-grass` handoff to the new cloud environment. Report provisioning and verification status separately; never claim unverified setup is complete.
