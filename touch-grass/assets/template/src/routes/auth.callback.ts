import { createFileRoute } from '@tanstack/react-router'
import { finishGoogleSignIn } from '@/platform/auth.server'

export const Route = createFileRoute('/auth/callback')({ server: { handlers: { GET: ({ request }) => finishGoogleSignIn(new URL(request.url).searchParams.get('code')) } } })
