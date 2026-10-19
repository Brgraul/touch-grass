import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bundleRef } from './bundle.ts';
import { must, run, StepError } from './exec.ts';
import { Project, templateBundle } from './project.ts';

type FileEntry = { path: string; mode: '100644' | '100755'; blob: string };
export type RemoteBinding = { owner: string; name: string } & (
  | { kind: 'creating' }
  | { kind: 'created'; id: number }
  | { kind: 'published'; id: number }
);
export type Journal = { version: 1; root: string; source: string; revision: string; files: FileEntry[]; tree: string; initialCommit?: string; remote?: RemoteBinding };
const hash = /^[a-f0-9]{40,64}$/;
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safePath(path: string): boolean { return !!path && path.split('/').every(part => !!part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git' && !part.includes('\\') && !part.includes('\0')); }
export function readJournal(project: Project): Journal | undefined {
  const path = join(project.stateDir, 'journal.json');
  if (!existsSync(path)) return undefined;
  if (lstatSync(project.stateDir).isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new StepError('Refusing symlinked bootstrap state.');
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!object(v) || v.version !== 1 || v.root !== project.root || typeof v.source !== 'string' || typeof v.revision !== 'string' || !hash.test(v.revision) || typeof v.tree !== 'string' || !hash.test(v.tree) || !Array.isArray(v.files)) throw new StepError('Invalid bootstrap journal.');
  const files: FileEntry[] = v.files.map((f: unknown) => {
    if (!object(f) || typeof f.path !== 'string' || !safePath(f.path) || (f.mode !== '100644' && f.mode !== '100755') || typeof f.blob !== 'string' || !hash.test(f.blob)) throw new StepError('Invalid snapshot entry.');
    return { path: f.path, mode: f.mode, blob: f.blob };
  });
  if (!files.length || new Set(files.map(f => f.path)).size !== files.length) throw new StepError('Empty or duplicate snapshot entries.');
  const journal: Journal = { version: 1, root: project.root, source: v.source, revision: v.revision, tree: v.tree, files };
  if (v.initialCommit !== undefined) {
    if (typeof v.initialCommit !== 'string' || !hash.test(v.initialCommit)) throw new StepError('Invalid initial commit.');
    journal.initialCommit = v.initialCommit;
  }
  if (v.remote !== undefined) {
    const b = v.remote;
    if (!object(b) || typeof b.owner !== 'string' || !/^[a-z0-9-]+$/i.test(b.owner) || b.name !== project.slug) throw new StepError('Invalid repository binding.');
    if (b.kind === 'creating') journal.remote = { kind: b.kind, owner: b.owner, name: project.slug };
    else if ((b.kind === 'created' || b.kind === 'published') && typeof b.id === 'number' && Number.isSafeInteger(b.id) && b.id > 0) journal.remote = { kind: b.kind, owner: b.owner, name: project.slug, id: b.id };
    else throw new StepError('Invalid repository receipt.');
  }
  return journal;
}
export function saveJournal(project: Project, journal: Journal): void {
  const path = join(project.stateDir, 'journal.json');
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(journal) + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}
type Snapshot = Pick<Journal, 'source' | 'revision' | 'tree' | 'files'>;
function entries(listing: string, prefix: string): FileEntry[] {
  const files = listing.split('\0').filter(Boolean).map((entry): FileEntry => {
    const tab = entry.indexOf('\t');
    const [mode, type, blob] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755') || !blob || !hash.test(blob) || !path.startsWith(prefix) || !safePath(path.slice(prefix.length))) throw new StepError('Template contains an unsupported mode or unsafe path.');
    return { mode, blob, path: path.slice(prefix.length) };
  });
  if (!files.length) throw new StepError('Template is empty.');
  return files;
}
/** Fetches the shipped template bundle into the new repository. Its ref keeps the objects reachable until the initial commit. */
function bundleSnapshot(project: Project, bundle: string): Snapshot {
  if (!existsSync(bundle)) throw new StepError('The skill has no assets/template.bundle. Reinstall the skill.');
  must('git', ['fetch', '--quiet', '--no-tags', bundle, `+${bundleRef}:${bundleRef}`], { cwd: project.root });
  const revision = must('git', ['rev-parse', '--verify', `${bundleRef}^{commit}`], { cwd: project.root }).trim();
  const tree = must('git', ['rev-parse', `${revision}^{tree}`], { cwd: project.root }).trim();
  return { source: bundle, revision, tree, files: entries(must('git', ['ls-tree', '-rz', tree], { cwd: project.root }), '') };
}
function blob(project: Project, file: FileEntry): Buffer {
  const result = spawnSync('git', ['cat-file', 'blob', file.blob], { cwd: project.root, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new StepError('Pinned template blob is unavailable in this repository. Inspect .git before retrying.');
  return result.stdout;
}
function validateTree(project: Project, journal: Journal): void {
  const files = new Set(journal.files.map(f => f.path));
  const dirs = new Set<string>();
  for (const file of files) { let d = dirname(file); while (d !== '.') { dirs.add(d); d = dirname(d); } }
  function walk(dir: string): void {
    for (const name of readdirSync(project.path(dir))) {
      const path = dir ? `${dir}/${name}` : name;
      if (!dir && name === '.git') continue;
      if (!dir && name === '.DS_Store' && lstatSync(project.path(path)).isFile() && !lstatSync(project.path(path)).isSymbolicLink()) continue;
      const stat = lstatSync(project.path(path));
      if (stat.isSymbolicLink()) throw new StepError(`Refusing symlink at ${path}.`);
      if (stat.isDirectory() && dirs.has(path)) walk(path);
      else if (!stat.isFile() || !files.has(path)) throw new StepError(`Unrelated destination entry ${path}. Preserve it and use an empty directory.`);
    }
  }
  walk('');
  for (const file of journal.files) {
    const path = project.path(file.path);
    if (existsSync(path) && (!readFileSync(path).equals(blob(project, file)) || (lstatSync(path).mode & 0o111) !== (file.mode === '100755' ? 0o111 : 0))) throw new StepError(`Interrupted scaffold conflicts with ${file.path}; its contents were preserved.`);
  }
}
function initialValid(project: Project, journal: Journal, commit: string): boolean {
  return run('git', ['rev-parse', `${commit}^{tree}`], { cwd: project.root }).stdout.trim() === journal.tree
    && must('git', ['rev-list', '--parents', '-n', '1', commit], { cwd: project.root }).trim() === commit
    && must('git', ['show', '-s', '--format=%s', commit], { cwd: project.root }).trim() === 'Initial commit from Touch Grass';
}
export function scaffoldDone(project: Project): boolean {
  const journal = readJournal(project);
  if (!journal?.initialCommit) return false;
  if (!initialValid(project, journal, journal.initialCommit) || run('git', ['merge-base', '--is-ancestor', journal.initialCommit, 'HEAD'], { cwd: project.root }).status !== 0) throw new StepError('Bootstrap initial commit is missing or no longer an ancestor of HEAD.');
  return true;
}
function ensureIdentity(project: Project): void {
  const name = run('git', ['config', '--get', 'user.name'], { cwd: project.root }).stdout.trim();
  const email = run('git', ['config', '--get', 'user.email'], { cwd: project.root }).stdout.trim();
  if ((process.env.GIT_AUTHOR_NAME || name) && (process.env.GIT_AUTHOR_EMAIL || email)
    && (process.env.GIT_COMMITTER_NAME || name) && (process.env.GIT_COMMITTER_EMAIL || email)) return;
  const identity = run('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '[.login,.id]|@tsv']);
  const [login = '', id = ''] = identity.stdout.trim().split('\t');
  if (identity.status !== 0 || !/^[a-z0-9-]+$/i.test(login) || !/^[1-9][0-9]*$/.test(id)) throw new StepError('Git author identity is missing. Configure user.name and user.email for this owned repository, or authorize gh so Touch Grass can derive a private GitHub noreply identity. No files were copied.');
  if (!name) must('git', ['config', '--local', 'user.name', login], { cwd: project.root });
  if (!email) must('git', ['config', '--local', 'user.email', `${id}+${login}@users.noreply.github.com`], { cwd: project.root });
}
export function scaffold(project: Project, bundle = templateBundle): void {
  let journal = readJournal(project);
  if (journal?.initialCommit) { scaffoldDone(project); return; }
  if (!journal) {
    if (readdirSync(project.root).some(n => n !== '.DS_Store' || !lstatSync(project.path(n)).isFile() || lstatSync(project.path(n)).isSymbolicLink())) throw new StepError('Bootstrap requires an empty directory, except .DS_Store. Existing files and Git checkouts are preserved.');
    must('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project.root });
    try {
      mkdirSync(project.stateDir, { mode: 0o700 });
      journal = { version: 1, root: project.root, ...bundleSnapshot(project, bundle) };
      saveJournal(project, journal);
    } catch (error) {
      rmSync(project.path('.git'), { recursive: true, force: true });
      throw error;
    }
  }
  must('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project.root });
  const branch = must('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: project.root }).trim();
  if (branch !== 'main') throw new StepError('Initial bootstrap requires branch main.');
  const head = run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: project.root });
  if (head.status === 0) {
    const commit = head.stdout.trim();
    if (!initialValid(project, journal, commit)) throw new StepError('Unexpected commit during interrupted bootstrap.');
    journal.initialCommit = commit; saveJournal(project, journal); return;
  }
  ensureIdentity(project);
  validateTree(project, journal);
  for (const file of journal.files) {
    const target = project.path(file.path);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, blob(project, file), { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 });
    chmodSync(target, file.mode === '100755' ? 0o755 : 0o644);
  }
  must('git', ['--literal-pathspecs', 'add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: project.root, input: journal.files.map(file => file.path).join('\0') + '\0' });
  if (must('git', ['write-tree'], { cwd: project.root }).trim() !== journal.tree) throw new StepError('Index differs from the pinned template. Nothing was committed.');
  must('git', ['commit', '--quiet', '-m', 'Initial commit from Touch Grass'], { cwd: project.root });
  journal.initialCommit = must('git', ['rev-parse', 'HEAD'], { cwd: project.root }).trim();
  saveJournal(project, journal);
  run('git', ['update-ref', '-d', bundleRef], { cwd: project.root });
}
