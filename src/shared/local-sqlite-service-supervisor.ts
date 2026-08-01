import {
  canonicalPortableJson,
  type PortableSqliteDatabase,
} from './portable-collector-reference-store'

export type LocalSqliteServiceStatus = 'stopped' | 'running' | 'halted'
export type LocalSqliteServiceEventType =
  | 'initialized'
  | 'started'
  | 'reclaimed'
  | 'heartbeat'
  | 'retry_scheduled'
  | 'stopped'
  | 'halted'

export interface LocalSqliteServiceSnapshotV1 {
  schemaVersion: 1
  profileId: string
  generation: number
  status: LocalSqliteServiceStatus
  ownerId: string | null
  leaseExpiresAt: string | null
  lastHeartbeatAt: string | null
  restartCount: number
  nextStartAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalSqliteServiceEventV1 {
  schemaVersion: 1
  profileId: string
  generation: number
  eventSequence: number
  eventType: LocalSqliteServiceEventType
  ownerId: string | null
  occurredAt: string
  details: Record<string, unknown>
}

interface SupervisorRow {
  profile_id: string
  schema_version: number
  generation: number
  status: LocalSqliteServiceStatus
  owner_id: string | null
  lease_expires_at: string | null
  last_heartbeat_at: string | null
  restart_count: number
  next_start_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

interface EventRow {
  profile_id: string
  generation: number
  event_sequence: number
  event_type: LocalSqliteServiceEventType
  owner_id: string | null
  occurred_at: string
  details_json: string
}

interface SequenceRow {
  next_sequence: number
}

export class LocalSqliteServiceSupervisorError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'not_initialized'
      | 'lease_conflict'
      | 'lease_lost'
      | 'restart_not_due'
      | 'terminal_halt'
      | 'invalid_transition',
    message: string,
  ) {
    super(message)
    this.name = 'LocalSqliteServiceSupervisorError'
  }
}

function requireIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized || !/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/u.test(normalized)) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_input',
      `${name} must be a stable identifier`,
    )
  }
  return normalized
}

function requireText(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_input',
      `${name} must be non-empty`,
    )
  }
  return normalized
}

function requireTimestamp(value: string, name: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_input',
      `${name} must be a canonical ISO timestamp`,
    )
  }
  return value
}

function timestampMillis(value: string): number {
  return new Date(value).getTime()
}

function requireFutureTimestamp(value: string, now: string, name: string): string {
  const timestamp = requireTimestamp(value, name)
  if (timestampMillis(timestamp) <= timestampMillis(now)) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_input',
      `${name} must be later than now`,
    )
  }
  return timestamp
}

function mapSnapshot(row: SupervisorRow): LocalSqliteServiceSnapshotV1 {
  return {
    schemaVersion: 1,
    profileId: row.profile_id,
    generation: row.generation,
    status: row.status,
    ownerId: row.owner_id,
    leaseExpiresAt: row.lease_expires_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    restartCount: row.restart_count,
    nextStartAt: row.next_start_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEvent(row: EventRow): LocalSqliteServiceEventV1 {
  let details: unknown
  try {
    details = JSON.parse(row.details_json)
  } catch {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_transition',
      `service event details are not valid JSON: ${row.profile_id}/${row.generation}/${row.event_sequence}`,
    )
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_transition',
      'service event details must be an object',
    )
  }
  if (canonicalPortableJson(details) !== row.details_json) {
    throw new LocalSqliteServiceSupervisorError(
      'invalid_transition',
      'service event details are not canonical JSON',
    )
  }
  return {
    schemaVersion: 1,
    profileId: row.profile_id,
    generation: row.generation,
    eventSequence: row.event_sequence,
    eventType: row.event_type,
    ownerId: row.owner_id,
    occurredAt: row.occurred_at,
    details: details as Record<string, unknown>,
  }
}

export class LocalSqliteServiceSupervisor {
  constructor(private readonly db: PortableSqliteDatabase) {}

  initialize(options: {
    profileId: string
    now: string
  }): LocalSqliteServiceSnapshotV1 {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const now = requireTimestamp(options.now, 'now')
    return this.db.transaction(() => {
      const existing = this.read(profileId)
      if (existing) return existing
      this.db.run(
        `INSERT INTO collector_local_service_supervisor (
           profile_id, schema_version, generation, status, owner_id,
           lease_expires_at, last_heartbeat_at, restart_count,
           next_start_at, last_error_code, last_error_message,
           created_at, updated_at
         ) VALUES (?, 1, 0, 'stopped', NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?)`,
        [profileId, now, now],
      )
      this.appendEvent({
        profileId,
        generation: 0,
        eventType: 'initialized',
        ownerId: null,
        occurredAt: now,
        details: { status: 'stopped' },
      })
      return this.requireSnapshot(profileId)
    })
  }

  get(profileId: string): LocalSqliteServiceSnapshotV1 | undefined {
    return this.read(requireIdentifier(profileId, 'profileId'))
  }

  listEvents(profileId: string): LocalSqliteServiceEventV1[] {
    const normalized = requireIdentifier(profileId, 'profileId')
    return this.db
      .all<EventRow>(
        `SELECT profile_id, generation, event_sequence, event_type,
                owner_id, occurred_at, details_json
         FROM collector_local_service_events
         WHERE profile_id = ?
         ORDER BY generation, event_sequence`,
        [normalized],
      )
      .map(mapEvent)
  }

  start(options: {
    profileId: string
    ownerId: string
    now: string
    leaseExpiresAt: string
  }): {
    status: 'started' | 'reclaimed' | 'duplicate'
    snapshot: LocalSqliteServiceSnapshotV1
  } {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const ownerId = requireIdentifier(options.ownerId, 'ownerId')
    const now = requireTimestamp(options.now, 'now')
    const leaseExpiresAt = requireFutureTimestamp(
      options.leaseExpiresAt,
      now,
      'leaseExpiresAt',
    )

    return this.db.transaction(() => {
      const current = this.requireSnapshot(profileId)
      if (current.status === 'halted') {
        throw new LocalSqliteServiceSupervisorError(
          'terminal_halt',
          `service profile is terminally halted: ${profileId}`,
        )
      }
      if (current.status === 'running') {
        const activeLease =
          current.leaseExpiresAt !== null &&
          timestampMillis(current.leaseExpiresAt) > timestampMillis(now)
        if (activeLease) {
          if (current.ownerId === ownerId) {
            return { status: 'duplicate' as const, snapshot: current }
          }
          throw new LocalSqliteServiceSupervisorError(
            'lease_conflict',
            `service lease is owned by ${current.ownerId ?? 'unknown'}`,
          )
        }
        const generation = current.generation + 1
        this.db.run(
          `UPDATE collector_local_service_supervisor
           SET generation = ?, status = 'running', owner_id = ?,
               lease_expires_at = ?, last_heartbeat_at = ?,
               restart_count = restart_count + 1, next_start_at = NULL,
               last_error_code = NULL, last_error_message = NULL,
               updated_at = ?
           WHERE profile_id = ?`,
          [generation, ownerId, leaseExpiresAt, now, now, profileId],
        )
        this.appendEvent({
          profileId,
          generation,
          eventType: 'reclaimed',
          ownerId,
          occurredAt: now,
          details: {
            previousGeneration: current.generation,
            previousOwnerId: current.ownerId,
            previousLeaseExpiresAt: current.leaseExpiresAt,
          },
        })
        return {
          status: 'reclaimed' as const,
          snapshot: this.requireSnapshot(profileId),
        }
      }

      if (
        current.nextStartAt !== null &&
        timestampMillis(current.nextStartAt) > timestampMillis(now)
      ) {
        throw new LocalSqliteServiceSupervisorError(
          'restart_not_due',
          `service restart is not due until ${current.nextStartAt}`,
        )
      }
      const generation = current.generation + 1
      this.db.run(
        `UPDATE collector_local_service_supervisor
         SET generation = ?, status = 'running', owner_id = ?,
             lease_expires_at = ?, last_heartbeat_at = ?, next_start_at = NULL,
             last_error_code = NULL, last_error_message = NULL,
             updated_at = ?
         WHERE profile_id = ?`,
        [generation, ownerId, leaseExpiresAt, now, now, profileId],
      )
      this.appendEvent({
        profileId,
        generation,
        eventType: 'started',
        ownerId,
        occurredAt: now,
        details: { previousGeneration: current.generation },
      })
      return {
        status: 'started' as const,
        snapshot: this.requireSnapshot(profileId),
      }
    })
  }

  heartbeat(options: {
    profileId: string
    ownerId: string
    now: string
    leaseExpiresAt: string
  }): LocalSqliteServiceSnapshotV1 {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const ownerId = requireIdentifier(options.ownerId, 'ownerId')
    const now = requireTimestamp(options.now, 'now')
    const leaseExpiresAt = requireFutureTimestamp(
      options.leaseExpiresAt,
      now,
      'leaseExpiresAt',
    )
    return this.db.transaction(() => {
      const current = this.requireRunningOwner(profileId, ownerId, now)
      this.db.run(
        `UPDATE collector_local_service_supervisor
         SET lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?
         WHERE profile_id = ? AND generation = ? AND owner_id = ?`,
        [leaseExpiresAt, now, now, profileId, current.generation, ownerId],
      )
      this.appendEvent({
        profileId,
        generation: current.generation,
        eventType: 'heartbeat',
        ownerId,
        occurredAt: now,
        details: { leaseExpiresAt },
      })
      return this.requireSnapshot(profileId)
    })
  }

  stop(options: {
    profileId: string
    ownerId: string
    now: string
  }): LocalSqliteServiceSnapshotV1 {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const ownerId = requireIdentifier(options.ownerId, 'ownerId')
    const now = requireTimestamp(options.now, 'now')
    return this.db.transaction(() => {
      const current = this.requireRunningOwner(profileId, ownerId, now)
      this.db.run(
        `UPDATE collector_local_service_supervisor
         SET status = 'stopped', owner_id = NULL, lease_expires_at = NULL,
             last_heartbeat_at = NULL, next_start_at = NULL,
             last_error_code = NULL, last_error_message = NULL,
             updated_at = ?
         WHERE profile_id = ? AND generation = ?`,
        [now, profileId, current.generation],
      )
      this.appendEvent({
        profileId,
        generation: current.generation,
        eventType: 'stopped',
        ownerId,
        occurredAt: now,
        details: { reason: 'graceful_stop' },
      })
      return this.requireSnapshot(profileId)
    })
  }

  failRetryable(options: {
    profileId: string
    ownerId: string
    now: string
    nextStartAt: string
    errorCode: string
    errorMessage: string
  }): LocalSqliteServiceSnapshotV1 {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const ownerId = requireIdentifier(options.ownerId, 'ownerId')
    const now = requireTimestamp(options.now, 'now')
    const nextStartAt = requireFutureTimestamp(
      options.nextStartAt,
      now,
      'nextStartAt',
    )
    const errorCode = requireIdentifier(options.errorCode, 'errorCode')
    const errorMessage = requireText(options.errorMessage, 'errorMessage')
    return this.db.transaction(() => {
      const current = this.requireRunningOwner(profileId, ownerId, now)
      this.db.run(
        `UPDATE collector_local_service_supervisor
         SET status = 'stopped', owner_id = NULL, lease_expires_at = NULL,
             last_heartbeat_at = NULL, restart_count = restart_count + 1,
             next_start_at = ?, last_error_code = ?, last_error_message = ?,
             updated_at = ?
         WHERE profile_id = ? AND generation = ?`,
        [
          nextStartAt,
          errorCode,
          errorMessage,
          now,
          profileId,
          current.generation,
        ],
      )
      this.appendEvent({
        profileId,
        generation: current.generation,
        eventType: 'retry_scheduled',
        ownerId,
        occurredAt: now,
        details: { errorCode, errorMessage, nextStartAt },
      })
      return this.requireSnapshot(profileId)
    })
  }

  failTerminal(options: {
    profileId: string
    ownerId: string
    now: string
    errorCode: string
    errorMessage: string
  }): LocalSqliteServiceSnapshotV1 {
    const profileId = requireIdentifier(options.profileId, 'profileId')
    const ownerId = requireIdentifier(options.ownerId, 'ownerId')
    const now = requireTimestamp(options.now, 'now')
    const errorCode = requireIdentifier(options.errorCode, 'errorCode')
    const errorMessage = requireText(options.errorMessage, 'errorMessage')
    return this.db.transaction(() => {
      const current = this.requireRunningOwner(profileId, ownerId, now)
      this.db.run(
        `UPDATE collector_local_service_supervisor
         SET status = 'halted', owner_id = NULL, lease_expires_at = NULL,
             last_heartbeat_at = NULL, next_start_at = NULL,
             last_error_code = ?, last_error_message = ?, updated_at = ?
         WHERE profile_id = ? AND generation = ?`,
        [errorCode, errorMessage, now, profileId, current.generation],
      )
      this.appendEvent({
        profileId,
        generation: current.generation,
        eventType: 'halted',
        ownerId,
        occurredAt: now,
        details: { errorCode, errorMessage },
      })
      return this.requireSnapshot(profileId)
    })
  }

  assertActiveOwner(options: {
    profileId: string
    ownerId: string
    now: string
  }): LocalSqliteServiceSnapshotV1 {
    return this.requireRunningOwner(
      requireIdentifier(options.profileId, 'profileId'),
      requireIdentifier(options.ownerId, 'ownerId'),
      requireTimestamp(options.now, 'now'),
    )
  }

  private read(profileId: string): LocalSqliteServiceSnapshotV1 | undefined {
    const row = this.db.get<SupervisorRow>(
      `SELECT profile_id, schema_version, generation, status, owner_id,
              lease_expires_at, last_heartbeat_at, restart_count,
              next_start_at, last_error_code, last_error_message,
              created_at, updated_at
       FROM collector_local_service_supervisor
       WHERE profile_id = ?`,
      [profileId],
    )
    return row ? mapSnapshot(row) : undefined
  }

  private requireSnapshot(profileId: string): LocalSqliteServiceSnapshotV1 {
    const snapshot = this.read(profileId)
    if (!snapshot) {
      throw new LocalSqliteServiceSupervisorError(
        'not_initialized',
        `service profile is not initialized: ${profileId}`,
      )
    }
    return snapshot
  }

  private requireRunningOwner(
    profileId: string,
    ownerId: string,
    now: string,
  ): LocalSqliteServiceSnapshotV1 {
    const current = this.requireSnapshot(profileId)
    if (
      current.status !== 'running' ||
      current.ownerId !== ownerId ||
      current.leaseExpiresAt === null
    ) {
      throw new LocalSqliteServiceSupervisorError(
        'lease_lost',
        `service owner does not hold the active lease: ${profileId}/${ownerId}`,
      )
    }
    if (timestampMillis(current.leaseExpiresAt) <= timestampMillis(now)) {
      throw new LocalSqliteServiceSupervisorError(
        'lease_lost',
        `service lease expired at ${current.leaseExpiresAt}`,
      )
    }
    return current
  }

  private appendEvent(options: {
    profileId: string
    generation: number
    eventType: LocalSqliteServiceEventType
    ownerId: string | null
    occurredAt: string
    details: Record<string, unknown>
  }): void {
    const sequence =
      this.db.get<SequenceRow>(
        `SELECT COALESCE(MAX(event_sequence) + 1, 0) AS next_sequence
         FROM collector_local_service_events
         WHERE profile_id = ? AND generation = ?`,
        [options.profileId, options.generation],
      )?.next_sequence ?? 0
    this.db.run(
      `INSERT INTO collector_local_service_events (
         profile_id, generation, event_sequence, event_type,
         owner_id, occurred_at, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        options.profileId,
        options.generation,
        sequence,
        options.eventType,
        options.ownerId,
        options.occurredAt,
        canonicalPortableJson(options.details),
      ],
    )
  }
}
