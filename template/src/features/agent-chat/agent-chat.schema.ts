import { z } from 'zod';
import {
  conversationId, instant, jsonValue, pageCursor, requestKey, runId, turnId, type JsonValue,
} from '@/platform/ids';

export const BLOCK_SCHEMA_VERSION = 1;

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;

// WHY: PostgreSQL cannot store NUL and JSON cannot carry a lone UTF-16 surrogate, and in a `u` regex only a lone surrogate matches this range.
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

function storableJson(value: JsonValue): JsonValue {
  if (typeof value === 'string') return value.replaceAll('\u0000', '\uFFFD').replace(LONE_SURROGATE, '\uFFFD');

  if (Array.isArray(value)) return value.map(storableJson);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [storableJson(key), storableJson(item)]));
  }

  return value;
}

const isStorable = (value: JsonValue) => JSON.stringify(storableJson(value)) === JSON.stringify(value);

const unstorable = 'Contains NUL or an unpaired surrogate, which the database cannot store';

const text = z.string().refine((value) => bytes(value) <= 32_768, 'Text exceeds 32 KB').refine(isStorable, unstorable);

const boundedJson = jsonValue.refine((value) => bytes(value) <= 16_384, 'JSON exceeds 16 KB').refine(isStorable, unstorable);

export const toolCallId = z.string().min(1).brand<'ToolCallId'>();

export type ToolCallId = z.infer<typeof toolCallId>;

export const contentBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text }).strict(),
  z.object({ kind: z.literal('tool_call'), callId: toolCallId, tool: z.string().min(1), input: boundedJson }).strict(),
  z.object({ kind: z.literal('tool_result'), callId: toolCallId, output: boundedJson, isError: z.boolean() }).strict(),
  z.object({ kind: z.literal('structured_output'), schema: z.string().min(1), value: boundedJson }).strict(),
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const storedBlockSchema = z.union([
  contentBlockSchema,
  z.object({ kind: z.literal('unsupported'), storedKind: z.string(), storedVersion: z.number().int() }).strict(),
]);

export type StoredBlock = z.infer<typeof storedBlockSchema>;

export const writeBlocksSchema = z.array(contentBlockSchema).max(64).superRefine((blocks, context) => {
  if (bytes(blocks) > 262_144) context.addIssue({ code: 'custom', message: 'Turn exceeds 256 KB' });
  const calls = new Set(blocks.flatMap((block) => block.kind === 'tool_call' ? [block.callId] : []));

  for (const block of blocks) {
    if (block.kind === 'tool_result' && !calls.has(block.callId)) {
      context.addIssue({ code: 'custom', message: 'A tool result needs a call in the same turn' });
    }
  }
});

export const runFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('execution'), code: z.enum(['internal', 'unclassified_provider_response']) }).strict(),
  z.object({ kind: z.literal('limit'), limit: z.enum(['steps', 'tool_calls', 'model_retries', 'context', 'duration']) }).strict(),
  z.object({ kind: z.literal('provider_refused'), reason: z.enum(['quota', 'policy', 'configuration']) }).strict(),
  z.object({ kind: z.literal('model_output_invalid'), reason: z.enum(['truncated', 'oversized']) }).strict(),
]);

export type RunFailure = z.infer<typeof runFailureSchema>;

const runBase = { id: runId, conversationId, message: text, version: z.number().int().nonnegative(), createdAt: instant };

export const runSchema = z.discriminatedUnion('state', [
  z.object({ ...runBase, state: z.literal('queued') }),
  z.object({ ...runBase, state: z.literal('running'), committedSteps: z.number().int().nonnegative() }),
  z.object({ ...runBase, state: z.literal('completed'), finalTurn: turnId, endedAt: instant }),
  z.object({ ...runBase, state: z.literal('failed'), failure: runFailureSchema, endedAt: instant }),
  z.object({ ...runBase, state: z.literal('canceled'), endedAt: instant }),
]);

export type Run = z.infer<typeof runSchema>;

export const agentTurnSchema = z.object({ id: turnId, runId, step: z.number().int().positive(), blocks: z.array(storedBlockSchema), createdAt: instant });

export type AgentTurn = z.infer<typeof agentTurnSchema>;

export const exchangeSchema = z.object({ run: runSchema, turns: z.array(agentTurnSchema) });

export type Exchange = z.infer<typeof exchangeSchema>;

export const conversationSchema = z.object({ id: conversationId, title: z.string().min(1).max(80), updatedAt: instant });

export type Conversation = z.infer<typeof conversationSchema>;

export const notFoundSchema = z.object({ kind: z.literal('not_found') });

export const sendReceiptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), run: runSchema }),
  z.object({ kind: z.literal('refused'), reason: z.enum(['rate_limited', 'capacity', 'busy']) }),
  z.object({ kind: z.literal('key_conflict') }),
]);

export type SendReceipt = z.infer<typeof sendReceiptSchema>;

export type SendRefusal = Extract<SendReceipt, { kind: 'refused' }>['reason'];

export const conversationPageSchema = z.object({ items: z.array(conversationSchema), next: pageCursor.optional() });

export const readConversationSchema = z.union([
  z.object({ conversation: conversationSchema, exchanges: z.object({ items: z.array(exchangeSchema), next: pageCursor.optional() }) }),
  notFoundSchema,
]);

export type ConversationRead = z.infer<typeof readConversationSchema>;

export const sendMessageInput = z.object({ requestKey, conversationId: conversationId.optional(), text: text.refine((value) => value.trim().length > 0, 'Enter a message') }).strict();

export const conversationPageInput = z.object({ after: pageCursor.optional() }).strict();

export const readConversationInput = z.object({ conversationId, after: pageCursor.optional() }).strict();

export const stopRunInput = z.object({ runId }).strict();

const sdkMessage = z.object({ type: z.literal('message'), role: z.literal('assistant'), content: z.array(z.object({ type: z.literal('output_text'), text: z.string() })) });

const sdkCall = z.object({ type: z.literal('function_call'), callId: toolCallId, name: z.string(), arguments: z.string() });

// WHY: The SDK hands a tool's string result back as a text output item.
const sdkTextOutput = z.object({ type: z.literal('text'), text: z.string() }).transform(({ text }) => text);

const sdkResult = z.object({ type: z.literal('function_call_result'), callId: toolCallId, output: z.union([z.string(), sdkTextOutput, jsonValue]) });

const agentItemSchema = z.union([sdkMessage, sdkCall, sdkResult]);

function parseJson(value: string) {
  try { return { success: true, data: jsonValue.parse(JSON.parse(value)) } as const; }
  catch { return { success: false } as const; }
}

export const blocksFromAgentItems = z.array(agentItemSchema).transform((items) => items.flatMap<ContentBlock>((item) => {
  switch (item.type) {
    case 'message': return item.content.map((part) => ({ kind: 'text', text: part.text }));
    case 'function_call': {
      const parsed = parseJson(item.arguments);

      return [{ kind: 'tool_call', callId: item.callId, tool: item.name, input: parsed.success ? parsed.data : { unparsed: item.arguments } }];
    }

    case 'function_call_result': {
      const parsed = typeof item.output === 'string' ? parseJson(item.output) : { success: true, data: item.output } as const;

      // WHY: Our tools return JSON, so a text result that is not JSON is the SDK's own message for unparsable arguments.
      if (!parsed.success) return [{ kind: 'tool_result', callId: item.callId, output: item.output, isError: true }];
      const output = parsed.data;
      const isError = typeof output === 'object' && output !== null && !Array.isArray(output) && 'error' in output;

      return [{ kind: 'tool_result', callId: item.callId, output, isError }];
    }
  }
})).transform((blocks) => z.array(contentBlockSchema).parse(blocks.map(storableJson)));
