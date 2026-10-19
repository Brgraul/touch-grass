import { createServerFn } from '@tanstack/react-start'
import type { z } from 'zod'
import { parseInput, requireActor, safeResult } from '@/platform/auth.server'
import { conversationPageInput, readConversationInput, sendMessageInput, stopRunInput } from './agent-chat.schema'

// Each validator only types the input. Parsing happens inside safeResult, so a bad input comes back
// as an `invalid_input` result instead of a thrown transport error that the client would retry.
// The actor resolves first, so a signed-out caller learns nothing about input rules.

export const sendMessage = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof sendMessageInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const actor = await requireActor()

    return context.chat.send(actor, parseInput(sendMessageInput, data))
  }))

export const listConversations = createServerFn({ method: 'GET' })
  .validator((input: z.input<typeof conversationPageInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const actor = await requireActor()

    return context.chat.listConversations(actor, parseInput(conversationPageInput, data))
  }))

export const readConversation = createServerFn({ method: 'GET' })
  .validator((input: z.input<typeof readConversationInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const actor = await requireActor()
    const input = parseInput(readConversationInput, data)

    return context.chat.readConversation(actor, input.conversationId, input)
  }))

export const stopRun = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof stopRunInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const actor = await requireActor()

    return context.chat.cancel(actor, parseInput(stopRunInput, data).runId)
  }))
