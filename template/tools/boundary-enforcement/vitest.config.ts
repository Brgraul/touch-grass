import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['tools/boundary-enforcement/boundary-enforcement.test.ts'] } });
