import type { BootstrapIdentity } from '../collector/current-state/bootstrap-runner'
import { runD1Bootstrap } from '../worker/bootstrap/d1-bootstrap'
import { loadD1BootstrapCheckpoint } from '../worker/repositories/d1-bootstrap-checkpoint-repository'
import { loadSnapshot } from '../worker/repositories/d1-snapshot'
import {
  markSnapshotCleanupEligible,
  removeEligibleSnapshot,
  restorePreviousSnapshot,
} from '../worker/repositories/d1-snapshot-retention'
import {
  activateSnapshot,
  verifySnapshot,
} from '../worker/repositories/d1-snapshot-verify'

const MAX_PAGES_PER_RUN = 25
const MAX_OBJECTS_PER_PAGE = 80
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const D1_SAFETY_THRESHOLD_BYTES = 350 * 1024 * 1024

export type OperatorAction =
  | {
      action: 'status'
      snapshotId: string
    }
  | {
      action: 'bootstrap'
      identity: BootstrapIdentity
      timeoutMs: number
      maxPagesPerRun?: number
      objectLimitPerPage?: number
      maxRetries?: number
    }
  | {
      action: 'verify'
      snapshotId: string
    }
  | {
      action: 'measure'
      snapshotId: string
    }
  | {
      action: 'activate'
      snapshotId: string
    }
  | {
      action: 'restore'
    }
  | {
      action: 'mark_cleanup'
      snapshotId: string
      eligibleAt: string
      reason: string
    }
  | {
      action: 'remove_cleanup'
      snapshotId: string
      removeAt: string
    }

interface CountRow {
  count: number
}

interface SizeRow {
  raw_bytes: number | null
  projection_bytes: number | null
  maximum_row_bytes: number | null
}

interface BatchSizeRow {
  maximum_batch_bytes: number | null
}

interface ManifestRow {
  manifest_hash: string
  batch_count: number
  object_count: number
  vault_count: number
  loan_broker_count: number
  loan_count: number
  normalized_bytes: number
  verified_at: string
}

interface ActiveRow {
  snapshot_id: string
  rollback_snapshot_id: string | null
}

export interface OperatorEvidence {
  schemaVersion: 1
  action: OperatorAction['action']
  generatedAt: string
  result: Record<string, unknown>
}

function positiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer from 1 to ${maximum}`)
  }
  return value
}

function retryCount(value: number | undefined): number {
  const retries = value ?? 0
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    throw new Error(`maxRetries must be an integer from 0 to ${MAX_RETRIES}`)
  }
  return retries
}

function validateIdentity(identity: BootstrapIdentity): void {
  if (!identity.snapshotId.trim()) throw new Error('snapshotId is required')
  if (!identity.epochId.trim()) throw new Error('epochId is required')
  if (!identity.endpoint.trim()) throw new Error('endpoint is required')
  if (!Number.isSafeInteger(identity.ledgerIndex) || identity.ledgerIndex < 0) {
    throw new Error('ledgerIndex must be a non-negative safe integer')
  }
  if (!/^[A-Fa-f0-9]{64}$/.test(identity.ledgerHash)) {
    throw new Error('ledgerHash must be a 64-character hexadecimal value')
  }
}

async function loadManifest(db: D1Database, snapshotId: string): Promise<ManifestRow | null> {
  return db
    .prepare(
      `SELECT manifest_hash, batch_count, object_count, vault_count,
              loan_broker_count, loan_count, normalized_bytes, verified_at
       FROM current_state_d1_snapshot_manifests
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshotId)
    .first<ManifestRow>()
}

async function loadActive(db: D1Database): Promise<ActiveRow | null> {
  return db
    .prepare(
      `SELECT snapshot_id, rollback_snapshot_id
       FROM current_state_d1_active_snapshots
       WHERE network = 'devnet'`,
    )
    .first<ActiveRow>()
}

async function countRows(db: D1Database, table: string, snapshotId: string): Promise<number> {
  const allowed = new Set([
    'current_state_d1_batches',
    'current_state_d1_vaults',
    'current_state_d1_loan_brokers',
    'current_state_d1_loans',
  ])
  if (!allowed.has(table)) throw new Error('Unsupported measurement table')
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE snapshot_id = ?1`)
    .bind(snapshotId)
    .first<CountRow>()
  return Number(row?.count ?? 0)
}

async function objectSizes(
  db: D1Database,
  table: 'current_state_d1_vaults' | 'current_state_d1_loan_brokers' | 'current_state_d1_loans',
  snapshotId: string,
): Promise<SizeRow> {
  const row = await db
    .prepare(
      `SELECT SUM(LENGTH(raw_json)) AS raw_bytes,
              SUM(LENGTH(projection_json)) AS projection_bytes,
              MAX(LENGTH(raw_json) + LENGTH(projection_json)) AS maximum_row_bytes
       FROM ${table}
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshotId)
    .first<SizeRow>()
  return row ?? { raw_bytes: 0, projection_bytes: 0, maximum_row_bytes: 0 }
}

export async function measureSnapshot(
  db: D1Database,
  snapshotId: string,
): Promise<Record<string, unknown>> {
  let queryCount = 0
  const count = async (table: string) => {
    queryCount += 1
    return countRows(db, table, snapshotId)
  }
  const sizes = async (
    table: 'current_state_d1_vaults' | 'current_state_d1_loan_brokers' | 'current_state_d1_loans',
  ) => {
    queryCount += 1
    return objectSizes(db, table, snapshotId)
  }

  queryCount += 1
  const snapshot = await loadSnapshot(db, snapshotId)
  if (!snapshot) throw new Error('D1 snapshot does not exist')

  const [batchCount, vaultCount, brokerCount, loanCount, vaultSizes, brokerSizes, loanSizes] =
    await Promise.all([
      count('current_state_d1_batches'),
      count('current_state_d1_vaults'),
      count('current_state_d1_loan_brokers'),
      count('current_state_d1_loans'),
      sizes('current_state_d1_vaults'),
      sizes('current_state_d1_loan_brokers'),
      sizes('current_state_d1_loans'),
    ])

  queryCount += 1
  const batchSize = await db
    .prepare(
      `SELECT MAX(normalized_bytes) AS maximum_batch_bytes
       FROM current_state_d1_batches
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshotId)
    .first<BatchSizeRow>()

  const rawBytes =
    Number(vaultSizes.raw_bytes ?? 0) +
    Number(brokerSizes.raw_bytes ?? 0) +
    Number(loanSizes.raw_bytes ?? 0)
  const projectionBytes =
    Number(vaultSizes.projection_bytes ?? 0) +
    Number(brokerSizes.projection_bytes ?? 0) +
    Number(loanSizes.projection_bytes ?? 0)
  const maximumRowBytes = Math.max(
    Number(vaultSizes.maximum_row_bytes ?? 0),
    Number(brokerSizes.maximum_row_bytes ?? 0),
    Number(loanSizes.maximum_row_bytes ?? 0),
  )
  const objectRows = vaultCount + brokerCount + loanCount
  const rowsWrittenEstimate = 1 + batchCount + objectRows + 1 + 1
  const logicalBytes = rawBytes + projectionBytes + snapshot.normalized_bytes
  const projectedBytesWithIndexes = Math.ceil(logicalBytes * 1.75)

  return {
    snapshotId,
    status: snapshot.status,
    ledgerIndex: snapshot.ledger_index,
    pageCount: snapshot.page_count,
    requestCount: snapshot.request_count,
    decodedObjectCount: snapshot.decoded_object_count,
    relevantObjectCount: objectRows,
    batchCount,
    vaultCount,
    loanBrokerCount: brokerCount,
    loanCount,
    rawBytes,
    projectionBytes,
    normalizedBytes: snapshot.normalized_bytes,
    logicalBytes,
    projectedBytesWithIndexes,
    safetyThresholdBytes: D1_SAFETY_THRESHOLD_BYTES,
    withinSafetyThreshold: projectedBytesWithIndexes < D1_SAFETY_THRESHOLD_BYTES,
    rowsWrittenEstimate,
    queryCount,
    maximumRowBytes,
    maximumBatchBytes: Number(batchSize?.maximum_batch_bytes ?? 0),
    retries: 0,
    durationMs: snapshot.duration_ms,
  }
}

async function statusEvidence(db: D1Database, snapshotId: string): Promise<Record<string, unknown>> {
  const [snapshot, checkpoint, manifest, active] = await Promise.all([
    loadSnapshot(db, snapshotId),
    loadD1BootstrapCheckpoint(db, snapshotId),
    loadManifest(db, snapshotId),
    loadActive(db),
  ])
  if (!snapshot) throw new Error('D1 snapshot does not exist')
  return {
    snapshotId,
    status: snapshot.status,
    ledgerIndex: snapshot.ledger_index,
    ledgerHash: snapshot.ledger_hash,
    checkpoint: checkpoint
      ? {
          nextBatchSequence: checkpoint.nextBatchSequence,
          scanComplete: checkpoint.scanComplete,
          markerPresent: checkpoint.nextMarker !== null,
          metrics: checkpoint.metrics,
          updatedAt: checkpoint.updatedAt,
        }
      : null,
    manifest,
    active: active?.snapshot_id === snapshotId,
    rollback: active?.rollback_snapshot_id === snapshotId,
  }
}

export async function executeD1CurrentStateOperator(options: {
  db: D1Database
  input: OperatorAction
  now?: () => string
}): Promise<OperatorEvidence> {
  const now = options.now ?? (() => new Date().toISOString())
  const generatedAt = now()

  switch (options.input.action) {
    case 'status':
      return {
        schemaVersion: 1,
        action: 'status',
        generatedAt,
        result: await statusEvidence(options.db, options.input.snapshotId),
      }

    case 'bootstrap': {
      validateIdentity(options.input.identity)
      const timeoutMs = positiveInteger(options.input.timeoutMs, 'timeoutMs', MAX_TIMEOUT_MS)
      const maxPagesPerRun = positiveInteger(
        options.input.maxPagesPerRun ?? MAX_PAGES_PER_RUN,
        'maxPagesPerRun',
        MAX_PAGES_PER_RUN,
      )
      const objectLimitPerPage = positiveInteger(
        options.input.objectLimitPerPage ?? MAX_OBJECTS_PER_PAGE,
        'objectLimitPerPage',
        MAX_OBJECTS_PER_PAGE,
      )
      const maxRetries = retryCount(options.input.maxRetries)
      let retries = 0
      const started = Date.now()
      let result
      while (true) {
        try {
          result = await runD1Bootstrap({
            db: options.db,
            identity: options.input.identity,
            timeoutMs,
            maxPagesPerRun,
            objectLimitPerPage,
            now,
            verifyOnComplete: false,
          })
          break
        } catch (error) {
          if (retries >= maxRetries) throw error
          retries += 1
        }
      }
      return {
        schemaVersion: 1,
        action: 'bootstrap',
        generatedAt,
        result: {
          snapshotId: options.input.identity.snapshotId,
          status: result.status,
          nextBatchSequence: result.checkpoint.nextBatchSequence,
          scanComplete: result.checkpoint.scanComplete,
          markerPresent: result.checkpoint.nextMarker !== null,
          metrics: result.checkpoint.metrics,
          retries,
          operatorWallTimeMs: Date.now() - started,
          heapUsedBytes: process.memoryUsage().heapUsed,
          activationPerformed: false,
        },
      }
    }

    case 'verify': {
      const snapshot = await loadSnapshot(options.db, options.input.snapshotId)
      const checkpoint = await loadD1BootstrapCheckpoint(options.db, options.input.snapshotId)
      if (!snapshot) throw new Error('D1 snapshot does not exist')
      if (!checkpoint?.scanComplete) throw new Error('D1 snapshot scan is not complete')
      const verified = await verifySnapshot({
        db: options.db,
        snapshotId: options.input.snapshotId,
        pageCount: checkpoint.metrics.pages,
        requestCount: checkpoint.metrics.requests,
        decodedObjectCount: checkpoint.metrics.decodedObjects,
        durationMs: checkpoint.metrics.elapsedMs,
        verifiedAt: generatedAt,
      })
      return {
        schemaVersion: 1,
        action: 'verify',
        generatedAt,
        result: {
          snapshotId: options.input.snapshotId,
          manifestHash: verified.manifestHash,
          manifest: verified.manifest,
          activationPerformed: false,
        },
      }
    }

    case 'measure':
      return {
        schemaVersion: 1,
        action: 'measure',
        generatedAt,
        result: await measureSnapshot(options.db, options.input.snapshotId),
      }

    case 'activate':
      return {
        schemaVersion: 1,
        action: 'activate',
        generatedAt,
        result: await activateSnapshot({
          db: options.db,
          snapshotId: options.input.snapshotId,
          activatedAt: generatedAt,
        }),
      }

    case 'restore':
      return {
        schemaVersion: 1,
        action: 'restore',
        generatedAt,
        result: await restorePreviousSnapshot({ db: options.db, restoredAt: generatedAt }),
      }

    case 'mark_cleanup':
      await markSnapshotCleanupEligible({
        db: options.db,
        snapshotId: options.input.snapshotId,
        eligibleAt: options.input.eligibleAt,
        reason: options.input.reason,
      })
      return {
        schemaVersion: 1,
        action: 'mark_cleanup',
        generatedAt,
        result: { snapshotId: options.input.snapshotId, eligibleAt: options.input.eligibleAt },
      }

    case 'remove_cleanup':
      return {
        schemaVersion: 1,
        action: 'remove_cleanup',
        generatedAt,
        result: {
          snapshotId: options.input.snapshotId,
          removed: await removeEligibleSnapshot({
            db: options.db,
            snapshotId: options.input.snapshotId,
            removeAt: options.input.removeAt,
          }),
        },
      }
  }
}
