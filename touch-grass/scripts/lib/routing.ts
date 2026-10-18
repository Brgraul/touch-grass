import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Project } from './project.ts';
import { readJournal } from './scaffold.ts';

export type Route =
  | { kind: 'bootstrap'; reason: 'new' | 'interrupted' }
  | { kind: 'verify'; skill: string };

export function route(root: string): Route {
  const skill = join(root, '.agents', 'skills', 'touch-grass', 'SKILL.md');
  const journalPath = join(root, '.git', 'touch-grass', 'journal.json');

  if (existsSync(journalPath)) {
    const journal = readJournal(new Project(root));

    if (journal?.remote?.kind !== 'published') return { kind: 'bootstrap', reason: 'interrupted' };
  }

  return existsSync(skill) ? { kind: 'verify', skill } : { kind: 'bootstrap', reason: 'new' };
}
