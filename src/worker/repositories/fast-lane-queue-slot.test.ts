import { describe, expect, it } from 'vitest'

import {
  claimFastLaneQueueSlot,
  completeFastLaneQueueSlot,
  markFastLaneQueueSlotError,
  pruneFastLaneQueueSlots,
  readFastLaneQueueSlot,
  stageFastLaneQueueSuccessor,
} from './fast-lane-queue-slot'

interface StoredRow {
  scheduled_time: number
  message_id: string
  status: 'processing' | 'error' | 'completed'
  started_at: string
  completed_at: string | null
  next_scheduled_time: number | null
  next_cron: string | null
  error_message: string | null
  updated_at: string
}

function database(initial: StoredRow | null = null): { db: D1Database; sql: string[] } {
  let row = initial
  const observedSql: string[] = []
  const db = { prepare(sql: string) {
    observedSql.push(sql)
    let values: unknown[] = []
    const statement = {
      bind(...input: unknown[]) { values = input; return statement },
      async run() {
        if (sql.includes("VALUES (?1, ?2, 'processing'")) {
          const canClaim = !row || row.status === 'error'
            || (row.status === 'processing'
              && (row.message_id === values[1] || row.updated_at <= String(values[3])))
          if (canClaim) row = {
            scheduled_time: Number(values[0]), message_id: String(values[1]), status: 'processing',
            started_at: String(values[2]), completed_at: null, next_scheduled_time: null, next_cron: null,
            error_message: null, updated_at: String(values[2]),
          }
          return { meta: {} }
        }
        if (sql.includes("VALUES (?1, ?2, 'error'")) {
          if (!row || row.status === 'error'
            || (row.status === 'processing' && row.next_scheduled_time === null
              && row.message_id === values[1])) row = {
            scheduled_time: Number(values[0]), message_id: String(values[1]), status: 'error',
            started_at: String(values[3]), completed_at: null, next_scheduled_time: null, next_cron: null,
            error_message: String(values[2]), updated_at: String(values[3]),
          }
          return { meta: {} }
        }
        if (sql.includes('SET next_scheduled_time')) {
          if (row?.message_id === values[1] && row.scheduled_time === values[0]
            && row.status === 'processing') row = {
            ...row, next_scheduled_time: Number(values[2]), next_cron: String(values[3]),
            updated_at: String(values[4]),
          }
          return { meta: {} }
        }
        if (sql.includes("SET status = 'completed'")) {
          if (row?.message_id === values[1] && row.scheduled_time === values[0]
            && row.status === 'processing' && row.next_scheduled_time === values[3]
            && row.next_cron === values[4]) row = {
            ...row, status: 'completed', completed_at: String(values[2]),
            error_message: null, updated_at: String(values[2]),
          }
          return { meta: {} }
        }
        if (sql.includes('DELETE FROM fast_lane_queue_slots')) return { meta: {} }
        throw new Error(`Unexpected run SQL: ${sql}`)
      },
      async first<T>() {
        if (sql.includes('SELECT scheduled_time')) return row as T
        throw new Error(`Unexpected first SQL: ${sql}`)
      },
    }
    return statement
  } } as unknown as D1Database
  return { db, sql: observedSql }
}

const claim = (db: D1Database, messageId: string, claimedAt: string) => claimFastLaneQueueSlot({
  db, scheduledTime: 123, messageId, claimedAt, staleBefore: '2026-07-30T04:15:00.000Z',
})

describe('fast-lane Queue slot leases', () => {
  it('does not let a different message steal a fresh processing lease', async () => {
    const { db } = database({ scheduled_time: 123, message_id: 'active', status: 'processing', started_at: '2026-07-30T04:20:00.000Z', completed_at: null, next_scheduled_time: null, next_cron: null, error_message: null, updated_at: '2026-07-30T04:20:00.000Z' })
    await expect(claim(db, 'replacement', '2026-07-30T04:30:00.000Z')).resolves.toBe('duplicate')
    await expect(readFastLaneQueueSlot({ db, scheduledTime: 123 })).resolves.toMatchObject({ messageId: 'active', startedAt: '2026-07-30T04:20:00.000Z' })
  })

  it('reclaims a stale processing lease and resets its ownership timestamps', async () => {
    const { db } = database({ scheduled_time: 123, message_id: 'terminated', status: 'processing', started_at: '2026-07-30T04:00:00.000Z', completed_at: null, next_scheduled_time: null, next_cron: null, error_message: 'old', updated_at: '2026-07-30T04:00:00.000Z' })
    await expect(claim(db, 'replacement', '2026-07-30T04:30:00.000Z')).resolves.toBe('claimed')
    await expect(readFastLaneQueueSlot({ db, scheduledTime: 123 })).resolves.toMatchObject({ messageId: 'replacement', status: 'processing', startedAt: '2026-07-30T04:30:00.000Z', updatedAt: '2026-07-30T04:30:00.000Z', errorMessage: null })
  })

  it('retries an error slot under the replacement message lease', async () => {
    const { db } = database({ scheduled_time: 123, message_id: 'failed', status: 'error', started_at: '2026-07-30T04:20:00.000Z', completed_at: null, next_scheduled_time: null, next_cron: null, error_message: 'transient', updated_at: '2026-07-30T04:29:00.000Z' })
    await expect(claim(db, 'replacement', '2026-07-30T04:30:00.000Z')).resolves.toBe('claimed')
    await expect(readFastLaneQueueSlot({ db, scheduledTime: 123 })).resolves.toMatchObject({ messageId: 'replacement', status: 'processing', errorMessage: null })
  })

  it('keeps a completed slot immutable', async () => {
    const { db } = database({ scheduled_time: 123, message_id: 'completed', status: 'completed', started_at: '2026-07-30T04:20:00.000Z', completed_at: '2026-07-30T04:21:00.000Z', next_scheduled_time: 456, next_cron: 'queue-self-schedule', error_message: null, updated_at: '2026-07-30T04:21:00.000Z' })
    await expect(claim(db, 'replacement', '2026-07-30T04:30:00.000Z')).resolves.toBe('duplicate')
    await markFastLaneQueueSlotError({ db, scheduledTime: 123, messageId: 'replacement', errorMessage: 'late', updatedAt: '2026-07-30T04:30:00.000Z' })
    await expect(readFastLaneQueueSlot({ db, scheduledTime: 123 })).resolves.toMatchObject({ messageId: 'completed', status: 'completed', nextScheduledTime: 456 })
  })

  it('preserves completed cycle work while a successor is pending', async () => {
    const { db } = database()
    await claim(db, 'owner', '2026-07-30T04:30:00.000Z')
    await stageFastLaneQueueSuccessor({ db, scheduledTime: 123, messageId: 'owner', nextScheduledTime: 456, nextCron: 'queue-self-schedule', updatedAt: '2026-07-30T04:31:00.000Z' })

    await expect(claim(db, 'retry', '2026-07-30T05:00:00.000Z')).resolves.toBe('successor_pending')
    await markFastLaneQueueSlotError({ db, scheduledTime: 123, messageId: 'owner', errorMessage: 'send failed', updatedAt: '2026-07-30T05:00:00.000Z' })
    await expect(readFastLaneQueueSlot({ db, scheduledTime: 123 })).resolves.toMatchObject({
      messageId: 'owner', status: 'processing', nextScheduledTime: 456,
      nextCron: 'queue-self-schedule',
    })
  })

  it('creates an error before claim but cannot overwrite another active lease', async () => {
    const empty = database()
    await markFastLaneQueueSlotError({ db: empty.db, scheduledTime: 123, messageId: 'message-1', errorMessage: 'capacity', updatedAt: '2026-07-30T04:30:00.000Z' })
    await expect(readFastLaneQueueSlot({ db: empty.db, scheduledTime: 123 })).resolves.toMatchObject({ status: 'error' })

    const active = database({ scheduled_time: 123, message_id: 'owner', status: 'processing', started_at: '2026-07-30T04:20:00.000Z', completed_at: null, next_scheduled_time: null, next_cron: null, error_message: null, updated_at: '2026-07-30T04:20:00.000Z' })
    await expect(markFastLaneQueueSlotError({ db: active.db, scheduledTime: 123, messageId: 'other', errorMessage: 'capacity', updatedAt: '2026-07-30T04:30:00.000Z' })).rejects.toThrow('was not persisted')
    await expect(readFastLaneQueueSlot({ db: active.db, scheduledTime: 123 })).resolves.toMatchObject({ messageId: 'owner', status: 'processing' })
  })

  it('completes only the owning message and prunes no processing slots', async () => {
    const { db, sql } = database()
    await claim(db, 'owner', '2026-07-30T04:30:00.000Z')
    await stageFastLaneQueueSuccessor({ db, scheduledTime: 123, messageId: 'owner', nextScheduledTime: 456, nextCron: 'queue-self-schedule', updatedAt: '2026-07-30T04:30:30.000Z' })
    await completeFastLaneQueueSlot({ db, scheduledTime: 123, messageId: 'owner', nextScheduledTime: 456, nextCron: 'queue-self-schedule', completedAt: '2026-07-30T04:31:00.000Z' })
    await pruneFastLaneQueueSlots({ db, cutoff: '2026-07-23T00:00:00.000Z' })
    const deletion = sql.find(value => value.includes('DELETE FROM fast_lane_queue_slots'))
    expect(deletion).toContain("status IN ('completed', 'error')")
    expect(deletion).not.toContain("'processing'")
  })
})
