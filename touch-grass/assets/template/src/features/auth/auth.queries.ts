import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { getSession, logout, startGoogleSignIn } from './auth.functions'
import { useIdempotentMutation } from '@/platform/mutations'

export const sessionQuery = () => queryOptions({
  queryKey: ['auth', 'session'],
  queryFn: () => getSession(),
  staleTime: 30_000,
})

export function useGoogleSignIn() {
  return useIdempotentMutation({ mutationKey: ['auth', 'google'], send: () => startGoogleSignIn(), invalidate: () => [] })
}

export function useLogout() {
  const client = useQueryClient()
  const mutation = useIdempotentMutation({ mutationKey: ['auth', 'logout'], send: () => logout(), invalidate: () => [] })

  async function submit() {
    const result = await mutation.submit(undefined)

    if (result?.kind === 'signed_out') client.clear()

    return result
  }

  return { ...mutation, submit }
}
