import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import type { z } from 'zod'
import { getRequest, setCookie, setResponseHeader } from '@tanstack/react-start/server'
import { userId } from './ids'
import type { Actor } from './ids'
import { getEnv } from './env.server'
import { logError } from './logger.server'
import type { Database } from './database.types'

export function createRequestClient(request: Request = getRequest()) {
  const settings = getEnv()

  return createServerClient<Database>(settings.SUPABASE_URL, settings.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: new URL(settings.APP_URL).protocol === 'https:', path: '/' },
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('cookie') ?? '').map(({ name, value }) => ({ name, value: value ?? '' })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) setCookie(name, value, options)
        setResponseHeader('Cache-Control', 'private, no-store')
      },
    },
  })
}

class Unauthenticated extends Error {}

class InvalidInput extends Error {}

export async function readSession() {
  const { data, error } = await createRequestClient().auth.getUser()

  if (error || !data.user) return null

  return { userId: userId.parse(data.user.id), email: data.user.email ?? '' }
}

export async function requireActor(request: Request = getRequest()): Promise<Actor> {
  const { data, error } = await createRequestClient(request).auth.getUser()

  if (error || !data.user) throw new Unauthenticated()

  return { userId: userId.parse(data.user.id), environmentId: getEnv().ENVIRONMENT_ID }
}

// WHY: Parsing in TanStack Start's .validator() throws before safeResult runs, and the client retries a thrown error as a transport failure.
export async function requireActorInput<Input>(schema: z.ZodType<Input>, data: unknown): Promise<{ actor: Actor; input: Input }> {
  const actor = await requireActor()
  const parsed = schema.safeParse(data)

  if (!parsed.success) throw new InvalidInput()

  return { actor, input: parsed.data }
}

export async function beginGoogleSignIn() {
  const { data, error } = await createRequestClient().auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: `${getEnv().APP_URL}/auth/callback`, skipBrowserRedirect: true, scopes: 'openid email profile' },
  })

  if (error || !data.url) throw new Error('Sign in failed')

  return { url: data.url }
}

export async function finishGoogleSignIn(code: string | null) {
  if (!code) return Response.redirect(`${getEnv().APP_URL}/login?error=sign_in_failed`, 302)
  const { error } = await createRequestClient().auth.exchangeCodeForSession(code)

  return Response.redirect(`${getEnv().APP_URL}${error ? '/login?error=sign_in_failed' : '/'}`, 302)
}

export async function signOut() {
  const { error } = await createRequestClient().auth.signOut({ scope: 'local' })

  if (error) throw new Error('Sign out failed')

  return { kind: 'signed_out' as const }
}

export async function safeResult<T>(operation: () => Promise<T>) {
  try { return await operation() }
  catch (error) {
    const correlationId = crypto.randomUUID()

    const code = error instanceof Unauthenticated ? 'unauthenticated' as const
      : error instanceof InvalidInput ? 'invalid_input' as const
        : 'internal' as const

    if (code === 'internal') logError(code, correlationId)

    return { kind: 'error' as const, code, correlationId }
  }
}

export function requestEnvironment() { return getEnv() }
