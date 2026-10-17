import handler from '@tanstack/react-start/server-entry'
import { AgentChatWorkflow, workflowRuns } from './features/agent-chat/agent-chat.workflow.server'
import { createChat, sweepRuns, type Chat } from './features/agent-chat/agent-chat.service.server'
import { createRequestClient } from './platform/auth.server'
import { getEnv } from './platform/env.server'

export { AgentChatWorkflow }

export default {
  fetch(request: Request, env: Env) {
    getEnv()
    const chat = createChat(env, workflowRuns(env.AGENT_CHAT_WORKFLOW), createRequestClient(request))

    return handler.fetch(request, { context: { chat } })
  },
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(sweepRuns(env, workflowRuns(env.AGENT_CHAT_WORKFLOW)))
  },
} satisfies ExportedHandler<Env>

declare module '@tanstack/router-core' { interface Register { server: { requestContext: { chat: Chat } } } }

declare module '@tanstack/react-router' { interface Register { server: { requestContext: { chat: Chat } } } }
