import { Link } from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'

type StateProps = { title: string; detail?: string }

function StateFrame({ title, detail }: StateProps) {
  return (
    <>
      <p className="font-medium">{title}</p>
      {detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}
    </>
  )
}

export function LoadingState({ title, detail }: StateProps) {
  return (
    <div role="status" aria-busy="true" className="rounded-xl border border-dashed p-8 text-center">
      <LoaderCircle className="mx-auto mb-3 size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <StateFrame title={title} detail={detail} />
    </div>
  )
}

export function EmptyState({ title, detail }: StateProps) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <StateFrame title={title} detail={detail} />
    </div>
  )
}

export function ErrorState({ title, detail }: StateProps) {
  return (
    <div role="alert" className="rounded-xl border border-dashed border-destructive/40 p-8 text-center">
      <StateFrame title={title} detail={detail} />
    </div>
  )
}

export function NotFoundState() {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <StateFrame title="Page not found" detail="The page you opened does not exist, or it moved." />
      <Link to="/chat" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Back to chat</Link>
    </div>
  )
}
