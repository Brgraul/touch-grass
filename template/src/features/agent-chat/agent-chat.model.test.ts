import { describe, expect, it } from 'vitest';
import { Agent, ModelBehaviorError, Runner, Usage, setTraceProcessors, setTracingDisabled, type AgentInputItem, type AgentOutputItem, type Model, type ModelRequest, type ModelResponse, type StreamEvent, type TracingProcessor } from '@openai/agents';
import { conversationId, instant, runId, userId } from '@/platform/ids';
import { TRACE_EXPORT_TIMEOUT } from '@/platform/telemetry.server';
import { CHAT_AGENT, CHAT_RUN_CONFIG } from './agent-chat.agent';
import {
  BLOCK_SCHEMA_VERSION, blocksFromAgentItems, exchangeSchema, sendMessageInput, writeBlocksSchema,
} from './agent-chat.schema';
import { evaluate, pureTool } from './agent-chat.tools';
import { z } from 'zod';
import {
  DISPATCH_CHECK_DELAY, MAX_HISTORY_BYTES, MAX_HISTORY_RUNS, MAX_STEPS, MODEL_CALL_TIMEOUT,
  MODEL_STEP_TIMEOUT, RUN_DURATION, WORKFLOW_STEP_LIMIT, RunEnded, RunFailed,
  checkBeforeCall, checkResponse, classifyModelError, failureFromRunError, toAgentInput, turnBlocks,
  type RunInput, type SavedModelResponse,
} from './agent-chat.model';

const id = '00000000-0000-4000-8000-000000000001';

const now = instant.parse('2026-10-17T12:00:00Z');

const runInput: RunInput = {
  runId: runId.parse(id), ownerId: userId.parse(id), conversationId: conversationId.parse(id), message: 'Calculate 6 * 7', history: [],
  policy: { maxSteps: 8, maxToolCallsPerStep: 4 }, deadline: instant.parse('2026-10-17T12:15:00Z'),
};

const call = (name = 'calculate', argumentsText = '{"expression":"6 * 7"}'): AgentOutputItem => ({ type: 'function_call', name, callId: 'call-1', arguments: argumentsText, status: 'completed' });

const final = (): AgentOutputItem => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The answer is 42.' }] });

const saved = (output: AgentOutputItem[]): SavedModelResponse => ({ output, usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop' });

class ScriptedModel implements Model {
  readonly inputs: ModelRequest['input'][] = [];
  constructor(private readonly responses: AgentOutputItem[][]) {}
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.inputs.push(request.input);
    const output = this.responses.shift();

    if (!output) throw new Error('Unexpected model request');

    return { output, usage: new Usage({ inputTokens: 10, outputTokens: 5, requests: 1 }) };
  }
  getStreamedResponse(): AsyncIterable<StreamEvent> { throw new Error('Not streaming'); }
}

describe('run policy', () => {
  it('fits the platform and timeout budgets', () => {
    expect(MODEL_STEP_TIMEOUT).toBeGreaterThan(MODEL_CALL_TIMEOUT + TRACE_EXPORT_TIMEOUT);
    expect(DISPATCH_CHECK_DELAY).toBeLessThan(RUN_DURATION);
    expect(2 * MAX_STEPS + 2).toBeLessThanOrEqual(WORKFLOW_STEP_LIMIT);
    expect(MAX_HISTORY_BYTES).toBeLessThan(1_048_576);
    expect(BLOCK_SCHEMA_VERSION).toBe(1);
  });

  it('stops exactly at the deadline and after the snapshotted step limit', () => {
    expect(checkBeforeCall(runInput, 8, now)).toBeUndefined();
    expect(checkBeforeCall(runInput, 9, now)).toEqual({ kind: 'limit', limit: 'steps' });
    expect(checkBeforeCall(runInput, 1, runInput.deadline)).toEqual({ kind: 'limit', limit: 'duration' });
  });

  it('rejects truncation, excessive calls and oversized text before a commit', () => {
    expect(checkResponse({ ...saved([final()]), finishReason: 'length' }, runInput.policy)).toEqual({ kind: 'model_output_invalid', reason: 'truncated' });
    expect(checkResponse(saved(Array.from({ length: 5 }, () => call())), runInput.policy)).toEqual({ kind: 'limit', limit: 'tool_calls' });
    const oversized: AgentOutputItem = { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'x'.repeat(32_769) }] };
    expect(checkResponse(saved([oversized]), runInput.policy)).toEqual({ kind: 'model_output_invalid', reason: 'oversized' });
  });

  it('classifies cancellation, explicit failure, SDK errors and provider outcomes', () => {
    expect(failureFromRunError(new RunEnded())).toBeUndefined();
    expect(failureFromRunError(new RunFailed({ kind: 'limit', limit: 'steps' }))).toEqual({ kind: 'limit', limit: 'steps' });
    expect(failureFromRunError(new ModelBehaviorError('Invalid model output'))).toEqual({ kind: 'execution', code: 'internal' });
    expect(classifyModelError('retryable')).toBe('retry');
    expect(classifyModelError('context_length')).toEqual({ kind: 'limit', limit: 'context' });
    expect(classifyModelError('quota')).toEqual({ kind: 'provider_refused', reason: 'quota' });
    expect(classifyModelError('unknown')).toEqual({ kind: 'execution', code: 'unclassified_provider_response' });
  });
});

describe('write boundaries', () => {
  it('counts UTF-8 bytes and accepts only a plain text message', () => {
    expect(sendMessageInput.safeParse({ requestKey: id, text: '🙂'.repeat(8_192) }).success).toBe(true);
    expect(sendMessageInput.safeParse({ requestKey: id, text: '🙂'.repeat(8_193) }).success).toBe(false);
    expect(sendMessageInput.safeParse({ requestKey: id, text: { kind: 'tool_call' } }).success).toBe(false);
    expect(sendMessageInput.safeParse({ requestKey: id, text: 'hello', ownerId: id }).success).toBe(false);
  });

  it('rejects a message the database cannot store', () => {
    expect(sendMessageInput.safeParse({ requestKey: id, text: 'before\u0000after' }).success).toBe(false);
    expect(sendMessageInput.safeParse({ requestKey: id, text: 'before\uD800after' }).success).toBe(false);
    expect(sendMessageInput.safeParse({ requestKey: id, text: 'before\uDC00after' }).success).toBe(false);
    expect(writeBlocksSchema.safeParse([{ kind: 'text', text: 'before\u0000after' }]).success).toBe(false);
    expect(writeBlocksSchema.safeParse([{ kind: 'structured_output', schema: 'answer', value: { 'key\u0000': 1 } }]).success).toBe(false);
  });

  it('stores model output the database cannot hold as replacement characters, the same way on every replay', () => {
    const output: AgentOutputItem[] = [
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'nul \u0000 lone \uD800 pair 🙂' }] },
      call('calculate', '{"expression":"6 * 7\\u0000"}'),
    ];

    const response = saved(output);

    const expected = [
      { kind: 'text', text: 'nul � lone � pair 🙂' },
      { kind: 'tool_call', callId: 'call-1', tool: 'calculate', input: { expression: '6 * 7�' } },
    ];

    expect(turnBlocks(response)).toEqual(expected);
    expect(turnBlocks(structuredClone(response))).toEqual(expected);
    expect(writeBlocksSchema.safeParse(expected).success).toBe(true);
    expect(checkResponse(response, runInput.policy)).toBeUndefined();
  });

  it('keeps invalid JSON arguments visible and pairs results in the same turn', () => {
    const response = saved([call('calculate', '{bad json')]);
    const blocks = turnBlocks(response, [{ type: 'function_call_result', name: 'calculate', callId: 'call-1', status: 'completed', output: '{"error":"invalid arguments"}' }]);
    expect(blocks).toEqual([
      { kind: 'tool_call', callId: 'call-1', tool: 'calculate', input: { unparsed: '{bad json' } },
      { kind: 'tool_result', callId: 'call-1', output: { error: 'invalid arguments' }, isError: true },
    ]);
    expect(writeBlocksSchema.safeParse([{ kind: 'tool_result', callId: 'missing', output: 42, isError: false }]).success).toBe(false);
    expect(writeBlocksSchema.safeParse([{ kind: 'unsupported', storedKind: 'future', storedVersion: 2 }]).success).toBe(false);
    expect(blocksFromAgentItems.parse([call('calculate', 'null')])[0]).toMatchObject({ input: null });
  });
});

describe('history', () => {
  const completed = (message: string, blocks: unknown[] = [{ kind: 'text', text: 'previous answer' }]) => exchangeSchema.parse({
    run: { id, conversationId: id, message, version: 3, createdAt: now, state: 'completed', finalTurn: id, endedAt: now },
    turns: [{ id, runId: id, step: 1, blocks, createdAt: now }],
  });

  it('includes only completed runs and keeps the newest bounded history', () => {
    const history = Array.from({ length: 25 }, (_, index) => completed(`message-${index}`));
    const failed = exchangeSchema.parse({ run: { id, conversationId: id, message: 'failed-secret', version: 2, createdAt: now, state: 'failed', failure: { kind: 'execution', code: 'internal' }, endedAt: now }, turns: [] });
    const input = toAgentInput([...history, failed], 'new message');
    const wire = JSON.stringify(input);
    expect(input.filter((item) => 'role' in item && item.role === 'user')).toHaveLength(MAX_HISTORY_RUNS + 1);
    expect(wire).not.toContain('message-4"');
    expect(wire).not.toContain('failed-secret');
    expect(wire).toContain('message-24');
    expect(input.at(-1)).toEqual({ role: 'user', content: 'new message' });
  });

  it('drops oversized oldest history and renders unknown stored data as text', () => {
    const large = completed('x'.repeat(32_768), Array.from({ length: 20 }, () => ({ kind: 'text', text: 'x'.repeat(32_768) })));
    const future = completed('recent', [{ kind: 'unsupported', storedKind: 'future', storedVersion: 10 }]);
    const input = toAgentInput([large, future], 'hello');
    expect(JSON.stringify(input)).toContain('[unsupported block]');
    expect(JSON.stringify(input)).not.toContain('x'.repeat(100));
  });
});

describe('calculator', () => {
  it.each([['6 * 7', 42], ['(2 + 3) * 4 - 1 / 2', 19.5], ['-.5 + +2', 1.5], ['2 * (3 + (4 / 2))', 10]])('evaluates %s', (expression, result) => {
    expect(evaluate(expression)).toBe(result);
  });
  it.each(['process.exit()', '1 / 0', '1 +', '(1', '1 2', '2 ** 4', '('.repeat(65) + '1' + ')'.repeat(65)])('rejects %s', (expression) => {
    expect(() => evaluate(expression)).toThrow();
  });
});

describe('the real Agents SDK loop', () => {
  const run = async (model: ScriptedModel, agent = CHAT_AGENT) => new Runner({ ...CHAT_RUN_CONFIG, model }).run(agent, 'Calculate 6 * 7', { maxTurns: 3 });

  const nextInput = (model: ScriptedModel): AgentInputItem[] => {
    const input = model.inputs[1];

    if (!Array.isArray(input)) throw new Error('The second model call received no item input');

    return input;
  };

  it('executes calculate and rebuilds the identical model input on replay', async () => {
    const first = new ScriptedModel([[call()], [final()]]);
    const replay = new ScriptedModel([[call()], [final()]]);
    expect((await run(first)).finalOutput).toBe('The answer is 42.');
    await run(replay);
    expect(replay.inputs).toEqual(first.inputs);
    expect(turnBlocks(saved([call()]), nextInput(first))).toEqual([
      { kind: 'tool_call', callId: 'call-1', tool: 'calculate', input: { expression: '6 * 7' } },
      { kind: 'tool_result', callId: 'call-1', output: { value: 42 }, isError: false },
    ]);
  });

  it('emits no trace or span with the chat run configuration', async () => {
    const events: string[] = [];

    const recorder: TracingProcessor = {
      async onTraceStart() { events.push('trace'); },
      async onTraceEnd() { events.push('trace'); },
      async onSpanStart() { events.push('span'); },
      async onSpanEnd() { events.push('span'); },
      async shutdown() {},
      async forceFlush() {},
    };

    setTraceProcessors([recorder]);
    setTracingDisabled(false);

    try {
      await new Runner({ ...CHAT_RUN_CONFIG, tracingDisabled: false, model: new ScriptedModel([[call()], [final()]]) }).run(CHAT_AGENT, 'Calculate 6 * 7');
      expect(events.length).toBeGreaterThan(0);
      events.length = 0;
      await run(new ScriptedModel([[call()], [final()]]));
      expect(events).toEqual([]);
    } finally {
      setTracingDisabled(true);
      setTraceProcessors([]);
    }
  });

  it.each([
    ['unknown', '{}'],
    ['calculate', '{bad json'],
    ['calculate', '{"expression":42}'],
    ['calculate', '{"expression":"1/0"}'],
  ])('returns a model-visible error for %s with %s', async (name, args) => {
    const model = new ScriptedModel([[call(name, args)], [final()]]);
    await run(model);
    expect(turnBlocks(saved([call(name, args)]), nextInput(model)).at(-1)).toMatchObject({ kind: 'tool_result', isError: true });
  });

  it('returns a model-visible error for an oversized pure tool result', async () => {
    const huge = pureTool({ name: 'huge', description: 'Test the tool output boundary', parameters: z.object({}), run: () => 'x'.repeat(16_385) });
    const agent = new Agent({ name: 'test', tools: [huge] });
    const model = new ScriptedModel([[call('huge', '{}')], [final()]]);
    await run(model, agent);
    expect(turnBlocks(saved([call('huge', '{}')]), nextInput(model)).at(-1)).toMatchObject({ kind: 'tool_result', isError: true });
    expect(JSON.stringify(nextInput(model))).not.toContain('x'.repeat(100));
  });
});
