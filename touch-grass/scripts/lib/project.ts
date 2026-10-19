import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, StepError } from './exec.ts';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const templateBundle = join(skillRoot, 'assets', 'template.bundle');
/** Every generated repository carries the verifier that local verification runs. */
export const generatedMarker = join('tools', 'verify.ts');
export class Project {
  readonly root: string;
  constructor(root: string) {
    if (lstatSync(root).isSymbolicLink()) throw new StepError('Project root must be a real directory.');
    this.root = realpathSync(root);
  }
  path(...parts: string[]): string { return join(this.root, ...parts); }
  get stateDir(): string {
    const dot = this.path('.git');
    if (existsSync(dot) && (!lstatSync(dot).isDirectory() || lstatSync(dot).isSymbolicLink())) {
      throw new StepError('Run Touch Grass from the root of a clone with its own .git directory. Worktrees and submodules are not bootstrap targets.');
    }
    return join(dot, 'touch-grass');
  }
}
export function findProjectRoot(cwd = process.cwd()): string {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  const candidate = top.status === 0 ? top.stdout.trim() : '';
  return candidate && (existsSync(join(candidate, '.git', 'touch-grass')) || existsSync(join(candidate, generatedMarker))) ? candidate : cwd;
}
