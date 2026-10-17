import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { conversationQuery, useSendMessage } from '../agent-chat.queries'
import type { SendRefusal } from '../agent-chat.schema'
import { Composer } from './composer'
import { ConversationList } from './conversation-list'
import { ExchangeView } from './exchange-view'
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/data-state'
import { Button } from '@/components/ui/button'
import type { ConversationId, PageCursor, UserId } from '@/platform/ids'

const refusalNotice: Record<SendRefusal, string> = {
  busy: 'Wait for this run to finish, or stop it first.',
  capacity: 'All available runs are busy. Please try again shortly.',
  rate_limited: 'You reached the hourly message limit. Please try again later.',
}

const failedSendNotice = 'Could not send the message. Please try again.'

const invalidMessageNotice = 'That message was not accepted. Check that it is not empty and is under 32 KB.'

type ChatPageProps = { userId: UserId; conversationId?: ConversationId }

export function ChatPage({ userId, conversationId }: ChatPageProps) {
  const navigate = useNavigate()
  const send = useSendMessage(userId)
  const [notice, setNotice] = useState('')

  async function sendText(text: string) {
    setNotice('')
    const receipt = await send.submit({ conversationId, text })

    if (!receipt) return false

    if (receipt.kind === 'accepted') {
      await navigate({ to: '/chat/$conversationId', params: { conversationId: receipt.run.conversationId } })

      return true
    }

    if (receipt.kind === 'refused') setNotice(refusalNotice[receipt.reason])
    else setNotice(receipt.kind === 'error' && receipt.code === 'invalid_input' ? invalidMessageNotice : failedSendNotice)

    return false
  }

  return (
    <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
      <section className="min-w-0 space-y-6 md:col-start-2 md:row-start-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{conversationId ? 'Conversation' : 'A fresh thought.'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask a question and follow each step.</p>
        </div>
        {conversationId
          ? <Transcript userId={userId} conversationId={conversationId} onResend={sendText} />
          : <EmptyState title="What are you working on?" detail="Ask for help, or try the calculator." />}
        {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
        {send.isError && <p role="alert" className="text-sm text-destructive">Your connection was interrupted. Please try again.</p>}
        <Composer busy={send.isPending} onSend={sendText} />
      </section>
      <ConversationList userId={userId} className="md:col-start-1 md:row-start-1" />
    </div>
  )
}

type TranscriptProps = { userId: UserId; conversationId: ConversationId; onResend: (text: string) => Promise<boolean> }

function Transcript({ userId, conversationId, onResend }: TranscriptProps) {
  const [after, setAfter] = useState<PageCursor>()
  const query = useQuery(conversationQuery(userId, conversationId, after))

  if (query.isPending) return <LoadingState title="Loading conversation…" />

  if (query.data === undefined || 'kind' in query.data) {
    return <ErrorState title="Conversation unavailable" detail="It may have been removed, or you may not have access." />
  }

  const { items, next } = query.data.exchanges
  const oldestFirst = items.toReversed()

  return (
    <div className="space-y-8">
      {next && <Button variant="ghost" onClick={() => setAfter(next)}>Earlier messages</Button>}
      {oldestFirst.map((exchange) => <ExchangeView key={exchange.run.id} exchange={exchange} userId={userId} onResend={onResend} />)}
      {after && <Button variant="ghost" onClick={() => setAfter(undefined)}>Latest messages</Button>}
    </div>
  )
}
