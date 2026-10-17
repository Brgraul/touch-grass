import { createServerFn } from '@tanstack/react-start'
import type { z } from 'zod'
import { createRequestClient, parseInput, requestEnvironment, requireActor, safeResult } from '@/platform/auth.server'
import { getProfile, updateProfile } from './account.repo.server'
import { updateProfileInput } from './account.schema'

export const readProfile = createServerFn({ method: 'GET' }).handler(() => safeResult(async () => {
  await requireActor()

  return getProfile(createRequestClient())
}))

export const saveProfile = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof updateProfileInput>) => input)
  .handler(({ data }) => safeResult(async () => {
    const actor = await requireActor()

    return updateProfile(requestEnvironment(), actor.userId, parseInput(updateProfileInput, data).displayName)
  }))
