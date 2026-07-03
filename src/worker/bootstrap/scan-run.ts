import type { BootstrapIdentity } from '../../collector/current-state/bootstrap-runner'
import { scanCurrentStateBatch } from '../../collector/current-state/scan-current-state'
import {
  updateD1BootstrapMetrics,
  type D1BootstrapCheckpoint,
} from '../repositories/d1-bootstrap-checkpoint-repository'
import { persistPageBatches } from './page-batching'
import {
  addRunPage,
  copyRunMetrics,
  createRunCheckpoint,
} from './run-helpers'

export async function executeScanRun(options: {
  db: D1Database
  identity: BootstrapIdentity
  checkpoint: D1BootstrapCheckpoint
  timeoutMs: number
  maxPagesPerRun: number
  objectLimitPerPage: number
  now: () => string
  scanBatch?: typeof scanCurrentStateBatch
  persistPage?: typeof persistPageBatches
  updateMetrics?: typeof updateD1BootstrapMetrics
}): Promise<D1BootstrapCheckpoint> {
  if (options.checkpoint.scanComplete) return options.checkpoint

  const scanBatch = options.scanBatch ?? scanCurrentStateBatch
  const persistPage = options.persistPage ?? persistPageBatches
  const updateMetrics = options.updateMetrics ?? updateD1BootstrapMetrics
  const metrics = copyRunMetrics(options.checkpoint.metrics)
  let nextSequence = options.checkpoint.nextBatchSequence
  let lastCheckpoint = options.checkpoint

  const batch = await scanBatch({
    endpoint: options.identity.endpoint,
    timeoutMs: options.timeoutMs,
    ledgerHash: options.identity.ledgerHash,
    ledgerIndex: options.identity.ledgerIndex,
    startMarker: nextSequence === 1 ? undefined : options.checkpoint.nextMarker,
    maxPages: options.maxPagesPerRun,
    objectLimitPerPage: options.objectLimitPerPage,
    onPage: async (page) => {
      addRunPage(metrics, page)
      const persisted = await persistPage({
        db: options.db,
        snapshotId: options.identity.snapshotId,
        page,
        metrics,
        nextSequence,
        now: options.now,
      })
      nextSequence = persisted.nextSequence
      lastCheckpoint = createRunCheckpoint({
        identity: options.identity,
        nextMarker: page.markerAfter ?? null,
        nextBatchSequence: nextSequence,
        scanComplete: page.markerAfter == null,
        metrics,
        updatedAt: persisted.updatedAt,
      })
    },
  })

  metrics.elapsedMs += batch.metrics.elapsedMs
  const updatedAt = options.now()
  await updateMetrics({
    db: options.db,
    snapshotId: options.identity.snapshotId,
    metrics,
    updatedAt,
  })

  return {
    ...lastCheckpoint,
    nextMarker: batch.nextMarker,
    scanComplete: batch.complete,
    metrics: copyRunMetrics(metrics),
    updatedAt,
  }
}
