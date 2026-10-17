import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderArchitecture } from './policy.ts';

writeFileSync(resolve('ARCHITECTURE.md'), renderArchitecture());
