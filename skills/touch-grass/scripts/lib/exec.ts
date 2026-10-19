import { spawnSync } from 'node:child_process';
export type RunOptions = { cwd?: string; input?: string; env?: Readonly<Record<string, string>>; sensitive?: boolean };
export type RunResult = { status: number; stdout: string; stderr: string };
export class StepError extends Error {}
export function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, { cwd: options.cwd, input: options.input, env: { ...process.env, ...options.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.error && 'code' in result.error && result.error.code === 'ENOENT' ? 127 : result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function subcommand(args: readonly string[]): string {
  return args.find((arg, index) => /^[a-z][a-z0-9:-]*$/.test(arg) && !/^-[a-z]$/.test(args[index - 1] ?? '')) ?? '';
}
/** The vendor's own reason for a failure, with URL credentials removed. Callers that pass secrets set `sensitive`. */
function reason(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim().replace(/\/\/[^/@\s]+@/g, '//***@')).filter(Boolean);
  const telling = lines.filter(line => /rejected|denied|fatal|error|refus|not found|permission/i.test(line));
  return (telling.length ? telling : lines).slice(0, 3).join(' | ');
}
export function must(command: string, args: readonly string[], options: RunOptions = {}): string {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const name = `${command} ${subcommand(args)}`.trim();
    const detail = options.sensitive ? 'Its output may hold secrets and was suppressed.' : reason(result.stderr) || 'It printed no error.';
    throw new StepError(`${name} exited with ${result.status}. ${detail}`);
  }
  return result.stdout;
}
