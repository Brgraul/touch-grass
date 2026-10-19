# Codex Cloud setup and proof

Discover an authorized environment-management tool first. Otherwise use the supported browser UI for [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) at Settings > Codex Cloud > Environments. If Computer Use cannot control the native Codex app, continue in the browser. Configure the environment through its setup conversation, inspect its install script, start skill and prepared files, then **Publish** for fresh tasks. A private checkpoint can be published to obtain a fresh runtime or updated policy while verification remains pending. Keep **Only me** access and claim readiness only after complete verification. No private endpoint is part of this skill.

## Account and repository access

Use existing authorized sessions. Before runtime setup, group the prerequisites visible in the supported UI. Confirm that the browser is signed into the intended ChatGPT account and that the GitHub integration can select the new private repository on `main`. **Configure access** may open a separate GitHub page with its own signed-out session. Drive each page until the next concrete account, password, OAuth, permission or billing decision requires the person. State that gate and resume afterward. Never request raw credentials in chat.

If an existing ChatGPT Codex Connector cannot see the newly created private repository, inspect its selected repositories. Have the person add that repository while preserving existing selections, then refresh the environment selector and confirm the repository appears. An existing connector alone does not prove access to a new repository.

Inspect required public download and authentication-discovery hosts while preparing the environment's scoped network policy. Local Google redirect tests use placeholders and abort browser navigation, but Auth still needs `accounts.google.com` for public OpenID discovery. Configure that host without requesting real Google credentials. The prepared checkpoint must be published and used by a fresh task when the running policy cannot receive saved changes.

Tell the setup agent to install the repository-pinned runtime, run `pnpm install --frozen-lockfile`, and prepare local Supabase and the real Google Chrome required by the full check. Inspect the install script and start skill before publishing. Make runtime paths available to later tasks through supported environment variables or the start skill. An `export` only in installation may not survive a new task.

## Runtime recipe and probes

Run these probes **inside the selected cloud runtime**, through its setup conversation or a supported task. Record actual outcomes without inferring capabilities from the environment label. Inspect writable installation/cache paths, available disk, supported package administration and any existing browser before choosing installers.

Distinguish the environment's network policy from the command tool's sandbox. If both the configured proxy and loopback fail with `EPERM`, inspect supported per-command network approval and request it for the required commands. Keep the environment's scoped policy and session-wide protections. An approved host alone does not grant a sandboxed process socket access.

```sh
uname -s
uname -m
node --version
corepack --version
pnpm --version
docker version
docker info
df -h .
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
export PNPM_HOME="$runtime/pnpm"
export npm_config_store_dir="$runtime/pnpm-store"
export XDG_CONFIG_HOME="$runtime/config"
mkdir -p "$PNPM_HOME" "$npm_config_store_dir" "$XDG_CONFIG_HOME"
if ! command -v corepack >/dev/null 2>&1; then npm install --global corepack; fi
corepack enable
corepack prepare pnpm@11.25.0 --activate
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Inspect that the checksum selection contains exactly the archive's checksum. The temporary download directory above is tool-owned. No downloaded user file is deleted.

Persist these writable paths with the toolchain PATH. Wrangler's preview server writes a registry under `XDG_CONFIG_HOME`; an inaccessible home-directory registry can otherwise make the browser suite time out before the app starts.

After frozen install, inspect the repository's Playwright version and browser configuration. On a supported Linux image with package-administration privileges, `pnpm exec playwright install --with-deps chrome` is one route. A root/sudo failure rules out that installer route, not every Chrome route. Check supported user-space installation of the Playwright-compatible real [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) and its required libraries. Follow [Playwright's browser guidance](https://playwright.dev/docs/browsers), preserve the configured browser, and prove that it launches in this runtime before claiming readiness. Installing Chrome is distinct from interactive agent browser use. Record a concrete limitation only after supported alternatives are exhausted.

On Debian/Ubuntu Linux x64 without package-administration privileges, the official Google package can be extracted into the verified writable runtime directory. This uses the same [vendor URL as Playwright's Chrome installer](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/bin/reinstall_chrome_stable_linux.sh). The generated configuration accepts `CHROME_EXECUTABLE_PATH`; retain that value in the environment/start skill. Probe missing shared libraries and an actual Playwright launch and page interaction before adopting this route. An older repository without the executable-path option needs a separate coding change and verification of its new commit.

```sh
curl --fail --location --silent --show-error https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$runtime/chrome-stable.deb"
dpkg-deb --extract "$runtime/chrome-stable.deb" "$runtime/chrome-stable"
export CHROME_EXECUTABLE_PATH="$runtime/chrome-stable/opt/google/chrome/chrome"
"$CHROME_EXECUTABLE_PATH" --version
ldd "$CHROME_EXECUTABLE_PATH"
```

Use the runtime's approved proxy for downloads. When a destination is denied, add only the required public download hosts through the supported environment UI, preserving existing entries, and save. Compare the saved draft with the running policy and test the destination once. **All changes saved** does not prove that the current runtime received the policy. If it cannot apply to the running task, use a supported fresh-task/restart path and preserve prepared files; keep readiness pending until that task passes verification. Do not repeatedly request an already-saved domain from the person.

For Docker, inspect supported services and privileges. If installation is permitted, use [Docker's official OS instructions](https://docs.docker.com/engine/install/). Start the daemon through the runtime's supported service mechanism and verify that the task user can run `docker info` without an interactive privilege prompt. Inspect its storage driver and available disk before pulling the local stack. The [`vfs` driver](https://docs.docker.com/engine/storage/drivers/vfs-driver/) deeply copies image layers and can exhaust a shared filesystem during Postgres extraction even when `docker info` passes. Avoid repeated pulls after a capacity failure. Inventory resources before cleanup; remove only identified unused images created by this setup, preserving pre-existing images, volumes and other projects. Use a supported storage remedy or investigate another local-stack route.

Inspect the pinned CLI's help and [Supabase CLI documentation](https://supabase.com/docs/reference/cli/supabase-start) for supported local runtimes. If it exposes an experimental native stack, validate the required services and repository checks in the selected runtime before adopting it. Neither a working Docker daemon nor a claimed alternative proves that local Supabase works. Use supported daemon service controls and honor the runtime’s privilege boundary.

CLI 2.121.0 exposes a [native runtime for agent sandboxes](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes) with `SUPABASE_EXPERIMENTAL_STACK=1` and `start --runtime native`. Discover its flags from the pinned CLI, select a writable `SUPABASE_HOME`, and preserve existing local projects. Keep the repository's PostgreSQL major, ports, schemas, migrations, Auth hooks and required services. Validate API/DB requests, reset, database tests and type generation. Experimental status uses different output flags; the repository's private `.env.test` interface can supply its actual local settings without changing the verifier. Create that file only when absent, mode 0600, and validate it without printing keys. Serialize the complete result from the repository's `localEnv()` loader, including its defaults; Worker integration reads `.env.test` directly. Preserve existing values when adding missing defaults. Native archive downloads must retain the vendor's manifest/archive checksum verification; a proxy failure is not evidence that the runtime is unsupported.

Native CLI 2.121.0 confines service environments and omits the parent's proxy variables. If host-side discovery succeeds but Auth logs direct DNS failure, use [Auth's supported dotenv configuration](https://github.com/supabase/auth#configuration). The tested Auth 2.197.0 process loads `.env` from its actual working directory, the project root in this runtime. A private proxy-only overlay there supplies the current runtime's approved proxy variables without changing provider settings or vendor files. Inspect the live process directory, preserve existing dotenv values, regenerate the overlay for each fresh task, and restart through the CLI. Prove the actual Auth authorize endpoint returns the Google redirect through the existing gateway; host-side curl and API health alone do not prove discovery works.

Once the chosen local-stack route and Chrome are available, create `supabase/.env` with test placeholders only when absent, then start the stack with that route's validated command. The Docker route uses `pnpm exec supabase start` below. Preserve existing files.

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

Read this repository's .agents/skills/touch-grass/SKILL.md and run its four checks in order. Report repository origin, actual git HEAD, the task/environment shown by this cloud session, each command's exit code, and passed/failed/not run. Stop this attempt at the first failure. Diagnose and repair environment causes, preserve the failed attempt, then restart all four checks. pnpm check exit 2 is incomplete. Continue until verified or a concrete human-only gate remains after supported alternatives. Repository source fixes require a coding task and verification of its new commit. Do not provision hosted resources or deploy.
```

The agent should submit and watch this itself whenever a supported selected-environment surface exists. A person-only handoff is the fallback, not a completed verification. A published filesystem preserves service data, not running processes. In a fresh task, inspect current owner/service lifecycle and actual API/DB requests, then restart through the supported CLI when needed. A retained status file or a successful status-command exit is insufficient readiness evidence.

[Legacy environments](https://learn.chatgpt.com/docs/environments/cloud-environment) use a different setup/maintenance-script workflow. CLI 0.162.1 exposes task commands and discovers Legacy environments, while [issue #50182](https://github.com/openai/codex/issues/50182) tracks new `asenvcfg_` discovery. Inspect installed `codex cloud --help` and the actual environment selector. Only when the selected environment is discoverable by that CLI may you use `codex cloud exec --env <observed-id> --branch main '<prompt above>'`, then its supported status/task UI. An ID copied from new Cloud is not proof of CLI compatibility. CLI status may exit 1 for pending; inspect its status text. It does not provide the final assistant message, so inspect the task UI or a task-produced artifact in its diff.

## Acceptance

Read the final task output from the supported surface. It must show the selected environment/task, correct repository, actual tested commit, and all four checks passed with exit 0. Do not accept a local JSON file's `runner` label, manually supplied ID, local pass or CI badge as cloud proof. If output/revision/environment cannot be inspected, report pending with the exact missing observation. Keep each failed attempt and its remaining not-run results separate from the fresh four-check sequence after repair. Verify that a fresh task retains the saved runtime and startup configuration before claiming setup complete. Provisioning and deployment retain separate status.
