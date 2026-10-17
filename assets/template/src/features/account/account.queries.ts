import { queryOptions } from '@tanstack/react-query'
import { readProfile, saveProfile } from './account.functions'
import { useIdempotentMutation } from '@/platform/mutations'
import type { UserId } from '@/platform/ids'
import type { Profile } from './account.schema'

export const profileQuery = (user: UserId) => queryOptions({
  queryKey: ['account', user],
  queryFn: () => readProfile(),
})

export function useSaveProfile(user: UserId) {
  return useIdempotentMutation({
    mutationKey: ['account', user, 'save'],
    send: (input: Profile) => saveProfile({ data: input }),
    invalidate: () => [['account', user]],
  })
}
