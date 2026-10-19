import { z } from 'zod'

// The Worker side of tests/fixtures/integration-harness.ts. Requests to this origin never leave the test process.
export const HARNESS_ORIGIN = 'http://integration-harness.test'

// The harness answers this origin in place of Langfuse and keeps each OTLP export it receives.
export const LANGFUSE_ORIGIN = 'http://langfuse.test'

// lose_response forwards the call and then fails it, as when a commit lands but its reply is lost.
// malformed_response answers in place of the database with a body no routine returns.
export const failpointSchema = z.object({
  rpc: z.string().min(1),
  runId: z.uuid(),
  action: z.enum(['lose_response', 'malformed_response']),
  times: z.number().int().positive(),
}).strict()

export type Failpoint = z.infer<typeof failpointSchema>

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${HARNESS_ORIGIN}${path}`, init)

  if (!response.ok) throw new Error(`Harness ${path} failed: ${await response.text()}`)

  return response
}

export async function sql(statement: string, parameters: (string | number)[] = []): Promise<void> {
  await call('/sql', { method: 'POST', body: JSON.stringify({ statement, parameters }) })
}

export async function armFailpoint(failpoint: Failpoint): Promise<void> {
  await call('/failpoints', { method: 'POST', body: JSON.stringify(failpoint) })
}

export async function pendingFailpoints(): Promise<Failpoint[]> {
  return z.array(failpointSchema).parse(await (await call('/failpoints')).json())
}

export async function outboundOrigins(): Promise<string[]> {
  return z.array(z.string()).parse(await (await call('/origins')).json())
}

const exportSchema = z.object({
  authorization: z.string(),
  body: z.object({
    resourceSpans: z.array(z.object({
      scopeSpans: z.array(z.object({
        spans: z.array(z.object({
          traceId: z.string(),
          spanId: z.string(),
          name: z.string(),
          attributes: z.array(z.object({ key: z.string(), value: z.object({ stringValue: z.string() }) })),
          status: z.object({ code: z.number(), message: z.string() }).optional(),
        })),
      })),
    })),
  }),
})

export type ExportedSpan = { authorization: string; traceId: string; spanId: string; name: string; attributes: Record<string, string>; error?: string }

export async function exportedSpans(traceId: string): Promise<ExportedSpan[]> {
  const exports = z.array(exportSchema).parse(await (await call('/traces')).json())

  return exports.flatMap(({ authorization, body }) => body.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)).map(span => ({
    authorization,
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    attributes: Object.fromEntries(span.attributes.map(({ key, value }) => [key, value.stringValue])),
    ...(span.status && { error: span.status.message }),
  }))).filter(span => span.traceId === traceId)
}
