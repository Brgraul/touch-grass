import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, StepError } from './exec.ts';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const templateRoot = join(skillRoot, 'assets', 'template');
export class Project {
  readonly root: string;
  readonly slug: string;
  constructor(root: string) {
    if (lstatSync(root).isSymbolicLink()) throw new StepError('Project root must be a real directory.');
    this.root = realpathSync(root);
    this.slug = slugFor(this.root);
  }
  path(...parts: string[]): string { return join(this.root, ...parts); }
  get stateDir(): string {
    const dot = this.path('.git');
    if (existsSync(dot) && (!lstatSync(dot).isDirectory() || lstatSync(dot).isSymbolicLink())) {
      throw new StepError('This bootstrap requires its own .git directory. Existing worktrees are not bootstrap targets.');
    }
    return join(dot, 'touch-grass');
  }
}
export function slugFor(root: string): string {
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(slug)) throw new StepError('Use a directory name of 2 to 39 letters, digits or hyphens, starting with a letter.');
  return slug;
}
export function findProjectRoot(cwd = process.cwd()): string {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  const candidate = top.status === 0 ? top.stdout.trim() : '';
  return candidate && (existsSync(join(candidate, '.git', 'touch-grass')) || existsSync(join(candidate, '.agents', 'skills', 'touch-grass', 'SKILL.md'))) ? candidate : cwd;
}
