import { createFileRoute } from '@tanstack/react-router'
import { profileQuery } from '@/features/account/account.queries'
import { AccountPage } from '@/features/account/ui/account-page'

export const Route = createFileRoute('/_authenticated/account')({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileQuery(context.session.userId)),
  component: Account,
})

function Account() {
  const { session } = Route.useRouteContext()

  return <AccountPage userId={session.userId} email={session.email} />
}
