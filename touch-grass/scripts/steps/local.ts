import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Step } from '../lib/engine.ts';
import { must, run, StepError } from '../lib/exec.ts';
import type { Project } from '../lib/project.ts';
export const localSteps: Step[] = [{
  id: 'tools', group: 'provisioning', title: 'Local tools', needs: [], actor: 'agent',
  async observe() {
    const missing = run('git', ['--version']).status !== 0 ? ['git'] : [];
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 23)) missing.push('Node >=22.23');
    return missing.length ? { done: false, summary: `missing ${missing.join(', ')}` } : { done: true, summary: 'Node >=22.23 and git available' };
  },
  instructions: () => 'Install missing Git/Node using the supported package manager, then rerun. pnpm, Docker and Chrome are needed later for local verification, not to scaffold.',
}];
const head = (project: Project) => must('git', ['rev-parse', '--verify', 'HEAD'], { cwd: project.root }).trim();
const dirty = (project: Project) => must('git', ['status', '--porcelain'], { cwd: project.root }).trim() !== '';
// Per worktree, so a pass in one checkout never vouches for another.
const record = (project: Project) => must('git', ['rev-parse', '--path-format=absolute', '--git-path', 'touch-grass/verified.json'], { cwd: project.root }).trim();
function verifiedHead(project: Project): string | undefined {
  const path = record(project);
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null && 'head' in value && typeof value.head === 'string' ? value.head : undefined;
  } catch { return undefined; }
}
/** `pnpm verify` is the repository's own four-check contract. A pass counts only for the clean commit it ran against. */
export const verificationSteps: Step[] = [{
  id: 'local-verification', group: 'verification', title: 'pnpm verify passed at HEAD', needs: ['push'], actor: 'script',
  async observe(project) {
    const commit = head(project);
    if (dirty(project)) return { done: false, summary: 'uncommitted changes; a pass is recorded only against a clean commit' };
    return verifiedHead(project) === commit ? { done: true, summary: `pnpm verify passed at ${commit}` } : { done: false, summary: `pnpm verify has not passed at ${commit}` };
  },
  async apply(project) {
    if (dirty(project)) throw new StepError('Commit or stash uncommitted changes, then rerun. pnpm verify is recorded against HEAD.');
    const commit = head(project);
    // Its output goes to stderr, so `tg run --json` keeps a clean stdout.
    const result = spawnSync('pnpm', ['verify'], { cwd: project.root, stdio: ['ignore', 2, 2] });
    const code = result.error ? 127 : result.status ?? 1;
    if (code === 127) throw new StepError('pnpm is not installed. Run `corepack enable pnpm` or install pnpm 11, then rerun.');
    if (code === 2) throw new StepError('pnpm verify is incomplete: a check did not run. Its summary names the check and the reason, such as Docker not running. Fix that, then rerun.');
    if (code !== 0) throw new StepError(`pnpm verify exited with ${code}. Fix the check its summary names as failed, then rerun.`);
    if (head(project) !== commit || dirty(project)) throw new StepError('The checkout changed while pnpm verify ran. Rerun.');
    const path = record(project);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ head: commit }) + '\n', { mode: 0o600 });
  },
}];
