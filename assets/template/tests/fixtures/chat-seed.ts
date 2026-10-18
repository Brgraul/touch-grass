import { Client } from 'pg'
import { z } from 'zod'
import type { JsonValue } from '../../src/platform/ids'

const settings = z.object({ TEST_DATABASE_URL: z.url(), ENVIRONMENT_ID: z.uuid() }).parse(process.env)

type SeedBlock = { kind: string } & Record<string, JsonValue>

type SeedInput = {
  userId: string
  message: string
  // Each entry is one agent turn, committed in order. The last one completes the run.
  turns: SeedBlock[][]
  // Inserted directly after the run completes, because commit_step refuses a kind it does not know.
  unknownBlock?: { kind: string; blockSchemaVersion: number }
}

const noUsage = JSON.stringify({ inputTokens: 0, outputTokens: 0 })

export async function seedFinishedExchange({ userId, message, turns, unknownBlock }: SeedInput) {
  const client = new Client({ connectionString: settings.TEST_DATABASE_URL })

  await client.connect()

  try {
    await client.query('begin')

    const submitted = await client.query<{ receipt: { run: { id: string; conversationId: string } } }>(
      'select agent_chat_api.submit_message($1, $2, $3, $4, 8, 4, 60, 2, 10, 900) as receipt',
      [userId, settings.ENVIRONMENT_ID, crypto.randomUUID(), message],
    )

    const { id: runId, conversationId } = submitted.rows[0]!.receipt.run

    await client.query('select agent_chat_api.start_run($1, 0, 0)', [runId])

    for (const [index, blocks] of turns.entries()) {
      const isLast = index === turns.length - 1

      await client.query('select agent_chat_api.commit_step($1, $2, $3, $4, $5)', [runId, index + 1, JSON.stringify(blocks), isLast, noUsage])
    }

    if (unknownBlock) {
      await client.query(
        'insert into agent_chat.turns (run_id, owner_id, step_ordinal, blocks, block_schema_version) values ($1, $2, $3, $4, $5)',
        [runId, userId, turns.length + 1, JSON.stringify([{ kind: unknownBlock.kind }]), unknownBlock.blockSchemaVersion],
      )
    }

    await client.query('commit')

    return { runId, conversationId }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

// Admits a run without starting its Workflow, as if the dispatch reply was lost, and ages it past the sweep's dispatch check.
export async function seedUndispatchedRun({ userId, message }: { userId: string; message: string }) {
  const client = new Client({ connectionString: settings.TEST_DATABASE_URL })

  await client.connect()

  try {
    const submitted = await client.query<{ receipt: { run: { id: string; conversationId: string } } }>(
      'select agent_chat_api.submit_message($1, $2, $3, $4, 8, 4, 60, 2, 10, 900) as receipt',
      [userId, settings.ENVIRONMENT_ID, crypto.randomUUID(), message],
    )

    const { id: runId, conversationId } = submitted.rows[0]!.receipt.run

    await client.query("update agent_chat.runs set created_at = now() - interval '2 minutes' where id = $1", [runId])

    return { runId, conversationId }
  } finally {
    await client.end()
  }
}
