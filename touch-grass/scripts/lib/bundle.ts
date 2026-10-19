import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { must, run } from './exec.ts';

export const bundleRef = 'refs/touch-grass/template';

// A fixed identity and date make the commit a pure function of the tree, so the drift check compares hashes.
const identity = {
  GIT_AUTHOR_NAME: 'Touch Grass', GIT_AUTHOR_EMAIL: 'template@touch-grass.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Touch Grass', GIT_COMMITTER_EMAIL: 'template@touch-grass.invalid', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
};

/** The commit for the staged tree of `prefix`, so a build holds exactly what the next commit will. */
export function templateCommit(repo: string, prefix: string): string {
  const tree = must('git', ['write-tree', `--prefix=${prefix}/`], { cwd: repo }).trim();
  return must('git', ['commit-tree', tree, '-m', 'Touch Grass template'], { cwd: repo, env: identity }).trim();
}

export function bundleCommit(bundle: string): string | undefined {
  const heads = run('git', ['bundle', 'list-heads', bundle, bundleRef]);
  return heads.status === 0 ? heads.stdout.trim().split(' ')[0] : undefined;
}

export function buildTemplateBundle(repo: string, prefix: string, out: string): string {
  const commit = templateCommit(repo, prefix);
  const temp = `${out}.tmp`;
  mkdirSync(dirname(out), { recursive: true });
  must('git', ['update-ref', bundleRef, commit], { cwd: repo });
  try {
    must('git', ['bundle', 'create', '--quiet', temp, bundleRef], { cwd: repo });
    renameSync(temp, out);
  } finally {
    run('git', ['update-ref', '-d', bundleRef], { cwd: repo });
    rmSync(temp, { force: true });
  }
  return commit;
}
