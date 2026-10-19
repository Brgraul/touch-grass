/// <reference types="@cloudflare/vitest-plugin/types" />
import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { z } from 'zod';
import { createTestUser, deleteTestUser, signInTestUser } from '../../../tests/fixtures/test-users';
import { armFailpoint, exportedSpans, outboundOrigins, pendingFailpoints, sql } from '../../../tests/fixtures/integration-harness-client';
import { environmentId, requestKey, userId } from '@/platform/ids';
import { parseEnv } from '@/platform/env.server';
import { createChatRepository } from './agent-chat.repo.server';
import { createChat, sweepRuns } from './agent-chat.service.server';
import { workflowRuns } from './agent-chat.workflow.server';
import { MAX_OUTPUT_TOKENS, MODEL_CALL_RETRIES } from './agent-chat.model';
import type { Run, RunFailure } from './agent-chat.schema';

type Introspector = Awaited<ReturnType<typeof introspectWorkflowInstance>>;

const runs = workflowRuns(env.AGENT_CHAT_WORKFLOW);

const users: Awaited<ReturnType<typeof createTestUser>>[] = [];

const introspectors: Introspector[] = [];

const limits = { maxSteps: 8, maxToolCallsPerStep: 4, messagesPerHour: 60, activePerUser: 2, activePerEnvironment: 10, runDurationSeconds: 900 };

const recordedRequest = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() }).passthrough()) }).passthrough();

async function context() {
  const user = await createTestUser();
  users.push(user);
  const client = await signInTestUser(user);
  const actor = { userId: userId.parse(user.id), environmentId: environmentId.parse(env.ENVIRONMENT_ID) };

  return { actor, client, repo: createChatRepository(env), chat: createChat(env, runs, client) };
}

type Context = Awaited<ReturnType<typeof context>>;

async function submit(ctx: Context, text: string, policy = limits, conversationId?: Run['conversationId']) {
  const receipt = await ctx.repo.submit(ctx.actor, { requestKey: requestKey.parse(crypto.randomUUID()), text, conversationId }, policy);

  if (receipt.kind !== 'accepted') throw new Error(`Run not admitted: ${receipt.kind}`);

  return receipt.run;
}

async function observe(id: string, options: { retryDelays: boolean } = { retryDelays: false }) {
  const introspector = await introspectWorkflowInstance(env.AGENT_CHAT_WORKFLOW, id);
  introspectors.push(introspector);

  if (!options.retryDelays) await introspector.modify(async (modifier) => { await modifier.disableRetryDelays(); });

  return introspector;
}

async function read(ctx: Context, run: Run) {
  const result = await ctx.repo.read(ctx.client, run.conversationId);

  if ('kind' in result) throw new Error('Conversation not found');
  const exchange = result.exchanges.items.find((item) => item.run.id === run.id);

  if (!exchange) throw new Error('Run not found');

  return exchange;
}

async function requestsFor(marker: string) {
  const response = await fetch('http://127.0.0.1:4010/requests');

  return z.array(recordedRequest).parse(await response.json()).filter((item) => JSON.stringify(item).includes(marker));
}

afterEach(async () => {
  for (const introspector of introspectors.splice(0)) await introspector.dispose();

  for (const user of users.splice(0)) await deleteTestUser(user);
});

describe('a run on the real Workflow binding, database and provider double', () => {
  it('replays a finished run from its saved steps without resending a model call or adding a turn', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    const finished = await read(ctx, run);

    await (await env.AGENT_CHAT_WORKFLOW.get(run.id)).restart({ from: { name: 'commit-2' } });
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toEqual(finished);
    expect(finished.turns.map((turn) => turn.step)).toEqual([1, 2]);
    expect(await requestsFor(marker)).toHaveLength(2);
  });

  it('resumes a run whose execution was replaced mid-step, as a deploy does, from its saved steps', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStepResult({ name: 'commit-1' });
    await expect.poll(async () => (await requestsFor(marker)).length).toBe(2);

    await (await env.AGENT_CHAT_WORKFLOW.get(run.id)).restart({ from: { name: 'model-2' } });
    await instance.waitForStatus('complete');
    const completed = await read(ctx, run);
    expect(completed.run.state).toBe('completed');
    expect(completed.turns.map((turn) => turn.step)).toEqual([1, 2]);
    const requests = await requestsFor(marker);
    expect(requests.map((request) => request.messages.at(-1)?.role)).toEqual(['user', 'tool', 'tool']);
  });

  it('commits each step, replays after a pause without resending a saved model call, and completes once', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStepResult({ name: 'commit-1' });
    const progress = await read(ctx, run);
    expect(progress.run).toMatchObject({ state: 'running', committedSteps: 1 });
    expect(progress.turns.map((turn) => turn.blocks)).toEqual([[
      { kind: 'tool_call', callId: expect.any(String), tool: 'calculate', input: { expression: '6 * 7' } },
      { kind: 'tool_result', callId: expect.any(String), output: { value: 42 }, isError: false },
    ]]);

    const handle = await env.AGENT_CHAT_WORKFLOW.get(run.id);
    await handle.pause();
    await instance.waitForStatus('paused');
    await handle.resume();
    await instance.waitForStatus('complete');

    const completed = await read(ctx, run);
    expect(completed.turns.map((turn) => turn.step)).toEqual([1, 2]);
    expect(completed.turns[1]?.blocks).toEqual([{ kind: 'text', text: 'The answer is 42.' }]);
    expect(completed.run).toMatchObject({ state: 'completed', finalTurn: completed.turns[1]?.id });
    const requests = await requestsFor(marker);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain('42');
  });

  it('repeats a commit step whose reply was lost after it committed and keeps one turn per step', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    await armFailpoint({ rpc: 'commit_step', runId: run.id, action: 'lose_response', times: 1 });
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await pendingFailpoints()).toEqual([]);
    const completed = await read(ctx, run);
    expect(completed.run.state).toBe('completed');
    expect(completed.turns.map((turn) => turn.step)).toEqual([1, 2]);
    expect(await requestsFor(marker)).toHaveLength(2);
  });

  it('reuses one admission when requests race and rejects changed input under the key', async () => {
    const ctx = await context();
    const input = { requestKey: requestKey.parse(crypto.randomUUID()), text: 'Same deliberate submission' };
    const [first, second] = await Promise.all([ctx.repo.submit(ctx.actor, input, limits), ctx.repo.submit(ctx.actor, input, limits)]);

    if (first.kind !== 'accepted' || second.kind !== 'accepted') throw new Error('Admission failed');
    expect(first.run.id).toBe(second.run.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(await ctx.repo.submit(ctx.actor, { ...input, text: 'Changed submission' }, limits)).toEqual({ kind: 'key_conflict' });
  });

  it('cancels a model call in flight, ends the instance and writes no turn after the cancellation', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[delay] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await expect.poll(async () => (await requestsFor(marker)).length).toBe(1);
    expect(await ctx.chat.cancel(ctx.actor, run.id)).toMatchObject({ state: 'canceled' });
    await instance.waitForStatus('terminated');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'canceled' }, turns: [] });
    expect(await ctx.repo.commit(run.id, 1, [{ kind: 'text', text: 'Late response' }], true, { inputTokens: 0, outputTokens: 0 })).toEqual({ kind: 'ended' });
    expect((await read(ctx, run)).turns).toEqual([]);
  });

  it('ends the loop at the next commit when termination fails after a cancellation', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[delay] ${marker}`);
    const instance = await observe(run.id);
    const terminationFails = createChat(env, { start: runs.start, terminate: async () => { throw new Error('Termination lost'); } }, ctx.client);
    await runs.start(run.id);
    await expect.poll(async () => (await requestsFor(marker)).length).toBe(1);
    expect(await terminationFails.cancel(ctx.actor, run.id)).toMatchObject({ state: 'canceled' });
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'canceled' }, turns: [] });
  });

  it.each<[string, RunFailure, number, number]>([
    ['quota', { kind: 'provider_refused', reason: 'quota' }, 1, 0],
    ['context', { kind: 'limit', limit: 'context' }, 1, 0],
    ['policy', { kind: 'provider_refused', reason: 'policy' }, 1, 0],
    ['policy-output', { kind: 'provider_refused', reason: 'policy' }, 1, 0],
    ['configuration', { kind: 'provider_refused', reason: 'configuration' }, 1, 0],
    ['unknown', { kind: 'execution', code: 'unclassified_provider_response' }, 1, 0],
    ['malformed', { kind: 'execution', code: 'unclassified_provider_response' }, 1, 0],
    ['truncated', { kind: 'model_output_invalid', reason: 'truncated' }, 1, 0],
    ['truncated-empty', { kind: 'model_output_invalid', reason: 'truncated' }, 1, 0],
    ['oversized', { kind: 'model_output_invalid', reason: 'oversized' }, 1, 0],
    ['too_many_tools', { kind: 'limit', limit: 'tool_calls' }, 1, 0],
    ['retryable', { kind: 'limit', limit: 'model_retries' }, MODEL_CALL_RETRIES + 1, 0],
    ['steps', { kind: 'limit', limit: 'steps' }, 2, 2],
    ['behavior', { kind: 'execution', code: 'internal' }, 1, 0],
  ])('fails a [%s] run with its failure after the bounded provider requests', async (scenario, failure, requests, turns) => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[${scenario}] ${marker}`, { ...limits, maxSteps: 2 });
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    const exchange = await read(ctx, run);
    expect(exchange.run).toMatchObject({ state: 'failed', failure });
    expect(exchange.turns).toHaveLength(turns);
    expect(await requestsFor(marker)).toHaveLength(requests);
  });

  it('retries one transient provider failure and sends exactly one extra request', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[transient] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect((await read(ctx, run)).run.state).toBe('completed');
    expect(await requestsFor(marker)).toHaveLength(2);
  });

  it('caps every model call with max_completion_tokens, which reasoning models accept, and never sends max_tokens', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    const requests = await requestsFor(marker);
    expect(requests).toHaveLength(2);

    for (const request of requests) {
      expect(request).toMatchObject({ max_completion_tokens: MAX_OUTPUT_TOKENS });
      expect(request).not.toHaveProperty('max_tokens');
    }
  });

  it('stores model text holding NUL and a lone surrogate with replacement characters and completes', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[unstorable-output] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'completed' }, turns: [{ blocks: [{ kind: 'text', text: 'nul \uFFFD lone \uFFFD end' }] }] });
    expect(await requestsFor(marker)).toHaveLength(1);
  });

  it('retries a model call whose connection drops mid-response and sends exactly one extra request', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[connection-lost] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'completed' }, turns: [{ blocks: [{ kind: 'text', text: 'Ready to help.' }] }] });
    expect(await requestsFor(marker)).toHaveLength(2);
  });

  it('fails with model_retries when every connection drops mid-response', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[connection-lost-always] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'failed', failure: { kind: 'limit', limit: 'model_retries' } }, turns: [] });
    expect(await requestsFor(marker)).toHaveLength(MODEL_CALL_RETRIES + 1);
  });

  it('retries a model step that times out', async () => {
    const ctx = await context();
    const run = await submit(ctx, 'Hello after a step timeout');
    const instance = await observe(run.id);
    await instance.modify(async (modifier) => { await modifier.forceStepTimeout({ name: 'model-1' }, 1); });
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect((await read(ctx, run)).run.state).toBe('completed');
  });

  it('fails with model_retries when every attempt of a model step times out', async () => {
    const ctx = await context();
    const run = await submit(ctx, 'Hello while every step times out');
    const instance = await observe(run.id);
    await instance.modify(async (modifier) => { await modifier.forceStepTimeout({ name: 'model-1' }); });
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect((await read(ctx, run)).run).toMatchObject({ state: 'failed', failure: { kind: 'limit', limit: 'model_retries' } });
  });

  it.each([
    ['unknown-tool', { kind: 'tool_call', tool: 'missing_tool', input: {} }],
    ['bad-arguments', { kind: 'tool_call', tool: 'calculate', input: { unparsed: '{"expression": "6 *' } }],
    ['invalid-arguments', { kind: 'tool_call', tool: 'calculate', input: { expression: 42 } }],
    ['throwing-tool', { kind: 'tool_call', tool: 'calculate', input: { expression: '1 / 0' } }],
  ])('returns a [%s] tool failure to the model as a tool error and continues', async (scenario, call) => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[${scenario}] ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    const exchange = await read(ctx, run);
    expect(exchange.run.state).toBe('completed');
    expect(exchange.turns.map((turn) => turn.blocks)).toEqual([
      [expect.objectContaining(call), expect.objectContaining({ kind: 'tool_result', isError: true })],
      [{ kind: 'text', text: 'The tool reported an error.' }],
    ]);
    const toolMessage = (await requestsFor(marker))[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({ role: 'tool' });
    expect(String(toolMessage?.content)).toMatch(/error/iu);
  });

  it('fails with duration when the deadline passes during a model call', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[delay] ${marker}`, { ...limits, runDurationSeconds: 1 });
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'failed', failure: { kind: 'limit', limit: 'duration' } }, turns: [] });
    expect(await requestsFor(marker)).toHaveLength(1);
  });

  it('fails with duration when the deadline passes during a retry backoff', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `[transient] ${marker}`, { ...limits, runDurationSeconds: 2 });
    const instance = await observe(run.id, { retryDelays: true });
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'failed', failure: { kind: 'limit', limit: 'duration' } }, turns: [] });
    expect(await requestsFor(marker)).toHaveLength(2);
  });

  it('fails once with an internal failure when the database answers a commit with a malformed row', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    await armFailpoint({ rpc: 'commit_step', runId: run.id, action: 'malformed_response', times: 6 });
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    expect(await read(ctx, run)).toMatchObject({ run: { state: 'failed', failure: { kind: 'execution', code: 'internal' } }, turns: [] });
    expect(await pendingFailpoints()).toEqual([]);
    expect(await requestsFor(marker)).toHaveLength(1);

    await armFailpoint({ rpc: 'start_run', runId: run.id, action: 'malformed_response', times: 1 });
    await expect(ctx.repo.start(run.id, { maxRuns: 20, maxBytes: 524_288 })).rejects.toThrow('Database returned an unexpected row: kind');
  });

  it('rejects a malformed Workflow payload before touching any run', async () => {
    const id = crypto.randomUUID();
    const instance = await observe(id);
    await env.AGENT_CHAT_WORKFLOW.create({ id, params: { runId: 'not-a-run-id' } });
    await instance.waitForStatus('errored');
    expect(await instance.getError()).toMatchObject({ message: expect.stringContaining('Invalid Workflow payload: runId') });
  });

  it('rejects a malformed environment with the variable name', () => {
    expect(() => parseEnv({ ...env, LLM_BASE_URL: 'not a url' })).toThrow('Invalid environment variables: LLM_BASE_URL');
  });

  it('treats a second start of the same run as success and surfaces any other create failure', async () => {
    const ctx = await context();
    const run = await submit(ctx, 'Start me twice');
    const instance = await observe(run.id);
    await runs.start(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');
    const unavailable = workflowRuns({ get: env.AGENT_CHAT_WORKFLOW.get.bind(env.AGENT_CHAT_WORKFLOW), create: async () => { throw new Error('Workflows unavailable'); } });
    await expect(unavailable.start(run.id)).rejects.toThrow('Workflows unavailable');
  });

  it('reads an unknown stored block as unsupported and sends it to the model as a placeholder', async () => {
    const ctx = await context();
    const earlier = await submit(ctx, 'Earlier message');
    const earlierInstance = await observe(earlier.id);
    await runs.start(earlier.id);
    await earlierInstance.waitForStatus('complete');
    await sql(`update agent_chat.turns set blocks = '[{"kind":"future_kind","payload":1}]' where run_id = $1`, [earlier.id]);
    expect((await read(ctx, earlier)).turns[0]?.blocks).toEqual([{ kind: 'unsupported', storedKind: 'future_kind', storedVersion: 1 }]);
    await sql(`update agent_chat.turns set blocks = '[{"kind":"text","text":"from a later schema"}]', block_schema_version = 2 where run_id = $1`, [earlier.id]);
    expect((await read(ctx, earlier)).turns[0]?.blocks).toEqual([{ kind: 'unsupported', storedKind: 'text', storedVersion: 2 }]);

    const marker = crypto.randomUUID();
    const next = await submit(ctx, `Follow up ${marker}`, limits, earlier.conversationId);
    const instance = await observe(next.id);
    await runs.start(next.id);
    await instance.waitForStatus('complete');
    const [request] = await requestsFor(marker);
    expect(request?.messages.slice(1)).toMatchObject([
      { role: 'user', content: 'Earlier message' },
      { role: 'assistant', content: [{ type: 'text', text: '[unsupported block]' }] },
      { role: 'user', content: `Follow up ${marker}` },
    ]);
  });

  it('the sweep starts a run whose dispatch was lost and fails runs past the deadline grace', async () => {
    const ctx = await context();
    const lostDispatch = createChat(env, { start: async () => { throw new Error('Dispatch response lost'); }, terminate: runs.terminate }, ctx.client);
    const receipt = await lostDispatch.send(ctx.actor, { requestKey: requestKey.parse(crypto.randomUUID()), text: 'Recover dispatch' });

    if (receipt.kind !== 'accepted') throw new Error('Run was not admitted');
    await sql("update agent_chat.runs set created_at = now() - interval '2 minutes' where id = $1", [receipt.run.id]);
    const instance = await observe(receipt.run.id);
    await sweepRuns(env, runs);
    await instance.waitForStatus('complete');
    expect((await read(ctx, receipt.run)).run.state).toBe('completed');

    const neverStarted = await submit(ctx, 'Abandoned before dispatch');
    await sql("update agent_chat.runs set deadline = now() - interval '6 minutes' where id = $1", [neverStarted.id]);
    await sweepRuns(env, runs);
    expect((await read(ctx, neverStarted)).run).toMatchObject({ state: 'failed', failure: { kind: 'limit', limit: 'duration' } });
  });

  it('the sweep fails a running run whose instance errored outside its loop', async () => {
    const ctx = await context();
    const run = await submit(ctx, 'Lose the start reply');
    await armFailpoint({ rpc: 'start_run', runId: run.id, action: 'lose_response', times: 6 });
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('errored');
    expect((await read(ctx, run)).run.state).toBe('running');
    await sql("update agent_chat.runs set deadline = now() - interval '6 minutes' where id = $1", [run.id]);
    await sweepRuns(env, runs);
    expect((await read(ctx, run)).run).toMatchObject({ state: 'failed', failure: { kind: 'limit', limit: 'duration' } });
  });

  it('sends nothing beyond the loopback stack and the Langfuse double, so no SDK trace export leaves the Worker', async () => {
    const origins = await outboundOrigins();
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.filter((origin) => new URL(origin).hostname !== '127.0.0.1')).toEqual([]);
  });
});

describe('the Langfuse trace of a run', () => {
  const traceIdOf = (run: Run) => run.id.replaceAll('-', '');

  it('holds one generation per provider call and one run span, keyed by the run ID, and a replay adds no generation', async () => {
    const ctx = await context();
    const marker = crypto.randomUUID();
    const run = await submit(ctx, `calculate 6 * 7 ${marker}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');

    const spans = await exportedSpans(traceIdOf(run));
    expect(spans.map((span) => [span.name, span.attributes['langfuse.observation.type']])).toEqual([
      ['model-1', 'generation'], ['model-2', 'generation'], ['run', 'agent'],
    ]);
    expect(new Set(spans.map((span) => span.attributes['langfuse.user.id']))).toEqual(new Set([ctx.actor.userId]));
    expect(new Set(spans.map((span) => span.attributes['langfuse.trace.name']))).toEqual(new Set(['agent-chat']));
    expect(new Set(spans.map((span) => span.attributes['langfuse.session.id']))).toEqual(new Set([run.conversationId]));
    expect(spans[0]?.authorization).toBe(`Basic ${btoa('pk-lf-test:sk-lf-test')}`);
    expect(spans[0]?.attributes).toMatchObject({ 'langfuse.observation.model.name': env.LLM_MODEL, 'langfuse.observation.usage_details': expect.stringMatching(/"input":\d+,"output":\d+/u) });
    expect(spans[1]?.attributes['langfuse.observation.input']).toContain('42');
    expect(JSON.parse(spans[2]?.attributes['langfuse.observation.output'] ?? '')).toEqual({ outcome: 'completed', steps: 2 });
    expect(spans.some((span) => span.error)).toBe(false);

    await (await env.AGENT_CHAT_WORKFLOW.get(run.id)).restart({ from: { name: 'commit-2' } });
    await instance.waitForStatus('complete');
    const replayed = await exportedSpans(traceIdOf(run));
    expect(replayed.filter((span) => span.name.startsWith('model-'))).toHaveLength(2);
    expect(new Set(replayed.filter((span) => span.name === 'run').map((span) => span.spanId)).size).toBe(1);
  });

  it('records a failed provider attempt as an error generation before the retry that succeeds', async () => {
    const ctx = await context();
    const run = await submit(ctx, `[transient] ${crypto.randomUUID()}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');

    const spans = await exportedSpans(traceIdOf(run));
    expect(spans.map((span) => [span.name, span.attributes['langfuse.observation.level'] ?? 'DEFAULT'])).toEqual([
      ['model-1', 'ERROR'], ['model-1', 'DEFAULT'], ['run', 'DEFAULT'],
    ]);
  });

  it('closes a failed run with its saved failure', async () => {
    const ctx = await context();
    const run = await submit(ctx, `[quota] ${crypto.randomUUID()}`);
    const instance = await observe(run.id);
    await runs.start(run.id);
    await instance.waitForStatus('complete');

    const spans = await exportedSpans(traceIdOf(run));
    expect(spans.map((span) => span.name)).toEqual(['model-1', 'run']);
    expect(spans.map((span) => span.attributes['langfuse.session.id'])).toEqual([run.conversationId, run.conversationId]);
    expect(spans.map((span) => span.error && JSON.parse(span.error))).toEqual([
      { kind: 'provider_refused', reason: 'quota' }, { kind: 'provider_refused', reason: 'quota' },
    ]);
  });
});
