import { prepareSnapshotObject } from '../../worker/repositories/d1-snapshot-object'
import { canonicalJson, utf8Bytes } from '../../worker/repositories/d1-snapshot'
import {
  scanCurrentStateBatch,
  type CurrentStatePage,
} from './scan-current-state'
import {
  MAX_OBJECTS_PER_BATCH,
  buildCapacityReport,
  type CapacityReport,
} from './capacity'

export interface CapacityScanResult {
  ledgerIndex: number
  ledgerHash: string
  pages: number
  requests: number
  decodedObjects: number
  relevantObjects: number
  rawBinaryBytes: number
  normalizedSnapshotBytes: number
  maximumRowBytes: number
  batchRows: number
  manifestBytes: number
  report: CapacityReport
}

function descriptorManifestBytes(batchRows: number, objectRows: number): number {
  const batches = Array.from({ length: batchRows }, (_, index) => ({
    sequence: index + 1,
    hash: 'a'.repeat(64),
    decodedObjects: 0,
    objects: index === batchRows - 1 ? objectRows % MAX_OBJECTS_PER_BATCH : MAX_OBJECTS_PER_BATCH,
    vaults: 0,
    loanBrokers: 0,
    loans: 0,
    normalizedBytes: 0,
  }))
  return utf8Bytes(canonicalJson({
    schemaVersion: 1,
    network: 'devnet',
    snapshotId: 'snapshot-capacity-measurement',
    epochId: 'epoch-capacity-measurement',
    ledgerIndex: 0,
    ledgerHash: 'a'.repeat(64),
    generatedAt: '2000-01-01T00:00:00.000Z',
    counts: { objects: objectRows, vaults: 0, loanBrokers: 0, loans: 0 },
    batchCount: batchRows,
    normalizedBytes: 0,
    batches,
  }))
}

async function measurePage(page: CurrentStatePage): Promise<{
  relevantObjects: number
  rawBinaryBytes: number
  normalizedBytes: number
  maximumRowBytes: number
  batchRows: number
}> {
  const objects = [...page.vaults, ...page.loanBrokers, ...page.loans]
  const prepared = await Promise.all(objects.map(prepareSnapshotObject))
  return {
    relevantObjects: objects.length,
    rawBinaryBytes: objects.reduce(
      (total, object) => total + Math.ceil(object.BinaryHex.length / 2),
      0,
    ),
    normalizedBytes: prepared.reduce((total, object) => total + object.normalizedBytes, 0),
    maximumRowBytes: prepared.reduce(
      (maximum, object) => Math.max(maximum, object.normalizedBytes + 512),
      0,
    ),
    batchRows: Math.max(1, Math.ceil(objects.length / MAX_OBJECTS_PER_BATCH)),
  }
}

export async function measureCurrentStateCapacity(options: {
  endpoint: string
  timeoutMs: number
  ledgerIndex: number
  ledgerHash: string
  existingDatabaseBytes: number
  historyReserveBytes: number
  maxPages?: number
  scanBatch?: typeof scanCurrentStateBatch
}): Promise<CapacityScanResult> {
  const scanBatch = options.scanBatch ?? scanCurrentStateBatch
  let relevantObjects = 0
  let rawBinaryBytes = 0
  let normalizedSnapshotBytes = 0
  let maximumRowBytes = 0
  let batchRows = 0

  const scan = await scanBatch({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    ledgerIndex: options.ledgerIndex,
    ledgerHash: options.ledgerHash,
    maxPages: options.maxPages ?? 2_000,
    objectLimitPerPage: 2_048,
    onPage: async (page) => {
      const measured = await measurePage(page)
      relevantObjects += measured.relevantObjects
      rawBinaryBytes += measured.rawBinaryBytes
      normalizedSnapshotBytes += measured.normalizedBytes
      maximumRowBytes = Math.max(maximumRowBytes, measured.maximumRowBytes)
      batchRows += measured.batchRows
    },
  })
  if (!scan.complete) throw new Error('Capacity scan did not complete the marker traversal')

  const manifestBytes = descriptorManifestBytes(batchRows, relevantObjects)
  const report = buildCapacityReport({
    existingDatabaseBytes: options.existingDatabaseBytes,
    normalizedSnapshotBytes,
    manifestBytes,
    objectRows: relevantObjects,
    batchRows,
    maximumRowBytes,
    maximumObjectsPerBatch: Math.min(MAX_OBJECTS_PER_BATCH, relevantObjects),
    historyReserveBytes: options.historyReserveBytes,
  })

  return {
    ledgerIndex: options.ledgerIndex,
    ledgerHash: options.ledgerHash,
    pages: scan.metrics.pages,
    requests: scan.metrics.requests,
    decodedObjects: scan.metrics.decodedObjects,
    relevantObjects,
    rawBinaryBytes,
    normalizedSnapshotBytes,
    maximumRowBytes,
    batchRows,
    manifestBytes,
    report,
  }
}
