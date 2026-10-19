import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bundleCommit, templateCommit } from '../skills/touch-grass/scripts/lib/bundle.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the shipped bundle holds exactly the staged template', () => {
  assert.equal(bundleCommit(join(repo, 'skills/touch-grass/assets/template.bundle')), templateCommit(repo, 'template'), 'Stage your template/ changes, run `npm run bundle`, and commit the bundle with them.');
});
