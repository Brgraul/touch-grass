import { Pool } from 'pg'
import { z } from 'zod'
import { HARNESS_ORIGIN, LANGFUSE_ORIGIN, failpointSchema, type Failpoint } from './integration-harness-client.ts'

const sqlSchema = z.object({ statement: z.string().min(1), parameters: z.array(z.union([z.string(), z.number()])).default([]) }).strict()

const hopHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']

// Runs in Node as the test Worker's outbound service: every fetch the Worker makes passes through here.
export function createIntegrationHarness(databaseUrl: string) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('The integration harness only connects to a loopback database')
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2, idleTimeoutMillis: 1_000, allowExitOnIdle: true })
  const failpoints: Failpoint[] = []
  const origins = new Set<string>()
  const traces: { authorization: string; body: unknown }[] = []

  async function control(request: Request, path: string): Promise<Response> {
    if (path === '/sql') {
      const { statement, parameters } = sqlSchema.parse(await request.json())

      await pool.query(statement, parameters)

      return new Response(null, { status: 204 })
    }

    if (path === '/failpoints' && request.method === 'GET') return Response.json(failpoints)

    if (path === '/failpoints') {
      failpoints.push(failpointSchema.parse(await request.json()))

      return new Response(null, { status: 204 })
    }

    if (path === '/origins') return Response.json([...origins])

    if (path === '/traces') return Response.json(traces)

    return new Response('Unknown harness route', { status: 404 })
  }

  function takeFailpoint(path: string, body: string): Failpoint | undefined {
    const index = failpoints.findIndex((failpoint) => path.endsWith(`/rpc/${failpoint.rpc}`) && body.includes(failpoint.runId))
    const failpoint = failpoints[index]

    if (!failpoint) return undefined
    failpoint.times -= 1

    if (failpoint.times === 0) failpoints.splice(index, 1)

    return failpoint
  }

  return async function outbound(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.origin === HARNESS_ORIGIN) return control(request, url.pathname)

    if (url.origin === LANGFUSE_ORIGIN) {
      traces.push({ authorization: request.headers.get('authorization') ?? '', body: await request.json() })

      return Response.json({})
    }

    origins.add(url.origin)
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text()
    const failpoint = body === undefined ? undefined : takeFailpoint(url.pathname, body)

    if (failpoint?.action === 'malformed_response') return Response.json({ kind: 'unexpected_shape' })
    const upstream = await fetch(url, { method: request.method, headers: request.headers, body, signal: request.signal })

    if (failpoint?.action === 'lose_response') {
      await upstream.arrayBuffer()

      return new Response('Connection reset after the database committed', { status: 503 })
    }

    const headers = new Headers(upstream.headers)

    for (const name of hopHeaders) headers.delete(name)

    return new Response(upstream.body, { status: upstream.status, headers })
  }
}
