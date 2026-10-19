import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { createTestUser, deleteTestUser, signInAs } from '../../../tests/fixtures/test-users'

const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'

test('protected navigation, OAuth redirect, callback failure and logout', async ({ page }) => {
  await page.goto('/chat')
  await expect(page).toHaveURL(/\/login$/)

  const navigation = page.waitForRequest((request) => request.url().startsWith('https://accounts.google.com/'))

  await page.route('https://accounts.google.com/**', (route) => route.abort())
  await page.getByRole('button', { name: 'Continue with Google' }).click()

  const target = new URL((await navigation).url())

  expect(target.searchParams.get('client_id')).toBe(process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID ?? 'local-test-client')
  expect(target.searchParams.get('redirect_uri')).toBe(`${supabaseUrl}/auth/v1/callback`)
  await page.goto('/auth/callback?code=invalid')
  await expect(page).toHaveURL(/\/login\?error=sign_in_failed$/)
  await expect(page.getByRole('alert')).toHaveText('Sign-in failed. Please try again.')

  const user = await createTestUser()

  try {
    await signInAs(page, user)
    await page.goto('/chat')
    await expect(page).toHaveURL(/\/chat$/)
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/chat')
    await expect(page).toHaveURL(/\/login$/)
  } finally {
    await deleteTestUser(user)
  }
})

test('email sign-up is refused', async () => {
  const visitor = createClient(supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY ?? '', { auth: { persistSession: false } })
  const { data, error } = await visitor.auth.signUp({ email: `signup-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() })

  expect(error?.status).toBe(403)
  expect(data.user).toBeNull()
})

test('logout ends this device only and says when it fails', async ({ page, browser }) => {
  const user = await createTestUser()
  const otherDevice = await browser.newContext()

  try {
    await signInAs(page, user)
    await signInAs(await otherDevice.newPage(), user)

    await test.step('logging out here keeps the other device signed in', async () => {
      await page.goto('/chat')
      await page.getByRole('button', { name: 'Log out' }).click()
      await expect(page).toHaveURL(/\/login$/)

      const other = otherDevice.pages()[0]
      await other?.goto('/chat')
      await expect(other).toHaveURL(/\/chat$/)
    })

    await test.step('a failed logout shows an alert and keeps the session', async () => {
      await signInAs(page, user)
      await page.goto('/chat')
      await page.route('**/_serverFn/**', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()))
      await page.getByRole('button', { name: 'Log out' }).click()
      await expect(page.getByRole('alert')).toHaveText('Could not log out. Please try again.')
      await expect(page).toHaveURL(/\/chat$/)
    })
  } finally {
    await otherDevice.close()
    await deleteTestUser(user)
  }
})
