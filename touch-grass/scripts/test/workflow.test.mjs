import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Project } from '../lib/project.ts';
import { readJournal, saveJournal, scaffold, scaffoldDone } from '../lib/scaffold.ts';
import { push, pushDone } from '../steps/repository.ts';
import { evaluate, exitCode, report, validateSteps } from '../lib/engine.ts';
import { verificationSteps } from '../steps/local.ts';
import { must } from '../lib/exec.ts';
import { buildTemplateBundle } from '../lib/bundle.ts';

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
const git = (cwd, args, options = {}) => {
  const result = spawnSync(realGit, args, { cwd, encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'touch grass fixture '));
  const saved = { ...process.env };
  t.after(() => { process.env = saved; rmSync(root, { recursive: true, force: true }); });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig') });
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
  // A stand-in for the generated repository's `pnpm verify`: it logs each run and exits with FAKE_VERIFY_EXIT.
  const pnpmLog = join(root, 'pnpm.log');
  mkdirSync(join(root, 'fake-bin'));
  writeFileSync(join(root, 'fake-bin/pnpm'), `#!/bin/sh\necho "pnpm $*" >> ${JSON.stringify(pnpmLog)}\necho noisy verifier output\nexit "\${FAKE_VERIFY_EXIT:-0}"\n`, { mode: 0o755 });
  process.env.PATH = `${join(root, 'fake-bin')}:${process.env.PATH}`;
  const source = join(root, 'source');
  const target = join(root, 'fresh-app');
  const remote = join(root, 'remote.git');
  mkdirSync(source); mkdirSync(target);
  git(source, ['init', '-q', '-b', 'main']);
  // The person's empty private repository, already cloned.
  git(root, ['init', '--bare', '-q', '-b', 'main', remote]);
  git(target, ['init', '-q', '-b', 'main']); git(target, ['remote', 'add', 'origin', remote]);
  const entries = { '.hidden': 'dotfile\n', 'bin/run': '#!/bin/sh\nexit 0\n', 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n', 'src/main.ts': 'export const answer = 42;\n' };
  for (const [path, value] of Object.entries(entries)) {
    const file = join(source, 'template', path);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value);
  }
  chmodSync(join(source, 'template/bin/run'), 0o755);
  git(source, ['add', '.']); git(source, ['commit', '-qm', 'Template fixture']);
  writeFileSync(join(source, 'template/.hidden'), 'dirty source\n');
  writeFileSync(join(source, 'template/untracked-secret'), 'secret\n');
  const project = new Project(target);
  const bundle = join(root, 'skill/assets/template.bundle');
  // Each read rebuilds the bundle from the staged template, as the release build does.
  return { root, source, target, remote, project, entries, verifyRuns: () => existsSync(pnpmLog) ? readFileSync(pnpmLog, 'utf8').split('\n').filter(Boolean).length : 0, get template() { buildTemplateBundle(source, 'template', bundle); return bundle; } };
}
function initialized(t) {
  const f = fixture(t); scaffold(f.project, f.template); return f;
}
const remoteMain = f => spawnSync(realGit, ['--git-dir', f.remote, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'], { encoding: 'utf8' }).stdout.trim();

test('copies only committed tracked blobs, dotfiles, lockfile and executable mode', t => {
  const f = fixture(t); writeFileSync(join(f.target, '.DS_Store'), 'harmless');
  scaffold(f.project, f.template);
  for (const [path, value] of Object.entries(f.entries)) assert.equal(readFileSync(join(f.target, path), 'utf8'), value);
  assert.equal(lstatSync(join(f.target, 'bin/run')).mode & 0o777, 0o755);
  assert.equal(existsSync(join(f.target, 'untracked-secret')), false);
  assert.deepEqual(git(f.target, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').sort(), Object.keys(f.entries).sort());
  assert.equal(lstatSync(join(f.project.stateDir, 'journal.json')).mode & 0o777, 0o600);
  assert.equal(scaffoldDone(f.project), true);
});

test('refuses existing files, matching directories, symlinks, born repositories and non-repositories', async t => {
  for (const kind of ['file', 'directory', 'symlink', 'commit', 'no-git', 'worktree-file', 'ds-symlink']) await t.test(kind, t => {
    const f = fixture(t);
    if (kind === 'no-git' || kind === 'worktree-file') rmSync(join(f.target, '.git'), { recursive: true });
    if (kind === 'file') writeFileSync(join(f.target, 'pnpm-lock.yaml'), 'sentinel');
    if (kind === 'directory') { mkdirSync(join(f.target, 'src')); writeFileSync(join(f.target, 'src/user.ts'), 'sentinel'); }
    if (kind === 'symlink') symlinkSync(f.source, join(f.target, 'src'));
    if (kind === 'ds-symlink') symlinkSync(f.source, join(f.target, '.DS_Store'));
    if (kind === 'commit') git(f.target, ['commit', '-q', '--allow-empty', '-m', 'Existing work']);
    if (kind === 'worktree-file') writeFileSync(join(f.target, '.git'), 'gitdir: /unowned');
    const before = readdirSync(f.target);
    assert.throws(() => scaffold(f.project, f.template), kind === 'no-git' ? /empty Git repository/ : kind === 'commit' ? /already has commits/ : undefined);
    assert.deepEqual(readdirSync(f.target), before);
    if (kind !== 'no-git' && kind !== 'worktree-file') assert.equal(existsSync(f.project.stateDir), false);
    if (kind === 'file') assert.equal(readFileSync(join(f.target, 'pnpm-lock.yaml'), 'utf8'), 'sentinel');
  });
});

test('a copied skill folder scaffolds from its bundle without any checkout, keeping files installers drop', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'template/metadata.json'), '{}\n');
  git(f.source, ['add', 'template/metadata.json']); git(f.source, ['commit', '-qm', 'Add metadata']);
  const copied = join(f.root, 'installed skills/touch-grass/assets/template.bundle');
  mkdirSync(dirname(copied), { recursive: true }); copyFileSync(f.template, copied);
  scaffold(f.project, copied);
  assert.deepEqual(git(f.target, ['ls-files']).split('\n').sort(), ['.hidden', 'bin/run', 'metadata.json', 'pnpm-lock.yaml', 'src/main.ts']);
  assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), f.entries['.hidden'], 'unstaged source edits never ship');
  assert.equal(git(f.target, ['ls-files', '-s', 'bin/run']).split(' ')[0], '100755');
  assert.equal(git(f.target, ['for-each-ref', 'refs/touch-grass']), '', 'the bundle ref is removed after the initial commit');
});

test('a missing bundle fails before claiming the directory', t => {
  const f = fixture(t);
  assert.throws(() => scaffold(f.project, join(f.root, 'absent.bundle')), /template\.bundle/);
  assert.deepEqual(readdirSync(f.target), ['.git']);
  assert.equal(existsSync(f.project.stateDir), false);
});

test('interruption at every file boundary resumes once and never overwrites conflicts', async t => {
  for (const stop of ['.hidden', 'bin/run', 'pnpm-lock.yaml', 'src/main.ts']) await t.test(stop, t => {
    const f = fixture(t);
    class Interrupted extends Project {
      count = 0;
      path(...parts) {
        if (parts.join('/') === stop && ++this.count === 2) throw new Error('simulated interruption');
        return super.path(...parts);
      }
    }
    assert.throws(() => scaffold(new Interrupted(f.target), f.template), /simulated interruption/);
    assert.ok(readJournal(f.project));
    assert.equal(readJournal(f.project).initialCommit, undefined);
    scaffold(f.project, f.template);
    const commit = git(f.target, ['rev-parse', 'HEAD']);
    scaffold(f.project, f.template);
    assert.equal(git(f.target, ['rev-parse', 'HEAD']), commit);
    assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '1');
  });
});

test('modified interrupted copy and unrelated entries are preserved and refused', async t => {
  for (const kind of ['changed', 'unrelated', 'symlink']) await t.test(kind, t => {
    const f = fixture(t);
    class Interrupted extends Project {
      count = 0;
      path(...parts) { if (parts[0] === 'src/main.ts' && ++this.count === 2) throw new Error('stop'); return super.path(...parts); }
    }
    assert.throws(() => scaffold(new Interrupted(f.target), f.template));
    if (kind === 'changed') writeFileSync(join(f.target, '.hidden'), 'user-change');
    if (kind === 'unrelated') writeFileSync(join(f.target, 'user.txt'), 'user-change');
    if (kind === 'symlink') { rmSync(join(f.target, 'bin/run')); symlinkSync(join(f.source, 'template/bin/run'), join(f.target, 'bin/run')); }
    assert.throws(() => scaffold(f.project, f.template));
    if (kind === 'changed') assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), 'user-change');
    if (kind === 'unrelated') assert.equal(readFileSync(join(f.target, 'user.txt'), 'utf8'), 'user-change');
    assert.notEqual(spawnSync(realGit, ['rev-parse', '--verify', 'HEAD'], { cwd: f.target }).status, 0);
  });
});

test('commit-response loss recovery validates exact initial tree and preserves subsequent work', t => {
  const f = fixture(t); scaffold(f.project, f.template);
  const journal = readJournal(f.project); const initial = journal.initialCommit;
  delete journal.initialCommit; saveJournal(f.project, journal);
  writeFileSync(join(f.target, '.hidden'), 'subsequent work');
  scaffold(f.project, f.template);
  assert.equal(readJournal(f.project).initialCommit, initial);
  assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), 'subsequent work');
  git(f.target, ['add', '.hidden']); git(f.target, ['commit', '-qm', 'User work']);
  const later = git(f.target, ['rev-parse', 'HEAD']); scaffold(f.project, f.template);
  assert.equal(git(f.target, ['rev-parse', 'HEAD']), later);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '2');
});

test('any HEAD marker cannot substitute for the initial snapshot', t => {
  const f = fixture(t); scaffold(f.project, f.template);
  const journal = readJournal(f.project); delete journal.initialCommit; saveJournal(f.project, journal);
  writeFileSync(join(f.target, '.hidden'), 'other'); git(f.target, ['add', '.']); git(f.target, ['commit', '--amend', '-qm', 'Not bootstrap']);
  assert.equal(scaffoldDone(f.project), false);
  assert.throws(() => scaffold(f.project, f.template), /Unexpected commit/);
});

test('first push publishes the initial commit to the empty origin and tracks it', t => {
  const f = initialized(t);
  assert.equal(pushDone(f.project), false);
  push(f.project);
  assert.equal(pushDone(f.project), true);
  assert.equal(remoteMain(f), readJournal(f.project).initialCommit);
  assert.equal(git(f.target, ['rev-parse', '--abbrev-ref', 'main@{upstream}']), 'origin/main');
});

test('the push follows whatever branch the clone checked out', t => {
  const f = fixture(t);
  git(f.target, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
  scaffold(f.project, f.template); push(f.project);
  assert.equal(git(f.root, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/trunk']), readJournal(f.project).initialCommit);
});

test('push response loss reconciles without a second push or commit', t => {
  const f = initialized(t);
  const bin = join(f.root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const cp = require('node:child_process'); const args = process.argv.slice(2);
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(args.includes('push') && result.status === 0 ? 1 : result.status ?? 1);
`, { mode: 0o755 });
  const path = process.env.PATH; process.env.PATH = `${bin}:${path}`;
  assert.throws(() => push(f.project), /git push exited with 1/);
  process.env.PATH = path;
  assert.equal(pushDone(f.project), true);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '1');
});

test('an origin branch without the initial commit is never overwritten', t => {
  const f = initialized(t);
  const other = join(f.root, 'other'); mkdirSync(other);
  git(other, ['init', '-q', '-b', 'main']); git(other, ['commit', '-q', '--allow-empty', '-m', 'Unrelated']); git(other, ['push', '-q', f.remote, 'main']);
  const unrelated = remoteMain(f);
  assert.throws(() => pushDone(f.project), /do not contain the initial commit/);
  assert.equal(remoteMain(f), unrelated);
});

test('a missing or unreachable origin fails with its reason and pushes nothing', async t => {
  for (const kind of ['missing', 'unreachable']) await t.test(kind, t => {
    const f = initialized(t);
    if (kind === 'missing') git(f.target, ['remote', 'remove', 'origin']);
    else git(f.target, ['remote', 'set-url', 'origin', join(f.root, 'absent.git')]);
    assert.throws(() => pushDone(f.project), kind === 'missing' ? /no origin/ : /git ls-remote exited/);
    assert.equal(remoteMain(f), '');
  });
});

test('empty, provisioning-only and unobserved local verification stay incomplete', async t => {
  const f = initialized(t);
  const both = ['provisioning', 'verification'];
  assert.equal(exitCode([], ['provisioning']), 2);
  const local = { id: 'push', group: 'provisioning', title: 'Local', state: 'done', summary: 'ready' };
  assert.equal(exitCode([local], both), 2);
  assert.equal(exitCode([local], ['provisioning']), 0);
  const script = { ...local, actor: 'script', needs: [], observe: async () => ({ done: true, summary: 'ready' }), apply: async () => {} };
  const outcomes = await evaluate([script, ...verificationSteps], f.project, ['provisioning']);
  assert.equal(exitCode(outcomes, both), 2);
  assert.deepEqual([report(outcomes).provisioning, report(outcomes).verification, report(outcomes).deployment], ['complete', 'pending', 'not configured']);
  assert.equal(outcomes.find(o => o.id === 'local-verification').state, 'ready');
  assert.equal(f.verifyRuns(), 0, 'only tg verify runs the verifier');
  assert.throws(() => validateSteps([script, script]));
  assert.throws(() => validateSteps([{ ...script, needs: ['missing'] }]));
});

test('CLI help, invalid args, read-only status and complete offline fixture', t => {
  const f = initialized(t);
  const cli = (...args) => spawnSync(process.execPath, [join(scripts, 'tg.ts'), ...args], { cwd: f.target, encoding: 'utf8' });
  assert.equal(cli('--help').status, 0);
  assert.equal(spawnSync(join(scripts, 'tg'), ['--help'], { cwd: f.target }).status, 0);
  assert.equal(spawnSync(join(scripts, 'tg'), ['invalid'], { cwd: f.target }).status, 1);
  assert.equal(cli('run', '--unknown').status, 1);
  assert.equal(cli('run', 'extra').status, 1);
  const before = git(f.target, ['rev-parse', 'HEAD']);
  const status = cli('status', '--json'); assert.equal(status.status, 2); assert.equal(remoteMain(f), '');
  assert.equal(JSON.parse(status.stdout).outcomes.find(o => o.id === 'push').state, 'ready');
  const result = cli('run', '--json'); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.provisioning, 'complete'); assert.equal(value.verification, 'pending'); assert.equal(value.deployment, 'not configured');
  assert.equal(value.outcomes.find(o => o.id === 'push').state, 'done');
  assert.equal(f.verifyRuns(), 0, 'tg run never runs the verifier');
  assert.match(cli('run').stdout, /Run `tg verify`\./);
  const verified = cli('verify', '--json'); assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verification, 'complete');
  assert.equal(git(f.target, ['rev-parse', 'HEAD']), before);
  assert.equal(remoteMain(f), before);
  writeFileSync(join(f.target, '.hidden'), 'later'); git(f.target, ['add', '.hidden']); git(f.target, ['commit', '-qm', 'Later']);
  assert.equal(cli('run', '--json').status, 0);
  assert.equal(remoteMain(f), before, 'a rerun never pushes later work');
});

test('installer handles path spaces, reruns and preserves unrelated existing installs', t => {
  const f = fixture(t); const installation = join(f.root, 'skills with spaces');
  const install = () => spawnSync(process.execPath, [join(scripts, 'install.mjs'), '--skills-dir', installation], { encoding: 'utf8' });
  assert.equal(install().status, 0); assert.equal(lstatSync(join(installation, 'touch-grass')).isSymbolicLink(), true); assert.equal(install().status, 0);
  rmSync(join(installation, 'touch-grass')); mkdirSync(join(installation, 'touch-grass')); writeFileSync(join(installation, 'touch-grass', 'sentinel'), 'preserve');
  assert.equal(install().status, 1); assert.equal(readFileSync(join(installation, 'touch-grass', 'sentinel'), 'utf8'), 'preserve');
  rmSync(join(installation, 'touch-grass'), { recursive: true }); symlinkSync(join(f.root, 'missing'), join(installation, 'touch-grass'));
  assert.equal(install().status, 1);
});

test('subprocess failures name the vendor reason, and suppress output marked sensitive', t => {
  const f = fixture(t);
  const failing = ['-e', 'process.stderr.write("fatal: sensitive-sentinel via https://user:pw@example.com/x\\n");process.stdout.write("sensitive-sentinel");process.exit(1)'];
  assert.throws(() => must(process.execPath, failing), error => error.message.includes('fatal: sensitive-sentinel') && !error.message.includes('pw@'));
  assert.throws(() => must(process.execPath, failing, { sensitive: true }), error => !error.message.includes('sensitive-sentinel'));
});

test('installer runs from a checkout path containing spaces', t => {
  const f = fixture(t);
  const checkout = join(f.root, 'checkout with spaces');
  const copiedScripts = join(checkout, 'touch-grass/scripts');
  mkdirSync(copiedScripts, { recursive: true }); mkdirSync(join(checkout, 'touch-grass/assets'), { recursive: true }); writeFileSync(join(checkout, 'touch-grass/assets/template.bundle'), 'fixture');
  writeFileSync(join(checkout, 'touch-grass/SKILL.md'), 'fixture');
  copyFileSync(join(scripts, 'install.mjs'), join(copiedScripts, 'install.mjs'));
  const destination = join(f.root, 'global skills');
  const result = spawnSync(process.execPath, [join(copiedScripts, 'install.mjs'), '--skills-dir', destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(destination, 'touch-grass/SKILL.md'), 'utf8'), 'fixture');
});

test('tracked template symlinks are refused before destination claim', t => {
  const f = fixture(t);
  symlinkSync('src/main.ts', join(f.source, 'template/link'));
  git(f.source, ['add', 'template/link']); git(f.source, ['commit', '-qm', 'Symlink fixture']);
  assert.throws(() => scaffold(f.project, f.template), /unsupported mode/);
  assert.deepEqual(readdirSync(f.target), ['.git']);
  assert.equal(existsSync(f.project.stateDir), false);
  assert.equal(git(f.target, ['for-each-ref', 'refs/touch-grass']), '');
});

test('journal traversal and symlink state are rejected', async t => {
  for (const kind of ['traversal', 'state-symlink']) await t.test(kind, t => {
    const f = fixture(t); scaffold(f.project, f.template);
    if (kind === 'traversal') {
      const journal = readJournal(f.project); journal.files[0].path = '../escaped';
      writeFileSync(join(f.project.stateDir, 'journal.json'), JSON.stringify(journal));
    } else {
      const original = join(f.project.stateDir, 'journal.json');
      const outside = join(f.root, 'journal-copy'); copyFileSync(original, outside); rmSync(original); symlinkSync(outside, original);
    }
    assert.throws(() => scaffold(f.project, f.template));
    assert.equal(existsSync(join(f.root, 'escaped')), false);
  });
});

test('missing Git identity stops before copying any file', t => {
  const f = fixture(t);
  for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete process.env[name];
  assert.throws(() => scaffold(f.project, f.template), /user\.name and user\.email/);
  assert.deepEqual(readdirSync(f.target), ['.git']);
  assert.equal(readJournal(f.project).initialCommit, undefined);
});

test('tracked files that match template ignore patterns are still committed exactly', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'template/.gitignore'), 'ignored-tracked\n');
  writeFileSync(join(f.source, 'template/ignored-tracked'), 'tracked despite ignore');
  git(f.source, ['add', '--force', 'template/.gitignore', 'template/ignored-tracked']);
  git(f.source, ['commit', '-qm', 'Tracked ignored fixture']);
  scaffold(f.project, f.template);
  assert.equal(git(f.target, ['show', 'HEAD:ignored-tracked']), 'tracked despite ignore');
});

test('failed real commit hook resumes without duplicate commit or recopying user changes', t => {
  const f = fixture(t);
  class Interrupted extends Project {
    count = 0;
    path(...parts) { if (parts[0] === '.hidden' && ++this.count === 2) throw new Error('stop after init'); return super.path(...parts); }
  }
  assert.throws(() => scaffold(new Interrupted(f.target), f.template));
  const hook = join(f.target, '.git/hooks/pre-commit'); writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => scaffold(f.project, f.template), /git commit exited/);
  for (const path of Object.keys(f.entries)) assert.ok(existsSync(join(f.target, path)));
  assert.equal(readJournal(f.project).initialCommit, undefined);
  rmSync(hook); scaffold(f.project, f.template); scaffold(f.project, f.template);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '1');
});

test('resume remains pinned when the template source advances', t => {
  const f = fixture(t);
  class Interrupted extends Project {
    count = 0;
    path(...parts) { if (parts[0] === '.hidden' && ++this.count === 2) throw new Error('stop'); return super.path(...parts); }
  }
  assert.throws(() => scaffold(new Interrupted(f.target), f.template));
  const pinned = readJournal(f.project).revision;
  writeFileSync(join(f.source, 'template/.hidden'), 'new source revision');
  git(f.source, ['add', 'template/.hidden']); git(f.source, ['commit', '-qm', 'Source advanced']);
  scaffold(f.project, f.template);
  assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), f.entries['.hidden']);
  assert.equal(readJournal(f.project).revision, pinned);
});

function generated(t) {
  const f = fixture(t);
  const relative = 'tools/verify.ts';
  mkdirSync(dirname(join(f.source, 'template', relative)), { recursive: true });
  writeFileSync(join(f.source, 'template', relative), '// Repository verifier\n');
  git(f.source, ['add', 'template/tools']); git(f.source, ['commit', '-qm', 'Add local verifier']);
  scaffold(f.project, f.template); push(f.project);
  return f;
}
function tg(cwd, command, env = {}) {
  const result = spawnSync(join(scripts, 'tg'), [command, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  const value = JSON.parse(result.stdout);
  return { status: result.status, stderr: result.stderr, value, state: id => value.outcomes.find(o => o.id === id) };
}

test('a later branch is never pushed once origin holds the initial commit', t => {
  const f = generated(t);
  git(f.target, ['checkout', '-qb', 'feature']); git(f.target, ['commit', '-q', '--allow-empty', '-m', 'Feature work']);
  assert.equal(pushDone(f.project), true);
  assert.equal(git(f.root, ['--git-dir', f.remote, 'for-each-ref', '--format=%(refname)']), 'refs/heads/main');
});

test('in a clone of a generated repository, tg run provisions nothing and tg verify runs pnpm verify', t => {
  const f = generated(t);
  const clone = join(f.root, 'teammate');
  git(f.root, ['clone', '-q', f.remote, clone]);
  const result = tg(clone, 'run');
  assert.equal(result.status, 0, result.stderr);
  for (const id of ['scaffold', 'push']) assert.deepEqual([result.state(id).state, result.state(id).summary], ['done', 'repository generated earlier']);
  assert.equal(result.state('local-verification').state, 'ready');
  assert.equal(tg(clone, 'verify').state('local-verification').state, 'done');
  assert.equal(existsSync(join(clone, '.git/touch-grass/journal.json')), false);
  assert.equal(tg(f.target, 'run').state('scaffold').summary, 'initial committed template verified');
});

test('tg run in a worktree or a subdirectory of a generated repository finds the repository and provisions nothing', async t => {
  for (const kind of ['worktree', 'subdirectory']) await t.test(kind, t => {
    const f = generated(t);
    let cwd = join(f.root, 'worktree');
    if (kind === 'worktree') git(f.target, ['worktree', 'add', '-q', '-b', 'feature', cwd]);
    else { cwd = join(f.target, 'empty-child'); mkdirSync(cwd); }
    const result = tg(cwd, 'verify');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(['scaffold', 'push', 'local-verification'].map(id => result.state(id).state), ['done', 'done', 'done']);
    if (kind === 'subdirectory') assert.deepEqual(readdirSync(cwd), []);
    assert.equal(git(f.root, ['--git-dir', f.remote, 'for-each-ref', '--format=%(refname)']), 'refs/heads/main');
  });
});

test('a pnpm verify pass is recorded for HEAD and reused until HEAD moves', t => {
  const f = generated(t);
  const first = tg(f.target, 'verify');
  assert.equal(first.status, 0, first.stderr);
  const commit = git(f.target, ['rev-parse', 'HEAD']);
  assert.equal(first.state('local-verification').summary, `pnpm verify passed at ${commit}`);
  assert.match(first.stderr, /noisy verifier output/, 'verifier output goes to stderr');
  assert.equal(f.verifyRuns(), 1);
  assert.equal(tg(f.target, 'verify').status, 0);
  assert.equal(f.verifyRuns(), 1, 'a recorded pass at the same HEAD is not rerun');
  git(f.target, ['commit', '-q', '--allow-empty', '-m', 'Later work']);
  const later = spawnSync(join(scripts, 'tg'), ['status', '--json'], { cwd: f.target, encoding: 'utf8' });
  assert.equal(JSON.parse(later.stdout).outcomes.find(o => o.id === 'local-verification').state, 'ready', 'a new commit needs a new pass');
  assert.equal(tg(f.target, 'verify').status, 0);
  assert.equal(f.verifyRuns(), 2);
});

test('a failed or incomplete pnpm verify, or a dirty tree, records nothing', async t => {
  for (const kind of ['failed', 'incomplete', 'dirty']) await t.test(kind, t => {
    const f = generated(t);
    if (kind === 'dirty') writeFileSync(join(f.target, '.hidden'), 'uncommitted');
    const result = tg(f.target, 'verify', { FAKE_VERIFY_EXIT: kind === 'failed' ? '1' : kind === 'incomplete' ? '2' : '0' });
    assert.equal(result.status, 1);
    assert.equal(result.value.verification, 'failed');
    const reason = result.state('local-verification').reason;
    assert.match(reason, kind === 'failed' ? /exited with 1/ : kind === 'incomplete' ? /incomplete/ : /uncommitted/);
    assert.equal(f.verifyRuns(), kind === 'dirty' ? 0 : 1);
    assert.equal(existsSync(join(f.target, '.git/touch-grass/verified.json')), false);
  });
});

test('tg verify never provisions: before the push it stays blocked and runs nothing', t => {
  const f = initialized(t);
  const result = tg(f.target, 'verify');
  assert.equal(result.status, 2);
  assert.equal(result.state('push').state, 'ready');
  assert.deepEqual(result.state('local-verification').on, ['push']);
  assert.equal(remoteMain(f), '');
  assert.equal(f.verifyRuns(), 0);
});
