import { createServerFn } from '@tanstack/react-start'
import type { z } from 'zod'
import { requireActorInput, safeResult } from '@/platform/auth.server'
import { conversationPageInput, readConversationInput, sendMessageInput, stopRunInput } from './agent-chat.schema'

export const sendMessage = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof sendMessageInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const { actor, input } = await requireActorInput(sendMessageInput, data)

    return context.chat.send(actor, input)
  }))

export const listConversations = createServerFn({ method: 'GET' })
  .validator((input: z.input<typeof conversationPageInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const { actor, input } = await requireActorInput(conversationPageInput, data)

    return context.chat.listConversations(actor, input)
  }))

export const readConversation = createServerFn({ method: 'GET' })
  .validator((input: z.input<typeof readConversationInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const { actor, input } = await requireActorInput(readConversationInput, data)

    return context.chat.readConversation(actor, input.conversationId, input)
  }))

export const stopRun = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof stopRunInput>) => input)
  .handler(({ data, context }) => safeResult(async () => {
    const { actor, input } = await requireActorInput(stopRunInput, data)

    return context.chat.cancel(actor, input.runId)
  }))
