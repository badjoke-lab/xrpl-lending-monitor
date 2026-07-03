import type { BootstrapIdentity } from '../../collector/current-state/bootstrap-runner'
import { runD1Bootstrap } from '../bootstrap/d1-bootstrap'
import { loadD1BootstrapCheckpoint } from '../repositories/d1-bootstrap-checkpoint-repository'
import { loadSnapshot } from '../repositories/d1-snapshot'
import {
  markSnapshotCleanupEligible,
  removeEligibleSnapshot,
  restorePreviousSnapshot,
} from '../repositories/d1-snapshot-retention'
import { activateSnapshot, verifySnapshot } from '../repositories/d1-snapshot-verify'

const MAX_PAGES_PER_RUN = 25
const MAX_OBJECTS_PER_PAGE = 80
const MAX_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const D1_SAFETY_THRESHOLD_BYTES = 350_000_000

export interface OperatorBootstrapIdentity {
  snapshotId: string
  epochId: string
  endpoint: string
  ledgerIndex: number
  ledgerHash: string
}

export type D1OperatorAction =
  | { action: 'status'; snapshotId: string }
  | {
      action: 'bootstrap'
      identity: OperatorBootstrapIdentity
      timeoutMs: number
      maxPagesPerRun?: number
      objectLimitPerPage?: number
      maxRetries?: number
    }
  | { action: 'verify'; snapshotId: string }
  | { action: 'measure'; snapshotId: string }
  | { action: 'activate'; snapshotId: string }
  | { action: 'restore' }
  | { action: 'mark_cleanup'; snapshotId: string; eligibleAt: string; reason: string }
  | { action: 'remove_cleanup'; snapshotId: string; removeAt: string }

export interface D1OperatorEvidence {
  schemaVersion: 1
  action: D1OperatorAction['action']
  generatedAt: string
  result: Record<string, unknown>
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

interface ActiveRow {
  snapshot_id: string
  rollback_snapshot_id: string | null
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

interface MeasurementSnapshotRow {
  id: string
  status: 'building' | 'verified' | 'failed' | 'superseded'
  ledger_index: number
  page_count: number
  request_count: number
  decoded_object_count: number
  normalized_bytes: number
  duration_ms: number | null
}

function boundedPositiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer from 1 to ${maximum}`)
  }
  return value
}

function boundedRetries(value: number | undefined): number {
  const retries = value ?? 0
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    throw new Error(`maxRetries must be an integer from 0 to ${MAX_RETRIES}`)
  }
  return retries
}

function validateIdentity(identity: OperatorBootstrapIdentity): void {
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

function bootstrapIdentity(identity: OperatorBootstrapIdentity): BootstrapIdentity {
  return { ...identity, objectPrefix: `d1/${identity.snapshotId}` }
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

async function loadMeasurementSnapshot(
  db: D1Database,
  snapshotId: string,
): Promise<MeasurementSnapshotRow | null> {
  return db
    .prepare(
      `SELECT id, status, ledger_index, page_count, request_count,
              decoded_object_count, normalized_bytes, duration_ms
       FROM current_state_d1_snapshots
       WHERE id = ?1`,
    )
    .bind(snapshotId)
    .first<MeasurementSnapshotRow>()
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
  return (
    (await db
      .prepare(
        `SELECT SUM(LENGTH(raw_json)) AS raw_bytes,
                SUM(LENGTH(projection_json)) AS projection_bytes,
                MAX(LENGTH(raw_json) + LENGTH(projection_json)) AS maximum_row_bytes
         FROM ${table}
         WHERE snapshot_id = ?1`,
      )
      .bind(snapshotId)
      .first<SizeRow>()) ?? {
      raw_bytes: 0,
      projection_bytes: 0,
      maximum_row_bytes: 0,
    }
  )
}

export async function measureD1Snapshot(
  db: D1Database,
  snapshotId: string,
): Promise<Record<string, unknown>> {
  let queryCount = 1
  const snapshot = await loadMeasurementSnapshot(db, snapshotId)
  if (!snapshot) throw new Error('D1 snapshot does not exist')

  const counted = async (table: string) => {
    queryCount += 1
    return countRows(db, table, snapshotId)
  }
  const sized = async (
    table: 'current_state_d1_vaults' | 'current_state_d1_loan_brokers' | 'current_state_d1_loans',
  ) => {
    queryCount += 1
    return objectSizes(db, table, snapshotId)
  }

  const [batchCount, vaultCount, brokerCount, loanCount, vaultSizes, brokerSizes, loanSizes] =
    await Promise.all([
      counted('current_state_d1_batches'),
      counted('current_state_d1_vaults'),
      counted('current_state_d1_loan_brokers'),
      counted('current_state_d1_loans'),
      sized('current_state_d1_vaults'),
      sized('current_state_d1_loan_brokers'),
      sized('current_state_d1_loans'),
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
  const relevantObjectCount = vaultCount + brokerCount + loanCount
  const rowsWrittenEstimate = 1 + batchCount + relevantObjectCount + 1 + 1
  const logicalBytes = rawBytes + projectionBytes + snapshot.normalized_bytes
  const projectedBytesWithIndexes = Math.ceil(logicalBytes * 1.75)

  return {
    snapshotId,
    status: snapshot.status,
    ledgerIndex: snapshot.ledger_index,
    pageCount: snapshot.page_count,
    requestCount: snapshot.request_count,
    decodedObjectCount: snapshot.decoded_object_count,
    relevantObjectCount,
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
  input: D1OperatorAction
  now?: () => string
  heapUsedBytes?: () => number
}): Promise<D1OperatorEvidence> {
  const now = options.now ?? (() => new Date().toISOString())
  const heapUsedBytes = options.heapUsedBytes ?? (() => 0)
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
      const timeoutMs = boundedPositiveInteger(options.input.timeoutMs, 'timeoutMs', MAX_TIMEOUT_MS)
      const maxPagesPerRun = boundedPositiveInteger(
        options.input.maxPagesPerRun ?? MAX_PAGES_PER_RUN,
        'maxPagesPerRun',
        MAX_PAGES_PER_RUN,
      )
      const objectLimitPerPage = boundedPositiveInteger(
        options.input.objectLimitPerPage ?? MAX_OBJECTS_PER_PAGE,
        'objectLimitPerPage',
        MAX_OBJECTS_PER_PAGE,
      )
      const maxRetries = boundedRetries(options.input.maxRetries)
      const startedAtMs = Date.now()
      let retries = 0
      let result
      while (true) {
        try {
          result = await runD1Bootstrap({
            db: options.db,
            identity: bootstrapIdentity(options.input.identity),
            timeoutMs,
            maxPagesPerRun,
            objectLimitPerPage,
            verifyOnComplete: false,
            now,
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
          operatorWallTimeMs: Date.now() - startedAtMs,
          heapUsedBytes: heapUsedBytes(),
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
        result: await measureD1Snapshot(options.db, options.input.snapshotId),
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
