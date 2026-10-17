import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'

// Scenarios are chosen by a bracketed marker in the latest user message, such as `[quota]`.
const requests: unknown[] = []

const attempts = new Map<string, number>()

const requestSchema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough()) }).passthrough()

type ToolCall = { id: string; name: string; arguments: string }

type AssistantMessage = { content: string | null; refusal?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }

const providerErrors = new Map([
  ['quota', { status: 429, code: 'insufficient_quota', type: 'insufficient_quota' }],
  ['context', { status: 400, code: 'context_length_exceeded', type: 'invalid_request_error' }],
  ['policy', { status: 400, code: 'content_policy_violation', type: 'invalid_request_error' }],
  ['configuration', { status: 401, code: 'invalid_api_key', type: 'invalid_request_error' }],
  ['retryable', { status: 503, code: 'server_error', type: 'server_error' }],
  ['unknown', { status: 400, code: 'unknown_provider_failure', type: 'invalid_request_error' }],
])

const toolErrorCalls = new Map([
  ['unknown-tool', { name: 'missing_tool', arguments: '{}' }],
  ['bad-arguments', { name: 'calculate', arguments: '{"expression": "6 *' }],
  ['invalid-arguments', { name: 'calculate', arguments: '{"expression":42}' }],
  ['throwing-tool', { name: 'calculate', arguments: '{"expression":"1 / 0"}' }],
])

const calculation = { name: 'calculate', arguments: '{"expression":"6 * 7"}' }

function completion(message: AssistantMessage, finishReason: string) {
  return { id: `completion-${requests.length}`, object: 'chat.completion', created: 0, model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }
}

function toolCalls(calls: readonly ToolCall[]) {
  return completion({ content: null, tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, 'tool_calls')
}

// lose_connection sends the status line and part of the body, then destroys the socket.
type Reply = { status: number; body: unknown } | 'lose_connection'

async function reply(text: string, afterTool: boolean, attempt: number): Promise<Reply> {
  const has = (scenario: string) => text.includes(`[${scenario}]`)
  const scenario = [...providerErrors].find(([name]) => has(name))?.[1]

  if (scenario) return { status: scenario.status, body: { error: { message: 'Scripted provider failure', type: scenario.type, code: scenario.code } } }

  if (has('connection-lost-always') || (has('connection-lost') && attempt === 1)) return 'lose_connection'

  if (has('unstorable-output')) return { status: 200, body: completion({ content: 'nul \u0000 lone \uD800 end' }, 'stop') }

  if (has('transient') && attempt === 1) return { status: 503, body: { error: { message: 'Temporary overload', type: 'server_error', code: 'server_error' } } }

  if (has('malformed')) return { status: 200, body: { choices: 'not-an-array' } }

  if (has('policy-output')) return { status: 200, body: completion({ content: null, refusal: 'Scripted policy refusal' }, 'content_filter') }

  if (has('truncated')) return { status: 200, body: completion({ content: 'Partial answer' }, 'length') }

  if (has('truncated-empty')) return { status: 200, body: completion({ content: null }, 'length') }

  if (has('oversized')) return { status: 200, body: completion({ content: 'x'.repeat(32_769) }, 'stop') }

  if (has('steps')) return { status: 200, body: toolCalls([{ id: `call_calculate_${attempt}_0`, ...calculation }]) }

  if (has('too_many_tools')) return { status: 200, body: toolCalls(Array.from({ length: 5 }, (_, index) => ({ id: `call_calculate_${attempt}_${index}`, ...calculation }))) }

  if (has('behavior')) return { status: 200, body: toolCalls([{ id: 'call_reused', ...calculation }, { id: 'call_reused', name: 'calculate', arguments: '{"expression":"1 + 1"}' }]) }

  const toolError = [...toolErrorCalls].find(([name]) => has(name))?.[1]

  if (toolError) return { status: 200, body: afterTool ? completion({ content: 'The tool reported an error.' }, 'stop') : toolCalls([{ id: `call_${attempt}_0`, ...toolError }]) }

  if (has('slow')) await sleep(30_000)

  if (has('delay')) await sleep(3_000)

  if (afterTool) {
    await sleep(5_000)

    return { status: 200, body: completion({ content: 'The answer is 42.' }, 'stop') }
  }

  if (/calculate|6\s*\*\s*7|six.*seven/i.test(text)) return { status: 200, body: toolCalls([{ id: `call_calculate_${attempt}_0`, ...calculation }]) }

  return { status: 200, body: completion({ content: 'Ready to help.' }, 'stop') }
}

export function startProviderDouble(port = 4010) {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')

    if (request.method === 'GET' && request.url === '/requests') {
      response.end(JSON.stringify(requests))

      return
    }

    if (request.method === 'DELETE' && request.url === '/requests') {
      requests.length = 0
      attempts.clear()
      response.end('{}')

      return
    }

    const chunks = []

    for await (const chunk of request) chunks.push(chunk)
    const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString()))
    requests.push(body)
    const text = String(body.messages.findLast((message) => message.role === 'user')?.content ?? '')
    const attempt = (attempts.get(text) ?? 0) + 1
    attempts.set(text, attempt)
    const result = await reply(text, body.messages.at(-1)?.role === 'tool', attempt)

    if (result === 'lose_connection') {
      response.writeHead(200)
      response.write('{"id":"completion-cut-off","choices":[')
      setTimeout(() => response.socket?.destroy(), 50)

      return
    }

    response.statusCode = result.status
    response.end(JSON.stringify(result.body))
  })

  server.listen(port, '127.0.0.1')

  return server
}

if (process.argv[1]?.endsWith('provider-double.ts')) startProviderDouble()
