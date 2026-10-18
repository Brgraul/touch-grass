#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
try {
  const { values, positionals } = parseArgs({ options: { 'skills-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { process.stdout.write('Usage: node install.mjs [--skills-dir <directory>]\nSymlinks touch-grass to this checkout; keep assets/template alongside it.\n'); }
  else {
    if (positionals.length) throw new Error('Unexpected argument.');
    const skill = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    if (!existsSync(join(skill, 'SKILL.md')) || !existsSync(resolve(skill, '../assets/template'))) throw new Error('Install from the complete Touch Grass checkout.');
    const directory = resolve(values['skills-dir'] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'));
    mkdirSync(directory, { recursive: true });
    const destination = join(directory, 'touch-grass');
    let entry;
    try { entry = lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry) {
      if (!entry.isSymbolicLink() || !existsSync(destination) || realpathSync(destination) !== skill) throw new Error('An unrelated touch-grass install already exists. It was preserved. Select another --skills-dir or resolve the conflict yourself.');
    } else symlinkSync(skill, destination, 'dir');
    process.stdout.write(`Installed ${destination} -> ${skill}\n`);
  }
} catch (error) { process.stderr.write(`touch-grass install: ${error.message}\n`); process.exitCode = 1; }
