import type { AppEnv } from './env.server';
import { logError } from './logger.server';

export const TRACE_EXPORT_TIMEOUT = 5_000;

export type Trace = { id: string; name: string; userId: string; sessionId?: string };

type Timing = { startedAt: number; endedAt: number };

export type Observation = Timing & { name: string; input?: unknown; output?: unknown; error?: string } & (
  | { type: 'agent' }
  | { type: 'generation'; model: string; usage?: { inputTokens: number; outputTokens: number } }
);

export type Tracer = { record(trace: Trace, observation: Observation): Promise<void> };

type Attribute = { key: string; value: { stringValue: string } };

const ERROR_STATUS = 2;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nanoseconds(milliseconds: number): string {
  return (BigInt(Math.round(milliseconds)) * 1_000_000n).toString();
}

function attributes(values: Record<string, string | undefined>): Attribute[] {
  return Object.entries(values).flatMap(([key, value]) => value === undefined ? [] : [{ key, value: { stringValue: value } }]);
}

const json = (value: unknown) => value === undefined ? undefined : JSON.stringify(value);

function span(trace: Trace, observation: Observation) {
  const traceId = trace.id.replaceAll('-', '');

  return {
    traceId,
    spanId: observation.type === 'agent' ? traceId.slice(16) : hex(crypto.getRandomValues(new Uint8Array(8))),
    name: observation.name,
    kind: 1,
    startTimeUnixNano: nanoseconds(observation.startedAt),
    endTimeUnixNano: nanoseconds(observation.endedAt),
    attributes: attributes({
      'langfuse.trace.name': trace.name,
      'langfuse.user.id': trace.userId,
      'langfuse.session.id': trace.sessionId,
      'langfuse.observation.type': observation.type,
      'langfuse.observation.input': json(observation.input),
      'langfuse.observation.output': json(observation.output),
      'langfuse.observation.level': observation.error === undefined ? undefined : 'ERROR',
      'langfuse.observation.status_message': observation.error,
      ...(observation.type === 'generation' && {
        'langfuse.observation.model.name': observation.model,
        'langfuse.observation.usage_details': observation.usage && json({ input: observation.usage.inputTokens, output: observation.usage.outputTokens }),
      }),
    }),
    ...(observation.error !== undefined && { status: { code: ERROR_STATUS, message: observation.error } }),
  };
}

const disabled: Tracer = { async record() {} };

// WHY: Langfuse accepts OTLP/JSON, so one fetch per span replaces the OpenTelemetry SDK.
export function createTracer(settings: Pick<AppEnv, 'LANGFUSE_BASE_URL' | 'LANGFUSE_PUBLIC_KEY' | 'LANGFUSE_SECRET_KEY'>): Tracer {
  const { LANGFUSE_BASE_URL: baseUrl, LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = settings;

  if (!publicKey || !secretKey) return disabled;
  const endpoint = new URL('/api/public/otel/v1/traces', baseUrl);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${btoa(`${publicKey}:${secretKey}`)}`,
    // WHY: Without it Langfuse can take minutes to show an OTLP span.
    'x-langfuse-ingestion-version': '4',
  };

  return {
    async record(trace, observation) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'touch-grass-app' }) }, scopeSpans: [{ scope: { name: 'touch-grass' }, spans: [span(trace, observation)] }] }] }),
          signal: AbortSignal.timeout(TRACE_EXPORT_TIMEOUT),
        });

        await response.arrayBuffer();

        if (!response.ok) logError('trace_export_failed', trace.id);
      } catch {
        logError('trace_export_failed', trace.id);
      }
    },
  };
}
