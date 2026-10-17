import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { sendMessageInput } from '../agent-chat.schema'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type ComposerProps = { busy: boolean; onSend: (text: string) => Promise<boolean> }

const tooLongNotice = 'This message is over the 32 KB limit. Shorten it to send.'

export function Composer({ busy, onSend }: ComposerProps) {
  const [text, setText] = useState('')
  const isBlank = text.trim().length === 0
  const tooLong = !isBlank && !sendMessageInput.shape.text.safeParse(text).success
  const canSend = !busy && !isBlank && !tooLong

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (!canSend) return
    const sent = await onSend(text)

    if (sent) setText('')
  }

  return (
    <form className="rounded-xl border bg-card p-3 shadow-sm" onSubmit={submit}>
      <Textarea
        aria-label="Message"
        placeholder="Ask a question. Try calculating 6 * 7."
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        aria-invalid={tooLong}
        className="min-h-24 resize-none border-0 shadow-none focus-visible:ring-0"
      />
      {tooLong && <p role="alert" className="px-3 pt-2 text-sm text-destructive">{tooLongNotice}</p>}
      <div className="flex items-center justify-between gap-4 pt-2">
        <p className="text-xs text-muted-foreground">Your conversation stays here when you leave.</p>
        <Button type="submit" size="sm" disabled={!canSend}>
          <ArrowUp className="size-4" />
          Send message
        </Button>
      </div>
    </form>
  )
}
