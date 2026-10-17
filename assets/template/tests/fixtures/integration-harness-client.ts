import { z } from 'zod'

// The Worker side of tests/fixtures/integration-harness.ts. Requests to this origin never leave the test process.
export const HARNESS_ORIGIN = 'http://integration-harness.test'

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
