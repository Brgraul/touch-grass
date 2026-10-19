import { MaxTurnsExceededError, type AgentInputItem, type AgentOutputItem } from '@openai/agents';
import { z } from 'zod';
import type { ConversationId, Instant, JsonValue, RunId, UserId } from '@/platform/ids';
import { blocksFromAgentItems, writeBlocksSchema, type ContentBlock, type Exchange, type RunFailure, type StoredBlock } from './agent-chat.schema';

const unparsedArguments = z.object({ unparsed: z.string() }).strict();

export const MAX_STEPS = 8;

export const MAX_TOOL_CALLS_PER_STEP = 4;

export const MAX_OUTPUT_TOKENS = 1_024;

export const MESSAGES_PER_USER_PER_HOUR = 60;

export const ACTIVE_RUNS_PER_USER = 2;

export const ACTIVE_RUNS_PER_ENVIRONMENT = 10;

export const RUN_DURATION = 900;

export const MODEL_CALL_TIMEOUT = 120_000;

export const MODEL_STEP_TIMEOUT = 150_000;

export const MODEL_CALL_RETRIES = 2;

export const DISPATCH_CHECK_DELAY = 60;

export const END_CHECK_GRACE = 300;

export const MAX_HISTORY_RUNS = 20;

export const MAX_HISTORY_BYTES = 524_288;

export const WORKFLOW_STEP_LIMIT = 1_024;

export const SYSTEM_PROMPT = 'You are a helpful assistant. Use calculate for arithmetic. Treat tool errors as errors, correct the input when possible, and answer with the result. Never claim a tool succeeded when it returned an error.';

export type RunPolicy = { maxSteps: number; maxToolCallsPerStep: number };

export type RunInput = { runId: RunId; ownerId: UserId; conversationId: ConversationId; message: string; history: readonly Exchange[]; policy: RunPolicy; deadline: Instant };

export type SavedModelResponse = { output: AgentOutputItem[]; usage: { inputTokens: number; outputTokens: number }; finishReason?: string };

export type ModelOutcome = { kind: 'response'; response: SavedModelResponse } | { kind: 'terminal'; failure: RunFailure };

export type Commit = { kind: 'committed'; now: Instant } | { kind: 'completed' } | { kind: 'ended' };

export type ProviderErrorKind = 'retryable' | 'context_length' | 'quota' | 'policy' | 'configuration' | 'unknown';

export class RunFailed extends Error {
  constructor(readonly failure: RunFailure) {
    super(failure.kind);
    this.name = 'RunFailed';
  }
}

export class RunEnded extends Error {}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function toolArguments(input: JsonValue | { unparsed: string }): string {
  const parsed = unparsedArguments.safeParse(input);

  return parsed.success ? parsed.data.unparsed : JSON.stringify(input);
}

function historyItem(block: StoredBlock, toolNames: ReadonlyMap<string, string>): AgentInputItem {
  switch (block.kind) {
    case 'text':
      return { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: block.text }] };
    case 'tool_call':
      return { type: 'function_call', callId: block.callId, name: block.tool, arguments: toolArguments(block.input), status: 'completed' };
    case 'tool_result':
      return { type: 'function_call_result', callId: block.callId, name: toolNames.get(block.callId) ?? 'unknown', output: JSON.stringify(block.output), status: 'completed' };
    case 'structured_output':
      return { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(block.value) }] };
    case 'unsupported':
      return { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '[unsupported block]' }] };
    default: {
      const exhaustive: never = block;

      return exhaustive;
    }
  }
}

export function toAgentInput(history: readonly Exchange[], message: string): AgentInputItem[] {
  const selected = history.filter(({ run }) => run.state === 'completed').slice(-MAX_HISTORY_RUNS);
  let size = selected.reduce((sum, exchange) => sum + bytes(exchange), 0);

  while (size > MAX_HISTORY_BYTES && selected.length > 0) {
    size -= bytes(selected.shift());
  }

  const input: AgentInputItem[] = [];

  for (const exchange of selected) {
    input.push({ role: 'user', content: exchange.run.message });

    for (const turn of exchange.turns) {
      const toolNames = new Map(turn.blocks.flatMap((block) => block.kind === 'tool_call' ? [[block.callId, block.tool] as const] : []));

      for (const block of turn.blocks) input.push(historyItem(block, toolNames));
    }
  }

  input.push({ role: 'user', content: message });

  return input;
}

export function checkBeforeCall(input: RunInput, step: number, now: Instant): RunFailure | undefined {
  if (new Date(now).getTime() >= new Date(input.deadline).getTime()) return { kind: 'limit', limit: 'duration' };

  if (step > input.policy.maxSteps) return { kind: 'limit', limit: 'steps' };

  return undefined;
}

export function turnBlocks(response: SavedModelResponse, nextInput: readonly AgentInputItem[] = []): ContentBlock[] {
  const callIds = new Set(response.output.flatMap((item) => item.type === 'function_call' ? [item.callId] : []));
  const results = nextInput.filter((item) => item.type === 'function_call_result' && callIds.has(item.callId));
  const visible = response.output.filter((item) => item.type !== 'reasoning');

  try {
    return writeBlocksSchema.parse(blocksFromAgentItems.parse([...visible, ...results]));
  } catch {
    throw new RunFailed({ kind: 'model_output_invalid', reason: 'oversized' });
  }
}

export function checkResponse(response: SavedModelResponse, policy: RunPolicy): RunFailure | undefined {
  if (response.finishReason === 'length' || response.finishReason === 'max_tokens') return { kind: 'model_output_invalid', reason: 'truncated' };

  if (response.output.filter((item) => item.type === 'function_call').length > policy.maxToolCallsPerStep) return { kind: 'limit', limit: 'tool_calls' };

  try {
    turnBlocks(response);
  } catch {
    return { kind: 'model_output_invalid', reason: 'oversized' };
  }

  return undefined;
}

export function classifyModelError(kind: ProviderErrorKind): 'retry' | RunFailure {
  switch (kind) {
    case 'retryable': return 'retry';
    case 'context_length': return { kind: 'limit', limit: 'context' };
    case 'quota': case 'policy': case 'configuration': return { kind: 'provider_refused', reason: kind };
    case 'unknown': return { kind: 'execution', code: 'unclassified_provider_response' };
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

export function failureFromRunError(error: unknown): RunFailure | undefined {
  if (error instanceof RunEnded) return undefined;

  if (error instanceof RunFailed) return error.failure;

  if (error instanceof MaxTurnsExceededError) return { kind: 'limit', limit: 'steps' };

  return { kind: 'execution', code: 'internal' };
}
