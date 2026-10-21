import { z } from 'zod';
import { NoopTrace, withTrace, type ModelRequest, type ModelResponse } from '@openai/agents';
import type { Actor, ConversationId, Instant, NotFound, Page, PageCursor, RunId } from '@/platform/ids';
import { parseEnv } from '@/platform/env.server';
import { logError } from '@/platform/logger.server';
import { classifyProviderError, createModelProvider, isTruncatedModelError, modelResponseMetadata } from '@/platform/model.server';
import type { RequestClient } from '@/platform/supabase.server';
import { createTracer, type Trace } from '@/platform/telemetry.server';
import { createChatRepository } from './agent-chat.repo.server';
import type { ContentBlock, Conversation, ConversationRead, Run, RunFailure, SendReceipt } from './agent-chat.schema';
import {
  ACTIVE_RUNS_PER_ENVIRONMENT, ACTIVE_RUNS_PER_USER, DISPATCH_CHECK_DELAY,
  END_CHECK_GRACE, MAX_HISTORY_BYTES, MAX_HISTORY_RUNS, MAX_STEPS,
  MAX_TOOL_CALLS_PER_STEP, MESSAGES_PER_USER_PER_HOUR, MODEL_CALL_TIMEOUT,
  RUN_DURATION, classifyModelError, type ModelOutcome, type RunInput,
} from './agent-chat.model';
import { sendMessageInput } from './agent-chat.schema';

export type WorkflowRuns = { start(runId: RunId): Promise<void>; terminate(runId: RunId): Promise<void> };

export interface Chat {
  send(actor: Actor, input: z.infer<typeof sendMessageInput>): Promise<SendReceipt | NotFound>;
  listConversations(actor: Actor, page: { after?: PageCursor }): Promise<Page<Conversation>>;
  readConversation(actor: Actor, id: ConversationId, page: { after?: PageCursor }): Promise<ConversationRead>;
  cancel(actor: Actor, runId: RunId): Promise<Run | NotFound>;
}

const itemStatus = z.enum(['completed', 'incomplete', 'in_progress']);

const savedOutput = z.array(z.union([
  z.object({ type: z.literal('message'), role: z.literal('assistant'), status: itemStatus, content: z.array(z.object({ type: z.literal('output_text'), text: z.string() })) }),
  z.object({ type: z.literal('function_call'), callId: z.string(), name: z.string(), arguments: z.string(), status: itemStatus.optional() }),
  z.object({ type: z.literal('reasoning'), content: z.array(z.object({ type: z.literal('input_text'), text: z.string() })), rawContent: z.array(z.object({ type: z.literal('reasoning_text'), text: z.string() })).optional() }),
]));

const savedUsage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });

const unclassified: ModelOutcome = { kind: 'terminal', failure: { kind: 'execution', code: 'unclassified_provider_response' } };

export type StartedRun = { input: RunInput; now: Instant };

type Attempt = ModelOutcome | { kind: 'retry' };

const traceOf = (input: RunInput): Trace => ({ id: input.runId, name: 'agent-chat', userId: input.ownerId, sessionId: input.conversationId });

export function createChat(source: unknown, workflows: WorkflowRuns, request: RequestClient): Chat {
  const repo = createChatRepository(source);

  return {
    async send(actor, input) {
      const receipt = await repo.submit(actor, input, {
        maxSteps: MAX_STEPS,
        maxToolCallsPerStep: MAX_TOOL_CALLS_PER_STEP,
        messagesPerHour: MESSAGES_PER_USER_PER_HOUR,
        activePerUser: ACTIVE_RUNS_PER_USER,
        activePerEnvironment: ACTIVE_RUNS_PER_ENVIRONMENT,
        runDurationSeconds: RUN_DURATION,
      });

      if (receipt.kind !== 'accepted') return receipt;

      if (receipt.created) {
        try {
          await workflows.start(receipt.run.id);
        } catch {
          logError('workflow_dispatch_failed', receipt.run.id);
        }
      }

      return { kind: 'accepted', run: receipt.run };
    },
    listConversations(_actor, page) {
      return repo.list(request, page.after);
    },
    readConversation(_actor, id, page) {
      return repo.read(request, id, page.after);
    },
    async cancel(actor, id) {
      const winner = await repo.cancel(actor, id);

      if ('kind' in winner) return winner;

      try {
        await workflows.terminate(id);
      } catch {
        logError('workflow_termination_failed', id);
      }

      return winner;
    },
  };
}

function outcomeFromResponse(response: ModelResponse): ModelOutcome {
  const metadata = modelResponseMetadata(response);
  const output = savedOutput.safeParse(response.output);
  const usage = savedUsage.safeParse(response.usage);

  if (metadata?.refused) return { kind: 'terminal', failure: { kind: 'provider_refused', reason: 'policy' } };

  if (!metadata || !output.success || !usage.success) return unclassified;

  return { kind: 'response', response: { output: output.data, usage: usage.data, finishReason: metadata.finishReason } };
}

function outcomeFromError(error: unknown): Attempt {
  if (isTruncatedModelError(error)) return { kind: 'terminal', failure: { kind: 'model_output_invalid', reason: 'truncated' } };
  const classification = classifyModelError(classifyProviderError(error));

  if (classification === 'retry') return { kind: 'retry' };

  return { kind: 'terminal', failure: classification };
}

function attemptResult(attempt: Attempt) {
  switch (attempt.kind) {
    case 'response': return { output: attempt.response.output, usage: attempt.response.usage };
    case 'terminal': return { error: JSON.stringify(attempt.failure) };
    case 'retry': return { error: 'Retryable model request failure' };
  }
}

export function createRunner(source: unknown) {
  const settings = parseEnv(source);
  const repo = createChatRepository(source);
  const provider = createModelProvider(settings);
  const tracer = createTracer(settings);

  async function attemptCall(request: ModelRequest): Promise<Attempt> {
    const timeout = AbortSignal.timeout(MODEL_CALL_TIMEOUT);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response;

    try {
      const model = await provider.getModel();
      // WHY: The SDK model always opens a span, and a Workflow step runs outside the SDK run's trace context.
      response = await withTrace(new NoopTrace(), () => model.getResponse({ ...request, signal, tracing: false }));
    } catch (error) {
      return outcomeFromError(error);
    }

    return outcomeFromResponse(response);
  }

  function traceRun(run: StartedRun, outcome: { output: unknown } | { error: string }) {
    return tracer.record(traceOf(run.input), { type: 'agent', name: 'run', startedAt: Date.parse(run.now), endedAt: Date.now(), input: run.input.message, ...outcome });
  }

  return {
    start(id: RunId) {
      return repo.start(id, { maxRuns: MAX_HISTORY_RUNS, maxBytes: MAX_HISTORY_BYTES });
    },
    async commit(run: StartedRun, step: number, blocks: ContentBlock[], final: boolean, usage: { inputTokens: number; outputTokens: number }) {
      const commit = await repo.commit(run.input.runId, step, blocks, final, usage);

      if (commit.kind === 'completed') await traceRun(run, { output: { outcome: 'completed', steps: step } });

      return commit;
    },
    async fail(run: StartedRun, failure: RunFailure) {
      const saved = await repo.fail(run.input.runId, failure);

      if (!('kind' in saved) && saved.state === 'failed') await traceRun(run, { error: JSON.stringify(saved.failure) });

      return saved;
    },
    // WHY: Throwing tells Workflows to retry the model step; every other outcome is saved as the step result.
    async callModel(run: RunInput, step: number, request: ModelRequest): Promise<ModelOutcome> {
      const startedAt = Date.now();
      const attempt = await attemptCall(request);

      await tracer.record(traceOf(run), {
        type: 'generation', name: `model-${step}`, model: settings.LLM_MODEL, startedAt, endedAt: Date.now(),
        input: { instructions: request.systemInstructions, input: request.input }, ...attemptResult(attempt),
      });

      if (attempt.kind === 'retry') throw new Error('Retryable model request failure');

      return attempt;
    },
  };
}

export type ChatRunner = ReturnType<typeof createRunner>;

export async function sweepRuns(source: unknown, workflows: WorkflowRuns): Promise<void> {
  const settings = parseEnv(source);
  const repo = createChatRepository(source);
  const candidates = await repo.candidates(settings.ENVIRONMENT_ID, { dispatchDelaySeconds: DISPATCH_CHECK_DELAY, endGraceSeconds: END_CHECK_GRACE });

  await Promise.all(candidates.dispatch.map(async (id) => {
    try {
      await workflows.start(id);
    } catch {
      logError('workflow_dispatch_failed', id);
    }
  }));

  await Promise.all(candidates.expired.map(async (id) => {
    try {
      await workflows.terminate(id);
    } catch {
      logError('workflow_termination_failed', id);
    }

    try {
      await repo.fail(id, { kind: 'limit', limit: 'duration' });
    } catch {
      logError('sweep_failure_not_saved', id);
    }
  }));
}
