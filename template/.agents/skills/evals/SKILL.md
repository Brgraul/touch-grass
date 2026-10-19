---
name: evals
description: Build, audit, and hillclimb evals for an LLM-powered app on any model provider. Use when asked to build an eval, audit an eval or check whether it can be trusted, hillclimb or improve the app against an eval, raise an eval score, or design eval cases, graders, and train/test splits.
---
<!-- Adapted from anthropics/skills@dbd4588f9e1033efb41dad4bef2f7947c8993d44 (skills/claude-api/SKILL.md, eval subcommands), changed for provider neutrality. Apache-2.0, see LICENSE.txt. -->

# Evals

Read the reference the request needs and execute it in order. Do not summarize it back to the user.

| Subcommand | Action |
|---|---|
| `build-eval` | Build an eval set for one flow of the app. Read `references/build-eval.md` immediately and run its interview: Step 0 (what's being evaluated), Step 1 (source the prompts: existing eval, transcripts, or synthesized), Step 2 (grading method), Step 3 (runnable script and measured cost). Get the user's explicit sign-off on the inputs, the grading method, and the cost before producing the eval. |
| `eval-audit` | Check whether an existing eval is trustworthy. Read `references/eval-audit.md`, run it against the eval's cases, runner, and grader, and report per its §6. |
| `hillclimb` | Improve the app against an existing eval. Read `references/eval-hillclimb.md` immediately and follow it: Step 0 (confirm a runnable eval exists, or route to `build-eval`), Step 1 (what to change and what is off-limits), Step 2 (budget and stopping condition from measured per-run cost), plan approval, then the analyze, apply, run, record loop with on-disk state and a train/test split. |

A request that is only a subcommand name follows its row. Otherwise route by intent. "Build me an eval" or "how do I know if my change helped" is `build-eval`. "Is my eval any good?" is `eval-audit`. "Hillclimb", "improve my eval score", or "iterate on my prompt against an eval" is `hillclimb`. Load the reference instead of improvising.

Build every report with `references/report/build-report-lite.mjs`. Don't write a parallel one.

The references name Claude Code tools (`AskUserQuestion`, `Bash`, `Agent`). On another runtime, use its equivalent. On Codex, `../poteto-mode/references/codex-tools.md` maps them.
