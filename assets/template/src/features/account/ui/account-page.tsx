import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { profileQuery, useSaveProfile } from '../account.queries'
import { updateProfileInput } from '../account.schema'
import { ErrorState } from '@/components/patterns/data-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { UserId } from '@/platform/ids'

const invalidNameNotice = 'Enter a display name. It cannot be blank and can have up to 80 characters.'

export function AccountPage({ userId, email }: { userId: UserId; email: string }) {
  const { data } = useSuspenseQuery(profileQuery(userId))
  const save = useSaveProfile(userId)
  const [draft, setDraft] = useState<string>()
  const [rejected, setRejected] = useState(false)

  if ('kind' in data) return <ErrorState title="Account unavailable" detail={`Please try again. Reference ${data.correlationId}`} />

  const displayName = draft ?? data.displayName
  const saveFailed = save.isError || (save.data !== undefined && 'kind' in save.data)
  const saved = save.data !== undefined && !('kind' in save.data)
  const serverRejected = save.data !== undefined && 'kind' in save.data && save.data.code === 'invalid_input'
  const nameRejected = rejected || serverRejected

  function editName(event: React.ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value)
    setRejected(false)
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    const valid = updateProfileInput.shape.displayName.safeParse(displayName).success

    setRejected(!valid)

    if (valid) await save.submit({ displayName })
  }

  return (
    <section className="mx-auto w-full max-w-xl py-4 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">Keep your profile up to date.</p>
      <form className="mt-8 space-y-6 rounded-xl border bg-card p-6" onSubmit={saveProfile}>
        <div className="space-y-2">
          <Label htmlFor="email">Google account</Label>
          <Input id="email" value={email} readOnly />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" value={displayName} aria-invalid={nameRejected} onChange={editName} maxLength={80} />
        </div>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
        {saved && !nameRejected && <p role="status" className="text-sm text-primary">Profile saved.</p>}
        {nameRejected && <p role="alert" className="text-sm text-destructive">{invalidNameNotice}</p>}
        {saveFailed && !serverRejected && <p role="alert" className="text-sm text-destructive">Could not save your profile. Please try again.</p>}
      </form>
    </section>
  )
}
