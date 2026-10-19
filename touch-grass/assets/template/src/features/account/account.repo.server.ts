import { z } from 'zod'
import { createServiceClient, type RequestClient } from '@/platform/supabase.server'
import type { UserId } from '@/platform/ids'
import type { Profile } from './account.schema'

const rows = z.array(z.object({ display_name: z.string(), updated_at: z.string() }))

export async function getProfile(client: RequestClient): Promise<Profile> {
  const { data, error } = await client.schema('account_api').rpc('get_profile')

  if (error) throw new Error('Profile read failed')

  return { displayName: rows.parse(data)[0]?.display_name ?? '' }
}

export async function updateProfile(env: unknown, userId: UserId, displayName: string): Promise<Profile> {
  const { error } = await createServiceClient(env).schema('account_api').rpc('upsert_profile', { p_user_id: userId, p_display_name: displayName })

  if (error) throw new Error('Profile write failed')

  return { displayName }
}
