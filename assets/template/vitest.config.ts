import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'cloudflare:workers': fileURLToPath(new URL('./tests/fixtures/cloudflare-workers-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.model.test.ts', 'src/**/*.queries.test.ts', 'src/platform/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
