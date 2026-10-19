import { z } from 'zod';
import { createServiceClient, type RequestClient } from '@/platform/supabase.server';
import { conversationId, instant, pageCursor, runId, userId, type Actor, type PageCursor, type RunId } from '@/platform/ids';
import {
  BLOCK_SCHEMA_VERSION, agentTurnSchema, contentBlockSchema, conversationSchema,
  notFoundSchema, runSchema, runFailureSchema, sendMessageInput,
  type ContentBlock, type RunFailure,
} from './agent-chat.schema';

const rawTurn = agentTurnSchema.omit({ blocks: true }).extend({
  blocks: z.array(z.unknown()), blockSchemaVersion: z.number().int(),
}).transform(({ blockSchemaVersion, blocks, ...turn }) => ({
  ...turn,
  blocks: blocks.map((value) => {
    const { kind } = z.object({ kind: z.string() }).parse(value);

    if (blockSchemaVersion !== BLOCK_SCHEMA_VERSION || !['text', 'tool_call', 'tool_result', 'structured_output'].includes(kind)) {
      return { kind: 'unsupported' as const, storedKind: kind, storedVersion: blockSchemaVersion };
    }

    return contentBlockSchema.parse(value);
  }),
}));

const exchange = z.object({ run: runSchema, turns: z.array(rawTurn) });

const page = z.object({ items: z.array(conversationSchema), next: pageCursor.optional() });

const read = z.union([z.object({ conversation: conversationSchema, exchanges: z.object({ items: z.array(exchange), next: pageCursor.optional() }) }), notFoundSchema]);

const submitted = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), run: runSchema, created: z.boolean() }),
  z.object({ kind: z.literal('refused'), reason: z.enum(['rate_limited', 'capacity', 'busy']) }),
  z.object({ kind: z.literal('key_conflict') }),
  notFoundSchema,
]);

const runResult = z.union([runSchema, notFoundSchema]);

const started = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ended') }),
  z.object({
    kind: z.literal('started'), now: instant,
    input: z.object({
      runId, ownerId: userId, conversationId, message: z.string(), history: z.array(exchange),
      policy: z.object({ maxSteps: z.number().int().positive(), maxToolCallsPerStep: z.number().int().positive() }),
      deadline: instant,
    }),
  }),
]);

const committed = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('committed'), now: instant }),
  z.object({ kind: z.literal('completed') }),
  z.object({ kind: z.literal('ended') }),
]);

const sweep = z.object({ dispatch: z.array(runId), expired: z.array(runId) });

const databaseError = z.object({ code: z.string().optional() });

function parseResult<T>(response: { data: unknown; error: unknown }, schema: z.ZodType<T>): T {
  if (response.error) throw new Error(`Database operation failed: ${databaseError.safeParse(response.error).data?.code ?? 'no code'}`);
  const parsed = schema.safeParse(response.data);

  if (!parsed.success) throw new Error(`Database returned an unexpected row: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.code).join(', ')}`);

  return parsed.data;
}

export function createChatRepository(source: unknown) {
  const client = createServiceClient(source).schema('agent_chat_api');

  return {
    async submit(actor: Actor, input: z.infer<typeof sendMessageInput>, limits: {
      maxSteps: number; maxToolCallsPerStep: number; messagesPerHour: number;
      activePerUser: number; activePerEnvironment: number; runDurationSeconds: number;
    }) {
      return parseResult(await client.rpc('submit_message', {
        p_owner_id: actor.userId, p_environment_id: actor.environmentId, p_request_key: input.requestKey,
        p_text: input.text, p_conversation_id: input.conversationId,
        p_max_steps: limits.maxSteps, p_max_tool_calls_per_step: limits.maxToolCallsPerStep,
        p_messages_per_hour: limits.messagesPerHour, p_active_per_user: limits.activePerUser,
        p_active_per_environment: limits.activePerEnvironment, p_run_duration_seconds: limits.runDurationSeconds,
      }), submitted);
    },
    async list(request: RequestClient, after?: PageCursor) {
      return parseResult(await request.schema('agent_chat_api').rpc('list_conversations', { p_after: after, p_limit: 25 }), page);
    },
    async read(request: RequestClient, id: z.infer<typeof conversationId>, after?: PageCursor) {
      return parseResult(await request.schema('agent_chat_api').rpc('read_conversation', { p_conversation_id: id, p_after: after, p_limit: 25 }), read);
    },
    async cancel(actor: Actor, id: RunId) {
      return parseResult(await client.rpc('cancel_run', { p_owner_id: actor.userId, p_run_id: id }), runResult);
    },
    async start(id: RunId, historyLimits: { maxRuns: number; maxBytes: number }) {
      return parseResult(await client.rpc('start_run', { p_run_id: id, p_max_history_runs: historyLimits.maxRuns, p_max_history_bytes: historyLimits.maxBytes }), started);
    },
    async commit(id: RunId, ordinal: number, blocks: ContentBlock[], final: boolean, usage: { inputTokens: number; outputTokens: number }) {
      return parseResult(await client.rpc('commit_step', { p_run_id: id, p_step_ordinal: ordinal, p_blocks: blocks, p_final: final, p_usage: usage }), committed);
    },
    async fail(id: RunId, failure: RunFailure) {
      return parseResult(await client.rpc('fail_run', { p_run_id: id, p_failure: runFailureSchema.parse(failure) }), runResult);
    },
    async candidates(actorEnvironment: Actor['environmentId'], timing: { dispatchDelaySeconds: number; endGraceSeconds: number }) {
      return parseResult(await client.rpc('sweep_candidates', {
        p_environment_id: actorEnvironment, p_dispatch_delay_seconds: timing.dispatchDelaySeconds,
        p_end_grace_seconds: timing.endGraceSeconds, p_limit: 25,
      }), sweep);
    },
  };
}
