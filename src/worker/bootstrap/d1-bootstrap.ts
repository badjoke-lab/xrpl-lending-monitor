import type { BootstrapIdentity } from '../../collector/current-state/bootstrap-runner'
import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import {
  loadD1BootstrapCheckpoint,
  updateD1BootstrapMetrics,
  type D1BootstrapCheckpoint,
} from '../repositories/d1-bootstrap-checkpoint-repository'
import { writeSnapshotBatch } from '../repositories/d1-snapshot-batch'
import { beginSnapshot } from '../repositories/d1-snapshot'
import { verifySnapshot, type SnapshotManifest } from '../repositories/d1-snapshot-verify'

const DEFAULT_OBJECT_LIMIT_PER_PAGE = 80
const DEFAULT_MAX_PAGES_PER_RUN = 25

export interface D1BootstrapResult {
  status: 'paused' | 'verified'
  checkpoint: D1BootstrapCheckpoint
  manifest: SnapshotManifest | null
  manifestHash: string | null
}

type Dependencies = {
  scanBatch: typeof scanCurrentStateBatch
  loadCheckpoint: typeof loadD1BootstrapCheckpoint
  updateMetrics: typeof updateD1BootstrapMetrics
  begin: typeof beginSnapshot
  writeBatch: typeof writeSnapshotBatch
  verify: typeof verifySnapshot
}

function emptyMetrics(objectLimitPerPage: number): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 0,
    requestedObjectsPerPage: objectLimitPerPage,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

function copyMetrics(metrics: CurrentStateScanMetrics): CurrentStateScanMetrics {
  return {
    ...metrics,
    byType: {
      vault: { ...metrics.byType.vault },
      loan_broker: { ...metrics.byType.loan_broker },
      loan: { ...metrics.byType.loan },
    },
  }
}

function addPage(metrics: CurrentStateScanMetrics, page: CurrentStatePage): void {
  metrics.pages += 1
  metrics.requests += 1
  metrics.decodedObjects += page.decodedObjects
  metrics.byType.vault.objects += page.vaults.length
  metrics.byType.loan_broker.objects += page.loanBrokers.length
  metrics.byType.loan.objects += page.loans.length
  metrics.objects += page.vaults.length + page.loanBrokers.length + page.loans.length
}

function validateLimits(objectLimitPerPage: number, maxPagesPerRun: number): void {
  if (!Number.isSafeInteger(objectLimitPerPage) || objectLimitPerPage < 1) {
    throw new Error('objectLimitPerPage must be a positive safe integer')
  }
  if (objectLimitPerPage > DEFAULT_OBJECT_LIMIT_PER_PAGE) {
    throw new Error(`D1 bootstrap objectLimitPerPage must not exceed ${DEFAULT_OBJECT_LIMIT_PER_PAGE}`)
  }
  if (!Number.isSafeInteger(maxPagesPerRun) || maxPagesPerRun < 1) {
    throw new Error('maxPagesPerRun must be a positive safe integer')
  }
}

function checkpointFrom(options: {
  identity: BootstrapIdentity
  nextMarker: unknown
  nextBatchSequence: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  updatedAt: string
}): D1BootstrapCheckpoint {
  return {
    snapshotId: options.identity.snapshotId,
    nextMarker: options.nextMarker,
    nextBatchSequence: options.nextBatchSequence,
    scanComplete: options.scanComplete,
    metrics: copyMetrics(options.metrics),
    updatedAt: options.updatedAt,
  }
}

export async function runD1Bootstrap(options: {
  db: D1Database
  identity: BootstrapIdentity
  timeoutMs: number
  maxPagesPerRun?: number
  objectLimitPerPage?: number
  now?: () => string
  dependencies?: Partial<Dependencies>
}): Promise<D1BootstrapResult> {
  const objectLimitPerPage = options.objectLimitPerPage ?? DEFAULT_OBJECT_LIMIT_PER_PAGE
  const maxPagesPerRun = options.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN
  validateLimits(objectLimitPerPage, maxPagesPerRun)

  const now = options.now ?? (() => new Date().toISOString())
  const dependencies: Dependencies = {
    scanBatch: options.dependencies?.scanBatch ?? scanCurrentStateBatch,
    loadCheckpoint: options.dependencies?.loadCheckpoint ?? loadD1BootstrapCheckpoint,
    updateMetrics: options.dependencies?.updateMetrics ?? updateD1BootstrapMetrics,
    begin: options.dependencies?.begin ?? beginSnapshot,
    writeBatch: options.dependencies?.writeBatch ?? writeSnapshotBatch,
    verify: options.dependencies?.verify ?? verifySnapshot,
  }

  await dependencies.begin(options.db, {
    id: options.identity.snapshotId,
    network: 'devnet',
    epochId: options.identity.epochId,
    ledgerIndex: options.identity.ledgerIndex,
    ledgerHash: options.identity.ledgerHash,
    endpoint: options.identity.endpoint,
    startedAt: now(),
  })

  const stored = await dependencies.loadCheckpoint(options.db, options.identity.snapshotId)
  let checkpoint = stored ?? checkpointFrom({
    identity: options.identity,
    nextMarker: null,
    nextBatchSequence: 1,
    scanComplete: false,
    metrics: emptyMetrics(objectLimitPerPage),
    updatedAt: now(),
  })

  if (checkpoint.metrics.requestedObjectsPerPage !== objectLimitPerPage) {
    throw new Error('D1 bootstrap object limit does not match the stored checkpoint')
  }

  if (!checkpoint.scanComplete) {
    const metrics = copyMetrics(checkpoint.metrics)
    const firstSequence = checkpoint.nextBatchSequence
    let lastCheckpoint = checkpoint

    const batch = await dependencies.scanBatch({
      endpoint: options.identity.endpoint,
      timeoutMs: options.timeoutMs,
      ledgerHash: options.identity.ledgerHash,
      ledgerIndex: options.identity.ledgerIndex,
      startMarker: firstSequence === 1 ? undefined : checkpoint.nextMarker,
      maxPages: maxPagesPerRun,
      objectLimitPerPage,
      onPage: async (page) => {
        const sequence = firstSequence + page.pageNumber - 1
        addPage(metrics, page)
        const writtenAt = now()
        await dependencies.writeBatch(options.db, {
          snapshotId: options.identity.snapshotId,
          sequence,
          markerBefore: page.markerBefore,
          markerAfter: page.markerAfter,
          decodedObjectCount: page.decodedObjects,
          vaults: page.vaults,
          loanBrokers: page.loanBrokers,
          loans: page.loans,
          cumulativeMetrics: metrics as unknown as Record<string, unknown>,
          writtenAt,
        })
        lastCheckpoint = checkpointFrom({
          identity: options.identity,
          nextMarker: page.markerAfter ?? null,
          nextBatchSequence: sequence + 1,
          scanComplete: page.markerAfter == null,
          metrics,
          updatedAt: writtenAt,
        })
      },
    })

    metrics.elapsedMs += batch.metrics.elapsedMs
    const updatedAt = now()
    await dependencies.updateMetrics({
      db: options.db,
      snapshotId: options.identity.snapshotId,
      metrics,
      updatedAt,
    })
    checkpoint = {
      ...lastCheckpoint,
      nextMarker: batch.nextMarker,
      scanComplete: batch.complete,
      metrics: copyMetrics(metrics),
      updatedAt,
    }

    if (!batch.complete) {
      return { status: 'paused', checkpoint, manifest: null, manifestHash: null }
    }
  }

  const verification = await dependencies.verify({
    db: options.db,
    snapshotId: options.identity.snapshotId,
    pageCount: checkpoint.metrics.pages,
    requestCount: checkpoint.metrics.requests,
    decodedObjectCount: checkpoint.metrics.decodedObjects,
    durationMs: checkpoint.metrics.elapsedMs,
    verifiedAt: now(),
  })

  return {
    status: 'verified',
    checkpoint,
    manifest: verification.manifest,
    manifestHash: verification.manifestHash,
  }
}
