import { OpenAIProvider, ModelBehaviorError, type ModelResponse } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';
import type { AppEnv } from './env.server';

export type ProviderErrorKind = 'retryable' | 'context_length' | 'quota' | 'policy' | 'configuration' | 'unknown';

const providerError = z.object({
  status: z.number().optional(),
  code: z.string().nullable().optional(),
  error: z.object({ code: z.string().nullable().optional(), type: z.string().optional() }).nullable().optional(),
});

const assistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  refusal: z.string().nullable().optional(),
  reasoning: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
});

const completionChoice = z.object({ finish_reason: z.string(), message: assistantMessage })
  .refine(({ message, finish_reason }) => finish_reason === 'content_filter'
    || typeof message.content === 'string'
    || Boolean(message.refusal || message.reasoning || message.tool_calls?.length), 'Provider returned no assistant output');

// WHY: The SDK's Chat Completions model keeps the raw completion as providerData, the only place the finish reason survives.
const completion = z.object({ choices: z.array(completionChoice).min(1) });

const QUOTA_CODES = ['insufficient_quota', 'billing_hard_limit_reached'];

const CONTEXT_CODES = ['context_length_exceeded', 'max_context_length_exceeded'];

const POLICY_CODES = ['content_policy_violation', 'content_filter', 'safety_violation'];

const CONFIGURATION_CODES = ['invalid_api_key', 'model_not_found', 'unsupported_parameter', 'unsupported_value'];

const TRUNCATED_EMPTY_COMPLETION = "Chat Completions response terminated with finish_reason='length' but produced no assistant text, tool call, or refusal.";

class ConfiguredOpenAIProvider extends OpenAIProvider {
  constructor(private readonly defaultModel: string, client: OpenAI) {
    super({ openAIClient: client, useResponses: false });
  }

  override getModel(name = this.defaultModel) {
    return super.getModel(name);
  }
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);

    return true;
  } catch {
    return false;
  }
}

// WHY: The OpenAI client raises APIConnectionError only when fetch rejects, so a connection lost mid-body would surface later as a bare TypeError or SyntaxError.
async function fetchWholeBody(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const body = await response.clone().text();

  if (response.headers.get('content-type')?.includes('json') && body !== '' && !parsesAsJson(body)) {
    throw new TypeError('The provider response body ended before it was complete');
  }

  return response;
}

export function createModelProvider(settings: Pick<AppEnv, 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL'>) {
  const client = new OpenAI({ apiKey: settings.LLM_API_KEY, baseURL: settings.LLM_BASE_URL, maxRetries: 0, fetch: fetchWholeBody });

  return new ConfiguredOpenAIProvider(settings.LLM_MODEL, client);
}

export function modelResponseMetadata(response: ModelResponse): { finishReason: string; refused: boolean } | undefined {
  const parsed = completion.safeParse(response.providerData);

  if (!parsed.success) return undefined;
  const [choice] = parsed.data.choices;

  return choice && { finishReason: choice.finish_reason, refused: choice.finish_reason === 'content_filter' || Boolean(choice.message.refusal) };
}

// WHY: The SDK raises this for a length-truncated completion with no output and exports no type guard for it.
export function isTruncatedModelError(error: unknown): boolean {
  return error instanceof ModelBehaviorError && error.message === TRUNCATED_EMPTY_COMPLETION;
}

export function classifyProviderError(error: unknown): ProviderErrorKind {
  // WHY: The OpenAI client raises these for network loss, its own timeout and our abort, all with the plain name 'Error'.
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIUserAbortError) return 'retryable';
  const parsed = providerError.safeParse(error);

  if (!parsed.success) return 'unknown';
  const { status, code: topCode, error: body } = parsed.data;
  const code = topCode ?? body?.code ?? body?.type ?? undefined;

  if (code && QUOTA_CODES.includes(code)) return 'quota';

  if (code && CONTEXT_CODES.includes(code)) return 'context_length';

  if (code && POLICY_CODES.includes(code)) return 'policy';

  if ((code && CONFIGURATION_CODES.includes(code)) || status === 401 || status === 403 || status === 404) return 'configuration';

  if (status === 429 || (status !== undefined && status >= 500)) return 'retryable';

  return 'unknown';
}
