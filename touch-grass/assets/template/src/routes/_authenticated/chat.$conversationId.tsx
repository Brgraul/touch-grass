import { createFileRoute, notFound } from '@tanstack/react-router'
import { conversationQuery, conversationsQuery } from '@/features/agent-chat/agent-chat.queries'
import { ChatPage } from '@/features/agent-chat/ui/chat-page'
import { conversationId } from '@/platform/ids'

export const Route = createFileRoute('/_authenticated/chat/$conversationId')({
  beforeLoad: ({ params }) => {
    const parsed = conversationId.safeParse(params.conversationId)

    if (!parsed.success) throw notFound()

    return { conversationId: parsed.data }
  },
  loader: async ({ context }) => {
    const { userId } = context.session

    await Promise.all([
      context.queryClient.ensureQueryData(conversationQuery(userId, context.conversationId)),
      context.queryClient.ensureInfiniteQueryData(conversationsQuery(userId)),
    ])
  },
  component: Chat,
})

function Chat() {
  const { session, conversationId } = Route.useRouteContext()

  return <ChatPage key={conversationId} userId={session.userId} conversationId={conversationId} />
}
