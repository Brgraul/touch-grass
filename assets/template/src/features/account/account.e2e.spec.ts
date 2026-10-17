import { expect, test } from '@playwright/test'
import { createTestUser, deleteTestUser, signInAs } from '../../../tests/fixtures/test-users'

test('display name persists after reload', async ({ page }) => {
  const user = await createTestUser()

  try {
    await signInAs(page, user)
    await page.goto('/account')
    await page.getByLabel('Display name').fill('Ada Lovelace')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText('Profile saved.')
    await page.reload()
    await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace')
    await expect(page.getByLabel('Google account')).toHaveValue(user.email)
  } finally { await deleteTestUser(user) }
})

test('a blank display name is refused in the browser with a reason', async ({ page }) => {
  const user = await createTestUser()
  const saves: string[] = []

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/_serverFn/')) saves.push(request.url())
  })

  try {
    await signInAs(page, user)
    await page.goto('/account')
    await page.getByLabel('Display name').fill('   ')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter a display name. It cannot be blank and can have up to 80 characters.')
    expect(saves).toEqual([])

    await page.getByLabel('Display name').fill('Grace Hopper')
    await expect(page.getByRole('alert')).toBeHidden()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText('Profile saved.')
    expect(saves).toHaveLength(1)
  } finally { await deleteTestUser(user) }
})
