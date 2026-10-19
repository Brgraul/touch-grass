import type { Step } from '../lib/engine.ts';
import { must, run, StepError } from '../lib/exec.ts';
import type { Project } from '../lib/project.ts';
import { generatedClone, readJournal, scaffold, scaffoldDone } from '../lib/scaffold.ts';

// Git asks no questions, so a missing credential fails with its reason instead of hanging on a prompt.
const quiet = { GIT_TERMINAL_PROMPT: '0' };
function origin(project: Project): string {
  const url = run('git', ['remote', 'get-url', '--push', 'origin'], { cwd: project.root });
  if (url.status !== 0) throw new StepError('This repository has no origin. Add the empty repository the person created as origin, then rerun.');
  return url.stdout.trim().replace(/\/\/[^/@\s]+@/, '//');
}
function contains(project: Project, tip: string, commit: string): boolean {
  return tip === commit || (run('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: project.root }).status === 0 && run('git', ['merge-base', '--is-ancestor', commit, tip], { cwd: project.root }).status === 0);
}
/** Done once any origin branch contains the initial commit, so later branches are never pushed for the person. */
export function pushDone(project: Project): boolean {
  const commit = readJournal(project)?.initialCommit;
  if (!commit) return false;
  origin(project);
  const tips = must('git', ['ls-remote', '--heads', 'origin'], { cwd: project.root, env: quiet }).split('\n').filter(Boolean).map(line => line.split('\t')[0] ?? '');
  if (tips.length === 0) return false;
  if (tips.some(tip => contains(project, tip, commit))) return true;
  throw new StepError('origin already has branches that do not contain the initial commit. Nothing was pushed; inspect the remote before retrying.');
}
export function push(project: Project): void {
  const branch = must('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: project.root }).trim();
  must('git', ['push', '--quiet', '--set-upstream', 'origin', `refs/heads/${branch}`], { cwd: project.root, env: quiet });
}
export const repositorySteps: Step[] = [
  { id: 'scaffold', group: 'provisioning', title: 'Pinned template committed', needs: ['tools'], actor: 'script',
    async observe(project) {
      if (generatedClone(project)) return { done: true, summary: 'repository generated earlier' };
      return scaffoldDone(project) ? { done: true, summary: 'initial committed template verified' } : { done: false };
    },
    async apply(project) { scaffold(project); },
  },
  { id: 'push', group: 'provisioning', title: 'Initial commit pushed to origin', needs: ['scaffold'], actor: 'script',
    async observe(project) {
      if (generatedClone(project)) return { done: true, summary: 'repository generated earlier' };
      return pushDone(project) ? { done: true, summary: origin(project) } : { done: false };
    },
    async apply(project) { push(project); },
  },
];
