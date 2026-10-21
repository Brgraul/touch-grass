import { createServerFn } from '@tanstack/react-start'
import type { z } from 'zod'
import { createRequestClient, requestEnvironment, requireActor, requireActorInput, safeResult } from '@/platform/auth.server'
import { getProfile, updateProfile } from './account.repo.server'
import { updateProfileInput } from './account.schema'

export const readProfile = createServerFn({ method: 'GET' }).handler(() => safeResult(async () => {
  await requireActor()

  return getProfile(createRequestClient())
}))

export const saveProfile = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof updateProfileInput>) => input)
  .handler(({ data }) => safeResult(async () => {
    const { actor, input } = await requireActorInput(updateProfileInput, data)

    return updateProfile(requestEnvironment(), actor.userId, input.displayName)
  }))
