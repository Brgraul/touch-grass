import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTemplateBundle } from '../skills/touch-grass/scripts/lib/bundle.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commit = buildTemplateBundle(root, 'template', join(root, 'skills', 'touch-grass', 'assets', 'template.bundle'));
process.stdout.write(`skills/touch-grass/assets/template.bundle now holds the staged template/ at ${commit}\n`);
