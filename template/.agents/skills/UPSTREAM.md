# Bundled skill provenance

Vendored skills are unchanged copies of upstream skills, installed with the [skills CLI](https://github.com/vercel-labs/skills) and pinned to a commit. `skills-lock.json` in the repository root records each skill's source, commit (`ref`), path, and `computedHash`, a SHA-256 over the upstream skill folder. `pnpm check:repo` recomputes that hash for every locked skill and fails when a copy differs from the recorded hash or a `ref` is not a full commit SHA. The check proves the copies match the lock. A reviewer confirms that a changed lock entry matches upstream.

`evals` is not in the lock. It adapts Anthropic's eval guides from https://github.com/anthropics/skills, `skills/claude-api/shared/evals`, commit `dbd4588f9e1033efb41dad4bef2f7947c8993d44`, for any model provider. It is Apache-2.0, with the license in `evals/LICENSE.txt` and a change notice at the top of each adapted file. Edit it like any repository file.

| Skills | Upstream | Commit | License |
|---|---|---|---|
| The 63 pstack skills, `poteto-mode` first | https://github.com/michael-denyer/pstack-claude, `plugins/pstack/skills` | `046341e3aaf2405083973a37f860d0d2ea98e18a` | MIT, in `poteto-mode/references/licenses/` |
| `grill-me`, `grilling` | https://github.com/mattpocock/skills, `skills/productivity` | `49dd158d1076134a641b33efb035946536778336` | MIT, `licenses/mattpocock-skills-LICENSE` |
| `show-me` | https://github.com/humanlayer/skills, `plugins/show-me/skills` | `653b6411c1f70c275a18e37673b042ff99f67ceb` | MIT, `licenses/humanlayer-skills-LICENSE` |
| `vercel-react-best-practices` | https://github.com/vercel-labs/agent-skills, `skills/react-best-practices` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT, declared in its `SKILL.md` front matter |

`vercel-react-best-practices` targets React and Next.js. Apply the React rules and skip the Next.js-only ones. The pstack skills use Claude Code tool names. On Codex, `poteto-mode/references/codex-tools.md` maps them.

## Restore the copies

Run from the repository root:

```sh
npx skills@1.7.2 experimental_install
```

The CLI hashes `metadata.json` but does not copy it, so restore that file for `vercel-react-best-practices` after any install:

```sh
gh api 'repos/vercel-labs/agent-skills/contents/skills/react-best-practices/metadata.json?ref=063bee94c3f4df8453406c830b0a7df0f2860278' --jq .content | base64 -d > .agents/skills/vercel-react-best-practices/metadata.json
```

Then run `pnpm check:repo`.

## Add or update a skill

Install from a GitHub tree URL that names the commit, so the lock pins it:

```sh
npx skills@1.7.2 add https://github.com/<owner>/<repo>/tree/<commit>/<skills-dir> --skill <name> --agent codex --copy --yes
```

Add the upstream license to `licenses/` when the skill folder does not carry one, update the table above, review the diff, and run `pnpm check:repo`. Never edit a vendored file in place. A local change belongs in a new repository-local skill.
