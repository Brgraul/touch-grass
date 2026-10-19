import { LoaderCircle, Square } from 'lucide-react'
import { useStopRun } from '../agent-chat.queries'
import type { Exchange, Run, RunFailure } from '../agent-chat.schema'
import { TurnView } from './turn-view'
import { Button } from '@/components/ui/button'
import type { RunId, UserId } from '@/platform/ids'

type ExchangeViewProps = { exchange: Exchange; userId: UserId; onResend: (text: string) => Promise<boolean> }

export function ExchangeView({ exchange, userId, onResend }: ExchangeViewProps) {
  const { run, turns } = exchange

  return (
    <article className="space-y-5 border-b pb-8" data-testid="exchange">
      <div className="ml-auto max-w-xl rounded-xl bg-secondary px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{run.message}</p>
      </div>
      <div className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Assistant</p>
        {turns.map((turn) => <TurnView key={turn.id} turn={turn} />)}
      </div>
      <RunStatus run={run} userId={userId} onResend={onResend} />
    </article>
  )
}

function RunStatus({ run, userId, onResend }: { run: Run; userId: UserId; onResend: (text: string) => Promise<boolean> }) {
  switch (run.state) {
    case 'queued':
      return <ActiveRun runId={run.id} userId={userId} label="Waiting to start" />
    case 'running':
      return <ActiveRun runId={run.id} userId={userId} label={`Working · ${run.committedSteps} saved ${run.committedSteps === 1 ? 'step' : 'steps'}`} />
    case 'completed':
      return <p className="text-xs text-muted-foreground">Completed</p>
    case 'failed':
      return <EndedRun reason={failureText(run.failure)} message={run.message} onResend={onResend} />
    case 'canceled':
      return <EndedRun reason="Run stopped." message={run.message} onResend={onResend} />
    default: {
      const unhandled: never = run

      return unhandled
    }
  }
}

function ActiveRun({ runId, userId, label }: { runId: RunId; userId: UserId; label: string }) {
  const stop = useStopRun(userId)
  const stopFailed = stop.isError || (stop.data !== undefined && 'kind' in stop.data)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          {label}
        </p>
        <Button variant="outline" size="sm" disabled={stop.isPending} onClick={() => stop.submit(runId)}>
          <Square className="size-3" />
          Stop run
        </Button>
      </div>
      {stopFailed && <p role="alert" className="text-sm text-destructive">Could not stop the run. Try again.</p>}
    </div>
  )
}

function EndedRun({ reason, message, onResend }: { reason: string; message: string; onResend: (text: string) => Promise<boolean> }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm text-muted-foreground">{reason}</p>
      <Button variant="outline" size="sm" onClick={() => onResend(message)}>Send again</Button>
    </div>
  )
}

function failureText(failure: RunFailure) {
  switch (failure.kind) {
    case 'limit':
      return `This run reached its ${failure.limit} limit.`
    case 'provider_refused':
      return `The model provider refused this run (${failure.reason}).`
    case 'model_output_invalid':
      return `The model response was ${failure.reason}.`
    case 'execution':
      return 'This run could not finish. Please try a new message.'
    default: {
      const unhandled: never = failure

      return unhandled
    }
  }
}
