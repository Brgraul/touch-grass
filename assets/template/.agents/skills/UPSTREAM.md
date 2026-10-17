# Bundled skill provenance

Three skills are unchanged copies of upstream files, pinned to the commits below. `SOURCE-SHA256.json` records the SHA-256 of every copied file, with paths relative to this directory. The `touch-grass` skill is written for this repository and is not listed there.

| Skill | Upstream | Pin | License |
|---|---|---|---|
| `systematic-debugging` | https://github.com/obra/superpowers, `skills/systematic-debugging` | tag `v6.3.0`, commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT, `superpowers-LICENSE` |
| `verification-before-completion` | https://github.com/obra/superpowers, `skills/verification-before-completion` | tag `v6.3.0`, commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT, `superpowers-LICENSE` |
| `react-best-practices` | https://github.com/vercel-labs/agent-skills, `skills/react-best-practices` | commit `063bee94c3f4df8453406c830b0a7df0f2860278` (2026-08-28) | MIT, declared in its `SKILL.md` front matter |

The `react-best-practices` front matter names the skill `vercel-react-best-practices`. The upstream directory is `react-best-practices`, and this repository keeps that name. Its rules target React and Next.js. Apply the React rules and skip the Next.js-only ones.

## Verify the copies

Run this from `.agents/skills/`. It prints nothing but `OK` lines when no file changed.

```sh
jq -r 'to_entries[] | "\(.value)  \(.key)"' SOURCE-SHA256.json | shasum -a 256 -c -
```

## Update a skill

Copy the new upstream files over the old directory, delete the files upstream removed, and regenerate `SOURCE-SHA256.json`. Then change the pin in the table above. Never edit a copied file in place. A local change belongs in a new repository-local skill.
