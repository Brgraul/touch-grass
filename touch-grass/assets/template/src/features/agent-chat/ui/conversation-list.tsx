import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { conversationsQuery } from '../agent-chat.queries'
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/data-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import type { UserId } from '@/platform/ids'

export function ConversationList({ userId, className }: { userId: UserId; className?: string }) {
  const query = useInfiniteQuery(conversationsQuery(userId))
  const pages = query.data?.pages ?? []
  const conversations = pages.flatMap((page) => 'kind' in page ? [] : page.items)
  const unavailable = query.isError || pages.some((page) => 'kind' in page)

  return (
    <aside aria-label="Conversations" className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Conversations</h2>
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/chat" aria-label="New conversation"><Plus className="size-4" /></Link>
        </Button>
      </div>
      {query.isPending && <LoadingState title="Loading conversations…" />}
      {unavailable && <ErrorState title="Could not load conversations" detail="Reload the page to try again." />}
      {query.isSuccess && !unavailable && conversations.length === 0 && <EmptyState title="No conversations yet" detail="Your first one starts here." />}
      <nav aria-label="Saved conversations" className="space-y-1">
        {conversations.map((conversation) => (
          <Link
            key={conversation.id}
            to="/chat/$conversationId"
            params={{ conversationId: conversation.id }}
            className="block truncate rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            activeProps={{ className: 'bg-accent text-foreground' }}
          >
            {conversation.title}
          </Link>
        ))}
      </nav>
      {query.hasNextPage && (
        <Button variant="ghost" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>More conversations</Button>
      )}
    </aside>
  )
}
