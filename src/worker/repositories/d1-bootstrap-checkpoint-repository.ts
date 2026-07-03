import type { CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { canonicalJson } from './d1-snapshot'

export interface D1BootstrapCheckpoint {
  snapshotId: string
  nextMarker: unknown
  nextBatchSequence: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  updatedAt: string
}

interface CheckpointRow {
  marker_json: string | null
  next_batch_sequence: number
  scan_complete: number
  metrics_json: string
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function validMetrics(value: unknown): value is CurrentStateScanMetrics {
  if (!isRecord(value) || !isRecord(value.byType)) return false
  return (
    nonNegativeInteger(value.pages) &&
    nonNegativeInteger(value.requests) &&
    nonNegativeInteger(value.decodedObjects) &&
    nonNegativeInteger(value.objects) &&
    nonNegativeInteger(value.elapsedMs) &&
    positiveInteger(value.requestedObjectsPerPage) &&
    value.responseMode === 'binary' &&
    isRecord(value.byType.vault) &&
    nonNegativeInteger(value.byType.vault.objects) &&
    isRecord(value.byType.loan_broker) &&
    nonNegativeInteger(value.byType.loan_broker.objects) &&
    isRecord(value.byType.loan) &&
    nonNegativeInteger(value.byType.loan.objects)
  )
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${field} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function loadD1BootstrapCheckpoint(
  db: D1Database,
  snapshotId: string,
): Promise<D1BootstrapCheckpoint | null> {
  const row = await db
    .prepare(
      `SELECT marker_json, next_batch_sequence, scan_complete, metrics_json, updated_at
       FROM current_state_d1_bootstrap_checkpoints
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshotId)
    .first<CheckpointRow>()
  if (!row) return null

  const metrics = parseJson(row.metrics_json, 'D1 bootstrap metrics')
  if (!validMetrics(metrics)) throw new Error('D1 bootstrap metrics do not match the expected schema')
  if (!positiveInteger(row.next_batch_sequence)) {
    throw new Error('D1 bootstrap next batch sequence must be positive')
  }
  if (row.scan_complete !== 0 && row.scan_complete !== 1) {
    throw new Error('D1 bootstrap scan_complete must be 0 or 1')
  }

  const nextMarker = row.marker_json === null
    ? null
    : parseJson(row.marker_json, 'D1 bootstrap marker')
  const scanComplete = row.scan_complete === 1
  if (!scanComplete && row.next_batch_sequence > 1 && nextMarker === null) {
    throw new Error('Incomplete D1 bootstrap checkpoint must preserve its exact marker')
  }
  if (scanComplete && nextMarker !== null) {
    throw new Error('Complete D1 bootstrap checkpoint must not retain a marker')
  }

  return {
    snapshotId,
    nextMarker,
    nextBatchSequence: row.next_batch_sequence,
    scanComplete,
    metrics,
    updatedAt: row.updated_at,
  }
}

export async function updateD1BootstrapMetrics(options: {
  db: D1Database
  snapshotId: string
  metrics: CurrentStateScanMetrics
  updatedAt: string
}): Promise<void> {
  if (!validMetrics(options.metrics)) throw new Error('D1 bootstrap metrics are invalid')
  await options.db
    .prepare(
      `UPDATE current_state_d1_bootstrap_checkpoints
       SET metrics_json = ?1, updated_at = ?2
       WHERE snapshot_id = ?3`,
    )
    .bind(canonicalJson(options.metrics), options.updatedAt, options.snapshotId)
    .run()
}
