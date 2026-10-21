import { z } from 'zod'

export const profileSchema = z.object({ displayName: z.string().max(80) })

// WHY: PostgreSQL cannot store NUL, and JSON cannot carry a lone UTF-16 surrogate.
const storable = (value: string) => !value.includes('\u0000') && !/[\uD800-\uDFFF]/u.test(value)

export const updateProfileInput = z.object({
  displayName: z.string().trim().min(1).max(80).refine(storable, 'Contains a character the database cannot store'),
}).strict()

export type Profile = z.infer<typeof profileSchema>
