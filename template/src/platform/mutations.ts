import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { requestKey, type RequestKey } from './ids'

type MutationSpec<Input, Result> = {
  mutationKey: QueryKey
  invalidate: (result: Result, input: Input) => readonly QueryKey[]
  send: (input: Input) => Promise<Result>
}

export function useIdempotentMutation<Input, Result>(spec: MutationSpec<Input, Result>) {
  const client = useQueryClient()

  const { mutateAsync, mutate: _mutate, ...mutation } = useMutation({
    mutationKey: spec.mutationKey,
    mutationFn: spec.send,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onSuccess: async (result, input) => {
      await Promise.all(spec.invalidate(result, input).map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })

  const submit = (input: Input) => mutateAsync(input).catch(() => undefined)

  return { ...mutation, submit }
}

export function useKeyedMutation<Input, Result>(spec: MutationSpec<Input & { requestKey: RequestKey }, Result>) {
  const mutation = useIdempotentMutation(spec)

  return { ...mutation, submit: (input: Input) => mutation.submit({ ...input, requestKey: requestKey.parse(crypto.randomUUID()) }) }
}
