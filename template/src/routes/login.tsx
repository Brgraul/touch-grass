import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginPage } from '@/features/auth/ui/login-page'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ error: z.string().optional().catch(undefined) }),
  component: Login,
})

function Login() {
  const { error } = Route.useSearch()

  return <LoginPage signInFailed={error === 'sign_in_failed'} />
}
