import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NoopTrace, withTrace } from '@openai/agents';
import { z } from 'zod';
import { classifyProviderError, createModelProvider, type ProviderErrorKind } from './model.server';

const recorded = new Map([
  ['rate-limit', { status: 429, body: { error: { message: 'Rate limit reached for requests', type: 'requests', param: null, code: 'rate_limit_exceeded' } } }],
  ['server-error', { status: 500, body: { error: { message: 'The server had an error while processing your request.', type: 'server_error', param: null, code: null } } }],
  ['overloaded', { status: 503, body: { error: { message: 'The engine is currently overloaded.', type: 'server_error', param: null, code: null } } }],
  ['context', { status: 400, body: { error: { message: "This model's maximum context length is 128000 tokens.", type: 'invalid_request_error', param: 'messages', code: 'context_length_exceeded' } } }],
  ['quota', { status: 429, body: { error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } } }],
  ['policy', { status: 400, body: { error: { message: 'Your request was rejected by the safety system.', type: 'invalid_request_error', param: null, code: 'content_policy_violation' } } }],
  ['invalid-key', { status: 401, body: { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } } }],
  ['missing-model', { status: 404, body: { error: { message: 'The model does not exist.', type: 'invalid_request_error', param: 'model', code: 'model_not_found' } } }],
  ['unsupported-parameter', { status: 400, body: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' } } }],
  ['unsupported-value', { status: 400, body: { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } } }],
  ['region', { status: 403, body: { error: { message: 'Country, region, or territory not supported', type: 'request_forbidden', param: null, code: 'unsupported_country_region_territory' } } }],
  ['unknown', { status: 400, body: { error: { message: 'Unexpected provider failure', type: 'invalid_request_error', param: null, code: 'unexpected_provider_code' } } }],
]);

let server: Server;

let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) chunks.push(chunk);
    const scenario = String(JSON.parse(Buffer.concat(chunks).toString()).messages.at(-1).content);

    if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 5_000));

    if (scenario === 'connection-lost' || scenario === 'body-cut-short') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"id":"completion-cut-off","choices":[');

      if (scenario === 'body-cut-short') response.end();
      else setTimeout(() => response.socket?.destroy(), 20);

      return;
    }

    const fixture = recorded.get(scenario);
    response.statusCode = fixture?.status ?? 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(fixture?.body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => {
  server.close();
});

async function errorFrom(scenario: string, options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<Error> {
  const model = await createModelProvider({ LLM_API_KEY: 'test-key', LLM_BASE_URL: options.baseUrl ?? baseUrl, LLM_MODEL: 'test-model' }).getModel();

  try {
    await withTrace(new NoopTrace(), () => model.getResponse({
      systemInstructions: undefined, input: scenario, modelSettings: {}, tools: [], outputType: 'text',
      handoffs: [], tracing: false, signal: options.signal,
    }));
  } catch (error) {
    if (error instanceof Error) return error;
  }

  throw new Error(`The ${scenario} fixture did not raise an error`);
}

describe('provider classification', () => {
  it.each<[string, ProviderErrorKind]>([
    ['rate-limit', 'retryable'],
    ['server-error', 'retryable'],
    ['overloaded', 'retryable'],
    ['context', 'context_length'],
    ['quota', 'quota'],
    ['policy', 'policy'],
    ['invalid-key', 'configuration'],
    ['missing-model', 'configuration'],
    ['unsupported-parameter', 'configuration'],
    ['unsupported-value', 'configuration'],
    ['region', 'configuration'],
    ['unknown', 'unknown'],
  ])('classifies the recorded %s response as %s', async (scenario, expected) => {
    expect(classifyProviderError(await errorFrom(scenario))).toBe(expected);
  });

  it('classifies an abort at the call timeout as retryable', async () => {
    expect(classifyProviderError(await errorFrom('slow', { signal: AbortSignal.timeout(100) }))).toBe('retryable');
  });

  it.each(['connection-lost', 'body-cut-short'])('classifies a %s response body as retryable network loss', async (scenario) => {
    expect(classifyProviderError(await errorFrom(scenario))).toBe('retryable');
  });

  it('classifies a refused connection as retryable', async () => {
    expect(classifyProviderError(await errorFrom('anything', { baseUrl: 'http://127.0.0.1:9/v1' }))).toBe('retryable');
  });

  it('classifies a value that is not a provider error as unknown', () => {
    expect(classifyProviderError(null)).toBe('unknown');
    expect(classifyProviderError(new Error('Something else'))).toBe('unknown');
  });
});
