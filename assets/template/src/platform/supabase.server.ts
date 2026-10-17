import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseEnv } from './env.server'
import type { Database } from './database.types'

export type RequestClient = SupabaseClient<Database>

export function createServiceClient(source: unknown): RequestClient {
  const settings = parseEnv(source)

  return createClient<Database>(settings.SUPABASE_URL, settings.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
