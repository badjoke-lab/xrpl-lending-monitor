import { describe, expect, it } from 'vitest'

import {
  markFastLaneQueueSlotError,
  pruneFastLaneQueueSlots,
  readFastLaneQueueSlot,
} from './fast-lane-queue-slot'

interface StoredRow {
  scheduled_time: number
  message_id: string
  status: 'processing' | 'error' | 'completed'
  started_at: string
  completed_at: string | null
  next_scheduled_time: number | null
  error_message: string | null
  updated_at: string
}

function database(initial: StoredRow | null = null): {
  db: D1Database
  sql: string[]
} {
  let row = initial
  const observedSql: string[] = []

  const db = {
    prepare(sql: string) {
      observedSql.push(sql)
      let values: unknown[] = []

      const statement = {
        bind(...input: unknown[]) {
          values = input
          return statement
        },

        async run() {
          if (
            sql.includes('INSERT INTO fast_lane_queue_slots')
            && sql.includes("'error'")
          ) {
            if (!row || row.status !== 'completed') {
              row = {
                scheduled_time: Number(values[0]),
                message_id: String(values[1]),
                status: 'error',
                started_at: String(values[3]),
                completed_at: null,
                next_scheduled_time: null,
                error_message: String(values[2]),
                updated_at: String(values[3]),
              }
            }
            return { meta: {} }
          }

          if (sql.includes('DELETE FROM fast_lane_queue_slots')) {
            return { meta: {} }
          }

          throw new Error(`Unexpected run SQL: ${sql}`)
        },

        async first<T>() {
          if (sql.includes('SELECT scheduled_time')) {
            return row as T
          }
          throw new Error(`Unexpected first SQL: ${sql}`)
        },
      }

      return statement
    },
  } as unknown as D1Database

  return { db, sql: observedSql }
}

describe('fast-lane Queue slot error persistence', () => {
  it('creates an error row before a processing claim exists', async () => {
    const { db } = database()

    await markFastLaneQueueSlotError({
      db,
      scheduledTime: 123,
      messageId: 'message-1',
      errorMessage: 'capacity guard reached',
      updatedAt: '2026-07-30T04:30:00.000Z',
    })

    await expect(readFastLaneQueueSlot({
      db,
      scheduledTime: 123,
    })).resolves.toMatchObject({
      messageId: 'message-1',
      status: 'error',
      errorMessage: 'capacity guard reached',
    })
  })

  it('does not overwrite an already completed slot', async () => {
    const { db } = database({
      scheduled_time: 123,
      message_id: 'completed-message',
      status: 'completed',
      started_at: '2026-07-30T04:20:00.000Z',
      completed_at: '2026-07-30T04:21:00.000Z',
      next_scheduled_time: 456,
      error_message: null,
      updated_at: '2026-07-30T04:21:00.000Z',
    })

    await markFastLaneQueueSlotError({
      db,
      scheduledTime: 123,
      messageId: 'later-message',
      errorMessage: 'late failure',
      updatedAt: '2026-07-30T04:30:00.000Z',
    })

    await expect(readFastLaneQueueSlot({
      db,
      scheduledTime: 123,
    })).resolves.toMatchObject({
      messageId: 'completed-message',
      status: 'completed',
      nextScheduledTime: 456,
    })
  })

  it('prunes completed and error slots but not processing slots', async () => {
    const { db, sql } = database()

    await pruneFastLaneQueueSlots({
      db,
      cutoff: '2026-07-23T00:00:00.000Z',
    })

    const deletion = sql.find((value) =>
      value.includes('DELETE FROM fast_lane_queue_slots')
    )

    expect(deletion).toContain("status IN ('completed', 'error')")
    expect(deletion).not.toContain("'processing'")
  })
})
