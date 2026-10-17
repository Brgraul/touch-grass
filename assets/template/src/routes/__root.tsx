import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import appCss from '../styles/app.css?url'
import { ErrorState, LoadingState, NotFoundState } from '@/components/patterns/data-state'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Touch Grass' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  pendingComponent: () => <main className="p-6"><LoadingState title="Loading…" /></main>,
  errorComponent: () => <main className="p-6"><ErrorState title="Something went wrong" detail="Please reload and try again." /></main>,
  notFoundComponent: () => <main className="p-6"><NotFoundState /></main>,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}
