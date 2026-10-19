import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { environmentId } from './ids'

const environment = z.object({
  ENVIRONMENT_ID: environmentId,
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1).refine((key) => key !== 'TOUCH_GRASS_SERVER_SECRET_SENTINEL_4b8ae730', 'Invalid model key'),
  LLM_MODEL: z.string().min(1),
  LANGFUSE_BASE_URL: z.url().default('https://cloud.langfuse.com'),
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
}).refine((settings) => (settings.LANGFUSE_PUBLIC_KEY === undefined) === (settings.LANGFUSE_SECRET_KEY === undefined), {
  message: 'Set both Langfuse keys or neither',
  path: ['LANGFUSE_SECRET_KEY'],
})

const parsed = new WeakMap<object, z.infer<typeof environment>>()

export function parseEnv(source: unknown) {
  if (typeof source !== 'object' || source === null) throw new Error('Missing Worker environment')
  const cached = parsed.get(source)

  if (cached) return cached
  const result = environment.safeParse(source)

  if (!result.success) throw new Error(`Invalid environment variables: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  parsed.set(source, result.data)

  return result.data
}

export function getEnv() { return parseEnv(env) }

export type AppEnv = z.infer<typeof environment>
