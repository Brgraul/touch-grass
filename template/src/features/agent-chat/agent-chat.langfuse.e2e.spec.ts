import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { createTestUser, deleteTestUser, signInAs, signInTestUser } from '../../../tests/fixtures/test-users'

const langfuse = z.object({
  LANGFUSE_BASE_URL: z.url().default('https://cloud.langfuse.com'),
  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
}).safeParse(process.env)

// WHY: Langfuse's deprecated v1 traces API lags by minutes and allows five reads per rate-limit window on the Hobby plan, while the v2 observations API serves spans within seconds.
const observationsSchema = z.object({
  data: z.array(z.object({
    traceId: z.string(), name: z.string(), type: z.string(), level: z.string(),
    userId: z.string().nullable(), sessionId: z.string().nullable(), traceName: z.string().nullable(), output: z.string().nullable(),
  })),
})

const runOutput = z.string().transform((text) => JSON.parse(text)).pipe(z.object({ outcome: z.literal('completed'), steps: z.number().int().positive() }))

const exchangeRunIds = z.object({ exchanges: z.object({ items: z.array(z.object({ run: z.object({ id: z.string() }) })) }) })

test.skip(!langfuse.success, 'Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to check traces in a real Langfuse project')

test('a chat run lands in Langfuse as one trace in its conversation session', async ({ page }) => {
  test.setTimeout(240_000)
  const { LANGFUSE_BASE_URL: baseUrl, LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = langfuse.data!
  const authorization = `Basic ${btoa(`${publicKey}:${secretKey}`)}`
  const user = await createTestUser()
  const sentAt = new Date(Date.now() - 60_000)

  try {
    await signInAs(page, user)
    await page.goto('/chat')
    await page.getByLabel('Message').fill(`Use the calculate tool: what is 6 * 7? [${crypto.randomUUID().slice(0, 8)}]`)
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Completed')).toBeVisible({ timeout: 60_000 })
    const conversationId = new URL(page.url()).pathname.split('/').at(-1)!

    const client = await signInTestUser(user)
    const { data, error } = await client.schema('agent_chat_api').rpc('read_conversation', { p_conversation_id: conversationId })

    expect(error).toBeNull()
    const [runId] = exchangeRunIds.parse(data).exchanges.items.map(({ run }) => run.id)
    const traceId = runId!.replaceAll('-', '')

    const query = new URLSearchParams({
      traceId, fromStartTime: sentAt.toISOString(), toStartTime: new Date(Date.now() + 60_000).toISOString(), fields: 'core,basic,io,trace_context',
    })

    let observations: z.infer<typeof observationsSchema>['data'] = []
    let steps = 0

    await expect.poll(async () => {
      const response = await fetch(new URL(`/api/public/v2/observations?${query}`, baseUrl), { headers: { authorization } })

      if (!response.ok) return `HTTP ${response.status}`
      observations = observationsSchema.parse(await response.json()).data
      const run = observations.find((observation) => observation.name === 'run')

      if (!run?.output) return 'no run span yet'
      steps = runOutput.parse(run.output).steps

      return observations.filter((observation) => observation.type === 'GENERATION').length === steps ? 'complete' : 'generations pending'
    }, { timeout: 120_000, intervals: [2_000, 5_000, 10_000] }).toBe('complete')

    expect(steps).toBeGreaterThanOrEqual(2)
    expect(observations.map(({ name, type }) => `${type} ${name}`).sort()).toEqual([
      ...Array.from({ length: steps }, (_, index) => `GENERATION model-${index + 1}`), 'AGENT run',
    ].sort())

    for (const observation of observations) {
      expect(observation).toMatchObject({ level: 'DEFAULT', traceName: 'agent-chat', userId: user.id, sessionId: conversationId })
    }
  } finally {
    await deleteTestUser(user)
  }
})
