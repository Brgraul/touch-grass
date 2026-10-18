# Codex Cloud setup and proof

Use supported tools and the native UI. Current [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) use Settings > Codex Cloud > Environments, an agent setup conversation, an install script and start skill, then **Publish**. Select the newly created private repository and `main`, and authorize the GitHub integration for it. Drive all accessible configuration steps; the person handles account/password/OAuth/permission/billing gates. Discover an authorized environment-management tool at run time before assuming the UI is required. No private endpoint is part of this skill.

Tell the setup agent to install the repository-pinned runtime and run `pnpm install --frozen-lockfile`, and to prepare Docker/local Supabase and Google Chrome for the full check. Inspect the install script/start skill it produces before publishing. Make the runtime PATH available to later tasks through the environment's supported variables/start skill; an `export` only in installation may not survive a new task.

## Runtime recipe and probes

Run these probes **inside the selected cloud runtime**, through its setup conversation or a supported task. Record actual outcomes without inferring capabilities from the environment label.

```sh
uname -s
uname -m
node --version
corepack --version
pnpm --version
docker version
docker info
google-chrome --version
```

The template pins `.node-version` to 22.23.2 and `packageManager` to pnpm 11.25.0. Image defaults are insufficient. On a Linux x64/arm64 VM with curl, tar and sha256sum, this is a self-contained user-local Node recipe for its install script. It contains no global-skill dependency. Validate the selected runtime before applying it. Other operating systems use their supported Node installer.

```sh
set -eu
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 1 ;; esac
runtime="$HOME/.local/share/touch-grass-runtime"
mkdir -p "$runtime"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
archive="node-v22.23.2-linux-$arch.tar.xz"
curl --fail --silent --show-error "https://nodejs.org/dist/v22.23.2/$archive" -o "$work/$archive"
curl --fail --silent --show-error https://nodejs.org/dist/v22.23.2/SHASUMS256.txt -o "$work/SHASUMS256.txt"
(cd "$work"; grep -F "  $archive" SHASUMS256.txt | sha256sum --check -)
tar -xJf "$work/$archive" -C "$runtime" --strip-components=1
export PATH="$runtime/bin:$PATH"
# Node distributions may omit Corepack. Install its supported package when missing.
if ! command -v corepack >/dev/null 2>&1; then npm install --global corepack; fi
corepack enable
corepack prepare pnpm@11.25.0 --activate
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Inspect that the checksum selection contains exactly the archive's checksum. The temporary download directory above is tool-owned. No downloaded user file is deleted.

After frozen install, install Chrome with `pnpm exec playwright install --with-deps chrome` on a supported Linux image. OS dependencies need available root/sudo permissions. Installing Chrome is distinct from interactive agent browser use, which the new Cloud docs currently mark unsupported. Probe `google-chrome --version` afterward. If permissions, architecture or network policy prevent installation, preserve the limitation and leave affected checks not run.

For Docker, inspect the VM's supported services and privileges. If its OS permits Docker installation, use [Docker's official OS instructions](https://docs.docker.com/engine/install/) in the setup conversation. On an Ubuntu VM, that means Docker's signed apt repository and `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`, followed by starting the supported daemon service. `sudo systemctl enable --now docker` applies only to a systemd VM. Verify the task user can run `docker info` without an interactive privilege prompt. Do not attempt privileged-daemon workarounds in a restricted runtime. A Docker CLI without a working daemon is insufficient.

With working Docker and Chrome, create `supabase/.env` with test placeholders only when absent, then start the local test stack. Preserve existing files.

```sh
if [ ! -e supabase/.env ]; then
  (umask 077; set -C; printf '%s\n' 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=local-test-client' 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=local-test-secret' > supabase/.env)
fi
pnpm exec supabase start
if [ ! -e .dev.vars ]; then pnpm dev:vars; fi
```

Use this from the generated repository root. Both are local to the task. The template's default Google/LLM values are test placeholders; cloud verification needs no hosted credentials. Do not print local stack secret output into the report. The local verifier still runs all four checks in order; preparation is not evidence that any check passed.

Docker and Chrome support in the selected new Cloud runtime remain unverified until these commands actually run. [codex-universal](https://github.com/openai/codex-universal) defaults and the [Supabase Docker issue](https://github.com/openai/codex-universal/issues/19) establish neither support nor absence in a new VM.

## Task submission and handoff

Prefer a supported task tool that can explicitly target the selected environment, otherwise use the environment's native task UI. Do not use `create_thread` to imply a new local/project thread runs in the selected Codex Cloud environment. When a supported tool cannot target it, give the person the selected environment link and this exact prompt to run there. Include the actual repository URL and current commit beside it.

```text
$touch-grass

Read this repository's .agents/skills/touch-grass/SKILL.md and run its four checks in order. Report repository origin, actual git HEAD, the task/environment shown by this cloud session, each command's exit code, and passed/failed/not run. Stop at the first failure. pnpm check exit 2 is incomplete. Do not provision hosted resources or deploy.
```

The agent should submit and watch this itself whenever a supported selected-environment surface exists. A person-only handoff is the fallback, not a completed verification.

[Legacy environments](https://learn.chatgpt.com/docs/environments/cloud-environment) use a different setup/maintenance-script workflow. CLI 0.162.1 exposes task commands and discovers Legacy environments, while [issue #50182](https://github.com/openai/codex/issues/50182) tracks new `asenvcfg_` discovery. Inspect installed `codex cloud --help` and the actual environment selector. Only when the selected environment is discoverable by that CLI may you use `codex cloud exec --env <observed-id> --branch main '<prompt above>'`, then its supported status/task UI. An ID copied from new Cloud is not proof of CLI compatibility. CLI status may exit 1 for pending; inspect its status text. It does not provide the final assistant message, so inspect the task UI or a task-produced artifact in its diff.

## Acceptance

Read the final task output from the supported surface. It must show the selected environment/task, correct repository, actual tested commit, and all four checks passed with exit 0. Do not accept a local JSON file's `runner` label, manually supplied ID, local pass or CI badge as cloud proof. If output/revision/environment cannot be inspected, report pending with the exact missing observation. If a check fails, keep its result and the remaining not-run results. Provisioning and deployment retain separate status.
