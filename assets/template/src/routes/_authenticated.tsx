import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { NotFoundState } from '@/components/patterns/data-state'
import { sessionQuery } from '@/features/auth/auth.queries'
import { AppShell } from '@/layouts/app-shell'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery())

    if (!session || 'kind' in session) throw redirect({ to: '/login' })

    return { session }
  },
  notFoundComponent: AuthenticatedNotFound,
  component: Authenticated,
})

function Authenticated() {
  const { session } = Route.useRouteContext()

  return <AppShell email={session.email}><Outlet /></AppShell>
}

function AuthenticatedNotFound() {
  const { session } = Route.useRouteContext()

  return <AppShell email={session.email}><NotFoundState /></AppShell>
}
