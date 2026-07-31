export type FastLaneQueueSlotStatus = 'processing' | 'error' | 'completed'

interface FastLaneQueueSlotRow {
  scheduled_time: number
  message_id: string
  status: FastLaneQueueSlotStatus
  started_at: string
  completed_at: string | null
  next_scheduled_time: number | null
  next_cron: string | null
  error_message: string | null
  updated_at: string
}

export interface FastLaneQueueSlot {
  scheduledTime: number
  messageId: string
  status: FastLaneQueueSlotStatus
  startedAt: string
  completedAt: string | null
  nextScheduledTime: number | null
  nextCron: string | null
  errorMessage: string | null
  updatedAt: string
}

export type FastLaneQueueSlotClaim = 'claimed' | 'successor_pending' | 'duplicate'

function mapSlot(row: FastLaneQueueSlotRow): FastLaneQueueSlot {
  return {
    scheduledTime: row.scheduled_time,
    messageId: row.message_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    nextScheduledTime: row.next_scheduled_time,
    nextCron: row.next_cron,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  }
}

export async function readFastLaneQueueSlot(options: {
  db: D1Database
  scheduledTime: number
}): Promise<FastLaneQueueSlot | null> {
  const row = await options.db.prepare(
    `SELECT scheduled_time, message_id, status, started_at, completed_at,
            next_scheduled_time, next_cron, error_message, updated_at
     FROM fast_lane_queue_slots
     WHERE scheduled_time = ?1`,
  ).bind(options.scheduledTime).first<FastLaneQueueSlotRow>()
  return row ? mapSlot(row) : null
}

export async function claimFastLaneQueueSlot(options: {
  db: D1Database
  scheduledTime: number
  messageId: string
  claimedAt: string
  staleBefore: string
}): Promise<FastLaneQueueSlotClaim> {
  await options.db.prepare(
    `INSERT INTO fast_lane_queue_slots (
       scheduled_time, message_id, status, started_at, completed_at,
       next_scheduled_time, next_cron, error_message, updated_at
     ) VALUES (?1, ?2, 'processing', ?3, NULL, NULL, NULL, NULL, ?3)
     ON CONFLICT(scheduled_time) DO UPDATE SET
       message_id = excluded.message_id,
       status = 'processing',
       started_at = excluded.started_at,
       completed_at = NULL,
       next_scheduled_time = NULL,
       next_cron = NULL,
       error_message = NULL,
       updated_at = excluded.updated_at
     WHERE fast_lane_queue_slots.status = 'error'
        OR (fast_lane_queue_slots.status = 'processing'
            AND fast_lane_queue_slots.next_scheduled_time IS NULL
            AND (fast_lane_queue_slots.message_id = excluded.message_id
                 OR fast_lane_queue_slots.updated_at <= ?4))`,
  ).bind(
    options.scheduledTime,
    options.messageId,
    options.claimedAt,
    options.staleBefore,
  ).run()

  const slot = await readFastLaneQueueSlot({
    db: options.db,
    scheduledTime: options.scheduledTime,
  })
  if (slot?.status === 'processing' && slot.nextScheduledTime !== null) {
    return 'successor_pending'
  }
  return slot?.messageId === options.messageId && slot.status === 'processing'
    ? 'claimed'
    : 'duplicate'
}

export async function stageFastLaneQueueSuccessor(options: {
  db: D1Database
  scheduledTime: number
  messageId: string
  nextScheduledTime: number
  nextCron: string
  updatedAt: string
}): Promise<void> {
  await options.db.prepare(
    `UPDATE fast_lane_queue_slots
     SET next_scheduled_time = ?3,
         next_cron = ?4,
         updated_at = ?5
     WHERE scheduled_time = ?1
       AND message_id = ?2
       AND status = 'processing'`,
  ).bind(
    options.scheduledTime,
    options.messageId,
    options.nextScheduledTime,
    options.nextCron,
    options.updatedAt,
  ).run()

  const slot = await readFastLaneQueueSlot({ db: options.db, scheduledTime: options.scheduledTime })
  if (slot?.status !== 'processing'
    || slot.nextScheduledTime !== options.nextScheduledTime
    || slot.nextCron !== options.nextCron) {
    throw new Error('fast-lane Queue successor was not staged')
  }
}

export async function markFastLaneQueueSlotError(options: {
  db: D1Database
  scheduledTime: number
  messageId: string
  errorMessage: string
  updatedAt: string
}): Promise<void> {
  await options.db.prepare(
    `INSERT INTO fast_lane_queue_slots (
       scheduled_time, message_id, status, started_at, completed_at,
       next_scheduled_time, next_cron, error_message, updated_at
     ) VALUES (?1, ?2, 'error', ?4, NULL, NULL, NULL, ?3, ?4)
     ON CONFLICT(scheduled_time) DO UPDATE SET
       message_id = excluded.message_id,
       status = 'error',
       started_at = excluded.started_at,
       completed_at = NULL,
       next_scheduled_time = NULL,
       next_cron = NULL,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at
     WHERE fast_lane_queue_slots.status = 'error'
        OR (fast_lane_queue_slots.status = 'processing'
            AND fast_lane_queue_slots.next_scheduled_time IS NULL
            AND fast_lane_queue_slots.message_id = excluded.message_id)`,
  ).bind(
    options.scheduledTime,
    options.messageId,
    options.errorMessage.slice(0, 2_000),
    options.updatedAt,
  ).run()

  const slot = await readFastLaneQueueSlot({
    db: options.db,
    scheduledTime: options.scheduledTime,
  })

  if (slot?.status === 'completed' || (slot?.status === 'processing' && slot.nextScheduledTime !== null)) return

  if (
    !slot
    || slot.messageId !== options.messageId
    || slot.status !== 'error'
  ) {
    throw new Error('fast-lane Queue slot error state was not persisted')
  }
}

export async function completeFastLaneQueueSlot(options: {
  db: D1Database
  scheduledTime: number
  messageId: string
  nextScheduledTime: number
  nextCron: string
  completedAt: string
}): Promise<void> {
  await options.db.prepare(
    `UPDATE fast_lane_queue_slots
     SET status = 'completed',
         completed_at = ?3,
         error_message = NULL,
         updated_at = ?3
     WHERE scheduled_time = ?1
       AND message_id = ?2
       AND status = 'processing'
       AND next_scheduled_time = ?4
       AND next_cron = ?5`,
  ).bind(
    options.scheduledTime,
    options.messageId,
    options.completedAt,
    options.nextScheduledTime,
    options.nextCron,
  ).run()

  const slot = await readFastLaneQueueSlot({
    db: options.db,
    scheduledTime: options.scheduledTime,
  })
  if (
    !slot
    || slot.messageId !== options.messageId
    || slot.status !== 'completed'
    || slot.nextScheduledTime !== options.nextScheduledTime
    || slot.nextCron !== options.nextCron
  ) {
    throw new Error('fast-lane Queue slot completion was not persisted')
  }
}

export async function pruneFastLaneQueueSlots(options: {
  db: D1Database
  cutoff: string
}): Promise<void> {
  await options.db.prepare(
    `DELETE FROM fast_lane_queue_slots
     WHERE status IN ('completed', 'error')
         AND updated_at < ?1`,
  ).bind(options.cutoff).run()
}
