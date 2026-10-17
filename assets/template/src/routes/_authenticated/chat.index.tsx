import { createFileRoute } from '@tanstack/react-router'
import { conversationsQuery } from '@/features/agent-chat/agent-chat.queries'
import { ChatPage } from '@/features/agent-chat/ui/chat-page'

export const Route = createFileRoute('/_authenticated/chat/')({
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(conversationsQuery(context.session.userId)),
  component: Chat,
})

function Chat() {
  const { session } = Route.useRouteContext()

  return <ChatPage userId={session.userId} />
}
