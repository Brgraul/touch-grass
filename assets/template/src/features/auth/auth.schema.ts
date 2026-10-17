import { z } from 'zod'
import { userId } from '@/platform/ids'

export const sessionSchema = z.object({ userId, email: z.string() }).nullable()

export type Session = z.infer<typeof sessionSchema>
