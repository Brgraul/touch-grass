import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './exec.ts';
import { redact } from './staging.ts';

export type Status = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';
export const statuses: readonly Status[] = ['pending', 'running', 'waiting', 'done', 'skipped', 'failed'];

export type Change = { step: string; status: Status; detail?: string };
export type Line = { step: string; line: string };
export type Event = (Change | Line) & { t: number };

/**
 * A step as `tg watch` lists it. `seconds` is a first-run guess that this machine's own timings replace. `person` names what the person must do.
 * `sections` are the `=== name ===` headers its output prints in order, which measure its progress.
 */
export type ProgressStep = { id: string; title: string; seconds: number; person?: string; sections?: readonly string[] };

const compactAt = 4 * 1024 * 1024;
const dirs = new Map<string, string | undefined>();

/** Under .git, so progress is never committed, and beside bootstrap's own state directory, whose creation marks a started bootstrap. Undefined outside a Git checkout. */
export function progressDir(root: string): string | undefined {
  if (!dirs.has(root)) {
    const result = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'touch-grass-progress'], { cwd: root });
    const dir = result.status === 0 ? result.stdout.trim() : undefined;
    if (dir) {
      mkdirSync(join(dir, 'logs'), { recursive: true, mode: 0o700 });
      compact(join(dir, 'events.jsonl'));
    }
    dirs.set(root, dir);
  }
  return dirs.get(root);
}

/** Drops output lines from an oversized log and keeps status events, which hold this machine's step timings. */
function compact(file: string): void {
  if (!existsSync(file) || statSync(file).size < compactAt) return;
  const kept = readFileSync(file, 'utf8').split('\n').filter(line => {
    try { return line !== '' && !('line' in JSON.parse(line)); } catch { return false; }
  });
  writeFileSync(file, kept.map(line => line + '\n').join(''), { mode: 0o600 });
}

/** Progress is a display aid: a failed write never fails the command. */
export function emit(root: string, event: Change | Line): void {
  const dir = progressDir(root);
  if (!dir) return;
  try { appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ t: Date.now(), ...event }) + '\n', { mode: 0o600 }); } catch { /* display only */ }
}

/** Logs this process has started, so a step that runs several commands keeps all their output. */
const started = new Set<string>();
const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Runs a command with its output in the step's log file and the progress log instead of on screen, every hidden value redacted.
 * Resolves to the exit code, the last lines and the log path, so callers print only what the agent needs.
 */
export function pipe(root: string, step: string, command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; hidden?: readonly (string | undefined)[] } = {}): Promise<{ code: number; tail: string[]; log?: string }> {
  const dir = progressDir(root);
  const log = dir && join(dir, 'logs', `${step}.log`);
  if (log) {
    if (!started.has(log)) writeFileSync(log, '', { mode: 0o600 });
    started.add(log);
    appendFileSync(log, redact(`$ ${[command, ...args].join(' ')}`, options.hidden ?? []) + '\n');
  }
  const tail: string[] = [];
  const write = (raw: string) => {
    const line = redact(raw.split('\r').at(-1) ?? '', options.hidden ?? []).replace(ansi, '').trimEnd();
    if (log) appendFileSync(log, line + '\n');
    if (!line) return;
    emit(root, { step, line });
    tail.push(line);
    if (tail.length > 40) tail.shift();
  };
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const source of [child.stdout, child.stderr]) {
      let buffer = '';
      source.setEncoding('utf8');
      source.on('data', (chunk: string) => {
        const lines = (buffer + chunk).split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(write);
      });
      source.on('end', () => { if (buffer) write(buffer); });
    }
    child.on('error', () => resolve({ code: 127, tail, log }));
    child.on('close', code => resolve({ code: code ?? 1, tail, log }));
  });
}
