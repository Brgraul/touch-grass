import { useGoogleSignIn } from '../auth.queries'
import { Button } from '@/components/ui/button'

export function LoginPage({ signInFailed }: { signInFailed: boolean }) {
  const signIn = useGoogleSignIn()
  const failed = signInFailed || signIn.isError || (signIn.data !== undefined && 'kind' in signIn.data)

  async function continueWithGoogle() {
    const result = await signIn.submit(undefined)

    if (result && 'url' in result) window.location.assign(result.url)
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-primary">Touch Grass</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Make room for ideas.</h1>
        <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">A place to think, calculate, and keep the conversation going.</p>
        {failed && <p role="alert" className="mb-4 text-sm text-destructive">Sign-in failed. Please try again.</p>}
        <Button className="w-full" disabled={signIn.isPending} onClick={continueWithGoogle}>
          {signIn.isPending ? 'Connecting…' : 'Continue with Google'}
        </Button>
      </section>
    </main>
  )
}
