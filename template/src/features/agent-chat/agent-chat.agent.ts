import { Agent, type RunConfig } from '@openai/agents';
import { MAX_OUTPUT_TOKENS, SYSTEM_PROMPT } from './agent-chat.model';
import { TOOL_ERROR_OUTPUT, TOOLS } from './agent-chat.tools';

export const CHAT_AGENT = new Agent({
  name: 'chat',
  instructions: SYSTEM_PROMPT,
  tools: TOOLS,
  // WHY: The SDK sends maxTokens as max_tokens, which OpenAI rejects for reasoning models, but passes providerData into the request body as is.
  modelSettings: { providerData: { max_completion_tokens: MAX_OUTPUT_TOKENS }, store: false, parallelToolCalls: false },
});

// WHY: The SDK reads toolNotFoundBehavior from the run configuration, not from the Agent.
export const CHAT_RUN_CONFIG = {
  tracingDisabled: true,
  toolNotFoundBehavior: 'return_error_to_model',
  toolErrorFormatter: () => TOOL_ERROR_OUTPUT,
} satisfies Partial<RunConfig>;
