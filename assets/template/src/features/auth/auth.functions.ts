import { createServerFn } from '@tanstack/react-start'
import { beginGoogleSignIn, readSession, safeResult, signOut } from '@/platform/auth.server'

export const getSession = createServerFn({ method: 'GET' }).handler(() => safeResult(readSession))

export const startGoogleSignIn = createServerFn({ method: 'POST' }).handler(() => safeResult(beginGoogleSignIn))

export const logout = createServerFn({ method: 'POST' }).handler(() => safeResult(signOut))
