import {
  encodePortablePhaseMessage,
  parsePortablePhaseMessage,
  type PortableCollectorPhaseMessageV1,
} from './portable-collector-messages'
import {
  canonicalPortableJson,
  type PortableSqliteDatabase,
} from './portable-collector-reference-store'

export type PortableSchedulerFailureClassification =
  | 'retryable_transport'
  | 'retryable_storage'
  | 'lease_lost'
  | 'stale_boundary'
  | 'parent_hash_mismatch'
  | 'reset_detected'
  | 'epoch_mismatch'
  | 'base_mismatch'
  | 'digest_mismatch'
  | 'resource_halt'
  | 'invalid_message'
  | 'terminal_internal'

export interface PortableSchedulerMessageSnapshot {
  messageId: string
  phase: PortableCollectorPhaseMessageV1['phase']
  payloadJson: string
  status: 'pending' | 'leased' | 'completed' | 'error'
  availableAt: string
  leaseOwner: string | null
  leaseExpiresAt: string | null
  attemptCount: number
  resultJson: string | null
  errorClassification: PortableSchedulerFailureClassification | null
  errorMessage: string | null
  successorMessageId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type PortableSchedulerClaimResult =
  | {
      status: 'claimed'
      message: PortableCollectorPhaseMessageV1
      snapshot: PortableSchedulerMessageSnapshot
    }
  | {
      status: 'completed'
      snapshot: PortableSchedulerMessageSnapshot
    }
  | {
      status: 'error'
      snapshot: PortableSchedulerMessageSnapshot
    }
  | {
      status: 'unavailable'
      reason: 'not_found' | 'not_ready' | 'fresh_lease'
      snapshot?: PortableSchedulerMessageSnapshot
    }

export interface PortableSchedulerOutboxSnapshot {
  currentMessageId: string
  successorMessageId: string
  successorPayloadJson: string
  successorAvailableAt: string
  status: 'pending' | 'dispatched'
  createdAt: string
  dispatchedAt: string | null
}

interface SchedulerMessageRow {
  message_id: string
  phase: 'scan' | 'commit' | 'finalize'
  payload_json: string
  status: 'pending' | 'leased' | 'completed' | 'error'
  available_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  attempt_count: number
  result_json: string | null
  error_classification: PortableSchedulerFailureClassification | null
  error_message: string | null
  successor_message_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface SchedulerOutboxRow {
  current_message_id: string
  successor_message_id: string
  successor_payload_json: string
  successor_available_at: string
  status: 'pending' | 'dispatched'
  created_at: string
  dispatched_at: string | null
}

export class PortableSchedulerLeaseLostError extends Error {
  constructor(messageId: string) {
    super(`portable scheduler lease lost: ${messageId}`)
    this.name = 'PortableSchedulerLeaseLostError'
  }
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function canonicalTimestamp(value: string, name: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${name} must be a valid timestamp`)
  return timestamp.toISOString()
}

function mapMessage(row: SchedulerMessageRow): PortableSchedulerMessageSnapshot {
  return {
    messageId: row.message_id,
    phase: row.phase,
    payloadJson: row.payload_json,
    status: row.status,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count,
    resultJson: row.result_json,
    errorClassification: row.error_classification,
    errorMessage: row.error_message,
    successorMessageId: row.successor_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function mapOutbox(row: SchedulerOutboxRow): PortableSchedulerOutboxSnapshot {
  return {
    currentMessageId: row.current_message_id,
    successorMessageId: row.successor_message_id,
    successorPayloadJson: row.successor_payload_json,
    successorAvailableAt: row.successor_available_at,
    status: row.status,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
  }
}

function canonicalResult(value: unknown): string {
  return canonicalPortableJson(value)
}

function isRetryable(classification: PortableSchedulerFailureClassification): boolean {
  return classification === 'retryable_transport' || classification === 'retryable_storage'
}

export class PortableCollectorScheduler {
  constructor(private readonly db: PortableSqliteDatabase) {}

  enqueue(
    message: PortableCollectorPhaseMessageV1,
    options: { availableAt: string; createdAt: string },
  ): PortableSchedulerMessageSnapshot {
    const payloadJson = encodePortablePhaseMessage(message)
    const availableAt = canonicalTimestamp(options.availableAt, 'availableAt')
    const createdAt = canonicalTimestamp(options.createdAt, 'createdAt')

    this.db.run(
      `INSERT OR IGNORE INTO collector_scheduler_messages (
         message_id, schema_version, phase, payload_json, status,
         available_at, attempt_count, created_at, updated_at
       ) VALUES (?, 1, ?, ?, 'pending', ?, 0, ?, ?)`,
      [message.messageId, message.phase, payloadJson, availableAt, createdAt, createdAt],
    )

    const existing = this.getMessage(message.messageId)
    if (!existing) throw new Error(`scheduler message was not persisted: ${message.messageId}`)
    if (
      existing.phase !== message.phase ||
      existing.payloadJson !== payloadJson ||
      existing.availableAt !== availableAt
    ) {
      throw new Error(`scheduler message identity conflict: ${message.messageId}`)
    }
    return existing
  }

  getMessage(messageId: string): PortableSchedulerMessageSnapshot | undefined {
    const row = this.db.get<SchedulerMessageRow>(
      `SELECT
         message_id, phase, payload_json, status, available_at,
         lease_owner, lease_expires_at, attempt_count, result_json,
         error_classification, error_message, successor_message_id,
         created_at, updated_at, completed_at
       FROM collector_scheduler_messages
       WHERE message_id = ?`,
      [messageId],
    )
    return row ? mapMessage(row) : undefined
  }

  claim(
    messageId: string,
    options: { leaseOwner: string; now: string; leaseExpiresAt: string },
  ): PortableSchedulerClaimResult {
    const leaseOwner = nonEmpty(options.leaseOwner, 'leaseOwner')
    const now = canonicalTimestamp(options.now, 'now')
    const leaseExpiresAt = canonicalTimestamp(options.leaseExpiresAt, 'leaseExpiresAt')
    if (leaseExpiresAt <= now) throw new Error('leaseExpiresAt must be after now')

    const before = this.getMessage(messageId)
    if (!before) return { status: 'unavailable', reason: 'not_found' }
    if (before.status === 'completed') return { status: 'completed', snapshot: before }
    if (before.status === 'error') return { status: 'error', snapshot: before }
    if (before.status === 'pending' && before.availableAt > now) {
      return { status: 'unavailable', reason: 'not_ready', snapshot: before }
    }
    if (
      before.status === 'leased' &&
      before.leaseExpiresAt !== null &&
      before.leaseExpiresAt > now
    ) {
      return { status: 'unavailable', reason: 'fresh_lease', snapshot: before }
    }

    const result = this.db.run(
      `UPDATE collector_scheduler_messages
       SET status = 'leased',
           lease_owner = ?,
           lease_expires_at = ?,
           attempt_count = attempt_count + 1,
           updated_at = ?
       WHERE message_id = ?
         AND (
           (status = 'pending' AND available_at <= ?) OR
           (status = 'leased' AND lease_expires_at <= ?)
         )`,
      [leaseOwner, leaseExpiresAt, now, messageId, now, now],
    )
    if (result.changes !== 1) {
      const current = this.getMessage(messageId)
      if (current?.status === 'completed') return { status: 'completed', snapshot: current }
      if (current?.status === 'error') return { status: 'error', snapshot: current }
      return {
        status: 'unavailable',
        reason: current?.status === 'leased' ? 'fresh_lease' : 'not_ready',
        snapshot: current,
      }
    }

    const snapshot = this.getMessage(messageId)
    if (!snapshot) throw new Error(`claimed scheduler message disappeared: ${messageId}`)
    return {
      status: 'claimed',
      message: parsePortablePhaseMessage(snapshot.payloadJson),
      snapshot,
    }
  }

  claimNext(options: {
    leaseOwner: string
    now: string
    leaseExpiresAt: string
  }): PortableSchedulerClaimResult {
    const now = canonicalTimestamp(options.now, 'now')
    const row = this.db.get<{ message_id: string }>(
      `SELECT message_id
       FROM collector_scheduler_messages
       WHERE (status = 'pending' AND available_at <= ?)
          OR (status = 'leased' AND lease_expires_at <= ?)
       ORDER BY available_at, created_at, message_id
       LIMIT 1`,
      [now, now],
    )
    if (!row) return { status: 'unavailable', reason: 'not_found' }
    return this.claim(row.message_id, options)
  }

  completeWithSuccessor<T>(options: {
    messageId: string
    leaseOwner: string
    now: string
    result: unknown
    successor: PortableCollectorPhaseMessageV1
    successorAvailableAt: string
    mutate?: () => T
  }): { status: 'completed' | 'duplicate'; mutationResult: T | undefined } {
    const leaseOwner = nonEmpty(options.leaseOwner, 'leaseOwner')
    const now = canonicalTimestamp(options.now, 'now')
    const successorAvailableAt = canonicalTimestamp(
      options.successorAvailableAt,
      'successorAvailableAt',
    )
    const resultJson = canonicalResult(options.result)
    const successorPayloadJson = encodePortablePhaseMessage(options.successor)

    return this.db.transaction(() => {
      const current = this.getMessage(options.messageId)
      if (!current) throw new Error(`scheduler message not found: ${options.messageId}`)
      if (current.status === 'completed') {
        const existingOutbox = this.getOutbox(options.messageId)
        if (
          !existingOutbox ||
          current.resultJson !== resultJson ||
          current.successorMessageId !== options.successor.messageId ||
          existingOutbox.successorPayloadJson !== successorPayloadJson ||
          existingOutbox.successorAvailableAt !== successorAvailableAt
        ) {
          throw new Error(`completed scheduler message result conflict: ${options.messageId}`)
        }
        return { status: 'duplicate', mutationResult: undefined }
      }
      this.requireLease(current, leaseOwner, now)

      const mutationResult = options.mutate?.()

      this.db.run(
        `INSERT OR IGNORE INTO collector_scheduler_outbox (
           current_message_id, successor_message_id, successor_payload_json,
           successor_available_at, status, created_at, dispatched_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
        [
          options.messageId,
          options.successor.messageId,
          successorPayloadJson,
          successorAvailableAt,
          now,
        ],
      )
      const outbox = this.getOutbox(options.messageId)
      if (
        !outbox ||
        outbox.successorMessageId !== options.successor.messageId ||
        outbox.successorPayloadJson !== successorPayloadJson ||
        outbox.successorAvailableAt !== successorAvailableAt
      ) {
        throw new Error(`scheduler successor outbox conflict: ${options.messageId}`)
      }

      const completed = this.db.run(
        `UPDATE collector_scheduler_messages
         SET status = 'completed',
             result_json = ?,
             successor_message_id = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             error_classification = NULL,
             error_message = NULL,
             completed_at = ?,
             updated_at = ?
         WHERE message_id = ?
           AND status = 'leased'
           AND lease_owner = ?
           AND lease_expires_at > ?`,
        [
          resultJson,
          options.successor.messageId,
          now,
          now,
          options.messageId,
          leaseOwner,
          now,
        ],
      )
      if (completed.changes !== 1) throw new PortableSchedulerLeaseLostError(options.messageId)
      return { status: 'completed', mutationResult }
    })
  }

  retry(options: {
    messageId: string
    leaseOwner: string
    now: string
    availableAt: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    if (!isRetryable(options.classification)) {
      throw new Error('retry requires a retryable failure classification')
    }
    const leaseOwner = nonEmpty(options.leaseOwner, 'leaseOwner')
    const now = canonicalTimestamp(options.now, 'now')
    const availableAt = canonicalTimestamp(options.availableAt, 'availableAt')
    if (availableAt <= now) throw new Error('retry availableAt must be after now')
    const current = this.getMessage(options.messageId)
    if (!current) throw new Error(`scheduler message not found: ${options.messageId}`)
    this.requireLease(current, leaseOwner, now)

    const retried = this.db.run(
      `UPDATE collector_scheduler_messages
       SET status = 'pending',
           available_at = ?,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_classification = ?,
           error_message = ?,
           updated_at = ?
       WHERE message_id = ?
         AND status = 'leased'
         AND lease_owner = ?
         AND lease_expires_at > ?`,
      [
        availableAt,
        options.classification,
        nonEmpty(options.errorMessage, 'errorMessage'),
        now,
        options.messageId,
        leaseOwner,
        now,
      ],
    )
    if (retried.changes !== 1) throw new PortableSchedulerLeaseLostError(options.messageId)
  }

  failTerminal(options: {
    messageId: string
    leaseOwner: string
    now: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    if (isRetryable(options.classification) || options.classification === 'lease_lost') {
      throw new Error('terminal failure requires a terminal classification')
    }
    const leaseOwner = nonEmpty(options.leaseOwner, 'leaseOwner')
    const now = canonicalTimestamp(options.now, 'now')
    const current = this.getMessage(options.messageId)
    if (!current) throw new Error(`scheduler message not found: ${options.messageId}`)
    this.requireLease(current, leaseOwner, now)

    const failed = this.db.run(
      `UPDATE collector_scheduler_messages
       SET status = 'error',
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_classification = ?,
           error_message = ?,
           successor_message_id = NULL,
           updated_at = ?
       WHERE message_id = ?
         AND status = 'leased'
         AND lease_owner = ?
         AND lease_expires_at > ?`,
      [
        options.classification,
        nonEmpty(options.errorMessage, 'errorMessage'),
        now,
        options.messageId,
        leaseOwner,
        now,
      ],
    )
    if (failed.changes !== 1) throw new PortableSchedulerLeaseLostError(options.messageId)
  }

  getOutbox(currentMessageId: string): PortableSchedulerOutboxSnapshot | undefined {
    const row = this.db.get<SchedulerOutboxRow>(
      `SELECT
         current_message_id, successor_message_id, successor_payload_json,
         successor_available_at, status, created_at, dispatched_at
       FROM collector_scheduler_outbox
       WHERE current_message_id = ?`,
      [currentMessageId],
    )
    return row ? mapOutbox(row) : undefined
  }

  dispatchNextOutbox(options: {
    now: string
  }): PortableSchedulerOutboxSnapshot | undefined {
    const now = canonicalTimestamp(options.now, 'now')

    return this.db.transaction(() => {
      const row = this.db.get<SchedulerOutboxRow>(
        `SELECT
           current_message_id, successor_message_id, successor_payload_json,
           successor_available_at, status, created_at, dispatched_at
         FROM collector_scheduler_outbox
         WHERE status = 'pending'
         ORDER BY created_at, current_message_id
         LIMIT 1`,
      )
      if (!row) return undefined
      const successor = parsePortablePhaseMessage(row.successor_payload_json)
      this.enqueue(successor, {
        availableAt: row.successor_available_at,
        createdAt: now,
      })
      const dispatched = this.db.run(
        `UPDATE collector_scheduler_outbox
         SET status = 'dispatched', dispatched_at = ?
         WHERE current_message_id = ? AND status = 'pending'`,
        [now, row.current_message_id],
      )
      if (dispatched.changes !== 1) {
        const existing = this.getOutbox(row.current_message_id)
        if (existing?.status !== 'dispatched') {
          throw new Error(`scheduler outbox dispatch conflict: ${row.current_message_id}`)
        }
        return existing
      }
      return this.getOutbox(row.current_message_id)
    })
  }

  private requireLease(
    current: PortableSchedulerMessageSnapshot,
    leaseOwner: string,
    now: string,
  ): void {
    if (
      current.status !== 'leased' ||
      current.leaseOwner !== leaseOwner ||
      current.leaseExpiresAt === null ||
      current.leaseExpiresAt <= now
    ) {
      throw new PortableSchedulerLeaseLostError(current.messageId)
    }
  }
}
