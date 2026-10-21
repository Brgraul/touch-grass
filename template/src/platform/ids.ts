import { z } from 'zod'

export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export const userId = z.uuid().brand<'UserId'>()

export const environmentId = z.uuid().brand<'EnvironmentId'>()

export const conversationId = z.uuid().brand<'ConversationId'>()

export const runId = z.uuid().brand<'RunId'>()

export const turnId = z.uuid().brand<'TurnId'>()

export const requestKey = z.uuid().brand<'RequestKey'>()

export const instant = z.iso.datetime({ offset: true }).brand<'IsoInstant'>()

const cursorKey = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])

function decodesToSortKey(cursor: string) {
  try {
    return cursorKey.safeParse(JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')))).success
  } catch {
    return false
  }
}

export const pageCursor = z.string().max(1024).regex(/^[\w-]+$/u).refine(decodesToSortKey, 'Unknown page cursor').brand<'PageCursor'>()

export const jsonValue = z.json()

export type UserId = z.infer<typeof userId>

export type EnvironmentId = z.infer<typeof environmentId>

export type ConversationId = z.infer<typeof conversationId>

export type RunId = z.infer<typeof runId>

export type TurnId = z.infer<typeof turnId>

export type RequestKey = z.infer<typeof requestKey>

export type Instant = z.infer<typeof instant>

export type PageCursor = z.infer<typeof pageCursor>

export type JsonValue = z.infer<typeof jsonValue>

export type Page<T> = { items: readonly T[]; next?: PageCursor }

export type Actor = { userId: UserId; environmentId: EnvironmentId }

export type NotFound = { kind: 'not_found' }
