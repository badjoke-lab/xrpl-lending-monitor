import {
  scanCurrentStateBatch,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { ArtifactStore } from './artifact-metadata'
import type {
  ArtifactBootstrapCheckpoint,
  ArtifactBootstrapCheckpointStore,
  ArtifactBootstrapIdentity,
  ArtifactBootstrapResult,
} from './artifact-bootstrap-types'
import { buildPageArtifactSet } from './page-artifact-set'
import { persistPageArtifactSet } from './persist-page-artifact-set'

const DEFAULT_MAX_PAGES_PER_RUN = 25
const DEFAULT_OBJECT_LIMIT_PER_PAGE = 2_048

type ScanBatch = typeof scanCurrentStateBatch

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
  metrics.objects += page.vaults.length + page.loanBrokers.length + page.loans.length
  metrics.byType.vault.objects += page.vaults.length
  metrics.byType.loan_broker.objects += page.loanBrokers.length
  metrics.byType.loan.objects += page.loans.length
}

function validateLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function assertCheckpointIdentity(
  identity: ArtifactBootstrapIdentity,
  checkpoint: ArtifactBootstrapCheckpoint,
): void {
  const fields: (keyof ArtifactBootstrapIdentity)[] = [
    'network',
    'snapshotId',
    'epochId',
    'endpoint',
    'ledgerIndex',
    'ledgerHash',
  ]
  for (const field of fields) {
    if (checkpoint[field] !== identity[field]) {
      throw new Error(`Artifact bootstrap checkpoint ${field} does not match`)
    }
  }
  if (checkpoint.nextPageSequence !== checkpoint.pageManifests.length + 1) {
    throw new Error('Artifact bootstrap page sequence does not match page manifests')
  }
  if (!checkpoint.scanComplete && checkpoint.nextPageSequence > 1 && checkpoint.nextMarker == null) {
    throw new Error('Incomplete artifact bootstrap must preserve a continuation marker')
  }
}

function checkpointFrom(options: {
  identity: ArtifactBootstrapIdentity
  nextMarker: unknown
  nextPageSequence: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  pageManifests: ArtifactBootstrapCheckpoint['pageManifests']
}): ArtifactBootstrapCheckpoint {
  return {
    schemaVersion: 1,
    ...options.identity,
    nextMarker: options.nextMarker,
    nextPageSequence: options.nextPageSequence,
    scanComplete: options.scanComplete,
    metrics: copyMetrics(options.metrics),
    pageManifests: [...options.pageManifests],
  }
}

export async function runArtifactBootstrap(options: {
  identity: ArtifactBootstrapIdentity
  store: ArtifactStore
  checkpointStore: ArtifactBootstrapCheckpointStore
  timeoutMs: number
  maxPagesPerRun?: number
  objectLimitPerPage?: number
  maxObjectsPerShard?: number
  maxDataUncompressedBytes?: number
  maxIndexEntriesPerShard?: number
  maxIndexUncompressedBytes?: number
  scanBatch?: ScanBatch
}): Promise<ArtifactBootstrapResult> {
  const maxPagesPerRun = options.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN
  const objectLimitPerPage = options.objectLimitPerPage ?? DEFAULT_OBJECT_LIMIT_PER_PAGE
  validateLimit(maxPagesPerRun, 'maxPagesPerRun')
  validateLimit(objectLimitPerPage, 'objectLimitPerPage')

  const existing = await options.checkpointStore.load(options.identity.snapshotId)
  if (existing) assertCheckpointIdentity(options.identity, existing)
  let checkpoint = existing ?? checkpointFrom({
    identity: options.identity,
    nextMarker: null,
    nextPageSequence: 1,
    scanComplete: false,
    metrics: emptyMetrics(objectLimitPerPage),
    pageManifests: [],
  })
  if (checkpoint.metrics.requestedObjectsPerPage !== objectLimitPerPage) {
    throw new Error('Artifact bootstrap object limit does not match checkpoint')
  }
  if (checkpoint.scanComplete) return { status: 'complete', checkpoint }

  let metrics = copyMetrics(checkpoint.metrics)
  const pageManifests = [...checkpoint.pageManifests]
  const firstPageSequence = checkpoint.nextPageSequence
  let lastCommitted = checkpoint
  const scanBatch = options.scanBatch ?? scanCurrentStateBatch

  const batch = await scanBatch({
    endpoint: options.identity.endpoint,
    timeoutMs: options.timeoutMs,
    ledgerHash: options.identity.ledgerHash,
    ledgerIndex: options.identity.ledgerIndex,
    startMarker: firstPageSequence === 1 ? undefined : checkpoint.nextMarker,
    maxPages: maxPagesPerRun,
    objectLimitPerPage,
    onPage: async (page) => {
      const pageSequence = firstPageSequence + page.pageNumber - 1
      const nextMetrics = copyMetrics(metrics)
      addPage(nextMetrics, page)
      const artifactSet = await buildPageArtifactSet({
        identity: options.identity,
        pageSequence,
        markerAfter: page.markerAfter ?? null,
        vaults: page.vaults,
        loanBrokers: page.loanBrokers,
        loans: page.loans,
        maxObjectsPerShard: options.maxObjectsPerShard,
        maxDataUncompressedBytes: options.maxDataUncompressedBytes,
        maxIndexEntriesPerShard: options.maxIndexEntriesPerShard,
        maxIndexUncompressedBytes: options.maxIndexUncompressedBytes,
      })
      const nextCheckpoint = checkpointFrom({
        identity: options.identity,
        nextMarker: page.markerAfter ?? null,
        nextPageSequence: pageSequence + 1,
        scanComplete: page.markerAfter == null,
        metrics: nextMetrics,
        pageManifests: [
          ...pageManifests,
          {
            pageSequence,
            key: artifactSet.manifestKey,
            sha256: artifactSet.manifestSha256,
          },
        ],
      })
      await persistPageArtifactSet({
        store: options.store,
        artifactSet,
        commitCheckpoint: async () => options.checkpointStore.save(nextCheckpoint),
      })
      metrics = nextMetrics
      pageManifests.push(nextCheckpoint.pageManifests.at(-1)!)
      lastCommitted = nextCheckpoint
    },
  })

  metrics.elapsedMs += batch.metrics.elapsedMs
  checkpoint = checkpointFrom({
    identity: options.identity,
    nextMarker: batch.nextMarker,
    nextPageSequence: lastCommitted.nextPageSequence,
    scanComplete: batch.complete,
    metrics,
    pageManifests,
  })
  await options.checkpointStore.save(checkpoint)
  return { status: batch.complete ? 'complete' : 'paused', checkpoint }
}
