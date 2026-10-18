import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Project } from '../lib/project.ts';
import { readJournal, saveJournal, scaffold, scaffoldDone } from '../lib/scaffold.ts';
import { ensureGithub, githubDone, normalizeOrigin } from '../steps/github.ts';
import { evaluate, exitCode, report, validateSteps } from '../lib/engine.ts';
import { codexSteps } from '../steps/codex.ts';
import { must } from '../lib/exec.ts';
import { route } from '../lib/routing.ts';

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
  const source = join(root, 'source');
  const target = join(root, 'fresh-app');
  mkdirSync(source); mkdirSync(target);
  git(source, ['init', '-q', '-b', 'main']);
  const entries = { '.hidden': 'dotfile\n', 'bin/run': '#!/bin/sh\nexit 0\n', 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n', 'src/main.ts': 'export const answer = 42;\n' };
  for (const [path, value] of Object.entries(entries)) {
    const file = join(source, 'assets/template', path);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value);
  }
  chmodSync(join(source, 'assets/template/bin/run'), 0o755);
  git(source, ['add', '.']); git(source, ['commit', '-qm', 'Template fixture']);
  writeFileSync(join(source, 'assets/template/.hidden'), 'dirty source\n');
  writeFileSync(join(source, 'assets/template/untracked-secret'), 'secret\n');
  const project = new Project(target);
  return { root, source, target, project, entries };
}
function fakeGithub(f, initial = {}) {
  const bin = join(f.root, 'bin'); mkdirSync(bin);
  const bare = join(f.root, 'remote.git'); git(f.root, ['init', '--bare', '-q', bare]);
  const stateFile = join(f.root, 'github.json');
  writeFileSync(stateFile, JSON.stringify({ exists: false, private: true, id: 123, default_branch: 'master', ...initial }));
  Object.assign(process.env, { TG_STATE: stateFile, TG_BARE: bare, TG_LOG: join(f.root, 'calls.jsonl'), TG_REAL_GIT: realGit });
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process');
const args = process.argv.slice(2); const state = JSON.parse(fs.readFileSync(process.env.TG_STATE));
fs.appendFileSync(process.env.TG_LOG, JSON.stringify({ command: 'gh', args }) + '\\n');
function output(status, value) { process.stdout.write('HTTP/2.0 ' + status + ' Fixture\\r\\nContent-Type: application/json\\r\\n\\r\\n' + JSON.stringify(value)); process.exit(status < 300 ? 0 : 1); }
function save() { fs.writeFileSync(process.env.TG_STATE, JSON.stringify(state)); }
if (args[0] === '--version') { console.log('gh version fixture'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'git-credential') { console.log('username=fixture-owner\\npassword=fixture-token-for-test'); process.exit(0); }
if (args[0] === 'auth') process.exit(state.authFailure ? 1 : 0);
if (args.includes('user') && args.includes('--jq')) { console.log(args[args.indexOf('--jq') + 1] === '.login' ? state.owner || 'fixture-owner' : 'fixture-owner\\t56789'); process.exit(0); }
if (state.network) { console.error('offline sentinel-secret'); process.exit(1); }
if (state.http) output(state.http, { message: 'request refused' });
if (args.includes('user/repos')) {
  if (state.exists) output(422, {});
  state.exists = true; save();
  if (state.createLost) { console.error('response lost'); process.exit(1); }
  output(201, { id: state.id, private: state.private, full_name: 'fixture-owner/fresh-app' });
}
const ref = args.find(a => a.endsWith('/git/ref/heads/main'));
if (ref) {
  if (state.conflict409) output(409, { message: 'Git Repository is unavailable.' });
  const sha = cp.spawnSync(process.env.TG_REAL_GIT, ['--git-dir', process.env.TG_BARE, 'rev-parse', '--verify', 'refs/heads/main'], { encoding: 'utf8' });
  if (sha.status !== 0) output(409, { message: 'Git Repository is empty.' });
  output(200, { object: { sha: state.refOverride || sha.stdout.trim() } });
}
if (args.includes('repos/fixture-owner/fresh-app')) {
  if (!state.exists) output(404, { message: 'Not Found' });
  if (args.includes('PATCH')) { state.default_branch = 'main'; save(); }
  output(200, { id: state.id, private: state.private, full_name: 'fixture-owner/fresh-app', default_branch: state.default_branch });
}
output(404, { message: 'Not Found' });
`);
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process'); const args = process.argv.slice(2);
if (args.includes('push')) {
  fs.appendFileSync(process.env.TG_LOG, JSON.stringify({ command: 'git-push', args }) + '\\n');
  args[args.indexOf('origin')] = process.env.TG_BARE;
}
const result = cp.spawnSync(process.env.TG_REAL_GIT, args, { stdio: 'inherit', env: process.env });
if (args.includes('push') && result.status === 0 && process.env.TG_LOSE_PUSH === '1') process.exit(1);
process.exit(result.status ?? 1);
`);
  chmodSync(join(bin, 'gh'), 0o755); chmodSync(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  const set = values => writeFileSync(stateFile, JSON.stringify({ ...state(), ...values }));
  const calls = () => existsSync(process.env.TG_LOG) ? readFileSync(process.env.TG_LOG, 'utf8').trim().split('\n').map(v => JSON.parse(v)) : [];
  return { bare, state, set, calls };
}
function initialized(t, initial) {
  const f = fixture(t); scaffold(f.project, f.source); return { ...f, github: fakeGithub(f, initial) };
}
function noPush(f) { assert.equal(f.github.calls().filter(c => c.command === 'git-push').length, 0); }

test('copies only committed tracked blobs, dotfiles, lockfile and executable mode', t => {
  const f = fixture(t); writeFileSync(join(f.target, '.DS_Store'), 'harmless');
  scaffold(f.project, f.source);
  for (const [path, value] of Object.entries(f.entries)) assert.equal(readFileSync(join(f.target, path), 'utf8'), value);
  assert.equal(lstatSync(join(f.target, 'bin/run')).mode & 0o777, 0o755);
  assert.equal(existsSync(join(f.target, 'untracked-secret')), false);
  assert.deepEqual(git(f.target, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').sort(), Object.keys(f.entries).sort());
  assert.equal(lstatSync(join(f.project.stateDir, 'journal.json')).mode & 0o777, 0o600);
  assert.equal(scaffoldDone(f.project), true);
});

test('refuses existing files, matching directories, symlinks and unowned Git', async t => {
  for (const kind of ['file', 'directory', 'symlink', 'git', 'worktree-file', 'ds-symlink']) await t.test(kind, t => {
    const f = fixture(t);
    if (kind === 'file') writeFileSync(join(f.target, 'pnpm-lock.yaml'), 'sentinel');
    if (kind === 'directory') { mkdirSync(join(f.target, 'src')); writeFileSync(join(f.target, 'src/user.ts'), 'sentinel'); }
    if (kind === 'symlink') symlinkSync(f.source, join(f.target, 'src'));
    if (kind === 'ds-symlink') symlinkSync(f.source, join(f.target, '.DS_Store'));
    if (kind === 'git') git(f.target, ['init', '-q']);
    if (kind === 'worktree-file') writeFileSync(join(f.target, '.git'), 'gitdir: /unowned');
    const before = readdirSync(f.target);
    assert.throws(() => scaffold(f.project, f.source));
    assert.deepEqual(readdirSync(f.target), before);
    if (kind === 'file') assert.equal(readFileSync(join(f.target, 'pnpm-lock.yaml'), 'utf8'), 'sentinel');
  });
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
    assert.throws(() => scaffold(new Interrupted(f.target), f.source), /simulated interruption/);
    assert.ok(readJournal(f.project));
    assert.equal(readJournal(f.project).initialCommit, undefined);
    scaffold(f.project, f.source);
    const commit = git(f.target, ['rev-parse', 'HEAD']);
    scaffold(f.project, f.source);
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
    assert.throws(() => scaffold(new Interrupted(f.target), f.source));
    if (kind === 'changed') writeFileSync(join(f.target, '.hidden'), 'user-change');
    if (kind === 'unrelated') writeFileSync(join(f.target, 'user.txt'), 'user-change');
    if (kind === 'symlink') { rmSync(join(f.target, 'bin/run')); symlinkSync(join(f.source, 'assets/template/bin/run'), join(f.target, 'bin/run')); }
    assert.throws(() => scaffold(f.project, f.source));
    if (kind === 'changed') assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), 'user-change');
    if (kind === 'unrelated') assert.equal(readFileSync(join(f.target, 'user.txt'), 'utf8'), 'user-change');
    assert.notEqual(spawnSync(realGit, ['rev-parse', '--verify', 'HEAD'], { cwd: f.target }).status, 0);
  });
});

test('commit-response loss recovery validates exact initial tree and preserves subsequent work', t => {
  const f = fixture(t); scaffold(f.project, f.source);
  const journal = readJournal(f.project); const initial = journal.initialCommit;
  delete journal.initialCommit; saveJournal(f.project, journal);
  writeFileSync(join(f.target, '.hidden'), 'subsequent work');
  scaffold(f.project, f.source);
  assert.equal(readJournal(f.project).initialCommit, initial);
  assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), 'subsequent work');
  git(f.target, ['add', '.hidden']); git(f.target, ['commit', '-qm', 'User work']);
  const later = git(f.target, ['rev-parse', 'HEAD']); scaffold(f.project, f.source);
  assert.equal(git(f.target, ['rev-parse', 'HEAD']), later);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '2');
});

test('any HEAD marker cannot substitute for the initial snapshot', t => {
  const f = fixture(t); scaffold(f.project, f.source);
  const journal = readJournal(f.project); delete journal.initialCommit; saveJournal(f.project, journal);
  writeFileSync(join(f.target, '.hidden'), 'other'); git(f.target, ['add', '.']); git(f.target, ['commit', '--amend', '-qm', 'Not bootstrap']);
  assert.equal(scaffoldDone(f.project), false);
  assert.throws(() => scaffold(f.project, f.source), /Unexpected commit/);
});

test('fresh create and first push handle empty Git Database 409 and inherited default master', t => {
  const f = initialized(t);
  assert.equal(githubDone(f.project), false);
  ensureGithub(f.project);
  assert.equal(githubDone(f.project), true);
  assert.equal(f.github.state().default_branch, 'main');
  const journal = readJournal(f.project);
  assert.equal(git(f.root, ['--git-dir', f.github.bare, 'rev-parse', 'refs/heads/main']), journal.initialCommit);
  assert.equal(journal.remote.kind, 'published');
  assert.equal(git(f.root, ['--git-dir', f.github.bare, 'for-each-ref', '--format=%(refname)']), 'refs/heads/main');
  ensureGithub(f.project);
  assert.equal(f.github.calls().filter(c => c.command === 'git-push').length, 1);
  assert.equal(f.github.calls().filter(c => c.command === 'gh' && c.args.includes('user/repos')).length, 1);
});

test('create response loss is conservatively refused on retry', t => {
  const f = initialized(t, { createLost: true });
  assert.throws(() => ensureGithub(f.project), /confirmed HTTP response/);
  assert.equal(readJournal(f.project).remote.kind, 'creating');
  assert.throws(() => ensureGithub(f.project), /unrelated same-name|ambiguous/);
  noPush(f);
  assert.equal(f.github.calls().filter(c => c.command === 'gh' && c.args.includes('user/repos')).length, 1);
});

test('push response loss reconciles exact main without duplicate push or commit', t => {
  const f = initialized(t); process.env.TG_LOSE_PUSH = '1';
  assert.throws(() => ensureGithub(f.project), /exited with 1/);
  assert.equal(readJournal(f.project).remote.kind, 'created');
  delete process.env.TG_LOSE_PUSH;
  ensureGithub(f.project);
  assert.equal(githubDone(f.project), true);
  assert.equal(f.github.calls().filter(c => c.command === 'git-push').length, 1);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '1');
});

test('same-name private/public repositories are collisions, never adopted or pushed', async t => {
  for (const privacy of [true, false]) await t.test(String(privacy), t => {
    const f = initialized(t, { exists: true, private: privacy });
    assert.throws(() => ensureGithub(f.project)); noPush(f);
    assert.equal(readJournal(f.project).remote, undefined);
  });
});

test('wrong origin, effective transport rewrite and multiple push URLs never push', async t => {
  for (const kind of ['wrong', 'rewrite', 'multiple']) await t.test(kind, t => {
    const f = initialized(t);
    git(f.target, ['remote', 'add', 'origin', kind === 'wrong' ? 'https://github.com/someone/other.git' : 'https://github.com/fixture-owner/fresh-app.git']);
    if (kind === 'rewrite') git(f.target, ['config', `url.${f.github.bare}.insteadOf`, 'https://github.com/fixture-owner/fresh-app.git']);
    if (kind === 'multiple') { git(f.target, ['config', '--add', 'remote.origin.pushurl', 'https://github.com/fixture-owner/fresh-app.git']); git(f.target, ['config', '--add', 'remote.origin.pushurl', 'https://github.com/other/fresh-app.git']); }
    assert.throws(() => ensureGithub(f.project), /Origin/); noPush(f);
    assert.equal(f.github.state().exists, false);
  });
});

test('403, 429 and network errors never become 404 creation', async t => {
  for (const failure of [{ http: 403 }, { http: 429 }, { network: true }]) await t.test(JSON.stringify(failure), t => {
    const f = initialized(t, failure);
    assert.throws(() => ensureGithub(f.project)); noPush(f);
    assert.equal(readJournal(f.project).remote, undefined);
    assert.equal(f.github.calls().filter(c => c.command === 'gh' && c.args.includes('user/repos')).length, 0);
  });
});

test('unrelated 409 response on a bound repo remains a failure', t => {
  const f = initialized(t, { exists: true, conflict409: true });
  const journal = readJournal(f.project); journal.remote = { kind: 'created', owner: 'fixture-owner', name: 'fresh-app', id: 123 }; saveJournal(f.project, journal);
  assert.throws(() => ensureGithub(f.project), /HTTP 409/); noPush(f);
});

test('wrong bound owner, ID and divergent main never push', async t => {
  for (const kind of ['owner', 'id', 'main']) await t.test(kind, t => {
    const f = initialized(t, { exists: true });
    const journal = readJournal(f.project);
    journal.remote = { kind: 'created', owner: kind === 'owner' ? 'another' : 'fixture-owner', name: 'fresh-app', id: kind === 'id' ? 99 : 123 }; saveJournal(f.project, journal);
    if (kind === 'main') { git(f.target, ['push', f.github.bare, 'HEAD:main']); f.github.set({ refOverride: 'a'.repeat(40) }); }
    assert.throws(() => ensureGithub(f.project)); noPush(f);
  });
});

test('published rerun never pushes later work or rewinds remote main', t => {
  const f = initialized(t); ensureGithub(f.project);
  writeFileSync(join(f.target, '.hidden'), 'later'); git(f.target, ['add', '.hidden']); git(f.target, ['commit', '-qm', 'Later']);
  git(f.target, ['push', f.github.bare, 'HEAD:main']);
  const later = git(f.target, ['rev-parse', 'HEAD']);
  assert.equal(githubDone(f.project), true); ensureGithub(f.project);
  assert.equal(git(f.root, ['--git-dir', f.github.bare, 'rev-parse', 'main']), later);
  assert.equal(f.github.calls().filter(c => c.command === 'git-push').length, 1);
});

test('empty, local-only and cloud handoff outcomes stay incomplete', async t => {
  const f = fixture(t);
  assert.equal(exitCode([]), 2);
  const local = { id: 'github-repo', group: 'provisioning', title: 'Local', state: 'done', summary: 'ready' };
  assert.equal(exitCode([local]), 2);
  const script = { ...local, actor: 'script', needs: [], observe: async () => ({ done: true, summary: 'ready' }), apply: async () => {} };
  const outcomes = await evaluate([script, ...codexSteps], f.project, 'run');
  assert.equal(exitCode(outcomes), 2);
  assert.deepEqual([report(outcomes).provisioning, report(outcomes).verification, report(outcomes).deployment], ['pending', 'pending', 'not configured']);
  assert.equal(outcomes.find(o => o.id === 'cloud-verification').state, 'waiting');
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
  const status = cli('status', '--json'); assert.equal(status.status, 2); assert.equal(f.github.state().exists, false);
  const result = cli('run', '--json'); assert.equal(result.status, 2, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.provisioning, 'pending'); assert.equal(value.verification, 'pending'); assert.equal(value.deployment, 'not configured');
  assert.equal(value.outcomes.find(o => o.id === 'github-repo').state, 'done');
  assert.equal(git(f.target, ['rev-parse', 'HEAD']), before);
  assert.equal(f.github.calls().some(c => JSON.stringify(c).includes('production')), false);
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

test('subprocess failures suppress raw secret-bearing output', t => {
  const f = fixture(t);
  assert.throws(() => must(process.execPath, ['-e', 'process.stderr.write("sensitive-sentinel");process.stdout.write("sensitive-sentinel");process.exit(1)']), error => !error.message.includes('sensitive-sentinel'));
});

test('origin normalization admits only the expected GitHub transport identities', () => {
  assert.equal(normalizeOrigin('git@github.com:Owner/Repo.git'), 'owner/repo');
  assert.equal(normalizeOrigin('ssh://git@github.com/Owner/Repo.git'), 'owner/repo');
  assert.equal(normalizeOrigin('https://github.com/Owner/Repo'), 'owner/repo');
  assert.equal(normalizeOrigin('https://github.com.evil/Owner/Repo'), undefined);
  assert.equal(normalizeOrigin('https://token@github.com/Owner/Repo'), undefined);
});


test('installer runs from a checkout path containing spaces', t => {
  const f = fixture(t);
  const checkout = join(f.root, 'checkout with spaces');
  const copiedScripts = join(checkout, 'touch-grass/scripts');
  mkdirSync(copiedScripts, { recursive: true }); mkdirSync(join(checkout, 'assets/template'), { recursive: true });
  writeFileSync(join(checkout, 'touch-grass/SKILL.md'), 'fixture');
  copyFileSync(join(scripts, 'install.mjs'), join(copiedScripts, 'install.mjs'));
  const destination = join(f.root, 'global skills');
  const result = spawnSync(process.execPath, [join(copiedScripts, 'install.mjs'), '--skills-dir', destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(destination, 'touch-grass/SKILL.md'), 'utf8'), 'fixture');
});

test('tracked template symlinks are refused before destination claim', t => {
  const f = fixture(t);
  symlinkSync('src/main.ts', join(f.source, 'assets/template/link'));
  git(f.source, ['add', 'assets/template/link']); git(f.source, ['commit', '-qm', 'Symlink fixture']);
  assert.throws(() => scaffold(f.project, f.source), /unsupported mode/);
  assert.deepEqual(readdirSync(f.target), []);
});

test('journal traversal and symlink state are rejected', async t => {
  for (const kind of ['traversal', 'state-symlink']) await t.test(kind, t => {
    const f = fixture(t); scaffold(f.project, f.source);
    if (kind === 'traversal') {
      const journal = readJournal(f.project); journal.files[0].path = '../escaped';
      writeFileSync(join(f.project.stateDir, 'journal.json'), JSON.stringify(journal));
    } else {
      const original = join(f.project.stateDir, 'journal.json');
      const outside = join(f.root, 'journal-copy'); copyFileSync(original, outside); rmSync(original); symlinkSync(outside, original);
    }
    assert.throws(() => scaffold(f.project, f.source));
    assert.equal(existsSync(join(f.root, 'escaped')), false);
  });
});


test('missing Git identity derives a local-only GitHub noreply fallback', t => {
  const f = fixture(t); fakeGithub(f);
  for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete process.env[name];
  scaffold(f.project, f.source);
  assert.equal(git(f.target, ['config', '--local', '--get', 'user.name']), 'fixture-owner');
  assert.equal(git(f.target, ['config', '--local', '--get', 'user.email']), '56789+fixture-owner@users.noreply.github.com');
  assert.equal(readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8'), '');
});

test('tracked files that match template ignore patterns are still committed exactly', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'assets/template/.gitignore'), 'ignored-tracked\n');
  writeFileSync(join(f.source, 'assets/template/ignored-tracked'), 'tracked despite ignore');
  git(f.source, ['add', '--force', 'assets/template/.gitignore', 'assets/template/ignored-tracked']);
  git(f.source, ['commit', '-qm', 'Tracked ignored fixture']);
  scaffold(f.project, f.source);
  assert.equal(git(f.target, ['show', 'HEAD:ignored-tracked']), 'tracked despite ignore');
});

test('failed real commit hook resumes without duplicate commit or recopying user changes', t => {
  const f = fixture(t);
  class Interrupted extends Project {
    count = 0;
    path(...parts) { if (parts[0] === '.hidden' && ++this.count === 2) throw new Error('stop after init'); return super.path(...parts); }
  }
  assert.throws(() => scaffold(new Interrupted(f.target), f.source));
  const hook = join(f.target, '.git/hooks/pre-commit'); writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => scaffold(f.project, f.source), /git commit exited/);
  for (const path of Object.keys(f.entries)) assert.ok(existsSync(join(f.target, path)));
  assert.equal(readJournal(f.project).initialCommit, undefined);
  rmSync(hook); scaffold(f.project, f.source); scaffold(f.project, f.source);
  assert.equal(git(f.target, ['rev-list', '--count', 'HEAD']), '1');
});

test('resume remains pinned when the template source advances', t => {
  const f = fixture(t);
  class Interrupted extends Project {
    count = 0;
    path(...parts) { if (parts[0] === '.hidden' && ++this.count === 2) throw new Error('stop'); return super.path(...parts); }
  }
  assert.throws(() => scaffold(new Interrupted(f.target), f.source));
  const pinned = readJournal(f.project).revision;
  writeFileSync(join(f.source, 'assets/template/.hidden'), 'new source revision');
  git(f.source, ['add', 'assets/template/.hidden']); git(f.source, ['commit', '-qm', 'Source advanced']);
  scaffold(f.project, f.source);
  assert.equal(readFileSync(join(f.target, '.hidden'), 'utf8'), f.entries['.hidden']);
  assert.equal(readJournal(f.project).revision, pinned);
});

test('plain reinvocation resumes bootstrap before publication and verifies afterward', t => {
  const f = fixture(t);
  assert.deepEqual(route(f.target), { kind: 'bootstrap', reason: 'new' });
  const relative = '.agents/skills/touch-grass/SKILL.md';
  mkdirSync(dirname(join(f.source, 'assets/template', relative)), { recursive: true });
  writeFileSync(join(f.source, 'assets/template', relative), 'Repository verifier');
  git(f.source, ['add', 'assets/template/.agents']);
  git(f.source, ['commit', '-qm', 'Add local verifier']);
  scaffold(f.project, f.source);
  assert.ok(existsSync(join(f.target, relative)));
  assert.deepEqual(route(f.target), { kind: 'bootstrap', reason: 'interrupted' });
  const before = spawnSync(join(scripts, 'tg'), ['route', '--json'], { cwd: f.target, encoding: 'utf8' });
  assert.equal(before.status, 0);
  assert.deepEqual(JSON.parse(before.stdout), { kind: 'bootstrap', reason: 'interrupted' });
  fakeGithub(f);
  ensureGithub(f.project);
  assert.deepEqual(route(f.target), { kind: 'verify', skill: join(f.target, relative) });
  const after = spawnSync(join(scripts, 'tg'), ['route', '--json'], { cwd: f.target, encoding: 'utf8' });
  assert.equal(after.status, 0);
  assert.equal(JSON.parse(after.stdout).kind, 'verify');
});

test('ordinary generated repositories and worktrees route to verification without a bootstrap journal', t => {
  const f = fixture(t);
  const skill = join(f.target, '.agents/skills/touch-grass/SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, 'Repository verifier');
  writeFileSync(join(f.target, '.git'), 'gitdir: /some/other/worktree');
  assert.deepEqual(route(f.target), { kind: 'verify', skill });
});

test('reinvocation inside a generated repository subdirectory finds its local verifier', t => {
  const f = fixture(t);
  git(f.target, ['init', '-q', '-b', 'main']);
  const skill = join(f.target, '.agents/skills/touch-grass/SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, 'Repository verifier');
  const child = join(f.target, 'empty-child');
  mkdirSync(child);
  const result = spawnSync(join(scripts, 'tg'), ['route', '--json'], { cwd: child, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).kind, 'verify');
  assert.equal(realpathSync(JSON.parse(result.stdout).skill), realpathSync(skill));
  assert.deepEqual(readdirSync(child), []);
});

test('first HTTPS push uses gh credentials without global Git configuration changes', t => {
  const f = initialized(t);
  const before = readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8');
  ensureGithub(f.project);
  const push = f.github.calls().find(call => call.command === 'git-push');
  assert.ok(push);
  const options = push.args.slice(0, push.args.indexOf('push'));
  assert.deepEqual(options, ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential']);
  const credential = spawnSync(realGit, [...options, 'credential', 'fill'], {
    cwd: f.target,
    encoding: 'utf8',
    input: 'protocol=https\nhost=github.com\n\n',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(credential.status, 0, credential.stderr);
  assert.ok(credential.stdout.includes('username=fixture-owner\n'));
  assert.ok(credential.stdout.includes('password=fixture-token-for-test\n'));
  assert.equal(readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8'), before);
  assert.equal(spawnSync(realGit, ['config', '--local', '--get-all', 'credential.helper'], { cwd: f.target }).status, 1);
});
