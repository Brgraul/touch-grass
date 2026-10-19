import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { createIntegrationHarness } from './tests/fixtures/integration-harness.ts'
import { LANGFUSE_ORIGIN } from './tests/fixtures/integration-harness-client.ts'

const settings = existsSync('.env.test') ? parseEnv(readFileSync('.env.test', 'utf8')) : process.env

const bindings = Object.fromEntries(Object.entries(settings).flatMap(([name, value]) => value === undefined ? [] : [[name, value]]))

if (!bindings.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must name the local test database')

// Each run gets its own environment, so admission capacity never counts another process's runs.
bindings.ENVIRONMENT_ID = crypto.randomUUID()

// Every run exports its trace to the harness, so each test also proves tracing never changes a run.
Object.assign(bindings, { LANGFUSE_BASE_URL: LANGFUSE_ORIGIN, LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' })

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [cloudflareTest({
    main: './tests/fixtures/workflow-worker.ts',
    miniflare: {
      compatibilityDate: '2026-10-17',
      compatibilityFlags: ['nodejs_compat'],
      bindings,
      outboundService: createIntegrationHarness(bindings.TEST_DATABASE_URL),
      workflows: { AGENT_CHAT_WORKFLOW: { name: 'agent-chat-test', className: 'AgentChatWorkflow' } },
    },
  })],
  test: { include: ['src/features/**/*.integration.test.ts'], testTimeout: 120_000, hookTimeout: 30_000, fileParallelism: false },
})
