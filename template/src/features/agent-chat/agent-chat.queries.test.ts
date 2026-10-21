import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationQuery, type ConversationReadResult } from './agent-chat.queries'
import { readConversationSchema } from './agent-chat.schema'
import { conversationId, userId } from '@/platform/ids'

// WHY: Query Core skips refetch intervals when it believes it runs on a server, so the test must look like a browser before it loads.
vi.hoisted(() => {
  Object.assign(globalThis, { window: globalThis })
})

const user = userId.parse('00000000-0000-4000-8000-0000000000a1')

const id = conversationId.parse('00000000-0000-4000-8000-0000000000c1')

const instant = '2026-10-17T10:00:00.000Z'

function read(state: 'running' | 'completed'): ConversationReadResult {
  const base = { id: '00000000-0000-4000-8000-0000000000d1', conversationId: id, message: 'hi', version: 1, createdAt: instant }
  const run = state === 'running' ? { ...base, state, committedSteps: 0 } : { ...base, state, finalTurn: '00000000-0000-4000-8000-0000000000e1', endedAt: instant }

  return readConversationSchema.parse({ conversation: { id, title: 'hi', updatedAt: instant }, exchanges: { items: [{ run, turns: [] }] } })
}

function failure(code: 'internal' | 'unauthenticated'): ConversationReadResult {
  return { kind: 'error', code, correlationId: '00000000-0000-4000-8000-0000000000f1' }
}

function scripted(...results: ConversationReadResult[]) {
  let calls = 0

  const load = () => {
    const next = results[Math.min(calls, results.length - 1)]
    calls += 1

    if (!next) throw new Error('A scripted reader needs at least one result')

    return Promise.resolve(next)
  }

  return { load, calls: () => calls }
}

async function observe(load: () => Promise<ConversationReadResult>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const observer = new QueryObserver(client, conversationQuery(user, id, undefined, load))
  const unsubscribe = observer.subscribe(() => {})

  await vi.advanceTimersByTimeAsync(0)

  return { data: () => observer.getCurrentResult().data, unsubscribe }
}

describe('conversation polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls every 2 seconds while a run is active and stops once it ends', async () => {
    const reader = scripted(read('running'), read('running'), read('completed'))
    const { unsubscribe } = await observe(reader.load)

    await vi.advanceTimersByTimeAsync(1999)
    expect(reader.calls()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reader.calls()).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(reader.calls()).toBe(3)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reader.calls()).toBe(3)
    unsubscribe()
  })

  it('keeps the last good data and keeps polling after a transient server error', async () => {
    const reader = scripted(read('running'), failure('internal'), read('running'), read('completed'))
    const { data, unsubscribe } = await observe(reader.load)

    await vi.advanceTimersByTimeAsync(2000)
    expect(reader.calls()).toBe(2)
    expect(data()).toEqual(read('running'))

    await vi.advanceTimersByTimeAsync(2000)
    expect(reader.calls()).toBe(3)
    await vi.advanceTimersByTimeAsync(2000)
    expect(reader.calls()).toBe(4)
    expect(data()).toEqual(read('completed'))
    unsubscribe()
  })

  it('stops polling when the session has expired', async () => {
    const reader = scripted(read('running'), failure('unauthenticated'))
    const { data, unsubscribe } = await observe(reader.load)

    await vi.advanceTimersByTimeAsync(2000)
    expect(data()).toEqual(failure('unauthenticated'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reader.calls()).toBe(2)
    unsubscribe()
  })

  it('reports an error on the first read, when there is no good data to keep', async () => {
    const reader = scripted(failure('internal'))
    const { data, unsubscribe } = await observe(reader.load)

    expect(data()).toEqual(failure('internal'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reader.calls()).toBe(1)
    unsubscribe()
  })
})
