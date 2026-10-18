import type { Step } from '../lib/engine.ts';
import { must, run, StepError } from '../lib/exec.ts';
import type { Project } from '../lib/project.ts';
import { readJournal, saveJournal, scaffold, scaffoldDone } from '../lib/scaffold.ts';

function login(): string {
  const owner = must('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login']).trim();
  if (!/^[a-z0-9-]+$/i.test(owner)) throw new StepError('GitHub returned an invalid account identity.');
  return owner;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
type ApiResult = { kind: 'missing' } | { kind: 'empty' } | { kind: 'found'; value: unknown };
function api(endpoint: string, fields: string[] = [], allowEmpty = false): ApiResult {
  const result = run('gh', ['api', '--hostname', 'github.com', '--include', endpoint, ...fields]);
  const match = /^HTTP\/[^ ]+ (\d{3})[^\n]*\r?\n([\s\S]*)$/.exec(result.stdout);
  if (!match) throw new StepError('GitHub API did not return a confirmed HTTP response. Check authentication and connectivity.');
  const status = Number(match[1]);
  if (status === 404 && result.status !== 0) return { kind: 'missing' };
  if (status === 409 && result.status !== 0 && allowEmpty) {
    const body = /\r?\n\r?\n/.exec(match[2] ?? '');
    if (body) {
      try {
        const value: unknown = JSON.parse((match[2] ?? '').slice(body.index + body[0].length));
        if (object(value) && value.message === 'Git Repository is empty.') return { kind: 'empty' };
      } catch {}
    }
  }
  if (status < 200 || status >= 300 || result.status !== 0) throw new StepError(`GitHub API returned HTTP ${status}; this is not repository absence.`);
  const rest = match[2] ?? '';
  const separator = /\r?\n\r?\n/.exec(rest);
  if (!separator || separator.index === undefined) throw new StepError('GitHub response has no JSON body.');
  try { return { kind: 'found', value: JSON.parse(rest.slice(separator.index + separator[0].length)) }; }
  catch { throw new StepError('GitHub returned invalid JSON.'); }
}
type Repo = { id: number; owner: string; name: string; defaultBranch: string };
function repository(owner: string, name: string): Repo | undefined {
  const result = api(`repos/${owner}/${name}`);
  if (result.kind !== 'found') return undefined;
  const v = result.value;
  if (!object(v) || typeof v.id !== 'number' || !Number.isSafeInteger(v.id) || v.id <= 0 || typeof v.full_name !== 'string' || v.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()) throw new StepError('GitHub repository identity does not match the expected owner/name.');
  if (v.private !== true) throw new StepError('Refusing a public repository. Touch Grass requires private visibility.');
  if (typeof v.default_branch !== 'string') throw new StepError('GitHub returned no default branch.');
  return { id: v.id, owner, name, defaultBranch: v.default_branch };
}
export function normalizeOrigin(url: string): string | undefined {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
function checkOrigin(project: Project, owner: string, name: string): boolean {
  const result = run('git', ['remote', 'get-url', '--push', '--all', 'origin'], { cwd: project.root });
  if (result.status !== 0) {
    const names = must('git', ['remote'], { cwd: project.root }).trim().split('\n');
    if (names.includes('origin')) throw new StepError('Origin exists but has no readable push URL.');
    return false;
  }
  const urls = result.stdout.trim().split('\n');
  // Read literal configured URLs because Git may expand a user transport rewrite.
  const configured = must('git', ['config', '--get-all', 'remote.origin.url'], { cwd: project.root }).trim().split('\n');
  const pushes = run('git', ['config', '--get-all', 'remote.origin.pushurl'], { cwd: project.root });
  const raw = pushes.status === 0 ? pushes.stdout.trim().split('\n') : configured;
  if (urls.length !== 1 || raw.length !== 1 || configured.length !== 1 || [...urls, ...raw, ...configured].some(url => normalizeOrigin(url) !== `${owner}/${name}`.toLowerCase())) throw new StepError('Origin does not match the expected GitHub repository. No push was attempted.');
  return true;
}
function remoteMain(owner: string, name: string, allowEmpty = false): string | undefined {
  const result = api(`repos/${owner}/${name}/git/ref/heads/main`, [], allowEmpty);
  if (result.kind !== 'found') return undefined;
  const v = result.value;
  if (!object(v) || !object(v.object) || typeof v.object.sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(v.object.sha)) throw new StepError('GitHub returned an invalid main ref.');
  return v.object.sha;
}
export function githubDone(project: Project): boolean {
  const journal = readJournal(project);
  if (!journal?.initialCommit) return false;
  const owner = login();
  if (journal.remote && journal.remote.owner.toLowerCase() !== owner.toLowerCase()) throw new StepError('Authenticated GitHub account differs from the bound owner.');
  checkOrigin(project, owner, project.slug);
  const repo = repository(owner, project.slug);
  if (!repo) {
    if (journal.remote) throw new StepError('The bound repository is missing. Inspect it before retrying; no replacement will be created.');
    return false;
  }
  if (!journal.remote || journal.remote.kind === 'creating') throw new StepError('Same-name repository has no creation receipt. Ownership is ambiguous, including a possibly lost create response. Inspect it manually; it will not be adopted or pushed.');
  if (repo.id !== journal.remote.id) throw new StepError('GitHub repository ID differs from the creation receipt.');
  if (!checkOrigin(project, owner, project.slug)) return false;
  const main = remoteMain(owner, project.slug, journal.remote.kind === 'created');
  if (journal.remote.kind === 'published') {
    if (repo.defaultBranch !== 'main') throw new StepError('Published repository no longer has default branch main.');
    if (!main) throw new StepError('Previously published main branch is missing.');
    return true;
  }
  if (main && main !== journal.initialCommit) throw new StepError('Remote main differs from the initial commit. No push will overwrite it.');
  return false;
}
export function ensureGithub(project: Project): void {
  const journal = readJournal(project);
  if (!journal?.initialCommit) throw new StepError('Scaffold must complete first.');
  const owner = login();
  if (journal.remote && journal.remote.owner.toLowerCase() !== owner.toLowerCase()) throw new StepError('Authenticated GitHub account differs from bound owner.');
  checkOrigin(project, owner, project.slug);
  let repo = repository(owner, project.slug);
  if (!repo) {
    if (journal.remote) throw new StepError('Creation was already attempted. Inspect GitHub before retrying; ownership is uncertain.');
    journal.remote = { kind: 'creating', owner, name: project.slug }; saveJournal(project, journal);
    const result = api('user/repos', ['--method', 'POST', '-f', `name=${project.slug}`, '-F', 'private=true']);
    if (result.kind !== 'found' || !object(result.value) || typeof result.value.id !== 'number' || !Number.isSafeInteger(result.value.id) || result.value.id <= 0 || result.value.private !== true || result.value.full_name !== `${owner}/${project.slug}`) throw new StepError('Repository create response is uncertain. Inspect GitHub before recovery.');
    journal.remote = { kind: 'created', owner, name: project.slug, id: result.value.id }; saveJournal(project, journal);
    repo = repository(owner, project.slug);
  }
  if (!repo || !journal.remote || journal.remote.kind === 'creating' || journal.remote.id !== repo.id) throw new StepError('Refusing an unrelated same-name repository or ambiguous creation.');
  if (journal.remote.kind === 'published') return;
  const main = remoteMain(owner, project.slug, journal.remote.kind === 'created');
  if (main && main !== journal.initialCommit) throw new StepError('Remote main differs from initial commit.');
  if (must('git', ['rev-parse', 'refs/heads/main'], { cwd: project.root }).trim() !== journal.initialCommit) throw new StepError('Local main changed before first publish. Preserve the work and resolve the bootstrap manually.');
  if (!checkOrigin(project, owner, project.slug)) must('git', ['remote', 'add', 'origin', `https://github.com/${owner}/${project.slug}.git`], { cwd: project.root });
  checkOrigin(project, owner, project.slug);
  if (!main) must('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '--quiet', 'origin', `${journal.initialCommit}:refs/heads/main`], { cwd: project.root, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (remoteMain(owner, project.slug) !== journal.initialCommit) throw new StepError('Initial main could not be confirmed at the expected commit.');
  if (repo.defaultBranch !== 'main') {
    api(`repos/${owner}/${project.slug}`, ['--method', 'PATCH', '-f', 'default_branch=main']);
    if (repository(owner, project.slug)?.defaultBranch !== 'main') throw new StepError('Could not confirm default branch main.');
  }
  journal.remote = { kind: 'published', id: repo.id, owner, name: project.slug }; saveJournal(project, journal);
}
export const githubSteps: Step[] = [
  { id: 'github-auth', group: 'provisioning', title: 'GitHub CLI authorization', needs: ['tools'], actor: 'agent',
    async observe() { return run('gh', ['auth', 'status', '--hostname', 'github.com']).status === 0 ? { done: true, summary: `signed in as ${login()}` } : { done: false, summary: 'GitHub authorization required' }; },
    instructions: () => 'Start gh auth login --hostname github.com --git-protocol https --web in an interactive terminal. Drive the browser until the person must approve the displayed code/OAuth request. Resume after the command finishes; never request a token in chat.',
  },
  { id: 'scaffold', group: 'provisioning', title: 'Pinned template committed', needs: ['tools', 'github-auth'], actor: 'script',
    async observe(project) { return scaffoldDone(project) ? { done: true, summary: 'initial committed template verified' } : { done: false }; },
    async apply(project) { scaffold(project); },
  },
  { id: 'github-repo', group: 'provisioning', title: 'Private GitHub repository and main', needs: ['github-auth', 'scaffold'], actor: 'script',
    async observe(project) { return githubDone(project) ? { done: true, summary: `https://github.com/${readJournal(project)?.remote?.owner}/${project.slug}` } : { done: false }; },
    async apply(project) { ensureGithub(project); },
  },
];
