import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { steps } from '../skills/touch-grass/scripts/steps/index.ts';
import { apply, emptyView, frame } from '../skills/touch-grass/scripts/watch.ts';

const tg = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'skills/touch-grass/scripts/tg');
const minute = 60_000;

function view(events) {
  const result = emptyView();
  for (const event of events) apply(result, event);
  return result;
}

const bootstrapped = [
  { t: 0, step: 'scaffold', status: 'running' },
  { t: 20_000, step: 'tools', status: 'done' },
  { t: 20_000, step: 'scaffold', status: 'done' },
  { t: 30_000, step: 'push', status: 'done' },
];

test('the dashboard names the current step, its elapsed time, the output tail and what Deploy will need', () => {
  const screen = frame(view([...bootstrapped, { t: minute, step: 'local-verification', status: 'running' }, { t: minute, step: 'local-verification', line: '=== install ===' }]), 3 * minute, 200, 40, false);
  assert.match(screen, /step 2 of 3 {2}Verify/);
  assert.match(screen, /✓ 1 Bootstrap +done/);
  assert.match(screen, /● pnpm verify passed at HEAD {2}2m00s/);
  assert.match(screen, /needs you: Cloudflare login, Supabase login, Google OAuth client, LLM key/);
  assert.match(screen, /=== install ===/);
});

test('a step this machine has timed before uses that time instead of its first-run guess', () => {
  const timed = [...bootstrapped, { t: minute, step: 'local-verification', status: 'running' }, { t: 3 * minute, step: 'local-verification', status: 'done' }, { t: 4 * minute, step: 'local-verification', status: 'running' }];
  const screen = frame(view(timed), 5 * minute, 200, 40, false);
  assert.match(screen, /▓+░+ +50% {2}~1m left/);
});

test('a waiting step tells the person what to do, and a failure stops the estimate', () => {
  const deploy = [...bootstrapped, { t: minute, step: 'local-verification', status: 'done' }, { t: minute, step: 'login-cloudflare', status: 'waiting', detail: 'approve the Cloudflare login in your browser' }];
  const waiting = frame(view([{ t: 0, step: 'local-verification', line: 'verify output' }, ...deploy]), 2 * minute, 200, 40, false);
  assert.match(waiting, /your turn: approve the Cloudflare login in your browser/);
  assert.doesNotMatch(waiting, /verify output/, 'the tail shows only the current step\'s output');
  const failed = frame(view([...deploy, { t: 2 * minute, step: 'login-cloudflare', status: 'failed', detail: 'cloudflare login exited with 1. Rerun it.' }]), 3 * minute, 200, 40, false);
  assert.match(failed, /stopped until the failure below is fixed/);
  assert.match(failed, /cloudflare login exited with 1/);
  assert.doesNotMatch(failed, /left overall/);
});

test('every screen line fits the terminal width', () => {
  const screen = frame(view([...bootstrapped, { t: 0, step: 'local-verification', line: 'x'.repeat(500) }]), minute, 60, 30, false);
  for (const line of screen.split('\n')) assert.ok(line.length <= 60, line);
});

test('tg deploy records its steps for tg watch and rejects unknown ones', t => {
  const dir = mkdtempSync(join(tmpdir(), 'touch grass progress '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'wrangler.jsonc'), '{ "env": { "production": {} } }');
  mkdirSync(join(dir, 'supabase'));
  writeFileSync(join(dir, 'supabase/config.toml'), '');
  assert.equal(spawnSync(tg, ['deploy', 'mark', 'acceptance', 'running'], { cwd: dir }).status, 0);
  const google = spawnSync(tg, ['deploy', 'google', join(dir, 'missing.json')], { cwd: dir, encoding: 'utf8' });
  assert.equal(google.status, 1);
  const unknown = spawnSync(tg, ['deploy', 'mark', 'nope', 'done'], { cwd: dir, encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Step must be one of/);
  const events = readFileSync(join(dir, '.git/touch-grass-progress/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => [event.step, event.status]), [['acceptance', 'running'], ['google', 'running'], ['google', 'failed']]);
});

test('tg status writes no progress', t => {
  const dir = mkdtempSync(join(tmpdir(), 'touch grass status '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync(tg, ['status', '--json'], { cwd: dir });
  assert.throws(() => readFileSync(join(dir, '.git/touch-grass-progress/events.jsonl')), { code: 'ENOENT' });
});

test('the finished screen shows the logo, the tagline and what each step took, and drops the logo when the terminal is too small', () => {
  const ids = ['tools', 'scaffold', 'push', 'local-verification', 'login-cloudflare', 'login-supabase', 'supabase', 'configure', 'google', 'llm', 'langfuse', 'deploy', 'verify-deployed', 'acceptance'];
  const done = view([...bootstrapped, { t: minute, step: 'local-verification', status: 'running' }, { t: 3 * minute, step: 'local-verification', status: 'done' }, ...ids.map(step => ({ t: 4 * minute, step, status: 'done' })), { t: 4 * minute, step: 'deploy', status: 'done', detail: 'https://demo-production.acme.workers.dev' }]);
  const wide = frame(done, 5 * minute, 100, 40, false);
  for (const color of ['truecolor', 'ansi256']) assert.match(frame(done, 5 * minute, 100, 40, color), /\x1b\[38;[25];[\d;]+m▀/);
  assert.doesNotMatch(wide, /▀/, 'no logo without color');
  assert.match(wide, /Ready for high-leverage prompting, from your desk or the great outdoors! ☀️/);
  assert.match(wide, /✓ Bootstrap 20s {3}✓ Verify 2m00s {3}✓ Deploy/);
  assert.match(wide, /Live at https:\/\/demo-production\.acme\.workers\.dev/);
  assert.match(frame(done, 5 * minute, 60, 40, false), /Ready for high-leverage prompting,\n +from your desk or the great outdoors! ☀️/);
  const small = frame(done, 5 * minute, 30, 12, false);
  assert.doesNotMatch(frame(done, 5 * minute, 30, 12, 'truecolor'), /▀/);
  for (const line of small.split('\n')) assert.ok(line.length <= 30, line);
});

test('Verify shows which of its sections is running and fills its bar by sections done', () => {
  const running = view([...bootstrapped, { t: minute, step: 'local-verification', status: 'running' }, ...['=== install ===', 'noise', '=== typecheck ==='].map(line => ({ t: 2 * minute, step: 'local-verification', line }))]);
  const screen = frame(running, 2 * minute, 200, 40, false);
  assert.match(screen, /● pnpm verify passed at HEAD {2}1m00s {2}9 of 17: typecheck/);
  assert.match(screen, /▓{9}░{11} +47%/);
  const failed = frame(view([...bootstrapped, { t: minute, step: 'local-verification', status: 'running' }, { t: 2 * minute, step: 'local-verification', line: '=== check ===' }, { t: 3 * minute, step: 'local-verification', status: 'failed', detail: 'Docker is not running' }]), 3 * minute, 200, 40, false);
  assert.match(failed, /✗ pnpm verify passed at HEAD {2}4 of 17: check/, 'a failure shows where it stopped');
});

test('Verify\'s sections match the template\'s verify checks and pnpm check steps', () => {
  const template = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'template');
  const verify = [...readFileSync(join(template, 'tools/verify.ts'), 'utf8').matchAll(/^\s*\{?\s*name: '([^']+)'/gm)].map(match => match[1]);
  const check = spawnSync(join(template, 'node_modules/.bin/tsx'), ['tools/check.ts', '--list'], { cwd: template, encoding: 'utf8' }).stdout.trim().split('\n');
  assert.deepEqual(steps.find(step => step.id === 'local-verification').sections, [...verify, ...check]);
});
