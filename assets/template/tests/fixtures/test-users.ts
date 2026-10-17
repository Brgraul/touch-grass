import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import type { Page } from '@playwright/test'
import { z } from 'zod'

const settings = z.object({ SUPABASE_URL: z.url().default('http://127.0.0.1:54321'), SUPABASE_PUBLISHABLE_KEY: z.string(), SUPABASE_SECRET_KEY: z.string(), APP_URL: z.url().default('http://127.0.0.1:3000') }).parse(process.env)

const admin = () => createClient(settings.SUPABASE_URL, settings.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export async function createTestUser() {
  const email = `test-${crypto.randomUUID()}@example.test`
  const password = crypto.randomUUID()
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true })

  if (error || !data.user) throw new Error(`Test user creation failed: ${error?.message}`)

  return { id: data.user.id, email, password }
}

export async function signInAs(page: Page, user: Awaited<ReturnType<typeof createTestUser>>) {
  const pending: { name: string; value: string; url: string; httpOnly: boolean; secure: boolean; sameSite: 'Lax' }[] = []

  const client = createServerClient(settings.SUPABASE_URL, settings.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: settings.APP_URL.startsWith('https:'), path: '/' },
    cookies: { getAll: () => [], setAll: (values) => { for (const { name, value } of values) pending.push({ name, value, url: settings.APP_URL, httpOnly: true, secure: settings.APP_URL.startsWith('https:'), sameSite: 'Lax' }) } },
  })

  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })

  if (error) throw new Error(`Test sign in failed: ${error.message}`)
  await page.context().addCookies(pending)
}

export async function deleteTestUser(user: Awaited<ReturnType<typeof createTestUser>>) {
  const { error } = await admin().auth.admin.deleteUser(user.id)

  if (error) throw new Error(`Test user cleanup failed: ${error.message}`)
}

export async function signInTestUser(user: Awaited<ReturnType<typeof createTestUser>>) {
  const client = createClient<import('../../src/platform/database.types').Database>(settings.SUPABASE_URL, settings.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })

  if (error) throw new Error(`Test sign in failed: ${error.message}`)

  return client
}
