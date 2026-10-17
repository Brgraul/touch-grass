import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { Runner, Usage, type AgentInputItem, type Model, type ModelRequest, type ModelResponse, type StreamEvent } from '@openai/agents';
import { z } from 'zod';
import { runId, type Instant } from '@/platform/ids';
import { CHAT_AGENT, CHAT_RUN_CONFIG } from './agent-chat.agent';
import { createRunner, type ChatRunner, type WorkflowRuns } from './agent-chat.service.server';
import {
  MODEL_CALL_RETRIES, MODEL_STEP_TIMEOUT, RunEnded, RunFailed,
  checkBeforeCall, checkResponse, failureFromRunError, toAgentInput, turnBlocks,
  type Commit, type RunInput, type SavedModelResponse,
} from './agent-chat.model';

const payloadSchema = z.object({ runId }).strict();

export const MODEL_STEP_CONFIG = {
  retries: { limit: MODEL_CALL_RETRIES, delay: '5 seconds', backoff: 'exponential' },
  timeout: MODEL_STEP_TIMEOUT,
} satisfies WorkflowStepConfig;

// A pause or restart rejects the pending step with this prefix. It must reach the engine untouched,
// or the run would record a failure for an instance that is only suspended.
function isEngineControl(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Aborting engine:');
}

function parseRunPayload(payload: unknown) {
  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success) throw new Error(`Invalid Workflow payload: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.code).join(', ')}`);

  return parsed.data;
}

// Workflows refuses a second instance with the same ID, which is how a run never gets two instances.
export function workflowRuns(binding: Pick<Workflow, 'create' | 'get'>): WorkflowRuns {
  return {
    async start(id) {
      try {
        await binding.create({ id, params: { runId: id } });
      } catch (error) {
        if (!(error instanceof Error && /already.exists/iu.test(error.message))) throw error;
      }
    },
    async terminate(id) {
      await (await binding.get(id)).terminate();
    },
  };
}

// Step names come only from the model call count, so a replay matches every saved result by name.
export class DurableModel implements Model {
  private calls = 0;
  private previous: SavedModelResponse | undefined;

  constructor(
    private readonly steps: WorkflowStep,
    private readonly runner: ChatRunner,
    private readonly input: RunInput,
    private now: Instant,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    if (this.previous) {
      const commit = await this.commit(this.previous, false, typeof request.input === 'string' ? [] : request.input);

      if (commit.kind === 'ended') throw new RunEnded();
      this.now = commit.now;
    }

    this.calls += 1;
    const limit = checkBeforeCall(this.input, this.calls, this.now);

    if (limit) throw new RunFailed(limit);
    const response = await this.callModel(request);
    this.previous = response;

    return { output: response.output, usage: new Usage({ ...response.usage, requests: 1 }) };
  }

  getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error('Durable runs do not stream');
  }

  async commitFinal(): Promise<void> {
    if (!this.previous) throw new RunFailed({ kind: 'execution', code: 'internal' });
    await this.commit(this.previous, true);
  }

  private async callModel(request: ModelRequest): Promise<SavedModelResponse> {
    let outcome;

    try {
      outcome = await this.steps.do(`model-${this.calls}`, MODEL_STEP_CONFIG, () => this.runner.callModel(request));
    } catch (error) {
      if (isEngineControl(error)) throw error;
      throw new RunFailed({ kind: 'limit', limit: 'model_retries' });
    }

    if (outcome.kind === 'terminal') throw new RunFailed(outcome.failure);
    const failure = checkResponse(outcome.response, this.input.policy);

    if (failure) throw new RunFailed(failure);

    return outcome.response;
  }

  private commit(response: SavedModelResponse, final: boolean, nextInput: readonly AgentInputItem[] = []): Promise<Commit> {
    const step = this.calls;
    const blocks = turnBlocks(response, nextInput);

    return this.steps.do(`commit-${step}`, () => this.runner.commit(this.input.runId, step, blocks, final, response.usage));
  }
}

export class AgentChatWorkflow extends WorkflowEntrypoint<Env, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<void> {
    const { runId: id } = parseRunPayload(event.payload);
    const runner = createRunner(this.env);
    const start = await step.do('start', () => runner.start(id));

    if (start.kind === 'ended') return;
    const model = new DurableModel(step, runner, start.input, start.now);

    try {
      await new Runner({ ...CHAT_RUN_CONFIG, model })
        .run(CHAT_AGENT, toAgentInput(start.input.history, start.input.message), { maxTurns: start.input.policy.maxSteps + 1 });
      await model.commitFinal();
    } catch (error) {
      if (isEngineControl(error)) throw error;
      const failure = failureFromRunError(error);

      if (failure) await step.do('fail', async () => { await runner.fail(id, failure); });
    }
  }
}
