import { expect, test } from '@playwright/test'
import { seedFinishedExchange, seedUndispatchedRun } from '../../../tests/fixtures/chat-seed'
import { createTestUser, deleteTestUser, signInAs } from '../../../tests/fixtures/test-users'

test('a run shows its steps, survives a reload, can be stopped, and renders every block kind', async ({ page }) => {
  const user = await createTestUser()
  const marker = crypto.randomUUID().slice(0, 8)
  const exchanges = page.getByTestId('exchange')
  const composer = page.getByLabel('Message')
  const sendButton = page.getByRole('button', { name: 'Send message' })
  const stopButton = page.getByRole('button', { name: 'Stop run' })

  try {
    await signInAs(page, user)

    await test.step('send a message that calls a tool and see each step as it is saved', async () => {
      await page.goto('/chat')
      await composer.fill(`Please calculate 6 * 7 [${marker}]`)
      await sendButton.click()
      await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)

      await expect(page.getByText('Tool call · calculate')).toBeVisible()
      await expect(page.getByText('Tool result')).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Working · 1 saved step' })).toBeVisible()
      await expect(page.getByText('The answer is 42.')).toBeHidden()
    })

    await test.step('reload while the run is active and see it finish', async () => {
      await page.reload()
      await expect(page.getByText('Tool call · calculate')).toBeVisible()
      await expect(page.getByText('Tool result')).toBeVisible()
      await expect(page.getByText('The answer is 42.')).toBeVisible()
      await expect(page.getByText('Completed')).toBeVisible()
      await expect(stopButton).toBeHidden()
    })

    const slowText = `[slow] keep thinking [${marker}]`

    await test.step('stop a slow run and send the same text again', async () => {
      await composer.fill(slowText)
      await sendButton.click()
      await expect(exchanges).toHaveCount(2)
      await stopButton.click()
      await expect(page.getByText('Run stopped.')).toBeVisible()
      await expect(stopButton).toBeHidden()

      await page.getByRole('button', { name: 'Send again' }).click()
      await expect(exchanges).toHaveCount(3)
      await expect(exchanges.last()).toContainText(slowText)
      await stopButton.click()
      await expect(page.getByText('Run stopped.')).toHaveCount(2)
    })

    await test.step('render every stored block kind and the unsupported fallback', async () => {
      const { conversationId } = await seedFinishedExchange({
        userId: user.id,
        message: `Show every block [${marker}]`,
        turns: [
          [
            { kind: 'text', text: 'Looking that up.' },
            { kind: 'tool_call', callId: 'call_seed_1', tool: 'calculate', input: { expression: '2 + 2' } },
            { kind: 'tool_result', callId: 'call_seed_1', output: { result: 4 }, isError: false },
            { kind: 'structured_output', schema: 'forecast', value: { outlook: 'sunny' } },
          ],
        ],
        unknownBlock: { kind: 'hologram', blockSchemaVersion: 1 },
      })

      await page.goto(`/chat/${conversationId}`)
      await expect(page.getByText('Looking that up.')).toBeVisible()
      await expect(page.getByText('Tool call · calculate')).toBeVisible()
      await expect(page.getByText('Tool result')).toBeVisible()
      await expect(page.getByText('Structured output · forecast')).toBeVisible()
      await expect(page.getByText('Unsupported saved content (hologram, version 1).')).toBeVisible()
    })
  } finally {
    await deleteTestUser(user)
  }
})

test('the cron trigger starts a run whose dispatch was lost', async ({ page }) => {
  const user = await createTestUser()

  try {
    const { conversationId } = await seedUndispatchedRun({ userId: user.id, message: `Recover this run [${crypto.randomUUID().slice(0, 8)}]` })

    await signInAs(page, user)
    await page.goto(`/chat/${conversationId}`)
    await expect(page.getByText('Ready to help.')).toBeHidden()

    // WHY: workerd serves this route locally and runs the Worker's `scheduled` export, as the deployed cron would.
    const sweep = await page.request.get('/cdn-cgi/local/scheduled?format=json')

    expect(await sweep.json()).toMatchObject({ outcome: 'ok' })
    await expect(page.getByText('Ready to help.')).toBeVisible()
    await expect(page.getByText('Completed')).toBeVisible()
  } finally {
    await deleteTestUser(user)
  }
})

test('a message over the byte limit is stopped with a reason, and a server rejection shows one request and a specific message', async ({ page }) => {
  const user = await createTestUser()
  const requests: string[] = []

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/_serverFn/')) requests.push(request.url())
  })

  try {
    await signInAs(page, user)
    await page.goto('/chat')

    await test.step('the browser counts bytes, so 12,000 three-byte characters are too long', async () => {
      await page.getByLabel('Message').fill('漢'.repeat(12_000))
      await expect(page.getByRole('alert')).toHaveText('This message is over the 32 KB limit. Shorten it to send.')
      await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
      expect(requests).toEqual([])
      await page.getByLabel('Message').fill('short again')
      await expect(page.getByRole('alert')).toBeHidden()
    })

    await test.step('a message the server rejects is not retried and says why', async () => {
      const oversized = 'é'.repeat(20_000)

      await page.route('**/_serverFn/**', (route) => {
        const body = route.request().postData()

        return body?.includes('rewrite-me') ? route.continue({ postData: body.replace('rewrite-me', oversized) }) : route.continue()
      })

      await page.getByLabel('Message').fill('rewrite-me')
      await page.getByRole('button', { name: 'Send message' }).click()
      await expect(page.getByRole('alert')).toHaveText('That message was not accepted. Check that it is not empty and is under 32 KB.')
      await page.waitForTimeout(3000)
      expect(requests).toHaveLength(1)
      await expect(page).toHaveURL(/\/chat$/)
    })
  } finally {
    await deleteTestUser(user)
  }
})

test('a malformed conversation link and an unknown page render a not-found state', async ({ page }) => {
  const user = await createTestUser()

  try {
    await signInAs(page, user)

    for (const path of ['/chat/not-a-uuid', '/no-such-page']) {
      await page.goto(path)
      await expect(page.getByText('Page not found')).toBeVisible()
      await expect(page.getByText('Something went wrong')).toBeHidden()
    }

    await page.goto('/chat/not-a-uuid')
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to chat' }).click()
    await expect(page).toHaveURL(/\/chat$/)
  } finally {
    await deleteTestUser(user)
  }
})

test('a send that cannot reach the server shows the connection notice without an unhandled rejection', async ({ page }) => {
  const user = await createTestUser()
  const pageErrors: string[] = []

  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    await signInAs(page, user)
    await page.goto('/chat')
    await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()))
    await page.getByLabel('Message').fill('Hello?')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('alert')).toHaveText('Your connection was interrupted. Please try again.')
    expect(pageErrors).toEqual([])
    await expect(page.getByLabel('Message')).toHaveValue('Hello?')
  } finally {
    await deleteTestUser(user)
  }
})
