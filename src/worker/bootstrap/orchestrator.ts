import type { BootstrapIdentity } from '../../collector/current-state/bootstrap-runner'
import {
  loadD1BootstrapCheckpoint,
  type D1BootstrapCheckpoint,
} from '../repositories/d1-bootstrap-checkpoint-repository'
import { beginSnapshot } from '../repositories/d1-snapshot'
import { verifySnapshot, type SnapshotManifest } from '../repositories/d1-snapshot-verify'
import { PAGE_OBJECT_LIMIT } from './page-batching'
import {
  DEFAULT_PAGES_PER_RUN,
  createRunCheckpoint,
  emptyRunMetrics,
  validateRunLimits,
} from './run-helpers'
import { executeScanRun } from './scan-run'

export interface BootstrapResult {
  status: 'paused' | 'verified'
  checkpoint: D1BootstrapCheckpoint
  manifest: SnapshotManifest | null
  manifestHash: string | null
}

type Dependencies = {
  begin: typeof beginSnapshot
  loadCheckpoint: typeof loadD1BootstrapCheckpoint
  executeScan: typeof executeScanRun
  verify: typeof verifySnapshot
}

export async function orchestrateBootstrap(options: {
  db: D1Database
  identity: BootstrapIdentity
  timeoutMs: number
  maxPagesPerRun?: number
  objectLimitPerPage?: number
  now?: () => string
  dependencies?: Partial<Dependencies>
}): Promise<BootstrapResult> {
  const objectLimitPerPage = options.objectLimitPerPage ?? PAGE_OBJECT_LIMIT
  const maxPagesPerRun = options.maxPagesPerRun ?? DEFAULT_PAGES_PER_RUN
  validateRunLimits(objectLimitPerPage, maxPagesPerRun)

  const now = options.now ?? (() => new Date().toISOString())
  const dependencies: Dependencies = {
    begin: options.dependencies?.begin ?? beginSnapshot,
    loadCheckpoint: options.dependencies?.loadCheckpoint ?? loadD1BootstrapCheckpoint,
    executeScan: options.dependencies?.executeScan ?? executeScanRun,
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

  let checkpoint = await dependencies.loadCheckpoint(options.db, options.identity.snapshotId)
  checkpoint ??= createRunCheckpoint({
    identity: options.identity,
    nextMarker: null,
    nextBatchSequence: 1,
    scanComplete: false,
    metrics: emptyRunMetrics(objectLimitPerPage),
    updatedAt: now(),
  })

  if (checkpoint.metrics.requestedObjectsPerPage !== objectLimitPerPage) {
    throw new Error('D1 bootstrap object limit does not match the stored checkpoint')
  }

  checkpoint = await dependencies.executeScan({
    db: options.db,
    identity: options.identity,
    checkpoint,
    timeoutMs: options.timeoutMs,
    maxPagesPerRun,
    objectLimitPerPage,
    now,
  })

  if (!checkpoint.scanComplete) {
    return { status: 'paused', checkpoint, manifest: null, manifestHash: null }
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
