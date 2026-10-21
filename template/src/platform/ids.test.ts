import { describe, expect, it } from 'vitest'
import { pageCursor } from './ids'

const encode = (sortKey: string) => Buffer.from(sortKey).toString('base64url')

describe('page cursors', () => {
  it('accepts the sort key cursor that agent_chat.cursor_encode writes', () => {
    expect(pageCursor.safeParse(encode('["2026-01-02T03:04:05.123456+00:00", "0b3a6c1e-5d2f-4e8a-9c7b-1f2e3d4c5b6a"]')).success).toBe(true)
  })

  it.each(['["2026-01-02T03:04:05+00:00"]', '{"time": "2026-01-02T03:04:05+00:00"}', 'not json'])('rejects a cursor that decodes to %s', (sortKey) => {
    expect(pageCursor.safeParse(encode(sortKey)).success).toBe(false)
  })
})
