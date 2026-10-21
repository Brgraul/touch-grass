import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { listConversations, readConversation, sendMessage, stopRun } from './agent-chat.functions'
import { pageCursor } from '@/platform/ids'
import { useIdempotentMutation, useKeyedMutation } from '@/platform/mutations'
import type { ConversationId, PageCursor, RunId, UserId } from '@/platform/ids'

const POLL_INTERVAL_MS = 2000

const featureKey = (user: UserId) => ['agent-chat', user] as const

export const conversationsQuery = (user: UserId) => infiniteQueryOptions({
  queryKey: [...featureKey(user), 'list'],
  initialPageParam: pageCursor.optional().parse(undefined),
  queryFn: ({ pageParam }) => listConversations({ data: { after: pageParam } }),
  getNextPageParam: (page) => 'kind' in page ? undefined : page.next,
})

export type ConversationReadResult = Awaited<ReturnType<typeof readConversation>>

function hasActiveRun(read: ConversationReadResult | undefined) {
  if (!read || 'kind' in read) return false

  return read.exchanges.items.some(({ run }) => run.state === 'queued' || run.state === 'running')
}

class TransientReadError extends Error {}

export const conversationQuery = (
  user: UserId,
  conversationId: ConversationId,
  after?: PageCursor,
  load: () => Promise<ConversationReadResult> = () => readConversation({ data: { conversationId, after } }),
) => queryOptions({
  queryKey: [...featureKey(user), 'conversation', conversationId, after],
  queryFn: async ({ client, queryKey }) => {
    const read = await load()
    const previous = client.getQueryData<ConversationReadResult>(queryKey)
    const hasGoodData = previous !== undefined && !('kind' in previous)

    if ('kind' in read && read.kind === 'error' && read.code === 'internal' && hasGoodData) throw new TransientReadError()

    return read
  },
  refetchInterval: (query) => hasActiveRun(query.state.data) ? POLL_INTERVAL_MS : false,
})

export function useSendMessage(user: UserId) {
  return useKeyedMutation<{ conversationId?: ConversationId; text: string }, Awaited<ReturnType<typeof sendMessage>>>({
    mutationKey: [...featureKey(user), 'send'],
    send: (input) => sendMessage({ data: input }),
    invalidate: () => [featureKey(user)],
  })
}

export function useStopRun(user: UserId) {
  return useIdempotentMutation({
    mutationKey: [...featureKey(user), 'stop'],
    send: (runId: RunId) => stopRun({ data: { runId } }),
    invalidate: () => [featureKey(user)],
  })
}
