import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { z } from 'zod'
import { localEnv } from '../../tools/local-env.ts'

const target = localEnv().TEST_DATABASE_URL

assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname), 'SQL races require a disposable local database')

// One race can pass by luck when a contender finishes before the other starts, so each race repeats.
const ROUNDS = 10

const pool = new Pool({ connectionString: target, max: 4 })

const owner = randomUUID()

const other = randomUUID()

const environment = randomUUID()

const receiptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), run: z.object({ id: z.uuid(), conversationId: z.uuid() }), created: z.boolean() }),
  z.object({ kind: z.literal('refused'), reason: z.enum(['rate_limited', 'capacity', 'busy']) }),
  z.object({ kind: z.literal('key_conflict') }),
  z.object({ kind: z.literal('not_found') }),
])

type Receipt = z.infer<typeof receiptSchema>

type Submission = { actor: string; key: string; text: string; userLimit: number; environmentLimit: number }

async function submitAs(client: PoolClient, input: Submission): Promise<Receipt> {
  const result = await client.query<{ receipt: unknown }>(
    'select agent_chat_api.submit_message($1,$2,$3,$4,8,4,60,$5,$6,900,null) as receipt',
    [input.actor, environment, input.key, input.text, input.userLimit, input.environmentLimit],
  )

  return receiptSchema.parse(result.rows[0]?.receipt)
}

// Both connections are open and in the service role before either call starts, so the calls overlap in the database.
async function race(submissions: readonly Submission[]): Promise<Receipt[]> {
  const clients = await Promise.all(submissions.map(() => pool.connect()))

  try {
    await Promise.all(clients.map((client) => client.query('set role service_role')))

    return await Promise.all(submissions.map((submission, index) => submitAs(clients[index]!, submission)))
  } finally {
    await Promise.all(clients.map(async (client) => {
      await client.query('reset role')
      client.release()
    }))
  }
}

async function submit(input: Submission): Promise<Receipt> {
  const [receipt] = await race([input])

  return receipt!
}

async function cancelAccepted(receipts: readonly Receipt[]): Promise<void> {
  for (const receipt of receipts) {
    if (receipt.kind === 'accepted') await pool.query("update agent_chat.runs set state='canceled',ended_at=clock_timestamp(),version=version+1 where id=$1", [receipt.run.id])
  }
}

function count(receipts: readonly Receipt[], kind: 'accepted' | 'capacity'): number {
  return receipts.filter((receipt) => kind === 'accepted' ? receipt.kind === 'accepted' : receipt.kind === 'refused' && receipt.reason === 'capacity').length
}

async function raceForLastPlace(label: string, contenders: (round: number) => readonly Submission[]): Promise<void> {
  for (let round = 1; round <= ROUNDS; round += 1) {
    const receipts = await race(contenders(round))
    assert.equal(count(receipts, 'accepted'), 1, `one contender wins the final ${label} place in round ${round}`)
    assert.equal(count(receipts, 'capacity'), 1, `the other ${label} contender is refused in round ${round}`)
    await cancelAccepted(receipts)
  }
}

try {
  await pool.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, `${owner}@example.test`, other, `${other}@example.test`])

  for (let round = 1; round <= ROUNDS; round += 1) {
    const same = { actor: owner, key: randomUUID(), text: `same input ${round}`, userLimit: 2, environmentLimit: 10 }
    const receipts = await race([same, same])
    const [a, b] = receipts
    assert(a?.kind === 'accepted' && b?.kind === 'accepted', `both identical calls return an accepted receipt in round ${round}`)
    assert.equal(a.run.id, b.run.id, `identical concurrent messages create one run in round ${round}`)
    assert.equal(receipts.filter((item) => item.kind === 'accepted' && item.created).length, 1, `exactly one call creates the run in round ${round}`)
    await cancelAccepted(receipts)
  }

  await raceForLastPlace('user', (round) => [
    { actor: owner, key: randomUUID(), text: `user race ${round} one`, userLimit: 1, environmentLimit: 10 },
    { actor: owner, key: randomUUID(), text: `user race ${round} two`, userLimit: 1, environmentLimit: 10 },
  ])

  await raceForLastPlace('environment', (round) => [
    { actor: owner, key: randomUUID(), text: `environment race ${round} one`, userLimit: 2, environmentLimit: 1 },
    { actor: other, key: randomUUID(), text: `environment race ${round} two`, userLimit: 2, environmentLimit: 1 },
  ])

  const orders = [
    ['complete', 'fail', 'cancel'], ['complete', 'cancel', 'fail'],
    ['fail', 'complete', 'cancel'], ['fail', 'cancel', 'complete'],
    ['cancel', 'complete', 'fail'], ['cancel', 'fail', 'complete'],
  ] as const

  const terminalStates = { complete: 'completed', fail: 'failed', cancel: 'canceled' } as const

  const transitions = {
    complete: `select agent_chat_api.commit_step($1,1,'[{"kind":"text","text":"done"}]',true,'{"inputTokens":1,"outputTokens":1}')`,
    fail: `select agent_chat_api.fail_run($1,'{"kind":"execution","code":"internal"}')`,
    cancel: `select agent_chat_api.cancel_run('${owner}',$1)`,
  } as const

  for (const order of orders) {
    const admitted = await submit({ actor: owner, key: randomUUID(), text: `terminal order ${order.join(',')}`, userLimit: 2, environmentLimit: 10 })
    assert(admitted.kind === 'accepted', 'terminal test run is admitted')
    await pool.query('select agent_chat_api.start_run($1,20,524288)', [admitted.run.id])

    for (const action of order) {
      await pool.query(transitions[action], [admitted.run.id])
      const result: QueryResult<{ state: string }> = await pool.query('select state from agent_chat.runs where id=$1', [admitted.run.id])
      assert.equal(result.rows[0]?.state, terminalStates[order[0]], `first terminal transition persists for ${order.join(',')}`)
    }
  }

  process.stdout.write(`PASS ${ROUNDS} rounds each of concurrent idempotency, user capacity and environment capacity, and all terminal orders\n`)
} finally {
  await pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, other]])
  await pool.end()
}
