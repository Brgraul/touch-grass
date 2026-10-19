import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { z } from 'zod';
import { parseEnv } from './env.server';
import { createTracer, type Observation } from './telemetry.server';

type Received = { path: string; headers: IncomingHttpHeaders; body: unknown };

const received: Received[] = [];

let status = 200;

let server: Server;

let baseUrl: string;

const keys = { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' };

const trace = { id: '0b3a6c1e-5d2f-4e8a-9c7b-1f2e3d4c5b6a', name: 'agent-chat', userId: 'user-1', sessionId: 'conversation-1' };

const generation: Observation = {
  type: 'generation', name: 'model-1', model: 'test-model', startedAt: 1_000, endedAt: 1_250,
  input: [{ role: 'user', content: 'Hi' }], output: [{ role: 'assistant', content: 'Hello' }], usage: { inputTokens: 10, outputTokens: 5 },
};

const spanSchema = z.object({
  traceId: z.string(), spanId: z.string(), name: z.string(), kind: z.number(), startTimeUnixNano: z.string(), endTimeUnixNano: z.string(),
  attributes: z.array(z.object({ key: z.string(), value: z.object({ stringValue: z.string() }) })),
  status: z.object({ code: z.number(), message: z.string() }).optional(),
});

const exportSchema = z.object({ resourceSpans: z.array(z.object({ scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })) })) });

function spans() {
  return received.flatMap(({ body }) => exportSchema.parse(body).resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans)))
    .map(({ attributes, ...rest }) => ({ ...rest, attributes: Object.fromEntries(attributes.map(({ key, value }) => [key, value.stringValue])) }));
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) chunks.push(chunk);
    received.push({ path: request.url ?? '', headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.statusCode = status;
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  received.length = 0;
  status = 200;
  vi.restoreAllMocks();
});

afterAll(() => {
  server.close();
});

describe('the Langfuse tracer', () => {
  it('sends nothing when no keys are set', async () => {
    await createTracer({ LANGFUSE_BASE_URL: baseUrl }).record(trace, generation);
    expect(received).toEqual([]);
  });

  it('exports a generation as an OTLP span in the trace named by the run ID and the session named by the conversation', async () => {
    await createTracer({ LANGFUSE_BASE_URL: baseUrl, ...keys }).record(trace, generation);

    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe('/api/public/otel/v1/traces');
    expect(received[0]?.headers).toMatchObject({
      authorization: `Basic ${btoa('pk-lf-test:sk-lf-test')}`,
      'content-type': 'application/json',
      'x-langfuse-ingestion-version': '4',
    });
    expect(spans()).toEqual([{
      traceId: '0b3a6c1e5d2f4e8a9c7b1f2e3d4c5b6a',
      spanId: expect.stringMatching(/^[\da-f]{16}$/u),
      name: 'model-1',
      kind: 1,
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1250000000',
      attributes: {
        'langfuse.trace.name': 'agent-chat',
        'langfuse.user.id': 'user-1',
        'langfuse.session.id': 'conversation-1',
        'langfuse.observation.type': 'generation',
        'langfuse.observation.input': JSON.stringify(generation.input),
        'langfuse.observation.output': JSON.stringify(generation.output),
        'langfuse.observation.model.name': 'test-model',
        'langfuse.observation.usage_details': '{"input":10,"output":5}',
      },
    }]);
  });

  it('leaves the session out when the trace has none', async () => {
    const { sessionId: _sessionId, ...sessionless } = trace;

    await createTracer({ LANGFUSE_BASE_URL: baseUrl, ...keys }).record(sessionless, generation);
    expect(spans()[0]?.attributes).not.toHaveProperty('langfuse.session.id');
  });

  it('gives every generation its own span and the agent span one ID per trace', async () => {
    const tracer = createTracer({ LANGFUSE_BASE_URL: baseUrl, ...keys });
    const agent: Observation = { type: 'agent', name: 'run', startedAt: 1_000, endedAt: 2_000, error: '{"kind":"limit"}' };

    await tracer.record(trace, generation);
    await tracer.record(trace, generation);
    await tracer.record(trace, agent);
    await tracer.record(trace, agent);
    const [first, second, run, again] = spans();

    expect(first?.spanId).not.toBe(second?.spanId);
    expect(run?.spanId).toBe(again?.spanId);
    expect(run).toMatchObject({
      status: { code: 2, message: '{"kind":"limit"}' },
      attributes: { 'langfuse.observation.type': 'agent', 'langfuse.observation.level': 'ERROR', 'langfuse.observation.status_message': '{"kind":"limit"}' },
    });
  });

  it.each([
    ['a rejected export', () => { status = 500; }, () => baseUrl],
    ['an unreachable host', () => {}, () => 'http://127.0.0.1:9'],
  ])('logs %s and resolves, so a lost span never fails the run', async (_case, arrange, url) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    arrange();

    await expect(createTracer({ LANGFUSE_BASE_URL: url(), ...keys }).record(trace, generation)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(JSON.stringify({ level: 'error', code: 'trace_export_failed', correlationId: trace.id }));
  });

  it('refuses one Langfuse key without the other', () => {
    const base = {
      ENVIRONMENT_ID: '00000000-0000-4000-8000-000000000001', APP_URL: 'http://127.0.0.1:3000', SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_PUBLISHABLE_KEY: 'publishable', SUPABASE_SECRET_KEY: 'secret', LLM_BASE_URL: 'http://127.0.0.1:4010/v1', LLM_API_KEY: 'key', LLM_MODEL: 'test-model',
    };

    expect(parseEnv({ ...base }).LANGFUSE_BASE_URL).toBe('https://cloud.langfuse.com');
    expect(parseEnv({ ...base, ...keys })).toMatchObject(keys);
    expect(() => parseEnv({ ...base, LANGFUSE_PUBLIC_KEY: 'pk-lf-test' })).toThrow('LANGFUSE_SECRET_KEY');
  });
});
