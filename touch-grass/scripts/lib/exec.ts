import { spawnSync } from 'node:child_process';
export type RunOptions = { cwd?: string; input?: string; env?: Readonly<Record<string, string>> };
export type RunResult = { status: number; stdout: string; stderr: string };
export class StepError extends Error {}
export function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, { ...options, env: { ...process.env, ...options.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.error && 'code' in result.error && result.error.code === 'ENOENT' ? 127 : result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
export function must(command: string, args: readonly string[], options: RunOptions = {}): string {
  const result = run(command, args, options);
  if (result.status !== 0) throw new StepError(`${command} ${args[0] ?? ''} exited with ${result.status}. Inspect the command privately; vendor output is suppressed.`);
  return result.stdout;
}
