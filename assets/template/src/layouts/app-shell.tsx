import { Link, useNavigate } from '@tanstack/react-router'
import { Leaf, LogOut, MessageSquare, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/features/auth/auth.queries'

type NavLinkProps = { to: '/chat' | '/account'; icon: ReactNode; children: ReactNode }

function NavLink({ to, icon, children }: NavLinkProps) {
  return (
    <Link to={to} className="flex items-center gap-2 text-muted-foreground hover:text-foreground" activeProps={{ className: 'text-foreground' }}>
      {icon}
      {children}
    </Link>
  )
}

export function AppShell({ children, email }: { children: ReactNode; email: string }) {
  const logout = useLogout()
  const navigate = useNavigate()
  const logoutFailed = logout.isError || logout.data?.kind === 'error'

  async function signOut() {
    const result = await logout.submit()

    if (result?.kind === 'signed_out') await navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:gap-6 sm:px-5 sm:py-4">
          <Link to="/chat" className="flex items-center gap-2 font-semibold tracking-tight">
            <Leaf className="size-5 text-primary" aria-hidden="true" />
            <span className="hidden sm:inline">Touch Grass</span>
            <span className="sr-only sm:hidden">Touch Grass</span>
          </Link>
          <nav aria-label="Main navigation" className="flex items-center gap-4 text-sm">
            <NavLink to="/chat" icon={<MessageSquare className="size-4" aria-hidden="true" />}>Chat</NavLink>
            <NavLink to="/account" icon={<UserRound className="size-4" aria-hidden="true" />}>Account</NavLink>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-xs text-muted-foreground md:block">{email}</span>
            <Button variant="ghost" size="sm" disabled={logout.isPending} onClick={signOut}>
              <LogOut className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Log out</span>
            </Button>
          </div>
        </div>
        {logoutFailed && <p role="alert" className="mx-auto max-w-6xl px-4 pb-3 text-sm text-destructive sm:px-5">Could not log out. Please try again.</p>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5">{children}</main>
    </div>
  )
}
